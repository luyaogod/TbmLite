import { app } from "electron";
import { sql } from "drizzle-orm";
import { db, getSchemaVersion } from "../db/index";
import { CURRENT_SCHEMA_VERSION } from "../db/migrations";
import { checkDatabase, type DatabaseCheck } from "./integrity";
import { compareVersions, readMeta } from "./meta";
import logger from "../utils/logger";

export type GuardStatus = "ok" | "higher-schema" | "older-app" | "corrupt" | "dirty-exit";

export interface GuardResult {
  status: GuardStatus;
  detail: string;
  schemaVersion: number;
  appVersion: string;
  minReaderVersion: string | null;
  check: DatabaseCheck | null;
}

/**
 * 打开数据目录前的门禁检查。顺序：可读性 → 数据版本 → 程序版本 → 非正常退出。
 * 任何「不通过」都不允许继续写入，由 main 负责提示与处置。
 */
export async function inspect(opts: { freshInstall: boolean }): Promise<GuardResult> {
  const appVersion = app.getVersion();
  const base = { appVersion, schemaVersion: 0, minReaderVersion: null, check: null };

  try {
    await db.get(sql`SELECT COUNT(*) AS n FROM sqlite_master`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error({ error: detail }, "数据库无法打开");
    return { ...base, status: "corrupt", detail };
  }

  const schemaVersion = await getSchemaVersion();
  const meta = readMeta();
  const minReaderVersion = meta?.minReaderVersion ?? null;

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      ...base,
      status: "higher-schema",
      schemaVersion,
      minReaderVersion,
      detail: `数据版本 ${schemaVersion} 高于当前程序支持的版本 ${CURRENT_SCHEMA_VERSION}`,
    };
  }

  if (minReaderVersion && compareVersions(appVersion, minReaderVersion) < 0) {
    return {
      ...base,
      status: "older-app",
      schemaVersion,
      minReaderVersion,
      detail: `当前程序版本 ${appVersion} 低于数据要求的最低版本 ${minReaderVersion}`,
    };
  }

  const dirtyExit = !opts.freshInstall && meta !== null && meta.cleanExit === false;
  if (dirtyExit) {
    const check = await checkDatabase(false);
    if (!check.ok) {
      return {
        ...base,
        status: "corrupt",
        schemaVersion,
        minReaderVersion,
        check,
        detail: check.messages.join("; "),
      };
    }
    logger.warn({ schemaVersion }, "上次未正常退出，完整性校验通过");
    return {
      ...base,
      status: "dirty-exit",
      schemaVersion,
      minReaderVersion,
      check,
      detail: "上次未正常退出，已通过完整性校验",
    };
  }

  return { ...base, status: "ok", schemaVersion, minReaderVersion, detail: "数据可读" };
}
