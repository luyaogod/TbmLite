/**
 * 迁移/数据完整性校验脚本
 *   npx tsx scripts/verify-migration.ts [--dir <数据目录>]
 * 环境变量：TBM_NEW_DATA
 */
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { resolveDataDir, sqliteUrl } from "./lib/paths";

const DIR = resolveDataDir({
  flag: "--dir",
  env: "TBM_NEW_DATA",
  fallback: "electron/app-data/dev",
  label: "数据目录",
});
const DB = path.join(DIR, "db", "app.db");
const FILES = path.join(DIR, "files");

const client = createClient({ url: sqliteUrl(DB) });
const query = async (sql: string) => (await client.execute(sql)).rows;

console.log(`数据目录: ${DIR}\n`);

const counts = await query(
  `SELECT (SELECT COUNT(*) FROM pjaa) AS projects,
          (SELECT COUNT(*) FROM xqaa_t) AS requirements,
          (SELECT COUNT(*) FROM xqab_t) AS items,
          (SELECT COUNT(*) FROM ffff_t) AS attachments`,
);
console.log("行数统计:", counts[0]);

const checks: Array<[string, string]> = [
  [
    "明细无对应需求书",
    `SELECT COUNT(*) n FROM xqab_t i WHERE NOT EXISTS (
       SELECT 1 FROM xqaa_t m WHERE m.xqaapj = i.xqabpj AND m.xqaa001 = i.xqab001)`,
  ],
  [
    "需求书无对应项目",
    `SELECT COUNT(*) n FROM xqaa_t m WHERE NOT EXISTS (
       SELECT 1 FROM pjaa p WHERE p.pjaa001 = m.xqaapj)`,
  ],
  [
    "附件记录无对应需求书",
    `SELECT COUNT(*) n FROM ffff_t f WHERE f.ffff001 = 'xqaa_t' AND NOT EXISTS (
       SELECT 1 FROM xqaa_t m WHERE m.xqaapj || '|' || m.xqaa001 = f.ffff002)`,
  ],
  [
    "明细项次重复",
    `SELECT COUNT(*) n FROM (
       SELECT 1 FROM xqab_t GROUP BY xqabpj, xqab001, xqabseq HAVING COUNT(*) > 1)`,
  ],
];

let problems = 0;
for (const [label, sql] of checks) {
  const rows = await query(sql);
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) problems += 1;
  console.log(`${n === 0 ? "✓" : "✗"} ${label}: ${n}`);
}

const integrity = await query("PRAGMA integrity_check");
console.log(`${String(integrity[0]?.integrity_check) === "ok" ? "✓" : "✗"} 完整性: ${integrity[0]?.integrity_check}`);

const version = await query("PRAGMA user_version");
console.log(`  schema 版本: v${version[0]?.user_version}`);

let present = 0;
let missing = 0;
for (const row of await query("SELECT ffff003 FROM ffff_t")) {
  if (fs.existsSync(path.join(FILES, String(row.ffff003)))) present += 1;
  else missing += 1;
}
if (missing > 0) problems += 1;
console.log(`${missing === 0 ? "✓" : "✗"} 附件物理文件: 存在 ${present} / 缺失 ${missing}`);

client.close();
console.log(problems === 0 ? "\n校验通过" : `\n发现 ${problems} 类问题`);
process.exit(problems === 0 ? 0 : 1);
