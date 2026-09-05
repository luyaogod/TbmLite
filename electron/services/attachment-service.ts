import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db/index";
import { ffff_t } from "../db/schema";
import { pathManager } from "../utils/paths";
import logger from "../utils/logger";

export interface AttachmentRow {
  ffff001: string;
  ffff002: string;
  ffff003: string;
  ffff004: string;
  ffff005: string;
  ffff006: string;
  ffffcrtdt: string;
  ffffecrtid: string;
  ffffstus: boolean;
}

// ── 文件系统 ────────────────────────────────────────────

function computeHash(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getFileAbsolutePath(relativePath: string): string {
  return path.join(pathManager.getFilesRoot(), relativePath);
}

function copyToStore(sourcePath: string, tableName: string): string {
  const hash = computeHash(sourcePath);
  const ext = path.extname(sourcePath);
  const storedName = `${hash}${ext}`;
  const tableDir = path.join(pathManager.getFilesRoot(), tableName);
  ensureDir(tableDir);
  const destPath = path.join(tableDir, storedName);
  if (!fs.existsSync(destPath)) fs.copyFileSync(sourcePath, destPath);
  return `${tableName}/${storedName}`;
}

// ── 查询 ────────────────────────────────────────────────

async function listFiles(tableName: string, key: string): Promise<AttachmentRow[]> {
  return db
    .select()
    .from(ffff_t)
    .where(and(eq(ffff_t.ffff001, tableName), eq(ffff_t.ffff002, key)))
    .all();
}

// ── 通用 ────────────────────────────────────────────────

async function importFile(
  sourcePath: string,
  tableName: string,
  key: string,
  userId: string,
): Promise<AttachmentRow> {
  const relativePath = copyToStore(sourcePath, tableName);
  const originalName = path.basename(sourcePath);
  const ext = path.extname(originalName);
  const hash = computeHash(sourcePath);
  const today = new Date().toISOString().slice(0, 10);

  const row: AttachmentRow = {
    ffff001: tableName,
    ffff002: key,
    ffff003: relativePath,
    ffff004: hash,
    ffff005: originalName,
    ffff006: ext,
    ffffcrtdt: today,
    ffffecrtid: userId,
    ffffstus: true,
  };
  await db.insert(ffff_t).values(row).run();
  logger.info({ tableName, key, originalName }, "导入附件");
  return row;
}

async function replaceFile(
  sourcePath: string,
  tableName: string,
  key: string,
  userId: string,
): Promise<AttachmentRow> {
  const files = await listFiles(tableName, key);
  for (const f of files) {
    const absPath = getFileAbsolutePath(f.ffff003);
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    await db.delete(ffff_t).where(eq(ffff_t.ffff004, f.ffff004)).run();
  }
  return importFile(sourcePath, tableName, key, userId);
}

async function deleteFile(hash: string): Promise<{ ok: boolean; reason?: string }> {
  const rows = await db.select().from(ffff_t).where(eq(ffff_t.ffff004, hash)).all();
  const row = rows[0];
  if (!row) return { ok: false, reason: "附件记录不存在" };
  const absPath = getFileAbsolutePath(row.ffff003);
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  await db.delete(ffff_t).where(eq(ffff_t.ffff004, hash)).run();
  return { ok: true };
}

async function deleteByKey(tableName: string, key: string): Promise<void> {
  const files = await listFiles(tableName, key);
  for (const f of files) {
    const absPath = getFileAbsolutePath(f.ffff003);
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    await db.delete(ffff_t).where(eq(ffff_t.ffff004, f.ffff004)).run();
  }
}

function getDataUrl(relativePath: string): string | null {
  const absPath = getFileAbsolutePath(relativePath);
  if (!fs.existsSync(absPath)) return null;
  const buffer = fs.readFileSync(absPath);
  const ext = path.extname(relativePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
  };
  return `data:${mimeMap[ext] || "application/octet-stream"};base64,${buffer.toString("base64")}`;
}

function getFileBase64(relativePath: string): string | null {
  const absPath = getFileAbsolutePath(relativePath);
  if (!fs.existsSync(absPath)) return null;
  return fs.readFileSync(absPath).toString("base64");
}

export const attachmentService = {
  getFileAbsolutePath,
  getDataUrl,
  getFileBase64,
  deleteFile,
  deleteByKey,

  /** 需求书附件（xqaa_t） */
  xqaa: {
    import(sourcePath: string, pj: string, req: string, userId: string) {
      return importFile(sourcePath, "xqaa_t", `${pj}|${req}`, userId);
    },
    replace(sourcePath: string, pj: string, req: string, userId: string) {
      return replaceFile(sourcePath, "xqaa_t", `${pj}|${req}`, userId);
    },
    list(pj: string, req: string) {
      return listFiles("xqaa_t", `${pj}|${req}`);
    },
    /** 按需求书收集全部附件（供 AI 上下文使用） */
    async listAllByRequirement(): Promise<Map<string, string[]>> {
      const rows = await db.select().from(ffff_t).where(eq(ffff_t.ffff001, "xqaa_t")).all();
      const map = new Map<string, string[]>();
      for (const r of rows) {
        const list = map.get(r.ffff002) ?? [];
        list.push(r.ffff005);
        map.set(r.ffff002, list);
      }
      return map;
    },
  },
};
