import fs from "node:fs";
import path from "node:path";
import { pathManager } from "../../utils/paths";
import { rmIfExists, writeJsonAtomic } from "../../utils/fsx";
import logger from "../../utils/logger";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSession {
  sessionId: string;
  projectCode: string | undefined;
  systemPrompt: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

function sessionsDir(): string {
  const dir = pathManager.getSessionsPath();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function filePath(sessionId: string): string {
  return path.join(sessionsDir(), `${sessionId}.json`);
}

export const sessionStore = {
  save(session: ChatSession): void {
    try {
      writeJsonAtomic(filePath(session.sessionId), session);
      logger.debug({ sessionId: session.sessionId, turns: session.messages.length / 2 }, "会话已保存");
    } catch (e) {
      logger.error({ sessionId: session.sessionId, error: String(e) }, "会话保存失败");
    }
  },

  load(sessionId: string): ChatSession | null {
    try {
      const p = filePath(sessionId);
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, "utf-8");
      return JSON.parse(raw) as ChatSession;
    } catch (e) {
      logger.error({ sessionId, error: String(e) }, "会话加载失败");
      return null;
    }
  },

  delete(sessionId: string): void {
    try {
      rmIfExists(filePath(sessionId));
      logger.debug({ sessionId }, "会话已删除");
    } catch (e) {
      logger.error({ sessionId, error: String(e) }, "会话删除失败");
    }
  },
};
