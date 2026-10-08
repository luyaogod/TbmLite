import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db/index";
import { ffff_t } from "../db/schema";
import { pathManager, resolveExistingWithin, resolveWithin } from "../utils/paths";
import { rmIfExists, stamp } from "../utils/fsx";
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

const MAX_FILE_BYTES = 200 * 1024 * 1024;

// ── 归属键 ──────────────────────────────────────────────
// 附件归属使用 `项目|需求书` 复合键（沿用历史数据结构）。
// 分隔符出现在键值里会导致串键，因此在写入侧统一校验。

export function attachmentOwnerKey(pj: string, req: string): string {
  validateKeyPart(pj, "项目编号");
  validateKeyPart(req, "需求书编号");
  return `${pj}|${req}`;
}

export function validateKeyPart(value: string, label: string): void {
  if (!value || /[|\\/:*?"<>]/.test(value)) {
    throw new Error(`${label}不能为空且不能包含 | \\ / : * ? " < > 等字符`);
  }
}

// ── 文件系统 ────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 只保留安全的扩展名（存储文件名由 hash + 扩展名生成） */
function sanitizeExt(ext: string): string {
  if (!ext) return "";
  const normalized = ext.toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(normalized) ? normalized : "";
}

function computeHash(filePath: string): string {
  const size = fs.statSync(filePath).size;
  if (size > MAX_FILE_BYTES) {
    throw new Error(`文件过大（${Math.round(size / 1024 / 1024)}MB），上限 ${MAX_FILE_BYTES / 1024 / 1024}MB`);
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertReadableFile(sourcePath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(sourcePath);
  } catch {
    throw new Error(`源文件不存在：${sourcePath}`);
  }
  if (!stat.isFile()) throw new Error(`源文件不可用：${sourcePath}`);
  if (stat.size === 0) throw new Error("源文件为空");
}

/**
 * 附件绝对路径：所有来自数据库/渲染层的相对路径都必须经 resolveWithin 收敛，
 * 已存在的文件再做 realpath 校验（防符号链接逃逸）。
 */
export function getFileAbsolutePath(relativePath: string): string {
  const base = pathManager.getFilesRoot();
  const abs = resolveWithin(base, relativePath);
  if (fs.existsSync(abs)) return resolveExistingWithin(base, relativePath);
  return abs;
}

function moveToTrash(absPath: string, relPath: string): void {
  const target = path.join(pathManager.getTrashRoot(), stamp(), relPath);
  ensureDir(path.dirname(target));
  try {
    fs.renameSync(absPath, target);
  } catch {
    fs.copyFileSync(absPath, target);
    rmIfExists(absPath);
  }
  logger.info({ relPath, target }, "附件移入回收站");
}

// ── 查询 ────────────────────────────────────────────────

async function listFiles(tableName: string, ownerKey: string): Promise<AttachmentRow[]> {
  return db
    .select()
    .from(ffff_t)
    .where(and(eq(ffff_t.ffff001, tableName), eq(ffff_t.ffff002, ownerKey)))
    .all();
}

// ── 写入 ────────────────────────────────────────────────

/**
 * 内容寻址存储：同一物理文件可被多个归属引用（引用计数由 ffff_t 行数表达）。
 * 文件先落盘（幂等），再写引用行。
 */
async function importFile(
  sourcePath: string,
  tableName: string,
  ownerKey: string,
  userId: string,
): Promise<AttachmentRow> {
  assertReadableFile(sourcePath);
  const hash = computeHash(sourcePath);
  const ext = sanitizeExt(path.extname(sourcePath));
  const relPath = `${tableName}/${hash}${ext}`;
  const destPath = resolveWithin(pathManager.getFilesRoot(), relPath);
  ensureDir(path.dirname(destPath));
  if (!fs.existsSync(destPath)) fs.copyFileSync(sourcePath, destPath);

  const row: AttachmentRow = {
    ffff001: tableName,
    ffff002: ownerKey,
    ffff003: relPath,
    ffff004: hash,
    ffff005: path.basename(sourcePath),
    ffff006: ext,
    ffffcrtdt: new Date().toISOString().slice(0, 10),
    ffffecrtid: userId,
    ffffstus: true,
  };
  await db.insert(ffff_t).values(row).onConflictDoNothing().run();
  logger.info({ tableName, ownerKey, originalName: row.ffff005, hash: hash.slice(0, 12) }, "导入附件");
  return row;
}

/** 未被任何引用行指向的物理文件按引用计数回收 */
async function retireFiles(relPaths: string[]): Promise<number> {
  let retired = 0;
  for (const relPath of new Set(relPaths)) {
    const remaining = await db.select().from(ffff_t).where(eq(ffff_t.ffff003, relPath)).all();
    if (remaining.length > 0) continue;
    const abs = resolveWithin(pathManager.getFilesRoot(), relPath);
    if (fs.existsSync(abs)) {
      moveToTrash(abs, relPath);
      retired++;
    }
  }
  return retired;
}

async function replaceFile(
  sourcePath: string,
  tableName: string,
  ownerKey: string,
  userId: string,
): Promise<AttachmentRow> {
  const previous = await listFiles(tableName, ownerKey);
  const row = await importFile(sourcePath, tableName, ownerKey, userId);
  // 旧引用行在导入成功后再删除，且仅当同一路径不再被引用才回收文件
  for (const item of previous) {
    await db
      .delete(ffff_t)
      .where(
        and(
          eq(ffff_t.ffff001, item.ffff001),
          eq(ffff_t.ffff002, item.ffff002),
          eq(ffff_t.ffff004, item.ffff004),
        ),
      )
      .run();
  }
  await retireFiles(previous.map((item) => item.ffff003));
  return row;
}

/** 解除单个引用（表 + 归属键 + hash），不存在的引用视为成功 */
async function detach(
  tableName: string,
  ownerKey: string,
  hash: string,
): Promise<{ ok: boolean; reason?: string }> {
  const rows = await db
    .select()
    .from(ffff_t)
    .where(
      and(
        eq(ffff_t.ffff001, tableName),
        eq(ffff_t.ffff002, ownerKey),
        eq(ffff_t.ffff004, hash),
      ),
    )
    .all();
  if (rows.length === 0) return { ok: false, reason: "附件记录不存在" };

  await db
    .delete(ffff_t)
    .where(
      and(
        eq(ffff_t.ffff001, tableName),
        eq(ffff_t.ffff002, ownerKey),
        eq(ffff_t.ffff004, hash),
      ),
    )
    .run();
  const retired = await retireFiles(rows.map((row) => row.ffff003));
  logger.info({ tableName, ownerKey, hash: hash.slice(0, 12), retired }, "解除附件引用");
  return { ok: true };
}

/** 解除某个归属下的全部引用（需求书删除时调用，需在同一事务后调用） */
async function detachByKey(tableName: string, ownerKey: string): Promise<number> {
  const rows = await listFiles(tableName, ownerKey);
  if (rows.length === 0) return 0;
  await db
    .delete(ffff_t)
    .where(and(eq(ffff_t.ffff001, tableName), eq(ffff_t.ffff002, ownerKey)))
    .run();
  return retireFiles(rows.map((row) => row.ffff003));
}

function getDataUrl(relativePath: string): string | null {
  const abs = getFileAbsolutePath(relativePath);
  if (!fs.existsSync(abs)) return null;
  const buffer = fs.readFileSync(abs);
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
  const mime = mimeMap[path.extname(relativePath).toLowerCase()] ?? "application/octet-stream";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function getFileBase64(relativePath: string): string | null {
  const abs = getFileAbsolutePath(relativePath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs).toString("base64");
}

export const attachmentService = {
  getFileAbsolutePath,
  getDataUrl,
  getFileBase64,
  retireFiles,
  attachmentOwnerKey,

  /** 需求书附件（xqaa_t） */
  xqaa: {
    list(pj: string, req: string) {
      return listFiles("xqaa_t", attachmentOwnerKey(pj, req));
    },
    import(sourcePath: string, pj: string, req: string, userId: string) {
      return importFile(sourcePath, "xqaa_t", attachmentOwnerKey(pj, req), userId);
    },
    replace(sourcePath: string, pj: string, req: string, userId: string) {
      return replaceFile(sourcePath, "xqaa_t", attachmentOwnerKey(pj, req), userId);
    },
    detach(pj: string, req: string, hash: string) {
      return detach("xqaa_t", attachmentOwnerKey(pj, req), hash);
    },
    detachByKey(pj: string, req: string) {
      return detachByKey("xqaa_t", attachmentOwnerKey(pj, req));
    },
    /** 按需求书收集全部附件（供 AI 上下文使用） */
    async listAllByRequirement(): Promise<Map<string, string[]>> {
      const rows = await db.select().from(ffff_t).where(eq(ffff_t.ffff001, "xqaa_t")).all();
      const map = new Map<string, string[]>();
      for (const row of rows) {
        const list = map.get(row.ffff002) ?? [];
        list.push(row.ffff005);
        map.set(row.ffff002, list);
      }
      return map;
    },
  },
};
