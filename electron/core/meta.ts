import { randomUUID } from "node:crypto";
import { app } from "electron";
import { pathManager } from "../utils/paths";
import { readJson, writeJsonAtomic } from "../utils/fsx";
import logger from "../utils/logger";

export const DATA_FORMAT_VERSION = 1;

export interface AppMeta {
  /** 匿名安装标识（日志/备份关联用，不含个人信息） */
  installId: string;
  dataFormatVersion: number;
  createdAt: string;
  /** 最后一次成功启动的版本 */
  appVersion: string;
  /** 与 PRAGMA user_version 同步 */
  schemaVersion: number;
  /** 允许写入本数据目录的最低程序版本（语义化版本） */
  minReaderVersion: string;
  /** 首启向导是否完成 */
  firstRunCompleted: boolean;
  /** 正常退出标记：启动置 false，正常退出置 true */
  cleanExit: boolean;
  lastBackupAt?: string;
  lastMigration?: { from: number; to: number; at: string; backup: string | null };
  lastRestoreAt?: string;
  /** 升级前的程序版本（安装后首启用它判断是否需要迁移备份保留） */
  lastUpdateFrom?: string;
  seenUpdateVersions?: string[];
  legacyAdoptedFrom?: string;
}

function defaults(): AppMeta {
  return {
    installId: randomUUID(),
    dataFormatVersion: DATA_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    schemaVersion: 0,
    minReaderVersion: app.getVersion(),
    firstRunCompleted: false,
    cleanExit: false,
  };
}

export function readMeta(): AppMeta | null {
  const raw = readJson<Partial<AppMeta>>(pathManager.getMetaFile());
  if (!raw) return null;
  return { ...defaults(), ...raw } as AppMeta;
}

export function writeMeta(meta: AppMeta): void {
  writeJsonAtomic(pathManager.getMetaFile(), meta);
}

/** 首次创建或补齐缺失字段 */
export function ensureMeta(): { meta: AppMeta; created: boolean } {
  const existing = readMeta();
  if (existing) return { meta: existing, created: false };
  const meta = defaults();
  writeMeta(meta);
  logger.info({ installId: meta.installId }, "创建数据目录元信息");
  return { meta, created: true };
}

export function updateMeta(patch: Partial<AppMeta>): AppMeta {
  const current = readMeta() ?? defaults();
  const next = { ...current, ...patch };
  writeMeta(next);
  return next;
}

/** 启动时标记「运行中」，用于检测非正常退出 */
export function markBoot(schemaVersion: number): AppMeta {
  return updateMeta({ cleanExit: false, appVersion: app.getVersion(), schemaVersion });
}

export function markCleanExit(): void {
  updateMeta({ cleanExit: true, appVersion: app.getVersion() });
}

/** 语义化版本比较：a < b → -1，相等 → 0，a > b → 1 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}
