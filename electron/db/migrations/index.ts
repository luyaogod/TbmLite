import { createHash } from "node:crypto";
import { app } from "electron";
import { sql } from "drizzle-orm";
import { db, getSchemaVersion } from "../index";
import logger from "../../utils/logger";
import { migration001Init } from "./001_init";
import { migration002Indexes } from "./002_indexes";
import { migration003ReferenceIntegrity } from "./003_reference_integrity";
import { migration004AttachmentRefs } from "./004_attachment_refs";
import type { Migration } from "./types";

/**
 * 迁移必须「只增不改」：已发布过的迁移文件永远不再修改，任何结构变化都新增版本号。
 * 每个迁移都必须在空库与已有库上均可跑通。
 */
export const MIGRATIONS: Migration[] = [
  migration001Init,
  migration002Indexes,
  migration003ReferenceIntegrity,
  migration004AttachmentRefs,
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);

export interface MigrationHooks {
  /** 迁移前回调（用于强制备份），返回备份路径以便记录 */
  beforeMigrate?(from: number, to: number): Promise<string | null>;
}

export interface MigrationReport {
  from: number;
  to: number;
  applied: string[];
  backupPath: string | null;
}

export class MigrationError extends Error {
  readonly backupPath: string | null;
  constructor(message: string, backupPath: string | null) {
    super(message);
    this.name = "MigrationError";
    this.backupPath = backupPath;
  }
}

function fingerprint(m: Migration): string {
  return createHash("sha1").update(`${m.version}:${m.name}`).digest("hex").slice(0, 12);
}

function validateRegistry(): void {
  const versions = MIGRATIONS.map((m) => m.version);
  const sorted = [...versions].sort((a, b) => a - b);
  if (versions.join(",") !== sorted.join(",")) {
    throw new Error("迁移注册表未按版本升序排列");
  }
  if (new Set(versions).size !== versions.length) {
    throw new Error("迁移注册表存在重复版本号");
  }
  if (sorted[0] !== 1) {
    throw new Error("迁移必须从版本 1 开始");
  }
}

/**
 * 执行未应用的迁移。步骤粒度事务：每一步成功即提交并记录，
 * 失败则抛出 MigrationError（该步已回滚，调用方应恢复迁移前备份）。
 */
export async function applyMigrations(hooks: MigrationHooks = {}): Promise<MigrationReport> {
  validateRegistry();

  await db.run(sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    app_version TEXT NOT NULL,
    fingerprint TEXT NOT NULL
  )`);

  const from = await getSchemaVersion();
  if (from > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `数据版本（${from}）高于当前程序支持的版本（${CURRENT_SCHEMA_VERSION}），拒绝迁移`,
    );
  }

  const pending = MIGRATIONS.filter((m) => m.version > from).sort(
    (a, b) => a.version - b.version,
  );
  if (pending.length === 0) {
    logger.info({ schemaVersion: from }, "数据库结构已是最新");
    return { from, to: from, applied: [], backupPath: null };
  }

  const to = pending[pending.length - 1].version;
  const backupPath = (await hooks.beforeMigrate?.(from, to)) ?? null;
  const applied: string[] = [];
  logger.info({ from, to, steps: pending.length, backupPath }, "开始数据迁移");

  for (const migration of pending) {
    try {
      await db.transaction(async (tx) => {
        // 表重建期间允许临时违反外键，提交前校验
        await tx.run(sql`PRAGMA defer_foreign_keys = ON`);
        await migration.up({ db: tx });
        await tx.run(sql`PRAGMA user_version = ${sql.raw(String(migration.version))}`);
        await tx.run(sql`
          INSERT OR REPLACE INTO schema_migrations (version, name, applied_at, app_version, fingerprint)
          VALUES (${migration.version}, ${migration.name}, ${new Date().toISOString()},
                  ${app.getVersion()}, ${fingerprint(migration)})`);
      });
      applied.push(`${migration.version}:${migration.name}`);
      logger.info({ version: migration.version, name: migration.name }, "迁移步骤完成");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { version: migration.version, name: migration.name, backupPath, error: message },
        "迁移步骤失败",
      );
      throw new MigrationError(
        `数据迁移失败（${migration.version}:${migration.name}）：${message}`,
        backupPath,
      );
    }
  }

  return { from, to, applied, backupPath };
}
