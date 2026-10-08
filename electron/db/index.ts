import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { pathManager } from "../utils/paths";
import logger from "../utils/logger";

export type Db = LibSQLDatabase<Record<string, never>>;

let client: Client | null = null;
let database: Db | null = null;

/**
 * 延迟建立连接：路径由 pathManager 决定，而 pathManager.init() 必须在
 * app.whenReady() 之前执行，因此不能在任何模块顶层创建客户端。
 */
function ensureDb(): Db {
  if (!database) {
    client = createClient({ url: pathManager.getSqliteUrl() });
    database = drizzle(client);
    logger.info({ url: pathManager.getSqliteUrl() }, "数据库连接已建立");
  }
  return database;
}

/** 事务句柄（drizzle 的事务对象与 db 拥有相同查询 API） */
export type DbExecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** 供 drizzle 查询使用的懒加载代理，调用方无需感知初始化时机 */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = ensureDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
}) as Db;

/**
 * 连接级 PRAGMA 基线。必须在任何业务查询之前执行。
 *  - WAL：读写并发 + 崩溃恢复能力
 *  - busy_timeout：多进程/多句柄竞争时自动等待而非立即报错
 *  - foreign_keys：让级联删除与悬挂数据在数据库层失效
 */
export async function bootstrapDb(): Promise<void> {
  const d = ensureDb();
  await d.run(sql`PRAGMA journal_mode = WAL`);
  await d.run(sql`PRAGMA synchronous = NORMAL`);
  await d.run(sql`PRAGMA busy_timeout = 5000`);
  await d.run(sql`PRAGMA foreign_keys = ON`);
}

/** 读取当前 schema 版本（PRAGMA user_version） */
export async function getSchemaVersion(): Promise<number> {
  const row = await ensureDb().get<{ user_version: number }>(sql`PRAGMA user_version`);
  return Number(row?.user_version ?? 0);
}

export async function setSchemaVersion(version: number): Promise<void> {
  await ensureDb().run(sql`PRAGMA user_version = ${sql.raw(String(version))}`);
}

/** 需要替换数据库文件（恢复备份）前释放文件句柄 */
export async function closeDb(): Promise<void> {
  if (client) {
    try {
      client.close();
    } catch (err) {
      logger.warn({ error: String(err) }, "关闭数据库连接失败");
    }
  }
  client = null;
  database = null;
}
