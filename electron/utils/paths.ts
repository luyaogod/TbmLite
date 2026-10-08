import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isInside, resolveExistingWithin, resolveWithin } from "./safe-path";

export { isInside, resolveExistingWithin, resolveWithin };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** dist-electron/ → 项目根 */
const APP_ROOT = path.resolve(__dirname, "..");

/** 用户数据目录内的固定子目录 */
const SUB_DIRS = [
  "db",
  "files",
  path.join("files", ".trash"),
  "config",
  path.join("config", "chat-sessions"),
  "logs",
  "backups",
  path.join("backups", "auto"),
  path.join("backups", "manual"),
  "tmp",
];

/** 旧版本曾把用户数据放在 <root>/publish 下，需要一次性收编 */
const LEGACY_SUB_DIRS = ["db", "files", "config", "logs"];

export type DataSubDir = "root" | "db" | "files" | "config" | "logs" | "backups" | "tmp";

// ── 通用文件工具 ────────────────────────────────────────

function mkdirp(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isDir(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** 删除目录/文件（尽力而为，失败不阻断） */
function rmSync(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // 忽略：若无法删除，内容已经在目标位置，不影响数据完整性
  }
}

/** 把 from 中「to 里不存在」的内容搬过去；已存在的保留目标版本（用户数据优先） */
function mergeMove(from: string, to: string, moved: string[], kept: string[]): void {
  if (!fs.existsSync(from)) return;
  mkdirp(to);
  for (const entry of fs.readdirSync(from)) {
    const src = path.join(from, entry);
    const dst = path.join(to, entry);
    const srcIsDir = isDir(src);
    if (!fs.existsSync(dst)) {
      try {
        fs.renameSync(src, dst);
      } catch {
        fs.cpSync(src, dst, { recursive: true });
        rmSync(src);
      }
      moved.push(dst);
    } else if (srcIsDir && isDir(dst)) {
      mergeMove(src, dst, moved, kept);
      rmSync(src);
    } else {
      kept.push(dst);
    }
  }
}

/** 仅复制目标不存在的文件（安装种子 / 默认值），绝不覆盖用户改动 */
function copyMissing(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  if (isDir(source)) {
    mkdirp(target);
    for (const entry of fs.readdirSync(source)) {
      copyMissing(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  if (fs.existsSync(target)) return;
  mkdirp(path.dirname(target));
  fs.copyFileSync(source, target);
}

// ── 路径管理 ────────────────────────────────────────────

class PathManager {
  private root = "";
  private initialized = false;
  private adoptionNotes: string[] = [];

  get isDev(): boolean {
    return !app.isPackaged;
  }

  /**
   * 解析数据根目录并建立目录结构。
   * 必须在 `app.whenReady()` 之前调用（便携模式需要 setPath("userData")）。
   * 优先级：开发态固定目录 > TBM_DATA_DIR > exe 同级 portable 标记 > userData
   */
  init(): void {
    if (this.initialized) return;

    const devRoot = path.join(APP_ROOT, "electron", "app-data", "dev");
    const envRoot = process.env.TBM_DATA_DIR?.trim();

    if (this.isDev) {
      // 开发态默认使用仓库内目录；TBM_DATA_DIR 可指向别处（自检 / 多数据集并行开发）
      this.root = envRoot ? path.resolve(envRoot) : devRoot;
    } else if (envRoot) {
      this.root = path.resolve(envRoot);
      app.setPath("userData", this.root);
    } else {
      const exeDir = path.dirname(app.getPath("exe"));
      if (fs.existsSync(path.join(exeDir, "portable"))) {
        this.root = path.join(exeDir, "data");
        app.setPath("userData", this.root);
      } else {
        this.root = app.getPath("userData");
      }
    }
    this.root = path.resolve(this.root);

    this.adoptLegacyLayout();
    this.ensureLayout();
    // 种子文件只对安装版有意义（开发态数据目录就在仓库内，无需回写）
    if (!this.isDev) this.applySeed();
    this.initialized = true;
  }

  /** 0.1.x 的用户数据位于 <root>/publish，一次性收编到 <root> 下 */
  private adoptLegacyLayout(): void {
    const legacy = path.join(this.root, "publish");
    if (!isDir(legacy)) return;

    const moved: string[] = [];
    const kept: string[] = [];
    for (const sub of LEGACY_SUB_DIRS) {
      const from = path.join(legacy, sub);
      if (!fs.existsSync(from)) continue;
      const to = path.join(this.root, sub);
      if (!fs.existsSync(to)) {
        // 快路径：直接整体移动
        try {
          fs.renameSync(from, to);
          moved.push(to);
          continue;
        } catch {
          // 跨分区等情况降级为合并
        }
      }
      mergeMove(from, to, moved, kept);
    }

    // 内容已全部搬走则直接删除旧目录，否则改名保留（不静默丢数据）
    try {
      if (kept.length === 0) {
        fs.rmSync(legacy, { recursive: true, force: true });
      } else {
        fs.renameSync(legacy, `${legacy}.legacy-${Date.now()}`);
      }
    } catch (err) {
      this.adoptionNotes.push(`旧 publish 目录清理失败：${String(err)}`);
    }
    this.adoptionNotes.push(
      `已收编旧版 publish 数据目录（移动/复制 ${moved.length} 项${
        kept.length ? `，保留 ${kept.length} 项目标已存在的数据` : ""
      }）`,
    );
  }

  private ensureLayout(): void {
    mkdirp(this.root);
    for (const sub of SUB_DIRS) mkdirp(path.join(this.root, sub));
  }

  /** 安装资源中的模板目录：仅补齐缺失文件 */
  private applySeed(): void {
    const source = this.isDev
      ? path.join(APP_ROOT, "electron", "app-data", "publish")
      : path.join(process.resourcesPath ?? "", "publish");
    try {
      copyMissing(source, this.root);
    } catch (err) {
      this.adoptionNotes.push(`种子文件落地失败：${String(err)}`);
    }
  }

  /** 初始化过程中值得写进日志的说明（旧布局收编、种子失败等） */
  notes(): string[] {
    return [...this.adoptionNotes];
  }

  getRoot(): string {
    return this.root;
  }

  /** 指定子目录（用于「打开数据目录」） */
  getSubDir(sub: DataSubDir): string {
    if (sub === "root") return this.root;
    return path.join(this.root, sub);
  }

  getDbPath(): string {
    return path.join(this.root, "db");
  }

  getSqliteFile(): string {
    return path.join(this.root, "db", "app.db");
  }

  /** libsql 只接受 file:/http:/ws: 形式，使用 pathToFileURL 生成规范 URL */
  getSqliteUrl(): string {
    return pathToFileURL(this.getSqliteFile()).href;
  }

  getFilesRoot(): string {
    return path.join(this.root, "files");
  }

  getTrashRoot(): string {
    return path.join(this.root, "files", ".trash");
  }

  getConfigPath(): string {
    return path.join(this.root, "config");
  }

  getSessionsPath(): string {
    return path.join(this.root, "config", "chat-sessions");
  }

  getLogsPath(): string {
    return path.join(this.root, "logs");
  }

  getBackupsPath(): string {
    return path.join(this.root, "backups");
  }

  getAutoBackupsPath(): string {
    return path.join(this.root, "backups", "auto");
  }

  getManualBackupsPath(): string {
    return path.join(this.root, "backups", "manual");
  }

  getTmpPath(): string {
    return path.join(this.root, "tmp");
  }

  getMetaFile(): string {
    return path.join(this.root, ".meta.json");
  }
}

export const pathManager = new PathManager();
