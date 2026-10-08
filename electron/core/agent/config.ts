import path from "node:path";
import { safeStorage } from "electron";
import { pathManager } from "../../utils/paths";
import { readJson, writeJsonAtomic } from "../../utils/fsx";
import logger from "../../utils/logger";

// ── 配置 ──────────────────────────────────────────────

export interface AgentConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxRetries: number;
}

const KEY_BASE_URL = "ANTHROPIC_BASE_URL";
const KEY_MODEL = "ANTHROPIC_MODEL";
const KEY_TOKEN = "ANTHROPIC_AUTH_TOKEN";

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";

/** safeStorage(DPAPI) 密文前缀，用于区分历史明文配置 */
const ENC_PREFIX = "v1:";

type StoredConfig = Record<string, string | undefined> & {
  keyEncoding?: "safeStorage" | "plain";
};

export type KeyState = "ok" | "missing" | "undecryptable" | "plaintext";

export function configFilePath(): string {
  return path.join(pathManager.getConfigPath(), "aj-api.json");
}

function readConfigFile(): StoredConfig | null {
  const filePath = configFilePath();
  const raw = readJson<StoredConfig>(filePath);
  if (!raw) {
    logger.debug({ filePath }, "配置文件不存在");
    return null;
  }
  return raw;
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function sealSecret(plain: string): { value: string; encoding: "safeStorage" | "plain" } {
  if (!plain) return { value: "", encoding: "plain" };
  if (!encryptionAvailable()) {
    logger.warn("系统安全存储不可用，API Key 将以明文保存");
    return { value: plain, encoding: "plain" };
  }
  try {
    return { value: ENC_PREFIX + safeStorage.encryptString(plain).toString("base64"), encoding: "safeStorage" };
  } catch (err) {
    logger.warn({ error: String(err) }, "API Key 加密失败，降级为明文保存");
    return { value: plain, encoding: "plain" };
  }
}

function openSecret(stored: string | undefined, encoding: StoredConfig["keyEncoding"]): { value: string; state: KeyState } {
  if (!stored) return { value: "", state: "missing" };
  if (!stored.startsWith(ENC_PREFIX)) {
    return { value: stored, state: encoding === "plain" ? "plaintext" : "ok" };
  }
  try {
    return { value: safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), "base64")), state: "ok" };
  } catch (err) {
    // 典型场景：备份被拷到另一台机器/另一个 Windows 用户下，DPAPI 无法解密
    logger.warn({ error: String(err) }, "API Key 解密失败（可能更换了机器或系统账户）");
    return { value: "", state: "undecryptable" };
  }
}

/** 主进程内部使用：返回解密后的明文配置 */
export function readRawConfig(): Record<string, string> | null {
  const raw = readConfigFile();
  if (!raw) return null;
  const token = openSecret(raw[KEY_TOKEN], raw.keyEncoding);
  return {
    [KEY_BASE_URL]: raw[KEY_BASE_URL] ?? DEFAULT_BASE_URL,
    [KEY_MODEL]: raw[KEY_MODEL] ?? DEFAULT_MODEL,
    [KEY_TOKEN]: token.value,
  };
}

export function loadConfig(): AgentConfig {
  const raw = readConfigFile();
  if (!raw) {
    throw new Error("AI 配置不存在，请先到「设置」页填写 API 配置");
  }
  const token = openSecret(raw[KEY_TOKEN], raw.keyEncoding);
  const baseUrl = (raw[KEY_BASE_URL] ?? DEFAULT_BASE_URL).replace("/anthropic", "/v1");
  const model = raw[KEY_MODEL] ?? DEFAULT_MODEL;
  logger.info({ baseUrl, model, keyState: token.state }, "Agent 配置加载完成");
  return { baseUrl, model, apiKey: token.value, maxRetries: 3 };
}

/** 供渲染层展示：绝不返回明文 Key */
export function getConfigForUi(): {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  keyState: KeyState;
  keyEncrypted: boolean;
} {
  const raw = readConfigFile();
  const token = openSecret(raw?.[KEY_TOKEN], raw?.keyEncoding);
  return {
    baseUrl: raw?.[KEY_BASE_URL] ?? DEFAULT_BASE_URL,
    model: raw?.[KEY_MODEL] ?? DEFAULT_MODEL,
    hasApiKey: token.state === "ok" || token.state === "plaintext",
    keyState: token.state,
    keyEncrypted: encryptionAvailable(),
  };
}

export interface SaveConfigInput {
  baseUrl: string;
  model: string;
  /** 留空表示「保持已保存的 Key 不变」 */
  apiKey?: string | null;
}

export function saveRawConfig(input: SaveConfigInput): void {
  const existing = readConfigFile();
  const sealed = input.apiKey ? sealSecret(input.apiKey) : null;

  const next: StoredConfig = {
    [KEY_BASE_URL]: input.baseUrl,
    [KEY_MODEL]: input.model,
    [KEY_TOKEN]: sealed
      ? sealed.value
      : (existing?.[KEY_TOKEN] ?? ""),
    keyEncoding: sealed ? sealed.encoding : (existing?.keyEncoding ?? "plain"),
  };
  writeJsonAtomic(configFilePath(), next);
  logger.info({ baseUrl: input.baseUrl, model: input.model, keyReplaced: sealed !== null }, "Agent 配置已保存");
}

/** 判断是否可用（不抛异常版本，供 UI 与启动检查） */
export function isConfigured(): boolean {
  const raw = readConfigFile();
  if (!raw) return false;
  const token = openSecret(raw[KEY_TOKEN], raw.keyEncoding);
  return token.state === "ok" || token.state === "plaintext";
}
