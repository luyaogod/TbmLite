import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { pjaa, xqaa_t } from "../db/schema";
import logger from "../utils/logger";

export interface ProjectRow {
  pjaa001: string;
  pjaa002: string;
  pjaacrtdt: string;
  pjaacrtid: string;
  pjaamoddt: string;
  pjaamodit: string;
}

export interface DeleteResult {
  ok: boolean;
  reason?: string;
}

export async function listProjects(search?: string): Promise<ProjectRow[]> {
  const rows = await db.select().from(pjaa).all();
  if (!search) return rows;
  const s = search.toLowerCase();
  return rows.filter(
    (r) =>
      r.pjaa001.toLowerCase().includes(s) ||
      r.pjaa002.toLowerCase().includes(s),
  );
}

export async function getProject(pjaa001: string): Promise<ProjectRow | null> {
  const rows = await db.select().from(pjaa).where(eq(pjaa.pjaa001, pjaa001)).all();
  return rows[0] ?? null;
}

export async function createProject(row: ProjectRow): Promise<void> {
  await db.insert(pjaa).values(row).run();
  logger.info({ pjaa001: row.pjaa001 }, "创建项目");
}

export async function updateProject(
  pjaa001: string,
  pjaa002: string,
  modifier: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .update(pjaa)
    .set({ pjaa002, pjaamoddt: today, pjaamodit: modifier })
    .where(eq(pjaa.pjaa001, pjaa001))
    .run();
  logger.info({ pjaa001 }, "更新项目");
}

export async function deleteProject(pjaa001: string): Promise<DeleteResult> {
  const used = await db
    .select()
    .from(xqaa_t)
    .where(eq(xqaa_t.xqaapj, pjaa001))
    .all();
  if (used.length > 0) {
    return {
      ok: false,
      reason: `该项目下存在 ${used.length} 份需求书，请先删除需求书`,
    };
  }
  await db.delete(pjaa).where(eq(pjaa.pjaa001, pjaa001)).run();
  logger.info({ pjaa001 }, "删除项目");
  return { ok: true };
}

export const projectService = { listProjects, getProject, createProject, updateProject, deleteProject };
