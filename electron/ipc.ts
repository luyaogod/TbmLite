import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getSchemaVersion } from "./db/index";
import { CURRENT_SCHEMA_VERSION } from "./db/migrations";
import { maintenance } from "./core/maintenance";
import { projectService } from "./services/project-service";
import { requirementService } from "./services/requirement-service";
import { attachmentService } from "./services/attachment-service";
import { agentService } from "./services/agent-service";
import { backupService } from "./services/backup-service";
import { getHealth, resetData, runGc, runIntegrityScan, type ResetScope } from "./services/data-service";
import { pathManager, type DataSubDir } from "./utils/paths";
import logger from "./utils/logger";

type WinGetter = () => BrowserWindow | null;

/**
 * 写操作统一包一层维护校验：恢复/重置/迁移期间拒绝写入，
 * 抛出的错误会以 reject 形式回到渲染层，由既有 toast 逻辑展示。
 */
function guarded<A extends unknown[], R>(
  handler: (...args: A) => R | Promise<R>,
): (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<R> {
  return async (_event, ...args) => {
    maintenance.assertWritable();
    return handler(...args);
  };
}

export function registerHandlers(getWin: WinGetter): void {
  // ── 项目 ──────────────────────────────────────────────

  ipcMain.handle("project:list", (_event, search?: string) =>
    projectService.listProjects(search));
  ipcMain.handle("project:get", (_event, pjaa001: string) =>
    projectService.getProject(pjaa001));
  ipcMain.handle("project:create", guarded((row: Parameters<typeof projectService.createProject>[0]) =>
    projectService.createProject(row)));
  ipcMain.handle("project:update", guarded((pjaa001: string, pjaa002: string, modifier: string) =>
    projectService.updateProject(pjaa001, pjaa002, modifier)));
  ipcMain.handle("project:delete", guarded((pjaa001: string) =>
    projectService.deleteProject(pjaa001)));

  // ── 需求书 ────────────────────────────────────────────

  ipcMain.handle("requirement:list", (_event, search?: string, xqaapj?: string) =>
    requirementService.listRequirements(search, xqaapj));
  ipcMain.handle("requirement:get", (_event, xqaapj: string, xqaa001: string) =>
    requirementService.getRequirement(xqaapj, xqaa001));
  ipcMain.handle("requirement:items", (_event, xqaapj: string, xqaa001: string) =>
    requirementService.listItems(xqaapj, xqaa001));
  ipcMain.handle("requirement:create", guarded(
    (master: Parameters<typeof requirementService.createRequirement>[0],
     items: Parameters<typeof requirementService.createRequirement>[1],
     userId: string) => requirementService.createRequirement(master, items, userId)));
  ipcMain.handle("requirement:update", guarded(
    (xqaapj: string, xqaa001: string, data: Parameters<typeof requirementService.updateRequirement>[2], modifier: string) =>
      requirementService.updateRequirement(xqaapj, xqaa001, data, modifier)));
  ipcMain.handle("requirement:sync-items", guarded(
    (xqaapj: string, xqaa001: string, rows: Parameters<typeof requirementService.syncItems>[2], userId: string) =>
      requirementService.syncItems(xqaapj, xqaa001, rows, userId)));
  ipcMain.handle("requirement:update-item", guarded(
    (xqaapj: string, xqaa001: string, seq: string, data: Parameters<typeof requirementService.updateItem>[3], modifier: string) =>
      requirementService.updateItem(xqaapj, xqaa001, seq, data, modifier)));
  ipcMain.handle("requirement:delete", guarded((xqaapj: string, xqaa001: string) =>
    requirementService.deleteRequirement(xqaapj, xqaa001)));

  // ── 附件 ──────────────────────────────────────────────

  ipcMain.handle("attachment:import", guarded((sourcePath: string, pj: string, req: string, userId: string) =>
    attachmentService.xqaa.import(sourcePath, pj, req, userId)));
  ipcMain.handle("attachment:replace", guarded((sourcePath: string, pj: string, req: string, userId: string) =>
    attachmentService.xqaa.replace(sourcePath, pj, req, userId)));
  ipcMain.handle("attachment:list", (_event, pj: string, req: string) =>
    attachmentService.xqaa.list(pj, req));
  ipcMain.handle("attachment:delete", guarded((pj: string, req: string, hash: string) =>
    attachmentService.xqaa.detach(pj, req, hash)));

  ipcMain.handle("attachment:open", async (_event, relativePath: string) => {
    let absPath: string;
    try {
      absPath = attachmentService.getFileAbsolutePath(relativePath);
    } catch (err) {
      return err instanceof Error ? err.message : "非法路径";
    }
    if (!fs.existsSync(absPath)) return "附件文件不存在";
    return shell.openPath(absPath); // 空字符串表示成功
  });

  ipcMain.handle("attachment:save-as", async (_event, relativePath: string, defaultName: string) => {
    let absPath: string;
    try {
      absPath = attachmentService.getFileAbsolutePath(relativePath);
    } catch (err) {
      logger.warn({ relativePath, error: String(err) }, "附件另存为被拒绝");
      return false;
    }
    if (!fs.existsSync(absPath)) return false;
    const parent = getWin();
    const result = parent
      ? await dialog.showSaveDialog(parent, { defaultPath: defaultName })
      : await dialog.showSaveDialog({ defaultPath: defaultName });
    if (result.canceled || !result.filePath) return false;
    fs.copyFileSync(absPath, result.filePath);
    return true;
  });

  ipcMain.handle("attachment:get-data-url", (_event, relativePath: string) => {
    try {
      return attachmentService.getDataUrl(relativePath);
    } catch (err) {
      logger.warn({ relativePath, error: String(err) }, "读取附件数据失败");
      return null;
    }
  });

  // ── AI ────────────────────────────────────────────────

  ipcMain.handle("ai:parse-docx", (_event, filePath: string) =>
    agentService.parseDocx(filePath));

  ipcMain.handle("ai:test-connection", () =>
    agentService.testConnection());

  ipcMain.handle("ai:config:get", () => agentService.getConfig());
  ipcMain.handle("ai:config:save", guarded((data: Parameters<typeof agentService.saveConfig>[0]) =>
    agentService.saveConfig(data)));
  ipcMain.handle("ai:status", () => ({ configured: agentService.isConfigured() }));

  ipcMain.on("ai:search", async (event, sessionId: string, question: string, projectCode?: string) => {
    try {
      await agentService.search(sessionId, question, (chunk) => {
        event.sender.send("ai:search-chunk", chunk);
      }, projectCode);
      event.sender.send("ai:search-done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, "AI 搜索失败");
      event.sender.send("ai:search-error", message);
    }
  });

  ipcMain.handle("ai:delete-session", guarded((sessionId: string) => {
    agentService.deleteSession(sessionId);
  }));

  // ── 应用信息 / 数据目录 ───────────────────────────────

  ipcMain.handle("app:info", async () => ({
    version: app.getVersion(),
    schemaVersion: await getSchemaVersion(),
    currentSchemaVersion: CURRENT_SCHEMA_VERSION,
    dataRoot: pathManager.getRoot(),
    userData: app.getPath("userData"),
    packaged: app.isPackaged,
    maintenance: maintenance.isActive(),
  }));

  ipcMain.handle("app:open-data-dir", async (_event, sub?: DataSubDir) => {
    const target = pathManager.getSubDir(sub ?? "root");
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    return shell.openPath(target);
  });

  ipcMain.handle("app:open-log", async () => {
    const file = path.join(pathManager.getLogsPath(), "app.log");
    if (!fs.existsSync(file)) return "日志文件尚未生成";
    return shell.openPath(file);
  });

  // ── 数据健康 / 一致性 / 重置 ──────────────────────────

  ipcMain.handle("data:health", (_event, check?: boolean) => getHealth({ check: Boolean(check) }));
  ipcMain.handle("data:check-integrity", () => runIntegrityScan());
  ipcMain.handle("data:gc-orphan-files", guarded((dryRun?: boolean) => runGc(Boolean(dryRun))));
  ipcMain.handle("data:reset", guarded((scope: ResetScope, confirm: string) => resetData(scope, confirm)));

  // ── 备份 ──────────────────────────────────────────────

  ipcMain.handle("backup:list", () => backupService.list());
  ipcMain.handle("backup:create", guarded((label?: string) => backupService.create("manual", label)));
  ipcMain.handle("backup:prune", guarded(() => ({ removed: backupService.prune() })));
  ipcMain.handle("backup:delete", guarded((id: string) => {
    backupService.delete(id);
    return { ok: true };
  }));
  ipcMain.handle("backup:restore", async (_event, id: string) => {
    const result = await backupService.stageRestore(id);
    // 换库只能在下次启动（无数据库连接）时完成，因此备份后自动重启应用
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 400);
    return {
      ok: true,
      preBackup: result.preBackup?.fileName ?? null,
      schemaVersion: result.schemaVersion,
      restarting: true,
    };
  });
  ipcMain.handle("backup:save-as", async (_event, id: string, defaultName?: string) => {
    const parent = getWin();
    const options = { defaultPath: defaultName ?? id, filters: [{ name: "SQLite 数据库", extensions: ["db"] }] };
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: false as const };
    await backupService.saveAs(id, result.filePath);
    return { ok: true as const, path: result.filePath };
  });
}
