import { createClient } from "@libsql/client";
import fs from "node:fs";

const DB = "D:/我的项目/TbmLite/electron/app-data/dev/db/app.db";
const FILES = "D:/我的项目/TbmLite/electron/app-data/dev/files";

const c = createClient({ url: `file:${DB}` });
const q = async (sql: string) => (await c.execute(sql)).rows;

const orphanAtt = await q(
  `SELECT COUNT(*) n FROM ffff_t WHERE ffff002 NOT IN (SELECT xqaapj || '|' || xqaa001 FROM xqaa_t)`,
);
console.log("附件键无对应需求书:", orphanAtt[0]?.n);

const samples = await q("SELECT ffff002, ffff005 FROM ffff_t LIMIT 5");
for (const r of samples) console.log(`  ${r.ffff002} → ${r.ffff005}`);

let ok = 0;
let miss = 0;
const files = await q("SELECT ffff003 FROM ffff_t");
for (const r of files) {
  fs.existsSync(`${FILES}/${r.ffff003}`) ? ok++ : miss++;
}
console.log("附件物理文件: 存在", ok, "/ 缺失", miss);

c.close();
