import fs from "node:fs";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/index";
import { pathManager } from "../utils/paths";
import { dirSize, fileSize, listFilesRecursive, rmIfExists, stamp } from "../utils/fsx";
import logger from "../utils/logger";

export interface IntegrityIssue {
  kind: string;
  count: number;
  samples: string[];
  hint: string;
}

export interface DatabaseCheck {
  ok: boolean;
  messages: string[];
  mode: "quick" | "full";
  durationMs: number;
}

/** PRAGMA quick_check / integrity_check */
export async function checkDatabase(full = false): Promise<DatabaseCheck> {
  const started = Date.now();
  const statement = full ? sql`PRAGMA integrity_check` : sql`PRAGMA quick_check`;
  try {
    const rows = await db.all<Record<string, string>>(statement);
    const messages = rows.map((row) => String(Object.values(row)[0] ?? "")).filter(Boolean);
    const ok = messages.length === 1 && messages[0] === "ok";
    const result: DatabaseCheck = { ok, messages, mode: full ? "full" : "quick", durationMs: Date.now() - started };
    if (!ok) logger.error({ messages }, "数据库完整性校验未通过");
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, "数据库完整性校验失败");
    return { ok: false, messages: [message], mode: full ? "full" : "quick", durationMs: Date.now() - started };
  }
}

const SAMPLE_LIMIT = 10;

/** 结构性巡检：悬挂引用、附件记录与物理文件失配 */
export async function scanIssues(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];

  const orphanItems = await db.all<{ key: string }>(sql`
    SELECT i.xqabpj || '|' || i.xqab001 || '|' || i.xqabseq AS key
    FROM xqab_t i
    WHERE NOT EXISTS (
      SELECT 1 FROM xqaa_t m WHERE m.xqaapj = i.xqabpj AND m.xqaa001 = i.xqab001
    ) LIMIT ${SAMPLE_LIMIT}`);
  const orphanItemCount = await countOf(sql`
    SELECT COUNT(*) AS n FROM xqab_t i
    WHERE NOT EXISTS (
      SELECT 1 FROM xqaa_t m WHERE m.xqaapj = i.xqabpj AND m.xqaa001 = i.xqab001)`);
  if (orphanItemCount > 0) {
    issues.push({
      kind: "dangling-items",
      count: orphanItemCount,
      samples: orphanItems.map((r) => r.key),
      hint: "明细所属需求书已不存在（历史非事务删除遗留）",
    });
  }

  const orphanMasters = await db.all<{ key: string }>(sql`
    SELECT m.xqaapj || '|' || m.xqaa001 AS key FROM xqaa_t m
    WHERE NOT EXISTS (SELECT 1 FROM pjaa p WHERE p.pjaa001 = m.xqaapj) LIMIT ${SAMPLE_LIMIT}`);
  const orphanMasterCount = await countOf(sql`
    SELECT COUNT(*) AS n FROM xqaa_t m
    WHERE NOT EXISTS (SELECT 1 FROM pjaa p WHERE p.pjaa001 = m.xqaapj)`);
  if (orphanMasterCount > 0) {
    issues.push({
      kind: "dangling-masters",
      count: orphanMasterCount,
      samples: orphanMasters.map((r) => r.key),
      hint: "需求书所属项目已不存在",
    });
  }

  const attachments = await db.all<{ ffff003: string; ffff004: string; ffff002: string }>(sql`
    SELECT ffff003, ffff004, ffff002 FROM ffff_t`);
  const missingFiles: string[] = [];
  let missingCount = 0;
  const referenced = new Set<string>();
  for (const row of attachments) {
    referenced.add(path.resolve(row.ffff003));
    if (!fs.existsSync(path.join(pathManager.getFilesRoot(), row.ffff003))) {
      missingCount++;
      if (missingFiles.length < SAMPLE_LIMIT) missingFiles.push(row.ffff003);
    }
  }
  if (missingCount > 0) {
    issues.push({
      kind: "missing-files",
      count: missingCount,
      samples: missingFiles,
      hint: "附件记录存在但物理文件缺失（可从备份恢复或重新上传）",
    });
  }

  const orphans = listOrphanFiles(referenced);
  if (orphans.length > 0) {
    issues.push({
      kind: "orphan-files",
      count: orphans.length,
      samples: orphans.slice(0, SAMPLE_LIMIT).map((item) => item.rel),
      hint: "物理文件未被任何附件记录引用（可安全清理至回收站）",
    });
  }

  return issues;
}

async function countOf(statement: SQL<unknown>): Promise<number> {
  const row = await db.get<{ n: number }>(statement);
  return Number(row?.n ?? 0);
}

export interface OrphanFile {
  rel: string;
  abs: string;
  sizeBytes: number;
}

/** files/ 下未被 ffff_t 引用的文件（.trash 内部不计） */
export function listOrphanFiles(referenced?: Set<string>): OrphanFile[] {
  const root = pathManager.getFilesRoot();
  if (!fs.existsSync(root)) return [];
  const trash = path.resolve(pathManager.getTrashRoot());
  const result: OrphanFile[] = [];
  for (const abs of listFilesRecursive(root)) {
    const resolved = path.resolve(abs);
    if (resolved.startsWith(trash)) continue;
    const rel = path.relative(root, resolved);
    if (referenced?.has(path.resolve(rel))) continue;
    result.push({ rel, abs: resolved, sizeBytes: fileSize(resolved) });
  }
  return result;
}

/** 把孤立附件移入回收站（不直接删除，7 天后由 housekeeping 清理） */
export async function gcOrphanFiles(
  referenced?: Set<string>,
  dryRun = false,
): Promise<{ count: number; bytes: number; samples: string[] }> {
  const refs = referenced ?? (await referencedPaths());
  const orphans = listOrphanFiles(refs);
  const bytes = orphans.reduce((sum, item) => sum + item.sizeBytes, 0);
  if (dryRun || orphans.length === 0) {
    return { count: orphans.length, bytes, samples: orphans.slice(0, SAMPLE_LIMIT).map((o) => o.rel) };
  }
  const target = path.join(pathManager.getTrashRoot(), stamp());
  for (const item of orphans) {
    const dest = path.join(target, item.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.renameSync(item.abs, dest);
    } catch {
      fs.copyFileSync(item.abs, dest);
      rmIfExists(item.abs);
    }
  }
  logger.audit({
    action: "gc-orphan-files",
    detail: { count: orphans.length, bytes, target },
    result: "ok",
  });
  return { count: orphans.length, bytes, samples: orphans.slice(0, SAMPLE_LIMIT).map((o) => o.rel) };
}

async function referencedPaths(): Promise<Set<string>> {
  const rows = await db.all<{ ffff003: string }>(sql`SELECT ffff003 FROM ffff_t`);
  return new Set(rows.map((row) => path.resolve(row.ffff003)));
}

/** 清理回收站中超过保留期的内容 */
export function pruneTrash(keepDays = 7): number {
  const trash = pathManager.getTrashRoot();
  if (!fs.existsSync(trash)) return 0;
  const cutoff = Date.now() - keepDays * 86_400_000;
  let removed = 0;
  for (const entry of fs.readdirSync(trash)) {
    const full = path.join(trash, entry);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        rmIfExists(full);
        removed++;
      }
    } catch (err) {
      logger.warn({ entry, error: String(err) }, "清理回收站失败");
    }
  }
  return removed;
}

export function filesUsage(): number {
  return dirSize(pathManager.getFilesRoot());
}
