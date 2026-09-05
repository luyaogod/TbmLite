import { sqliteTable, text, real, integer, primaryKey } from "drizzle-orm/sqlite-core";

/** 项目表 */
export const pjaa = sqliteTable("pjaa", {
  /** 项目编号 */
  pjaa001: text("pjaa001").primaryKey(),
  /** 项目名称 */
  pjaa002: text("pjaa002").notNull(),
  /** 资料创建日 */
  pjaacrtdt: text("pjaacrtdt").notNull(),
  /** 资料创建人 */
  pjaacrtid: text("pjaacrtid").notNull(),
  /** 最近修改日 */
  pjaamoddt: text("pjaamoddt").notNull(),
  /** 最近修改人 */
  pjaamodit: text("pjaamodit").notNull(),
});

/** 需求书主档 */
export const xqaa_t = sqliteTable("xqaa_t", {
  /** 项目编号 */
  xqaapj: text("xqaapj").notNull(),
  /** 需求书编号 */
  xqaa001: text("xqaa001").notNull(),
  /** 需求书名称 */
  xqaa002: text("xqaa002").notNull(),
  /** 需求书日期 */
  xqaa003: text("xqaa003").notNull(),
  /** 需求书状态 [1 进行中 / 2 已结案] */
  xqaa004: text("xqaa004").notNull(),
  /** 备注 */
  xqaa005: text("xqaa005").notNull().default(""),
  /** 资料创建日 */
  xqaacrtdt: text("xqaacrtdt").notNull(),
  /** 资料创建人 */
  xqaacrtid: text("xqaacrtid").notNull(),
  /** 最近修改日 */
  xqaamoddt: text("xqaamoddt").notNull(),
  /** 最近修改人 */
  xqaamodit: text("xqaamodit").notNull(),
}, (table) => [
  primaryKey({ columns: [table.xqaapj, table.xqaa001] }),
]);

/** 需求书明细档 */
export const xqab_t = sqliteTable("xqab_t", {
  /** 项目编号 */
  xqabpj: text("xqabpj").notNull(),
  /** 需求书编号 */
  xqab001: text("xqab001").notNull(),
  /** 需求书项次 */
  xqabseq: text("xqabseq").notNull(),
  /** 需求描述 */
  xqab002: text("xqab002").notNull(),
  /** 对应作业编号 */
  xqab003: text("xqab003").notNull(),
  /** 核定工时 */
  xqab004: real("xqab004").notNull(),
  /** 需求项状态 [1 需求评估 / 2 需求开发 / 3 顾问确认 / 4 用户确认 / 5 已结案] */
  xqab005: text("xqab005").notNull(),
  /** 开发人员（姓名，自由填写） */
  xqab006: text("xqab006").notNull().default(""),
  /** 对应作业名称 */
  xqab007: text("xqab007").notNull().default(""),
  /** 资料创建日 */
  xqabcrtdt: text("xqabcrtdt").notNull(),
  /** 资料创建人 */
  xqabcrtid: text("xqabcrtid").notNull(),
  /** 最近修改日 */
  xqabmoddt: text("xqabmoddt").notNull(),
  /** 最近修改人 */
  xqabmodit: text("xqabmodit").notNull(),
}, (table) => [
  primaryKey({ columns: [table.xqabpj, table.xqab001, table.xqabseq] }),
]);

/** 附件表 */
export const ffff_t = sqliteTable("ffff_t", {
  /** 归属表名 */
  ffff001: text("ffff001").notNull(),
  /** 归属表主键 */
  ffff002: text("ffff002").notNull(),
  /** 存放路径 */
  ffff003: text("ffff003").notNull(),
  /** hash */
  ffff004: text("ffff004").primaryKey(),
  /** 原始文件名 */
  ffff005: text("ffff005").notNull(),
  /** 文件拓展名 */
  ffff006: text("ffff006").notNull(),
  /** 资料创建日 */
  ffffcrtdt: text("ffffcrtdt").notNull(),
  /** 资料创建人 */
  ffffecrtid: text("ffffecrtid").notNull(),
  /** 文件状态 */
  ffffstus: integer("ffffstus", { mode: "boolean" }).notNull(),
});
