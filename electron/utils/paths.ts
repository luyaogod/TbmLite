import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class PathManager {
  private isDev: boolean;

  constructor() {
    this.isDev = !app.isPackaged;
  }

  getAppDataRoot(): string {
    if (this.isDev) {
      return path.join(__dirname, "..", "electron", "app-data", "dev");
    }
    const userData = app.getPath("userData");
    const publishDir = path.join(userData, "publish");
    if (!fs.existsSync(publishDir)) {
      this.copyFromResources(publishDir);
    }
    return publishDir;
  }

  private copyFromResources(target: string) {
    const source = path.join(process.resourcesPath, "publish");
    if (fs.existsSync(source)) {
      fs.cpSync(source, target, { recursive: true });
    } else {
      fs.mkdirSync(target, { recursive: true });
      fs.mkdirSync(path.join(target, "db"), { recursive: true });
    }
  }

  getDbPath(): string {
    return path.join(this.getAppDataRoot(), "db");
  }

  getSqliteDBPath(): string {
    return path.join(this.getDbPath(), "app.db");
  }

  getLogsPath(): string {
    return path.join(this.getAppDataRoot(), "logs");
  }

  getConfigPath(): string {
    return path.join(this.getAppDataRoot(), "config");
  }

  getFilesRoot(): string {
    return path.join(this.getAppDataRoot(), "files");
  }
}

export const pathManager = new PathManager();

export const getAppDataRoot = () => pathManager.getAppDataRoot();
export const getSqliteDBPath = () => pathManager.getSqliteDBPath();
export const getLogsPath = () => pathManager.getLogsPath();
export const getConfigPath = () => pathManager.getConfigPath();
export const getFilesRoot = () => pathManager.getFilesRoot();
