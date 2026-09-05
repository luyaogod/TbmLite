import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { xqaa_t, xqab_t } from "../db/schema";
import { attachmentService } from "./attachment-service";
import logger from "../utils/logger";

export interface RequirementRow {
  xqaapj: string;
  xqaa001: string;
  xqaa002: string;
  xqaa003: string;
  xqaa004: string;
  xqaa005: string;
  xqaacrtdt: string;
  xqaacrtid: string;
  xqaamoddt: string;
  xqaamodit: string;
}

export interface RequirementMasterInput {
  xqaapj: string;
  xqaa001: string;
  xqaa002: string;
  xqaa003: string;
  xqaa004: string;
  xqaa005?: string;
}

export interface RequirementItemInput {
  seq: string;
  description: string;
  jobCode: string;
  jobName: string;
  hours: number;
  status: string;
  developer: string;
}

/** 需求书明细行（数据库原始形状） */
export interface RequirementItemRow {
  xqabpj: string;
  xqab001: string;
  xqabseq: string;
  xqab002: string;
  xqab003: string;
  xqab004: number;
  xqab005: string;
  xqab006: string;
  xqab007: string;
  xqabcrtdt: string;
  xqabcrtid: string;
  xqabmoddt: string;
  xqabmodit: string;
}

export interface DeleteResult {
  ok: boolean;
  reason?: string;
}

// ── 查询 ────────────────────────────────────────────────

export async function listRequirements(
  search?: string,
  xqaapj?: string,
): Promise<RequirementRow[]> {
  const rows = await db.select().from(xqaa_t).all();
  let result = rows;
  if (xqaapj) {
    const f = xqaapj.toLowerCase();
    result = result.filter((r) => r.xqaapj.toLowerCase().includes(f));
  }
  if (search) {
    const s = search.toLowerCase();
    result = result.filter(
      (r) =>
        r.xqaapj.toLowerCase().includes(s) ||
        r.xqaa001.toLowerCase().includes(s) ||
        r.xqaa002.toLowerCase().includes(s),
    );
  }
  // 按项目 + 需求书编号排序
  result = [...result].sort((a, b) =>
    a.xqaapj === b.xqaapj ? a.xqaa001.localeCompare(b.xqaa001) : a.xqaapj.localeCompare(b.xqaapj),
  );
  return result;
}

export async function getRequirement(
  xqaapj: string,
  xqaa001: string,
): Promise<RequirementRow | null> {
  const rows = await db
    .select()
    .from(xqaa_t)
    .where(and(eq(xqaa_t.xqaapj, xqaapj), eq(xqaa_t.xqaa001, xqaa001)))
    .all();
  return rows[0] ?? null;
}

export async function listItems(
  xqaapj: string,
  xqaa001: string,
): Promise<RequirementItemRow[]> {
  const rows = await db
    .select()
    .from(xqab_t)
    .where(and(eq(xqab_t.xqabpj, xqaapj), eq(xqab_t.xqab001, xqaa001)))
    .all();
  return [...rows].sort((a, b) =>
    Number(a.xqabseq) - Number(b.xqabseq) || a.xqabseq.localeCompare(b.xqabseq),
  );
}

// ── 新增 ────────────────────────────────────────────────

export async function createRequirement(
  master: RequirementMasterInput,
  items: RequirementItemInput[],
  userId: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await db
    .insert(xqaa_t)
    .values({
      xqaapj: master.xqaapj,
      xqaa001: master.xqaa001,
      xqaa002: master.xqaa002,
      xqaa003: master.xqaa003,
      xqaa004: master.xqaa004,
      xqaa005: master.xqaa005 ?? "",
      xqaacrtdt: today,
      xqaacrtid: userId,
      xqaamoddt: today,
      xqaamodit: userId,
    })
    .run();

  for (const item of items) {
    await db
      .insert(xqab_t)
      .values({
        xqabpj: master.xqaapj,
        xqab001: master.xqaa001,
        xqabseq: item.seq,
        xqab002: item.description,
        xqab003: item.jobCode,
        xqab004: item.hours,
        xqab005: item.status || "1",
        xqab006: item.developer ?? "",
        xqab007: item.jobName ?? "",
        xqabcrtdt: today,
        xqabcrtid: userId,
        xqabmoddt: today,
        xqabmodit: userId,
      })
      .run();
  }
  logger.info({ xqaapj: master.xqaapj, xqaa001: master.xqaa001, items: items.length }, "创建需求书");
}

// ── 更新主档 ────────────────────────────────────────────

export async function updateRequirement(
  xqaapj: string,
  xqaa001: string,
  data: Pick<RequirementRow, "xqaa002" | "xqaa003" | "xqaa004" | "xqaa005">,
  modifier: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .update(xqaa_t)
    .set({
      xqaa002: data.xqaa002,
      xqaa003: data.xqaa003,
      xqaa004: data.xqaa004,
      xqaa005: data.xqaa005,
      xqaamoddt: today,
      xqaamodit: modifier,
    })
    .where(and(eq(xqaa_t.xqaapj, xqaapj), eq(xqaa_t.xqaa001, xqaa001)))
    .run();
  logger.info({ xqaapj, xqaa001 }, "更新需求书主档");
}

// ── 明细全量同步（替换） ─────────────────────────────────

export async function syncItems(
  xqaapj: string,
  xqaa001: string,
  rows: RequirementItemInput[],
  userId: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .delete(xqab_t)
    .where(and(eq(xqab_t.xqabpj, xqaapj), eq(xqab_t.xqab001, xqaa001)))
    .run();
  for (const item of rows) {
    await db
      .insert(xqab_t)
      .values({
        xqabpj: xqaapj,
        xqab001: xqaa001,
        xqabseq: item.seq,
        xqab002: item.description,
        xqab003: item.jobCode,
        xqab004: item.hours,
        xqab005: item.status || "1",
        xqab006: item.developer ?? "",
        xqab007: item.jobName ?? "",
        xqabcrtdt: today,
        xqabcrtid: userId,
        xqabmoddt: today,
        xqabmodit: userId,
      })
      .run();
  }
  await db
    .update(xqaa_t)
    .set({ xqaamoddt: today, xqaamodit: userId })
    .where(and(eq(xqaa_t.xqaapj, xqaapj), eq(xqaa_t.xqaa001, xqaa001)))
    .run();
  logger.info({ xqaapj, xqaa001, items: rows.length }, "同步需求书明细");
}

// ── 更新单个明细项 ──────────────────────────────────────

export async function updateItem(
  xqaapj: string,
  xqaa001: string,
  seq: string,
  data: Partial<Pick<RequirementItemRow, "xqab002" | "xqab003" | "xqab004" | "xqab005" | "xqab006">>,
  modifier: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .update(xqab_t)
    .set({ ...data, xqabmoddt: today, xqabmodit: modifier })
    .where(
      and(
        eq(xqab_t.xqabpj, xqaapj),
        eq(xqab_t.xqab001, xqaa001),
        eq(xqab_t.xqabseq, seq),
      ),
    )
    .run();
}

// ── 删除（级联明细 + 附件） ─────────────────────────────

export async function deleteRequirement(
  xqaapj: string,
  xqaa001: string,
): Promise<DeleteResult> {
  await db
    .delete(xqab_t)
    .where(and(eq(xqab_t.xqabpj, xqaapj), eq(xqab_t.xqab001, xqaa001)))
    .run();
  await attachmentService.deleteByKey("xqaa_t", `${xqaapj}|${xqaa001}`);
  await db
    .delete(xqaa_t)
    .where(and(eq(xqaa_t.xqaapj, xqaapj), eq(xqaa_t.xqaa001, xqaa001)))
    .run();
  logger.info({ xqaapj, xqaa001 }, "删除需求书（级联）");
  return { ok: true };
}

export const requirementService = {
  listRequirements,
  getRequirement,
  listItems,
  createRequirement,
  updateRequirement,
  syncItems,
  updateItem,
  deleteRequirement,
};
