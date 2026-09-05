import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import fs from "node:fs";
import { projectService } from "./services/project-service";
import { requirementService } from "./services/requirement-service";
import { attachmentService } from "./services/attachment-service";
import { agentService } from "./services/agent-service";
import logger from "./utils/logger";

export function registerHandlers(win: BrowserWindow) {
  // ── 项目 ──────────────────────────────────────────────

  ipcMain.handle("project:list", (_event, search?: string) =>
    projectService.listProjects(search));
  ipcMain.handle("project:get", (_event, pjaa001: string) =>
    projectService.getProject(pjaa001));
  ipcMain.handle("project:create", (_event, row) =>
    projectService.createProject(row));
  ipcMain.handle("project:update", (_event, pjaa001: string, pjaa002: string, modifier: string) =>
    projectService.updateProject(pjaa001, pjaa002, modifier));
  ipcMain.handle("project:delete", (_event, pjaa001: string) =>
    projectService.deleteProject(pjaa001));

  // ── 需求书 ────────────────────────────────────────────

  ipcMain.handle("requirement:list", (_event, search?: string, xqaapj?: string) =>
    requirementService.listRequirements(search, xqaapj));
  ipcMain.handle("requirement:get", (_event, xqaapj: string, xqaa001: string) =>
    requirementService.getRequirement(xqaapj, xqaa001));
  ipcMain.handle("requirement:items", (_event, xqaapj: string, xqaa001: string) =>
    requirementService.listItems(xqaapj, xqaa001));
  ipcMain.handle("requirement:create", (_event, master, items, userId: string) =>
    requirementService.createRequirement(master, items, userId));
  ipcMain.handle("requirement:update", (_event, xqaapj: string, xqaa001: string, data, modifier: string) =>
    requirementService.updateRequirement(xqaapj, xqaa001, data, modifier));
  ipcMain.handle("requirement:sync-items", (_event, xqaapj: string, xqaa001: string, rows, userId: string) =>
    requirementService.syncItems(xqaapj, xqaa001, rows, userId));
  ipcMain.handle("requirement:update-item", (_event, xqaapj: string, xqaa001: string, seq: string, data, modifier: string) =>
    requirementService.updateItem(xqaapj, xqaa001, seq, data, modifier));
  ipcMain.handle("requirement:delete", (_event, xqaapj: string, xqaa001: string) =>
    requirementService.deleteRequirement(xqaapj, xqaa001));

  // ── 附件 ──────────────────────────────────────────────

  ipcMain.handle("attachment:import", (_event, sourcePath: string, pj: string, req: string, userId: string) =>
    attachmentService.xqaa.import(sourcePath, pj, req, userId));
  ipcMain.handle("attachment:replace", (_event, sourcePath: string, pj: string, req: string, userId: string) =>
    attachmentService.xqaa.replace(sourcePath, pj, req, userId));
  ipcMain.handle("attachment:list", (_event, pj: string, req: string) =>
    attachmentService.xqaa.list(pj, req));
  ipcMain.handle("attachment:delete", (_event, hash: string) =>
    attachmentService.deleteFile(hash));

  ipcMain.handle("attachment:open", async (_event, relativePath: string) => {
    const absPath = attachmentService.getFileAbsolutePath(relativePath);
    const result = await shell.openPath(absPath);
    return result; // 空字符串表示成功
  });

  ipcMain.handle("attachment:save-as", async (_event, relativePath: string, defaultName: string) => {
    const absPath = attachmentService.getFileAbsolutePath(relativePath);
    if (!fs.existsSync(absPath)) return false;
    const result = await dialog.showSaveDialog(win, { defaultPath: defaultName });
    if (result.canceled || !result.filePath) return false;
    fs.copyFileSync(absPath, result.filePath);
    return true;
  });

  ipcMain.handle("attachment:get-data-url", (_event, relativePath: string) =>
    attachmentService.getDataUrl(relativePath));

  // ── AI ────────────────────────────────────────────────

  ipcMain.handle("ai:parse-docx", (_event, filePath: string) =>
    agentService.parseDocx(filePath));

  ipcMain.handle("ai:test-connection", () =>
    agentService.testConnection());

  ipcMain.handle("ai:config:get", () => agentService.getConfig());
  ipcMain.handle("ai:config:save", (_event, data: Record<string, string>) =>
    agentService.saveConfig(data));

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

  ipcMain.handle("ai:delete-session", (_event, sessionId: string) => {
    agentService.deleteSession(sessionId);
  });

  // ── 应用信息 ──────────────────────────────────────────

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    userData: app.getPath("userData"),
  }));
}
