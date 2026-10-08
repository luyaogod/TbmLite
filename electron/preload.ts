import { ipcRenderer, contextBridge, webUtils } from "electron";

contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args;
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args;
    return ipcRenderer.off(channel, ...omit);
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  },
});

contextBridge.exposeInMainWorld("api", {
  /** 获取 File 对象的磁盘绝对路径（Electron webUtils） */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },

  project: {
    list(search?: string) {
      return ipcRenderer.invoke("project:list", search);
    },
    get(pjaa001: string) {
      return ipcRenderer.invoke("project:get", pjaa001);
    },
    create(row: unknown) {
      return ipcRenderer.invoke("project:create", row);
    },
    update(pjaa001: string, pjaa002: string, modifier: string) {
      return ipcRenderer.invoke("project:update", pjaa001, pjaa002, modifier);
    },
    delete(pjaa001: string) {
      return ipcRenderer.invoke("project:delete", pjaa001);
    },
  },

  requirement: {
    list(search?: string, xqaapj?: string) {
      return ipcRenderer.invoke("requirement:list", search, xqaapj);
    },
    get(xqaapj: string, xqaa001: string) {
      return ipcRenderer.invoke("requirement:get", xqaapj, xqaa001);
    },
    items(xqaapj: string, xqaa001: string) {
      return ipcRenderer.invoke("requirement:items", xqaapj, xqaa001);
    },
    create(master: unknown, items: unknown[], userId: string) {
      return ipcRenderer.invoke("requirement:create", master, items, userId);
    },
    update(xqaapj: string, xqaa001: string, data: unknown, modifier: string) {
      return ipcRenderer.invoke("requirement:update", xqaapj, xqaa001, data, modifier);
    },
    syncItems(xqaapj: string, xqaa001: string, rows: unknown[], userId: string) {
      return ipcRenderer.invoke("requirement:sync-items", xqaapj, xqaa001, rows, userId);
    },
    updateItem(xqaapj: string, xqaa001: string, seq: string, data: unknown, modifier: string) {
      return ipcRenderer.invoke("requirement:update-item", xqaapj, xqaa001, seq, data, modifier);
    },
    delete(xqaapj: string, xqaa001: string) {
      return ipcRenderer.invoke("requirement:delete", xqaapj, xqaa001);
    },
  },

  attachment: {
    import(sourcePath: string, pj: string, req: string, userId: string) {
      return ipcRenderer.invoke("attachment:import", sourcePath, pj, req, userId);
    },
    replace(sourcePath: string, pj: string, req: string, userId: string) {
      return ipcRenderer.invoke("attachment:replace", sourcePath, pj, req, userId);
    },
    list(pj: string, req: string) {
      return ipcRenderer.invoke("attachment:list", pj, req);
    },
    /** 按归属删除引用（同一物理文件仍被其他需求书引用时不会删文件） */
    delete(pj: string, req: string, hash: string) {
      return ipcRenderer.invoke("attachment:delete", pj, req, hash);
    },
    open(relativePath: string) {
      return ipcRenderer.invoke("attachment:open", relativePath);
    },
    saveAs(relativePath: string, defaultName: string) {
      return ipcRenderer.invoke("attachment:save-as", relativePath, defaultName);
    },
    getDataUrl(relativePath: string) {
      return ipcRenderer.invoke("attachment:get-data-url", relativePath);
    },
  },

  ai: {
    parseDocx(filePath: string) {
      return ipcRenderer.invoke("ai:parse-docx", filePath);
    },
    testConnection() {
      return ipcRenderer.invoke("ai:test-connection");
    },
    status() {
      return ipcRenderer.invoke("ai:status");
    },
    config: {
      get() {
        return ipcRenderer.invoke("ai:config:get");
      },
      save(data: { baseUrl: string; model: string; apiKey?: string | null }) {
        return ipcRenderer.invoke("ai:config:save", data);
      },
    },
    search(
      sessionId: string,
      prompt: string,
      projectCode: string | undefined,
      onChunk: (chunk: string) => void,
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        const chunkHandler = (_e: unknown, c: string) => onChunk(c);
        const doneHandler = () => { cleanup(); resolve(); };
        const errorHandler = (_e: unknown, msg: string) => { cleanup(); reject(new Error(msg)); };
        const cleanup = () => {
          ipcRenderer.off("ai:search-chunk", chunkHandler);
          ipcRenderer.off("ai:search-done", doneHandler);
          ipcRenderer.off("ai:search-error", errorHandler);
        };
        ipcRenderer.on("ai:search-chunk", chunkHandler);
        ipcRenderer.once("ai:search-done", doneHandler);
        ipcRenderer.once("ai:search-error", errorHandler);
        ipcRenderer.send("ai:search", sessionId, prompt, projectCode);
      });
    },
    deleteSession(sessionId: string) {
      return ipcRenderer.invoke("ai:delete-session", sessionId);
    },
  },

  app: {
    info() {
      return ipcRenderer.invoke("app:info");
    },
    openDataDir(sub?: "root" | "db" | "files" | "config" | "logs" | "backups" | "tmp") {
      return ipcRenderer.invoke("app:open-data-dir", sub);
    },
    openLog() {
      return ipcRenderer.invoke("app:open-log");
    },
    /** 订阅维护状态（恢复/重置期间 UI 应禁用写操作） */
    onMaintenance(listener: (state: { active: boolean; tag: string | null }) => void) {
      const handler = (_e: unknown, state: { active: boolean; tag: string | null }) => listener(state);
      ipcRenderer.on("maintenance:state", handler);
      return () => ipcRenderer.off("maintenance:state", handler);
    },
  },

  data: {
    health(check?: boolean) {
      return ipcRenderer.invoke("data:health", check);
    },
    checkIntegrity() {
      return ipcRenderer.invoke("data:check-integrity");
    },
    gcOrphanFiles(dryRun?: boolean) {
      return ipcRenderer.invoke("data:gc-orphan-files", dryRun);
    },
    reset(scope: "business" | "factory", confirm: string) {
      return ipcRenderer.invoke("data:reset", scope, confirm);
    },
  },

  backup: {
    list() {
      return ipcRenderer.invoke("backup:list");
    },
    create(label?: string) {
      return ipcRenderer.invoke("backup:create", label);
    },
    prune() {
      return ipcRenderer.invoke("backup:prune");
    },
    delete(id: string) {
      return ipcRenderer.invoke("backup:delete", id);
    },
    restore(id: string) {
      return ipcRenderer.invoke("backup:restore", id);
    },
    saveAs(id: string, defaultName?: string) {
      return ipcRenderer.invoke("backup:save-as", id, defaultName);
    },
  },
});
