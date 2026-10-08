import fs from "node:fs";
import path from "node:path";
import { pathManager } from "./paths";

type Level = "debug" | "info" | "warn" | "error";

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 单文件 5MB
const MAX_LOG_FILES = 4; // app.log.1 ~ app.log.4
const CHECK_EVERY_WRITES = 200;

/** 敏感键名与值模式 */
const SENSITIVE_KEY = /(token|secret|password|passwd|api[-_]?key|authorization|cookie)/i;
const SENSITIVE_INLINE = [/sk-[A-Za-z0-9_-]{6,}/g, /Bearer\s+[A-Za-z0-9._-]{8,}/gi];

function maskValue(value: unknown): unknown {
  if (typeof value !== "string") return "***";
  if (value.length === 0) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***`;
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    result[key] = SENSITIVE_KEY.test(key) ? maskValue(item) : redactValue(item, depth + 1);
  }
  return result;
}

function redactMessage(message: string): string {
  let result = message;
  for (const pattern of SENSITIVE_INLINE) result = result.replace(pattern, "***");
  return result;
}

let writeCount = 0;

function logDir(): string | null {
  const root = pathManager.getRoot();
  if (!root) return null; // 初始化之前只输出到控制台
  const dir = pathManager.getLogsPath();
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

function rotateIfNeeded(file: string): void {
  if (++writeCount % CHECK_EVERY_WRITES !== 0) return;
  try {
    if (fs.statSync(file).size < MAX_LOG_BYTES) return;
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const from = `${file}.${i}`;
      const to = `${file}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(file, `${file}.1`);
  } catch {
    // 轮转失败不应影响业务
  }
}

function append(fileName: string, line: string): void {
  const dir = logDir();
  if (!dir) return;
  const file = path.join(dir, fileName);
  try {
    rotateIfNeeded(file);
    fs.appendFileSync(file, line + "\n", "utf-8");
  } catch {
    // 日志失败不应影响业务
  }
}

/**
 * 兼容两种调用形式（与原 TBM 的 winston 调用风格一致）：
 *   logger.info("消息")
 *   logger.info({ meta }, "消息")
 * 敏感字段（token / apiKey / authorization / cookie …）会被自动脱敏。
 */
function write(level: Level, a: unknown, b?: string): void {
  const message = redactMessage(typeof b === "string" ? b : String(a));
  const meta = typeof b === "string" ? redactValue(a) : undefined;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    meta: meta ?? undefined,
  });
  append("app.log", line);

  const consoleArgs = meta === undefined ? [message] : [message, meta];
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(`[${level}]`, ...consoleArgs);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[${level}]`, ...consoleArgs);
  }
}

export interface AuditEvent {
  action: string;
  target?: string;
  detail?: Record<string, unknown>;
  result?: "ok" | "failed";
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
  /** 审计日志：删除 / 恢复 / 导入 / 重置 等不可逆操作 */
  audit(event: AuditEvent) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...event,
      detail: event.detail ? (redactValue(event.detail) as Record<string, unknown>) : undefined,
    });
    append("audit.log", line);
    write("info", { audit: event.action, target: event.target, result: event.result }, "审计事件");
  },
};

export default logger;
