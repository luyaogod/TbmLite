import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { CURRENT_SCHEMA_VERSION } from "../db/migrations";
import { maintenance } from "../core/maintenance";
import { readMeta, updateMeta } from "../core/meta";
import { checkDatabase, filesUsage, gcOrphanFiles, listOrphanFiles, scanIssues, type DatabaseCheck, type IntegrityIssue } from "../core/integrity";
import { backupService, createBackupNow } from "./backup-service";
import { configFilePath } from "../core/agent/config";
import { dirSize, fileSize, rmIfExists, stamp } from "../utils/fsx";
import { pathManager } from "../utils/paths";
import logger from "../utils/logger";

export interface DataHealth {
  appVersion: string;
  schemaVersion: number;
  currentSchemaVersion: number;
  minReaderVersion: string | null;
  installId: string | null;
  dataRoot: string;
  firstRunCompleted: boolean;
  lastBackupAt: string | null;
  lastRestoreAt: string | null;
  lastMigration: { from: number; to: number; at: string; backup: string | null } | null;
  sizes: { db: number; files: number; logs: number; backups: number; total: number };
  counts: {
    projects: number;
    requirements: number;
    items: number;
    attachments: number;
    sessions: number;
  };
  backups: { count: number; latestAt: string | null; latestFile: string | null };
  integrity: DatabaseCheck | null;
}

async function countOf(table: string): Promise<number> {
  const row = await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)}`);
  return Number(row?.n ?? 0);
}

function sessionCount(): number {
  const dir = pathManager.getSessionsPath();
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).length;
}

export async function getHealth(options: { check?: boolean } = {}): Promise<DataHealth> {
  const meta = readMeta();
  const schemaVersion = await db
    .get<{ user_version: number }>(sql`PRAGMA user_version`)
    .then((row) => Number(row?.user_version ?? 0))
    .catch(() => 0);

  const dbSize = fileSize(pathManager.getSqliteFile());
  const logsSize = dirSize(pathManager.getLogsPath());
  const backupsSize = dirSize(pathManager.getBackupsPath());
  const backups = backupService.list();
  const files = filesUsage();

  return {
    appVersion: meta?.appVersion ?? "",
    schemaVersion,
    currentSchemaVersion: CURRENT_SCHEMA_VERSION,
    minReaderVersion: meta?.minReaderVersion ?? null,
    installId: meta?.installId ?? null,
    dataRoot: pathManager.getRoot(),
    firstRunCompleted: meta?.firstRunCompleted ?? false,
    lastBackupAt: meta?.lastBackupAt ?? null,
    lastRestoreAt: meta?.lastRestoreAt ?? null,
    lastMigration: meta?.lastMigration ?? null,
    sizes: { db: dbSize, files, logs: logsSize, backups: backupsSize, total: dbSize + files + logsSize + backupsSize },
    counts: {
      projects: await countOf("pjaa"),
      requirements: await countOf("xqaa_t"),
      items: await countOf("xqab_t"),
      attachments: await countOf("ffff_t"),
      sessions: sessionCount(),
    },
    backups: {
      count: backups.length,
      latestAt: backups[0]?.createdAt ?? null,
      latestFile: backups[0]?.fileName ?? null,
    },
    integrity: options.check ? await checkDatabase(false) : null,
  };
}

export async function runIntegrityScan(): Promise<{ check: DatabaseCheck; issues: IntegrityIssue[] }> {
  return { check: await checkDatabase(true), issues: await scanIssues() };
}

export async function runGc(dryRun: boolean): Promise<{ count: number; bytes: number; samples: string[] }> {
  if (dryRun) {
    const orphans = listOrphanFiles();
    return {
      count: orphans.length,
      bytes: orphans.reduce((sum, item) => sum + item.sizeBytes, 0),
      samples: orphans.slice(0, 10).map((item) => item.rel),
    };
  }
  return maintenance.runExclusive("gc", () => gcOrphanFiles());
}

export type ResetScope = "business" | "factory";

const CONFIRM_WORD: Record<ResetScope, string> = { business: "CLEAR", factory: "RESET" };

/**
 * 重置数据。始终先自动备份，物理附件移入回收站（可人工取回）。
 */
export async function resetData(
  scope: ResetScope,
  confirm: string,
): Promise<{ backupId: string }> {
  if (confirm !== CONFIRM_WORD[scope]) {
    throw new Error(`确认词不正确，请输入 ${CONFIRM_WORD[scope]}`);
  }
  return maintenance.runExclusive("reset", async () => {
    const backup = await createBackupNow("pre-reset", scope);
    const ownerKeys = await db.all<{ ffff002: string }>(sql`SELECT DISTINCT ffff002 FROM ffff_t`);

    await db.transaction(async (tx) => {
      await tx.run(sql`DELETE FROM ffff_t`);
      await tx.run(sql`DELETE FROM xqab_t`);
      await tx.run(sql`DELETE FROM xqaa_t`);
      await tx.run(sql`DELETE FROM pjaa`);
    });

    // 附件物理文件移入回收站（而非直接删除）
    const trash = path.join(pathManager.getTrashRoot(), `reset-${stamp()}`);
    const filesRoot = pathManager.getFilesRoot();
    const tableDir = path.join(filesRoot, "xqaa_t");
    if (fs.existsSync(tableDir)) {
      fs.mkdirSync(path.join(trash, "xqaa_t"), { recursive: true });
      for (const name of fs.readdirSync(tableDir)) {
        const from = path.join(tableDir, name);
        const to = path.join(trash, "xqaa_t", name);
        try {
          fs.renameSync(from, to);
        } catch {
          fs.copyFileSync(from, to);
          rmIfExists(from);
        }
      }
    }

    let removedSessions = 0;
    if (scope === "factory") {
      rmIfExists(configFilePath());
      const sessions = pathManager.getSessionsPath();
      if (fs.existsSync(sessions)) {
        removedSessions = fs.readdirSync(sessions).length;
        for (const name of fs.readdirSync(sessions)) rmIfExists(path.join(sessions, name));
      }
    }

    updateMeta({ firstRunCompleted: scope === "factory" ? false : (readMeta()?.firstRunCompleted ?? false) });
    logger.audit({
      action: scope === "business" ? "reset-business" : "reset-factory",
      detail: {
        backup: backup.fileName,
        owners: ownerKeys.length,
        removedSessions,
        trash,
      },
      result: "ok",
    });
    return { backupId: backup.fileName };
  });
}
