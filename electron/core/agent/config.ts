import fs from "node:fs";
import path from "node:path";
import { pathManager } from "../../utils/paths";
import logger from "../../utils/logger";

// ── 配置 ──────────────────────────────────────────────

export interface AgentConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxRetries: number;
}

export function configFilePath(): string {
  return path.join(pathManager.getConfigPath(), "aj-api.json");
}

export function loadConfig(): AgentConfig {
  const filePath = configFilePath();
  logger.debug({ filePath }, "加载 Agent 配置");
  if (!fs.existsSync(filePath)) {
    logger.error({ filePath }, "Agent 配置文件不存在");
    throw new Error(`AI 配置文件不存在，请先到「设置」页填写 API 配置`);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const baseUrl =
    raw.ANTHROPIC_BASE_URL?.replace("/anthropic", "/v1") ??
    "https://api.deepseek.com/v1";
  const model = raw.ANTHROPIC_MODEL ?? "deepseek-chat";
  logger.info(
    { baseUrl, model, apiKeyMasked: raw.ANTHROPIC_AUTH_TOKEN?.slice(0, 8) + "***" },
    "Agent 配置加载完成",
  );
  return {
    baseUrl,
    model,
    apiKey: raw.ANTHROPIC_AUTH_TOKEN ?? "",
    maxRetries: 3,
  };
}

export function readRawConfig(): Record<string, string> | null {
  const filePath = configFilePath();
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, string>;
}

export function saveRawConfig(data: Record<string, string>): void {
  const filePath = configFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 4), "utf-8");
  logger.info("Agent 配置已保存");
}
