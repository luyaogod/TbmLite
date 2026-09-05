/**
 * 一次性迁移脚本：把旧 TBM 的需求书数据迁入 TbmLite
 *  - pjaa / xqaa_t / xqab_t 全量复制（INSERT OR IGNORE，可重复执行）
 *  - ffff_t 仅迁移需求书附件（ffff001 = 'xqaa_t'）并复制物理文件
 *  - xqac_t 待办等新项目已移除的功能不迁移
 *
 * 用法：npx tsx scripts/migrate-from-tbm.ts
 */
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const OLD_DB = "D:/我的项目/TBM/electron/app-data/dev/db/app.db";
const OLD_FILES = "D:/我的项目/TBM/electron/app-data/dev/files";
const NEW_DB = "D:/我的项目/TbmLite/electron/app-data/dev/db/app.db";
const NEW_FILES = "D:/我的项目/TbmLite/electron/app-data/dev/files";

async function count(db: ReturnType<typeof createClient>, table: string): Promise<number> {
  const r = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(r.rows[0]?.n ?? 0);
}

async function copyTable(
  oldDb: ReturnType<typeof createClient>,
  newDb: ReturnType<typeof createClient>,
  table: string,
  where?: string,
): Promise<number> {
  const rows = (await oldDb.execute(`SELECT * FROM ${table}${where ? ` WHERE ${where}` : ""}`)).rows;
  if (rows.length === 0) return 0;
  const cols = Object.keys(rows[0]);
  const stmt = `INSERT OR IGNORE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
  for (const row of rows) {
    await newDb.execute({ sql: stmt, args: cols.map((c) => (row as Record<string, unknown>)[c]) });
  }
  return rows.length;
}

async function main() {
  const oldDb = createClient({ url: `file:${OLD_DB}` });
  const newDb = createClient({ url: `file:${NEW_DB}` });

  if (!fs.existsSync(OLD_DB)) {
    console.error("旧数据库不存在:", OLD_DB);
    process.exit(1);
  }

  // 1. 备份新库
  const bak = `${NEW_DB}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (fs.existsSync(NEW_DB)) {
    fs.copyFileSync(NEW_DB, bak);
    console.log(`已备份新库 → ${path.basename(bak)}`);
  }

  // 2. 清理旧版遗留的空表
  await newDb.execute("DROP TABLE IF EXISTS dev_t");

  // 3. 迁移主数据
  console.log("\n── 主数据迁移 ──");
  const tables = ["pjaa", "xqaa_t", "xqab_t"] as const;
  for (const t of tables) {
    const before = await count(newDb, t);
    const copied = await copyTable(oldDb, newDb, t);
    const after = await count(newDb, t);
    console.log(`${t}: 旧库 ${copied} 行 → 新库 ${before} → ${after}（跳过重复 ${copied - (after - before)}）`);
  }

  // 4. 迁移需求书附件（记录 + 物理文件）
  console.log("\n── 附件迁移 ──");
  const attRows = (await oldDb.execute(`SELECT * FROM ffff_t WHERE ffff001 = 'xqaa_t'`)).rows;
  let copiedFiles = 0;
  let missingFiles = 0;
  for (const row of attRows) {
    const r = row as Record<string, unknown>;
    const rel = String(r.ffff003 ?? "");
    const src = path.join(OLD_FILES, rel);
    if (!fs.existsSync(src)) {
      console.warn(`  ⚠ 源文件缺失，跳过记录: ${rel}`);
      missingFiles++;
      continue;
    }
    const dst = path.join(NEW_FILES, rel);
    if (!fs.existsSync(dst)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    copiedFiles++;
  }
  const before = await count(newDb, "ffff_t");
  const copied = await copyTable(oldDb, newDb, "ffff_t", `ffff001 = 'xqaa_t'`);
  const after = await count(newDb, "ffff_t");
  console.log(
    `ffff_t(xqaa): 旧库记录 ${attRows.length} → 新库 ${before} → ${after}；物理文件复制 ${copiedFiles}，缺失 ${missingFiles}`,
  );

  // 5. 汇总
  console.log("\n── 迁移完成，新库汇总 ──");
  for (const t of ["pjaa", "xqaa_t", "xqab_t", "ffff_t"]) {
    console.log(`${t}: ${await count(newDb, t)} 行`);
  }

  oldDb.close();
  newDb.close();
}

main().catch((err) => {
  console.error("迁移失败:", err);
  process.exit(1);
});
