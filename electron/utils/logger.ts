import fs from "node:fs";
import path from "node:path";
import { pathManager } from "./paths";

type Level = "debug" | "info" | "warn" | "error";

function logFilePath(): string {
  const dir = pathManager.getLogsPath();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "app.log");
}

/**
 * 兼容两种调用形式（与原 TBM 的 winston 调用风格一致）：
 *   logger.info("消息")
 *   logger.info({ meta }, "消息")
 */
function write(level: Level, a: unknown, b?: string): void {
  const message = typeof b === "string" ? b : String(a);
  const meta = typeof b === "string" ? a : undefined;
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      meta: meta ?? undefined,
    });
    fs.appendFileSync(logFilePath(), line + "\n", "utf-8");
  } catch {
    // 日志失败不应影响业务
  }
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(`[${level}] ${message}`, meta ?? "");
  } else {
    // eslint-disable-next-line no-console
    console.log(`[${level}] ${message}`, meta ?? "");
  }
}

const logger = {
  debug(a: unknown, b?: string) {
    write("debug", a, b);
  },
  info(a: unknown, b?: string) {
    write("info", a, b);
  },
  warn(a: unknown, b?: string) {
    write("warn", a, b);
  },
  error(a: unknown, b?: string) {
    write("error", a, b);
  },
};

export default logger;
