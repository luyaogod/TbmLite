import { sql } from "drizzle-orm";
import logger from "../../utils/logger";
import type { Migration } from "./types";

/**
 * 查询索引：列表页原先全表扫描后在内存过滤，数据量上去后（万级）需要索引兜底。
 * 均为幂等语句。
 */
export const migration002Indexes: Migration = {
  version: 2,
  name: "indexes",
  async up({ db }) {
    const indexes = [
      sql`CREATE INDEX IF NOT EXISTS idx_pjaa_name ON pjaa (pjaa002)`,
      sql`CREATE INDEX IF NOT EXISTS idx_xqaa_pj ON xqaa_t (xqaapj)`,
      sql`CREATE INDEX IF NOT EXISTS idx_xqaa_name ON xqaa_t (xqaa002)`,
      sql`CREATE INDEX IF NOT EXISTS idx_xqab_req ON xqab_t (xqabpj, xqab001)`,
      sql`CREATE INDEX IF NOT EXISTS idx_xqab_dev ON xqab_t (xqab006)`,
      sql`CREATE INDEX IF NOT EXISTS idx_ffff_owner ON ffff_t (ffff001, ffff002)`,
      sql`CREATE INDEX IF NOT EXISTS idx_ffff_hash ON ffff_t (ffff004)`,
    ];
    for (const statement of indexes) {
      await db.run(statement);
    }
    logger.info({ count: indexes.length }, "创建查询索引");
  },
};
