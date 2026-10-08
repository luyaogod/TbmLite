import { sql } from "drizzle-orm";
import logger from "../../utils/logger";
import type { Migration } from "./types";

/**
 * 附件引用模型：
 *  - 旧模型 PK = sha256，导致「同一文件挂到两个需求书」主键冲突，且删一处会连物理文件一起删掉。
 *  - 新模型 PK = (归属表, 归属主键, sha256)：同一物理文件可被多处引用，删除按引用计数决定是否回收文件。
 * 表重建会连带删除索引，末尾重建。
 */
export const migration004AttachmentRefs: Migration = {
  version: 4,
  name: "attachment_refs",
  async up({ db }) {
    // 清理无主附件记录（归属需求书已不存在）
    const orphans = await db.get<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM ffff_t f
      WHERE f.ffff001 = 'xqaa_t'
        AND NOT EXISTS (
          SELECT 1 FROM xqaa_t m
          WHERE m.xqaapj || '|' || m.xqaa001 = f.ffff002
        )`);
    const orphanCount = Number(orphans?.n ?? 0);
    if (orphanCount > 0) {
      logger.warn({ orphanCount }, "清理无主附件记录");
      await db.run(sql`
        DELETE FROM ffff_t WHERE ffff001 = 'xqaa_t' AND NOT EXISTS (
          SELECT 1 FROM xqaa_t m WHERE m.xqaapj || '|' || m.xqaa001 = ffff_t.ffff002)`);
    }

    await db.run(sql`CREATE TABLE ffff_t_new (
      ffff001 TEXT NOT NULL,
      ffff002 TEXT NOT NULL,
      ffff004 TEXT NOT NULL,
      ffff003 TEXT NOT NULL,
      ffff005 TEXT NOT NULL,
      ffff006 TEXT NOT NULL,
      ffffcrtdt TEXT NOT NULL,
      ffffecrtid TEXT NOT NULL,
      ffffstus INTEGER NOT NULL,
      PRIMARY KEY (ffff001, ffff002, ffff004)
    )`);
    await db.run(sql`INSERT OR IGNORE INTO ffff_t_new (
      ffff001, ffff002, ffff004, ffff003, ffff005, ffff006,
      ffffcrtdt, ffffecrtid, ffffstus
    ) SELECT
      ffff001, ffff002, ffff004, ffff003, ffff005, ffff006,
      ffffcrtdt, ffffecrtid, ffffstus
    FROM ffff_t`);
    await db.run(sql`DROP TABLE ffff_t`);
    await db.run(sql`ALTER TABLE ffff_t_new RENAME TO ffff_t`);

    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ffff_owner ON ffff_t (ffff001, ffff002)`);
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ffff_hash ON ffff_t (ffff004)`);
    logger.info({ removed: orphanCount }, "附件表已升级为引用模型");
  },
};
