/**
 * 旧 TBM 数据导入脚本（幂等，可重复执行）
 *  - pjaa / xqaa_t / xqab_t 全量复制（INSERT OR IGNORE）
 *  - ffff_t 仅迁移需求书附件（ffff001 = 'xqaa_t'）并复制物理文件
 *  - xqac_t 待办等新项目已移除的功能不迁移
 *
 * 用法：
 *   npx tsx scripts/migrate-from-tbm.ts                       # 使用默认目录
 *   npx tsx scripts/migrate-from-tbm.ts --from <旧数据目录> --to <新数据目录>
 *   npx tsx scripts/migrate-from-tbm.ts --dry-run             # 只预览不写入
 *
 * 环境变量：TBM_OLD_DATA / TBM_NEW_DATA
 * 备份：写入前用 VACUUM INTO 生成一致性快照（不要用文件拷贝，WAL 模式下会丢数据）
 */
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { hasFlag, humanSize, resolveDataDir, sqliteUrl } from "./lib/paths";

const dryRun = hasFlag("--dry-run");

const OLD_DIR = resolveDataDir({
  flag: "--from",
  env: "TBM_OLD_DATA",
  fallback: "../TBM/electron/app-data/dev",
  label: "旧数据目录",
});
const NEW_DIR = resolveDataDir({
  flag: "--to",
  env: "TBM_NEW_DATA",
  fallback: "electron/app-data/dev",
  label: "新数据目录",
});

const OLD_DB = path.join(OLD_DIR, "db", "app.db");
const OLD_FILES = path.join(OLD_DIR, "files");
const NEW_DB = path.join(NEW_DIR, "db", "app.db");
const NEW_FILES = path.join(NEW_DIR, "files");

type Client = ReturnType<typeof createClient>;

async function count(db: Client, table: string, where?: string): Promise<number> {
  const result = await db.execute(`SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ""}`);
  return Number(result.rows[0]?.n ?? 0);
}

async function copyTable(
  oldDb: Client,
  newDb: Client,
  table: string,
  where?: string,
): Promise<number> {
  const rows = (await oldDb.execute(`SELECT * FROM ${table}${where ? ` WHERE ${where}` : ""}`)).rows;
  if (rows.length === 0) return 0;
  const cols = Object.keys(rows[0]);
  const stmt = `INSERT OR IGNORE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
  if (!dryRun) {
    for (const row of rows) {
      await newDb.execute({ sql: stmt, args: cols.map((c) => (row as Record<string, unknown>)[c]) });
    }
  }
  return rows.length;
}

/** 一致性备份：VACUUM INTO（WAL 模式下 fs.copyFileSync 会丢失未 checkpoint 的数据） */
async function backupNewDb(db: Client): Promise<string | null> {
  if (!fs.existsSync(NEW_DB)) return null;
  const target = `${NEW_DB}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (dryRun) {
    console.log(`[dry-run] 将备份新库 → ${path.basename(target)}`);
    return target;
  }
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  await db.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  console.log(`已备份新库 → ${path.basename(target)}（${humanSize(fs.statSync(target).size)}）`);
  return target;
}

async function main(): Promise<void> {
  console.log(`旧数据目录: ${OLD_DIR}`);
  console.log(`新数据目录: ${NEW_DIR}${dryRun ? "（dry-run）" : ""}`);

  const oldDb = createClient({ url: sqliteUrl(OLD_DB) });
  const newDb = createClient({ url: sqliteUrl(NEW_DB) });

  // 新库必须已由程序建好表（先启动一次 TBM Lite）
  const tables = (await newDb.execute(
    "SELECT name FROM sqlite_master WHERE type='table'",
  )).rows.map((row) => String((row as Record<string, unknown>).name));
  const missing = ["pjaa", "xqaa_t", "xqab_t", "ffff_t"].filter((t) => !tables.includes(t));
  if (missing.length > 0) {
    throw new Error(`新库缺少表：${missing.join(", ")}。请先启动一次 TBM Lite 完成初始化。`);
  }

  await backupNewDb(newDb);

  console.log("\n── 主数据迁移 ──");
  for (const table of ["pjaa", "xqaa_t", "xqab_t"] as const) {
    const before = await count(newDb, table);
    const copied = await copyTable(oldDb, newDb, table);
    const after = await count(newDb, table);
    console.log(
      `${table}: 旧库 ${copied} 行 → 新库 ${before} → ${after}（跳过重复 ${copied - (after - before)}）`,
    );
  }

  console.log("\n── 附件迁移 ──");
  const attRows = (await oldDb.execute(`SELECT * FROM ffff_t WHERE ffff001 = 'xqaa_t'`)).rows;
  let copiedFiles = 0;
  let missingFiles = 0;
  let skippedFiles = 0;
  for (const row of attRows) {
    const record = row as Record<string, unknown>;
    const rel = String(record.ffff003 ?? "");
    const src = path.join(OLD_FILES, rel);
    if (!fs.existsSync(src)) {
      console.warn(`  ⚠ 源文件缺失，跳过物理文件: ${rel}`);
      missingFiles++;
      continue;
    }
    const dst = path.join(NEW_FILES, rel);
    if (fs.existsSync(dst)) {
      skippedFiles++;
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    copiedFiles++;
  }

  const before = await count(newDb, "ffff_t");
  await copyTable(oldDb, newDb, "ffff_t", `ffff001 = 'xqaa_t'`);
  const after = await count(newDb, "ffff_t");
  console.log(
    `ffff_t(xqaa): 旧库记录 ${attRows.length} → 新库 ${before} → ${after}；` +
      `物理文件新增 ${copiedFiles}，已存在 ${skippedFiles}，缺失 ${missingFiles}`,
  );

  console.log("\n── 迁移完成，新库汇总 ──");
  for (const table of ["pjaa", "xqaa_t", "xqab_t", "ffff_t"]) {
    console.log(`${table}: ${await count(newDb, table)} 行`);
  }

  oldDb.close();
  newDb.close();
}

main().catch((err) => {
  console.error("迁移失败:", err instanceof Error ? err.message : err);
  process.exit(1);
});
