import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { CURRENT_SCHEMA_VERSION } from "../db/migrations";
import { maintenance } from "../core/maintenance";
import { readMeta, updateMeta } from "../core/meta";
import { pathManager } from "../utils/paths";
import { readSqliteHeader } from "../utils/sqlite-header";
import {
  copyFileVerified,
  ensureDir,
  fileSize,
  readJson,
  rmIfExists,
  stamp,
  writeJsonAtomic,
} from "../utils/fsx";
import logger from "../utils/logger";

export type BackupKind =
  | "auto"
  | "manual"
  | "pre-migrate"
  | "pre-restore"
  | "pre-import"
  | "pre-reset"
  | "pre-update";

export interface BackupEntry {
  id: string;
  fileName: string;
  filePath: string;
  kind: BackupKind;
  sizeBytes: number;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
}

const AUTO_DIR = () => pathManager.getAutoBackupsPath();
const MANUAL_DIR = () => pathManager.getManualBackupsPath();
const DAILY_KEEP_DAYS = 30;
const MIN_KEEP = 5;
const MAX_AUTO = 20;
const PRE_KEEP_DAYS = 7;

function sidecar(file: string): string {
  return `${file}.json`;
}

function dirFor(kind: BackupKind): string {
  return kind === "manual" ? MANUAL_DIR() : AUTO_DIR();
}

function ageDays(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

async function currentSchemaVersion(): Promise<number> {
  const row = await db.get<{ user_version: number }>(sql`PRAGMA user_version`);
  return Number(row?.user_version ?? 0);
}

/**
 * SQLite 官方一致性热备：VACUUM INTO。
 * 千万不要用 fs.copyFileSync 备份 WAL 模式的库——会丢失未 checkpoint 的事务。
 */
async function vacuumInto(target: string): Promise<void> {
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  ensureDir(path.dirname(target));
  const escaped = target.replace(/'/g, "''");
  await db.run(sql.raw(`VACUUM INTO '${escaped}'`));
}

function toEntry(filePath: string, kind: BackupKind): BackupEntry {
  const cached = readJson<Partial<BackupEntry>>(sidecar(filePath));
  const stat = fs.statSync(filePath);
  return {
    id: path.basename(filePath),
    fileName: path.basename(filePath),
    filePath,
    kind: (cached?.kind as BackupKind) ?? kind,
    sizeBytes: stat.size,
    createdAt: cached?.createdAt ?? stat.mtime.toISOString(),
    appVersion: cached?.appVersion ?? "unknown",
    schemaVersion: cached?.schemaVersion ?? 0,
  };
}

/** 不限并发地创建备份（供维护任务内部调用，避免嵌套独占锁） */
export async function createBackupUnlocked(
  kind: BackupKind,
  label?: string,
): Promise<BackupEntry> {
  const dir = dirFor(kind);
  ensureDir(dir);
  const fileName = `${kind}${label ? `-${label}` : ""}-${stamp()}.db`;
  const filePath = path.join(dir, fileName);
  const schemaVersion = await currentSchemaVersion();
  await vacuumInto(filePath);

  const entry: BackupEntry = {
    id: fileName,
    fileName,
    filePath,
    kind,
    sizeBytes: fileSize(filePath),
    createdAt: new Date().toISOString(),
    appVersion: readMeta()?.appVersion ?? app.getVersion(),
    schemaVersion,
  };
  writeJsonAtomic(sidecar(filePath), entry);
  updateMeta({ lastBackupAt: entry.createdAt });
  logger.info({ kind, fileName, sizeBytes: entry.sizeBytes, schemaVersion }, "创建数据备份");
  return entry;
}

/**
 * 解析备份 id / 路径，拒绝越界访问：
 * 只接受「备份目录内的文件名」或「位于备份目录内的绝对路径」。
 */
export function resolveBackupFile(idOrPath: string): string {
  const dirs = [AUTO_DIR(), MANUAL_DIR()].map((dir) => path.resolve(dir));
  const candidates = [...dirs.map((dir) => path.join(dir, path.basename(idOrPath))), path.resolve(idOrPath)];
  for (const candidate of candidates) {
    if (!candidate.endsWith(".db")) continue;
    const inside = dirs.some((dir) => {
      const rel = path.relative(dir, candidate);
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    });
    if (inside && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`备份文件不存在：${idOrPath}`);
}

export interface BackupInspection {
  ok: boolean;
  schemaVersion: number;
  message?: string;
  sizeBytes: number;
}

/** 只读文件头校验（不打开数据库连接，避免锁住待恢复的文件） */
export function inspectBackup(filePath: string): BackupInspection {
  const header = readSqliteHeader(filePath);
  if (!header.ok) {
    return { ok: false, schemaVersion: 0, sizeBytes: header.sizeBytes, message: header.message };
  }
  if (header.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      schemaVersion: header.schemaVersion,
      sizeBytes: header.sizeBytes,
      message: `备份数据版本（${header.schemaVersion}）高于当前程序支持版本（${CURRENT_SCHEMA_VERSION}），请先升级程序`,
    };
  }
  return { ok: true, schemaVersion: header.schemaVersion, sizeBytes: header.sizeBytes };
}

/** 待恢复标记文件（换库在下次启动、尚未建立任何数据库连接时执行） */
function pendingRestoreMarker(): string {
  return path.join(pathManager.getTmpPath(), "pending-restore.json");
}

function stagedRestoreFile(): string {
  return path.join(pathManager.getTmpPath(), "pending-restore.db");
}

interface PendingRestore {
  source: string;
  requestedAt: string;
  schemaVersion: number;
  preBackup: string | null;
}

export const backupService = {
  create(kind: BackupKind, label?: string): Promise<BackupEntry> {
    return maintenance.runExclusive("backup", () => createBackupUnlocked(kind, label));
  },

  list(): BackupEntry[] {
    const result: BackupEntry[] = [];
    for (const [dir, kind] of [
      [AUTO_DIR(), "auto"],
      [MANUAL_DIR(), "manual"],
    ] as const) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".db")) continue;
        try {
          result.push(toEntry(path.join(dir, name), kind));
        } catch (err) {
          logger.warn({ name, error: String(err) }, "读取备份条目失败");
        }
      }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  latest(): BackupEntry | null {
    return backupService.list()[0] ?? null;
  },

  /** 保留策略：最新 5 份 + 每日 1 份（30 天）+ pre-* 7 天；auto 总数上限 20；manual 永不自动删 */
  prune(): number {
    const all = backupService.list().filter((entry) => entry.kind !== "manual");
    const sorted = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const keep = new Set<string>();
    sorted.slice(0, MIN_KEEP).forEach((entry) => keep.add(entry.id));

    const days = new Set<string>();
    for (const entry of sorted) {
      const day = entry.createdAt.slice(0, 10);
      if (!days.has(day) && ageDays(entry.createdAt) <= DAILY_KEEP_DAYS) {
        days.add(day);
        keep.add(entry.id);
      }
    }
    for (const entry of sorted) {
      if (entry.kind.startsWith("pre-") && ageDays(entry.createdAt) <= PRE_KEEP_DAYS) {
        keep.add(entry.id);
      }
    }

    // auto 总数上限
    const kept = sorted.filter((entry) => keep.has(entry.id));
    if (kept.length > MAX_AUTO) {
      const removable = kept
        .filter((entry) => !entry.kind.startsWith("pre-"))
        .slice(MAX_AUTO);
      for (const entry of removable) keep.delete(entry.id);
    }

    let removed = 0;
    for (const entry of sorted) {
      if (keep.has(entry.id)) continue;
      try {
        rmIfExists(entry.filePath);
        rmIfExists(sidecar(entry.filePath));
        removed++;
      } catch (err) {
        logger.warn({ file: entry.fileName, error: String(err) }, "删除过期备份失败");
      }
    }
    if (removed > 0) logger.info({ removed, kept: keep.size }, "清理过期备份");
    return removed;
  },

  async saveAs(idOrPath: string, targetPath: string): Promise<string> {
    const source = resolveBackupFile(idOrPath);
    copyFileVerified(source, targetPath);
    logger.info({ source, targetPath }, "备份另存为");
    return targetPath;
  },

  /** 仅允许删除手动备份，或超过 24 小时的自动备份 */
  delete(id: string): void {
    const filePath = resolveBackupFile(id);
    const isManual = path.dirname(filePath) === path.resolve(MANUAL_DIR());
    if (!isManual && ageDays(toEntry(filePath, "auto").createdAt) < 1) {
      throw new Error("最近 24 小时内的自动备份不可删除");
    }
    rmIfExists(filePath);
    rmIfExists(sidecar(filePath));
    logger.info({ filePath }, "删除备份");
  },

  /**
   * 恢复备份（两阶段）：
   *  阶段一（本次进程）：拷到 tmp/pending-restore.db 并写标记；
   *  阶段二（下次启动、建库连接之前）：在 main 中调用 applyPendingRestore 换库。
   * 之所以不在本进程直接换库：libsql 原生客户端在 Windows 上 close() 后仍持有文件句柄，
   * 本进程内无法删除/重命名 app.db。
   */
  async stageRestore(
    idOrPath: string,
    opts: { skipPreBackup?: boolean } = {},
  ): Promise<{ entry: BackupEntry; preBackup: BackupEntry | null; schemaVersion: number }> {
    return maintenance.runExclusive("restore", async () => {
      const filePath = resolveBackupFile(idOrPath);
      const inspection = inspectBackup(filePath);
      if (!inspection.ok) throw new Error(inspection.message ?? "备份文件不可用");

      const preBackup = opts.skipPreBackup ? null : await createBackupUnlocked("pre-restore");
      const staged = stagedRestoreFile();
      rmIfExists(staged);
      copyFileVerified(filePath, staged);

      const marker: PendingRestore = {
        source: path.basename(filePath),
        requestedAt: new Date().toISOString(),
        schemaVersion: inspection.schemaVersion,
        preBackup: preBackup?.fileName ?? null,
      };
      writeJsonAtomic(pendingRestoreMarker(), marker);
      logger.audit({
        action: "restore-staged",
        target: marker.source,
        detail: { schemaVersion: inspection.schemaVersion, preBackup: marker.preBackup },
        result: "ok",
      });
      return { entry: toEntry(filePath, "auto"), preBackup, schemaVersion: inspection.schemaVersion };
    });
  },

  pendingRestore(): PendingRestore | null {
    return readJson<PendingRestore>(pendingRestoreMarker());
  },

  /** 启动时：当日无备份则创建一份，并执行保留策略 */  async onAppStart(): Promise<void> {
    try {
      await maintenance.runExclusive("backup", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const hasToday = backupService
          .list()
          .some((entry) => entry.createdAt.slice(0, 10) === today && entry.kind === "auto");
        if (!hasToday) await createBackupUnlocked("auto", "daily");
        backupService.prune();
      });
    } catch (err) {
      logger.warn({ error: String(err) }, "启动备份失败（不阻塞启动）");
    }
  },

  /** 退出时：当日有过备份则跳过，避免拖慢退出 */
  async onAppQuit(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = backupService
      .list()
      .some((entry) => entry.createdAt.slice(0, 10) === today && entry.kind === "auto");
    if (hasToday) return;
    await createBackupUnlocked("auto", "exit");
    backupService.prune();
  },
};

export { createBackupUnlocked as createBackupNow };

/**
 * 阶段二：在「尚未建立任何数据库连接」的启动早期完成换库。
 * 必须在 bootstrapDb() 之前调用。
 */
export function applyPendingRestore(): { applied: boolean; source?: string; reason?: string } {
  const marker = readJson<PendingRestore>(pendingRestoreMarker());
  if (!marker) return { applied: false };

  const staged = stagedRestoreFile();
  if (!fs.existsSync(staged)) {
    rmIfExists(pendingRestoreMarker());
    logger.warn({ source: marker.source }, "待恢复暂存文件缺失，已放弃恢复");
    return { applied: false, reason: "暂存文件不存在" };
  }

  const header = readSqliteHeader(staged);
  if (!header.ok) {
    const failed = `${staged}.failed-${stamp()}`;
    try {
      fs.renameSync(staged, failed);
    } catch {
      // 忽略：tmp 会在本次启动的清理阶段被清空
    }
    rmIfExists(pendingRestoreMarker());
    logger.error({ source: marker.source, message: header.message }, "待恢复文件校验未通过，已放弃恢复");
    return { applied: false, reason: header.message };
  }

  const target = pathManager.getSqliteFile();
  for (const candidate of [target, `${target}-wal`, `${target}-shm`]) rmIfExists(candidate);
  fs.renameSync(staged, target); // tmp 与 db 同分区，rename 为原子操作
  rmIfExists(pendingRestoreMarker());
  updateMeta({ cleanExit: false, lastRestoreAt: new Date().toISOString() });
  logger.audit({
    action: "restore-applied",
    target: marker.source,
    detail: { schemaVersion: header.schemaVersion, preBackup: marker.preBackup },
    result: "ok",
  });
  return { applied: true, source: marker.source };
}
