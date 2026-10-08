import { parseDocx, extractRequirement, type ParseDocxResult, type RequirementExtraction } from "../core/agent/docx-parser";
import { runSearchWithSession, deleteSession, testConnection } from "../core/agent/search-agent";
import { getConfigForUi, loadConfig, saveRawConfig, isConfigured, type SaveConfigInput } from "../core/agent/config";

export const agentService = {
  /** 解析 .docx 并通过 AI 提取需求书结构 */
  parseDocx(filePath: string): Promise<ParseDocxResult> {
    return parseDocx(filePath);
  },

  /** 从 Markdown 文本提取需求书结构 */
  extractRequirement(markdown: string): Promise<RequirementExtraction> {
    return extractRequirement(markdown);
  },

  /** 流式 AI 搜索（带会话） */
  search(sessionId: string, question: string, onChunk: (text: string) => void, projectCode?: string): Promise<void> {
    return runSearchWithSession(sessionId, question, onChunk, projectCode);
  },

  deleteSession(sessionId: string): void {
    deleteSession(sessionId);
  },

  testConnection(): Promise<{ ok: boolean; message: string }> {
    return testConnection();
  },

  /** 供设置页展示：不含明文 Key */
  getConfig() {
    return getConfigForUi();
  },

  isConfigured(): boolean {
    return isConfigured();
  },

  getEffectiveConfig() {
    try {
      return loadConfig();
    } catch {
      return null;
    }
  },

  saveConfig(data: SaveConfigInput): void {
    saveRawConfig(data);
  },
};
