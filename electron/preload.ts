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
    delete(hash: string) {
      return ipcRenderer.invoke("attachment:delete", hash);
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
    config: {
      get() {
        return ipcRenderer.invoke("ai:config:get");
      },
      save(data: Record<string, string>) {
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
});
