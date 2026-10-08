import type { DbExecutor } from "../index";

export interface MigrationContext {
  /** 事务句柄：迁移步骤内的所有语句都在同一事务中执行 */
  db: DbExecutor;
}

export interface Migration {
  /** 目标 PRAGMA user_version，必须严格递增 */
  version: number;
  /** 短名，用于日志与 schema_migrations 审计 */
  name: string;
  up(ctx: MigrationContext): Promise<void>;
}
