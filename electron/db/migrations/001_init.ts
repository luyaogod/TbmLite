import { sql } from "drizzle-orm";
import type { Migration } from "./types";

/** 基线：4 张业务表（等价于 0.1.x 的启动建表 DDL，保持幂等） */
export const migration001Init: Migration = {
  version: 1,
  name: "init",
  async up({ db }) {
    await db.run(sql`CREATE TABLE IF NOT EXISTS pjaa (
      pjaa001 TEXT PRIMARY KEY NOT NULL,
      pjaa002 TEXT NOT NULL,
      pjaacrtdt TEXT NOT NULL,
      pjaacrtid TEXT NOT NULL,
      pjaamoddt TEXT NOT NULL,
      pjaamodit TEXT NOT NULL
    )`);

    await db.run(sql`CREATE TABLE IF NOT EXISTS xqaa_t (
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
      PRIMARY KEY (xqaapj, xqaa001)
    )`);

    await db.run(sql`CREATE TABLE IF NOT EXISTS xqab_t (
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
      PRIMARY KEY (xqabpj, xqab001, xqabseq)
    )`);

    await db.run(sql`CREATE TABLE IF NOT EXISTS ffff_t (
      ffff001 TEXT NOT NULL,
      ffff002 TEXT NOT NULL,
      ffff003 TEXT NOT NULL,
      ffff004 TEXT PRIMARY KEY NOT NULL,
      ffff005 TEXT NOT NULL,
      ffff006 TEXT NOT NULL,
      ffffcrtdt TEXT NOT NULL,
      ffffecrtid TEXT NOT NULL,
      ffffstus INTEGER NOT NULL
    )`);
  },
};
