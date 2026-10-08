import fs from "node:fs";
import path from "node:path";
import { pathManager } from "../utils/paths";
import { rmIfExists } from "../utils/fsx";
import { pruneTrash } from "./integrity";
import logger from "../utils/logger";

const SESSION_KEEP_DAYS = 90;
const SESSION_MAX = 200;
const TRASH_KEEP_DAYS = 7;

interface SessionFile {
  file: string;
  updatedAt: number;
}

/** 清空 tmp（原子写残留、恢复工作区） */
export function clearTmp(): number {
  const tmp = pathManager.getTmpPath();
  if (!fs.existsSync(tmp)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(tmp)) {
    try {
      rmIfExists(path.join(tmp, entry));
      removed++;
    } catch (err) {
      logger.warn({ entry, error: String(err) }, "清理临时文件失败");
    }
  }
  return removed;
}

/** AI 会话：保留最近 30 天且总数不超过 200（含需求书正文，属敏感数据） */
export function pruneSessions(): number {
  const dir = pathManager.getSessionsPath();
  if (!fs.existsSync(dir)) return 0;
  const files: SessionFile[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(dir, name);
    try {
      const raw = JSON.parse(fs.readFileSync(full, "utf-8")) as { updatedAt?: number };
      files.push({ file: full, updatedAt: Number(raw.updatedAt ?? fs.statSync(full).mtimeMs) });
    } catch {
      files.push({ file: full, updatedAt: fs.statSync(full).mtimeMs });
    }
  }

  const cutoff = Date.now() - SESSION_KEEP_DAYS * 86_400_000;
  const sorted = files.sort((a, b) => b.updatedAt - a.updatedAt);
  let removed = 0;
  sorted.forEach((item, index) => {
    const expired = item.updatedAt < cutoff;
    const overLimit = index >= SESSION_MAX;
    if (!expired && !overLimit) return;
    try {
      rmIfExists(item.file);
      removed++;
    } catch (err) {
      logger.warn({ file: item.file, error: String(err) }, "清理会话失败");
    }
  });
  if (removed > 0) logger.info({ removed }, "清理过期 AI 会话");
  return removed;
}

/** 启动清理：临时文件 / 过期会话 / 回收站 */
export function runHousekeeping(): { tmp: number; sessions: number; trash: number } {
  const result = {
    tmp: clearTmp(),
    sessions: pruneSessions(),
    trash: pruneTrash(TRASH_KEEP_DAYS),
  };
  logger.info(result, "启动清理完成");
  return result;
}
