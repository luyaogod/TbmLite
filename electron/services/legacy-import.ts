import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { createClient, type Client } from "@libsql/client";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { ffff_t, pjaa, xqaa_t, xqab_t } from "../db/schema";
import { maintenance } from "../core/maintenance";
import { pathManager } from "../utils/paths";
import { ensureDir } from "../utils/fsx";
import { createBackupUnlocked, stageRestoreUnlocked } from "./backup-service";
import logger from "../utils/logger";

/**
 * 旧 TBM 数据导入（产品化版本，替代一次性脚本）。
 *
 * 迁移范围与 scripts/migrate-from-tbm.ts 保持一致：
 *   pjaa / xqaa_t / xqab_t 全量 + 需求书附件（ffff001 = 'xqaa_t'），
 *   xqac_t（待办）等新版本已移除的功能不迁移。
 *
 * 特性：目录自动探测 / 导入前预览 / 幂等（INSERT OR IGNORE）/
 *      悬挂行与缺失物理文件跳过并计数 / 失败自动回滚到导入前备份。
 */

const LEGACY_TABLES = ["pjaa", "xqaa_t", "xqab_t"] as const;
type LegacyTable = (typeof LEGACY_TABLES)[number];

const PK_COLUMNS: Record<LegacyTable, string[]> = {
  pjaa: ["pjaa001"],
  xqaa_t: ["xqaapj", "xqaa001"],
  xqab_t: ["xqabpj", "xqab001", "xqabseq"],
};

const INSERT_BATCH = 200;

export interface LegacyCandidate {
  dir: string;
  dbFile: string;
  hasFiles: boolean;
  /** 旧库是否可读（能列出版本表） */
  readable: boolean;
  sizeBytes: number;
}

export interface LegacyTablePreview {
  table: string;
  source: number;
  insertable: number;
  duplicate: number;
  missingColumns: string[];
}

export interface LegacyPreview {
  sourceDir: string;
  tables: LegacyTablePreview[];
  attachments: { records: number; insertable: number; missingFiles: number; missingSamples: string[] };
  warnings: string[];
}

export interface LegacyImportReport {
  ok: boolean;
  sourceDir: string;
  tables: Array<{ table: string; source: number; inserted: number; duplicate: number; orphan: number }>;
  files: { copied: number; existing: number; missing: number; missingSamples: string[] };
  warnings: string[];
  preBackup: string | null;
  durationMs: number;
  rolledBack: boolean;
  error?: string;
}

// ── 目录探测 ────────────────────────────────────────────

function candidateDirs(): string[] {
  const appData = app.getPath("appData");
  const result = [
    path.join(appData, "TBM", "publish"),
    path.join(appData, "TBM"),
    // 开发态：与仓库同级的历史项目
    path.resolve(pathManager.getRoot(), "..", "..", "..", "..", "TBM", "electron", "app-data", "dev"),
  ];
  return [...new Set(result.map((dir) => path.resolve(dir)))];
}

function inspectDir(dir: string): LegacyCandidate | null {
  const dbFile = path.join(dir, "db", "app.db");
  if (!fs.existsSync(dbFile)) return null;
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(dbFile).size;
  } catch {
    return null;
  }
  return {
    dir,
    dbFile,
    hasFiles: fs.existsSync(path.join(dir, "files")),
    readable: sizeBytes > 4096,
    sizeBytes,
  };
}

/** 自动探测可导入的旧数据目录（不打开数据库，零副作用） */
export function detectLegacySources(): LegacyCandidate[] {
  return candidateDirs()
    .map(inspectDir)
    .filter((item): item is LegacyCandidate => item !== null);
}

/** 校验用户手动选择的目录 */
export function inspectLegacyDir(dir: string): LegacyCandidate {
  const candidate = inspectDir(path.resolve(dir));
  if (!candidate) {
    throw new Error(`该目录下未找到 db/app.db：${path.resolve(dir)}`);
  }
  return candidate;
}

// ── 预览 ────────────────────────────────────────────────

async function openSource(dbFile: string): Promise<Client> {
  return createClient({ url: pathToFileURL(dbFile).href });
}

async function tableColumns(client: Client, table: string): Promise<string[]> {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  return result.rows.map((row) => String((row as Record<string, unknown>).name));
}

async function sourceRows(client: Client, table: string): Promise<Record<string, unknown>[]> {
  const result = await client.execute(`SELECT * FROM ${table}`);
  return result.rows as unknown as Record<string, unknown>[];
}

async function targetKeys(table: LegacyTable): Promise<Set<string>> {
  const columns = PK_COLUMNS[table];
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT ${sql.join(columns.map((c) => sql.identifier(c)), sql`, `)} FROM ${sql.identifier(table)}`,
  );
  return new Set(rows.map((row) => columns.map((c) => String(row[c] ?? "")).join("\u0001")));
}

function keyOf(table: LegacyTable, row: Record<string, unknown>): string {
  return PK_COLUMNS[table].map((c) => String(row[c] ?? "")).join("\u0001");
}

export async function previewLegacyImport(sourceDir: string): Promise<LegacyPreview> {
  const candidate = inspectLegacyDir(sourceDir);
  const client = await openSource(candidate.dbFile);
  const warnings: string[] = [];
  const tables: LegacyTablePreview[] = [];

  try {
    for (const table of LEGACY_TABLES) {
      const columns = await tableColumns(client, table);
      const targetCols = (
        await db.all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(table)})`)
      ).map((row) => row.name);
      const missingColumns = targetCols.filter((c) => !columns.includes(c));
      if (missingColumns.length > 0) {
        warnings.push(
          `${table} 缺少列 ${missingColumns.join(", ")}，导入时使用默认值`,
        );
      }
      const rows = await sourceRows(client, table);
      const existing = await targetKeys(table);
      const duplicate = rows.filter((row) => existing.has(keyOf(table, row))).length;
      tables.push({
        table,
        source: rows.length,
        insertable: rows.length - duplicate,
        duplicate,
        missingColumns,
      });
    }

    const attachmentRows = (
      await client.execute(`SELECT ffff002, ffff003 FROM ffff_t WHERE ffff001 = 'xqaa_t'`)
    ).rows as unknown as Array<Record<string, unknown>>;
    const owners = await db.all<{ key: string }>(
      sql`SELECT xqaapj || '|' || xqaa001 AS key FROM xqaa_t`,
    );
    const ownerSet = new Set(owners.map((row) => row.key));
    const existingAttachments = new Set(
      (
        await db.all<{ key: string }>(
          sql`SELECT ffff001 || '|' || ffff002 || '|' || ffff004 AS key FROM ffff_t`,
        )
      ).map((row) => row.key),
    );

    const missingSamples: string[] = [];
    let missingFiles = 0;
    let insertable = 0;
    for (const row of attachmentRows) {
      const ownerKey = String(row.ffff002 ?? "");
      const rel = String(row.ffff003 ?? "");
      if (!ownerSet.has(ownerKey)) continue;
      if (!fs.existsSync(path.join(candidate.dir, "files", rel))) {
        missingFiles++;
        if (missingSamples.length < 10) missingSamples.push(rel);
        continue;
      }
      if (!existingAttachments.has(`xqaa_t|${ownerKey}|${rel}`)) insertable++;
    }

    if (missingFiles > 0) {
      warnings.push(`${missingFiles} 个附件的物理文件缺失，对应记录将被跳过`);
    }
    if (!candidate.hasFiles) {
      warnings.push("该目录下没有 files 子目录，附件不会导入");
    }

    return {
      sourceDir: candidate.dir,
      tables,
      attachments: { records: attachmentRows.length, insertable, missingFiles, missingSamples },
      warnings,
    };
  } finally {
    try {
      client.close();
    } catch {
      // 忽略：libsql 可能未真正释放句柄，不影响后续流程
    }
  }
}

// ── 导入 ────────────────────────────────────────────────

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function importTable(
  client: Client,
  table: LegacyTable,
  ownerFilter?: { xqaaKeys: Set<string>; pjaaKeys: Set<string> },
): Promise<{ source: number; inserted: number; duplicate: number; orphan: number }> {
  const rows = await sourceRows(client, table);
  const existing = await targetKeys(table);
  let inserted = 0;
  let duplicate = 0;
  let orphan = 0;
  const pending: Record<string, unknown>[] = [];

  for (const row of rows) {
    const key = keyOf(table, row);
    if (existing.has(key)) {
      duplicate++;
      continue;
    }
    if (table !== "pjaa" && ownerFilter) {
      if (table === "xqaa_t") {
        if (!ownerFilter.pjaaKeys.has(str(row.xqaapj))) {
          orphan++;
          continue;
        }
      } else {
        const ownerKey = `${str(row.xqabpj)}\u0001${str(row.xqab001)}`;
        if (!ownerFilter.xqaaKeys.has(ownerKey)) {
          orphan++;
          continue;
        }
      }
    }
    pending.push(row);
  }

  for (let index = 0; index < pending.length; index += INSERT_BATCH) {
    const batch = pending.slice(index, index + INSERT_BATCH);
    await db.transaction(async (tx) => {
      if (table === "pjaa") {
        await tx
          .insert(pjaa)
          .values(
            batch.map((row) => ({
              pjaa001: str(row.pjaa001),
              pjaa002: str(row.pjaa002),
              pjaacrtdt: str(row.pjaacrtdt),
              pjaacrtid: str(row.pjaacrtid),
              pjaamoddt: str(row.pjaamoddt),
              pjaamodit: str(row.pjaamodit),
            })),
          )
          .onConflictDoNothing()
          .run();
      } else if (table === "xqaa_t") {
        await tx
          .insert(xqaa_t)
          .values(
            batch.map((row) => ({
              xqaapj: str(row.xqaapj),
              xqaa001: str(row.xqaa001),
              xqaa002: str(row.xqaa002),
              xqaa003: str(row.xqaa003),
              xqaa004: str(row.xqaa004),
              xqaa005: str(row.xqaa005),
              xqaacrtdt: str(row.xqaacrtdt),
              xqaacrtid: str(row.xqaacrtid),
              xqaamoddt: str(row.xqaamoddt),
              xqaamodit: str(row.xqaamodit),
            })),
          )
          .onConflictDoNothing()
          .run();
      } else {
        await tx
          .insert(xqab_t)
          .values(
            batch.map((row) => ({
              xqabpj: str(row.xqabpj),
              xqab001: str(row.xqab001),
              xqabseq: str(row.xqabseq),
              xqab002: str(row.xqab002),
              xqab003: str(row.xqab003),
              xqab004: num(row.xqab004),
              xqab005: str(row.xqab005),
              xqab006: str(row.xqab006),
              xqab007: str(row.xqab007),
              xqabcrtdt: str(row.xqabcrtdt),
              xqabcrtid: str(row.xqabcrtid),
              xqabmoddt: str(row.xqabmoddt),
              xqabmodit: str(row.xqabmodit),
            })),
          )
          .onConflictDoNothing()
          .run();
      }
    });
    inserted += batch.length;
  }

  return { source: rows.length, inserted, duplicate, orphan };
}

async function importAttachments(
  client: Client,
  sourceDir: string,
): Promise<{ copied: number; existing: number; missing: number; missingSamples: string[] }> {
  const rows = (
    await client.execute(`SELECT * FROM ffff_t WHERE ffff001 = 'xqaa_t'`)
  ).rows as unknown as Array<Record<string, unknown>>;
  const ownerRows = await db.all<{ key: string }>(
    sql`SELECT xqaapj || '|' || xqaa001 AS key FROM xqaa_t`,
  );
  const owners = new Set(ownerRows.map((row) => row.key));

  let copied = 0;
  let existing = 0;
  let missing = 0;
  const missingSamples: string[] = [];
  const values: Array<typeof ffff_t.$inferInsert> = [];

  for (const row of rows) {
    const ownerKey = str(row.ffff002);
    const rel = str(row.ffff003);
    if (!owners.has(ownerKey)) continue;

    const source = path.join(sourceDir, "files", rel);
    if (!fs.existsSync(source)) {
      missing++;
      if (missingSamples.length < 10) missingSamples.push(rel);
      continue;
    }
    const target = path.join(pathManager.getFilesRoot(), rel);
    if (fs.existsSync(target)) {
      existing++;
    } else {
      ensureDir(path.dirname(target));
      fs.copyFileSync(source, target);
      copied++;
    }
    values.push({
      ffff001: "xqaa_t",
      ffff002: ownerKey,
      ffff003: rel,
      ffff004: str(row.ffff004),
      ffff005: str(row.ffff005),
      ffff006: str(row.ffff006),
      ffffcrtdt: str(row.ffffcrtdt),
      ffffecrtid: str(row.ffffecrtid),
      ffffstus: Boolean(num(row.ffffstus ?? 1)),
    });
  }

  for (let index = 0; index < values.length; index += INSERT_BATCH) {
    await db
      .insert(ffff_t)
      .values(values.slice(index, index + INSERT_BATCH))
      .onConflictDoNothing()
      .run();
  }

  return { copied, existing, missing, missingSamples };
}

/**
 * 执行导入。整个过程在 maintenance 独占区内完成，失败自动回滚到导入前备份。
 * 注意：回滚采用「暂存恢复」，需要调用方在返回 rolledBack 时重启应用。
 */
export async function importLegacyData(sourceDir: string): Promise<LegacyImportReport> {
  const started = Date.now();
  return maintenance.runExclusive("import", async () => {
    const candidate = inspectLegacyDir(sourceDir);
    const warnings: string[] = [];
    const preBackup = await createBackupUnlocked("pre-import");
    const client = await openSource(candidate.dbFile);

    try {
      logger.audit({
        action: "legacy-import-start",
        target: candidate.dir,
        detail: { preBackup: preBackup.fileName },
        result: "ok",
      });

      const tables: LegacyImportReport["tables"] = [];
      let pjaaKeys = new Set<string>();
      let xqaaKeys = new Set<string>();

      for (const table of LEGACY_TABLES) {
        const ownerFilter =
          table === "pjaa" ? undefined : { xqaaKeys, pjaaKeys };
        const result = await importTable(client, table, ownerFilter);
        tables.push({ table, ...result });

        if (table === "pjaa") {
          const rows = await db.all<{ key: string }>(sql`SELECT pjaa001 AS key FROM pjaa`);
          pjaaKeys = new Set(rows.map((row) => row.key));
        } else if (table === "xqaa_t") {
          const rows = await db.all<{ xqaapj: string; xqaa001: string }>(
            sql`SELECT xqaapj, xqaa001 FROM xqaa_t`,
          );
          xqaaKeys = new Set(rows.map((row) => `${row.xqaapj}\u0001${row.xqaa001}`));
        }
      }

      const files = await importAttachments(client, candidate.dir);
      if (files.missing > 0) {
        warnings.push(`${files.missing} 个附件的物理文件在旧目录缺失，对应记录已跳过`);
      }

      const durationMs = Date.now() - started;
      logger.audit({
        action: "legacy-import-done",
        target: candidate.dir,
        detail: { tables, files, durationMs, preBackup: preBackup.fileName },
        result: "ok",
      });

      return {
        ok: true,
        sourceDir: candidate.dir,
        tables,
        files,
        warnings,
        preBackup: preBackup.fileName,
        durationMs,
        rolledBack: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message, preBackup: preBackup.fileName }, "旧数据导入失败，回滚到导入前备份");
      let rolledBack = false;
      try {
        await stageRestoreUnlocked(preBackup.fileName, { skipPreBackup: true });
        rolledBack = true;
      } catch (rollbackError) {
        logger.error({ error: String(rollbackError) }, "回滚暂存失败，请手动从备份恢复");
      }
      return {
        ok: false,
        sourceDir: candidate.dir,
        tables: [],
        files: { copied: 0, existing: 0, missing: 0, missingSamples: [] },
        warnings,
        preBackup: preBackup.fileName,
        durationMs: Date.now() - started,
        rolledBack,
        error: message,
      };
    } finally {
      try {
        client.close();
      } catch {
        // 忽略
      }
    }
  });
}

/** 供诊断使用：当前库内已有的业务数据量 */
export async function currentDataCounts(): Promise<Record<string, number>> {
  const rows = await db.all<Record<string, number>>(sql`
    SELECT
      (SELECT COUNT(*) FROM pjaa) AS projects,
      (SELECT COUNT(*) FROM xqaa_t) AS requirements,
      (SELECT COUNT(*) FROM xqab_t) AS items,
      (SELECT COUNT(*) FROM ffff_t) AS attachments`);
  return rows[0] ?? {};
}
