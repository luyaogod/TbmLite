import { sql } from "drizzle-orm";
import logger from "../../utils/logger";
import type { Migration } from "./types";

/**
 * 引用完整性：
 *  1) 清理历史悬挂数据（明细无主档 / 主档无项目）——仅统计并删除不可达行
 *  2) 重建 xqaa_t：加 pjaa 外键（RESTRICT，删项目前必须先删需求书）
 *  3) 重建 xqab_t：加复合外键 ON DELETE CASCADE
 * 表重建会连带删除索引，故末尾重建索引。
 */
export const migration003ReferenceIntegrity: Migration = {
  version: 3,
  name: "reference_integrity",
  async up({ db }) {
    const orphanItems = await db.get<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM xqab_t i
      WHERE NOT EXISTS (
        SELECT 1 FROM xqaa_t m WHERE m.xqaapj = i.xqabpj AND m.xqaa001 = i.xqab001
      )`);
    const orphanMasters = await db.get<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM xqaa_t m
      WHERE NOT EXISTS (SELECT 1 FROM pjaa p WHERE p.pjaa001 = m.xqaapj)`);
    const orphanItemCount = Number(orphanItems?.n ?? 0);
    const orphanMasterCount = Number(orphanMasters?.n ?? 0);
    if (orphanItemCount > 0 || orphanMasterCount > 0) {
      logger.warn({ orphanItemCount, orphanMasterCount }, "清理悬挂数据");
      await db.run(sql`
        DELETE FROM xqab_t WHERE NOT EXISTS (
          SELECT 1 FROM xqaa_t m WHERE m.xqaapj = xqab_t.xqabpj AND m.xqaa001 = xqab_t.xqab001)`);
      // 主档悬挂时其明细也一并清除（明细外键此时尚未建立）
      await db.run(sql`
        DELETE FROM xqab_t WHERE NOT EXISTS (
          SELECT 1 FROM pjaa p WHERE p.pjaa001 = xqab_t.xqabpj)`);
      await db.run(sql`
        DELETE FROM xqaa_t WHERE NOT EXISTS (
          SELECT 1 FROM pjaa p WHERE p.pjaa001 = xqaa_t.xqaapj)`);
    }

    // ── xqaa_t：加 pjaa 外键 ──────────────────────────────
    await db.run(sql`CREATE TABLE xqaa_t_new (
      xqaapj TEXT NOT NULL,
      xqaa001 TEXT NOT NULL,
      xqaa002 TEXT NOT NULL,
      xqaa003 TEXT NOT NULL,
      xqaa004 TEXT NOT NULL,
      xqaa005 TEXT NOT NULL DEFAULT '',
      xqaacrtdt TEXT NOT NULL,
      xqaacrtid TEXT NOT NULL,
      xqaamoddt TEXT NOT NULL,
      xqaamodit TEXT NOT NULL,
      PRIMARY KEY (xqaapj, xqaa001),
      FOREIGN KEY (xqaapj) REFERENCES pjaa (pjaa001) ON DELETE RESTRICT ON UPDATE CASCADE
    )`);
    await db.run(sql`INSERT INTO xqaa_t_new (
      xqaapj, xqaa001, xqaa002, xqaa003, xqaa004, xqaa005,
      xqaacrtdt, xqaacrtid, xqaamoddt, xqaamodit
    ) SELECT
      xqaapj, xqaa001, xqaa002, xqaa003, xqaa004, xqaa005,
      xqaacrtdt, xqaacrtid, xqaamoddt, xqaamodit
    FROM xqaa_t`);
    await db.run(sql`DROP TABLE xqaa_t`);
    await db.run(sql`ALTER TABLE xqaa_t_new RENAME TO xqaa_t`);

    // ── xqab_t：加复合外键（级联删除） ────────────────────
    await db.run(sql`CREATE TABLE xqab_t_new (
      xqabpj TEXT NOT NULL,
      xqab001 TEXT NOT NULL,
      xqabseq TEXT NOT NULL,
      xqab002 TEXT NOT NULL,
      xqab003 TEXT NOT NULL,
      xqab004 REAL NOT NULL,
      xqab005 TEXT NOT NULL,
      xqab006 TEXT NOT NULL DEFAULT '',
      xqab007 TEXT NOT NULL DEFAULT '',
      xqabcrtdt TEXT NOT NULL,
      xqabcrtid TEXT NOT NULL,
      xqabmoddt TEXT NOT NULL,
      xqabmodit TEXT NOT NULL,
      PRIMARY KEY (xqabpj, xqab001, xqabseq),
      FOREIGN KEY (xqabpj, xqab001) REFERENCES xqaa_t (xqaapj, xqaa001)
        ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    await db.run(sql`INSERT INTO xqab_t_new (
      xqabpj, xqab001, xqabseq, xqab002, xqab003, xqab004, xqab005, xqab006, xqab007,
      xqabcrtdt, xqabcrtid, xqabmoddt, xqabmodit
    ) SELECT
      xqabpj, xqab001, xqabseq, xqab002, xqab003, xqab004, xqab005, xqab006, xqab007,
      xqabcrtdt, xqabcrtid, xqabmoddt, xqabmodit
    FROM xqab_t`);
    await db.run(sql`DROP TABLE xqab_t`);
    await db.run(sql`ALTER TABLE xqab_t_new RENAME TO xqab_t`);

    // 重建因表重建而丢失的索引
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_xqaa_pj ON xqaa_t (xqaapj)`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_xqaa_name ON xqaa_t (xqaa002)`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_xqab_req ON xqab_t (xqabpj, xqab001)`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_xqab_dev ON xqab_t (xqab006)`);
  },
};
