import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { registerHandlers } from "./ipc";
import { bootstrapDb, closeDb, getSchemaVersion } from "./db/index";
import { applyMigrations } from "./db/migrations";
import { inspect as inspectDataGuard, type GuardResult } from "./core/data-guard";
import { ensureMeta, markBoot, markCleanExit, readMeta, updateMeta } from "./core/meta";
import { maintenance } from "./core/maintenance";
import { runHousekeeping } from "./core/housekeeping";
import { scanIssues } from "./core/integrity";
import { backupService, applyPendingRestore, createBackupNow } from "./services/backup-service";
import { getHealth } from "./services/data-service";
import { detectLegacySources, importLegacyData, previewLegacyImport } from "./services/legacy-import";
import {
  buildDingtalkWorkbook,
  defaultFileName as dingtalkFileName,
  setResourceRoot,
  templateFilePath,
} from "./services/dingtalk-export";
import { requirementService } from "./services/requirement-service";
import { pathManager } from "./utils/paths";
import { TITLEBAR_HEIGHT } from "./core/window-chrome";
import { writeFileAtomic, writeJsonAtomic } from "./utils/fsx";
import logger from "./utils/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null = null;
let quitting = false;

/** 无边框窗口（Windows）：去掉系统标题栏的图标与文字，仅保留窗口按钮
 *  顶部 TITLEBAR_HEIGHT 由渲染层留出可拖拽标题带 */
const FRAMELESS = process.platform === "win32";
if (FRAMELESS) process.env.TBM_FRAMELESS = "1";

/** 自检模式：只跑数据层（路径/门禁/迁移/备份/健康），不建窗口 */
const isSmokeTest = process.argv.includes("--tbm-smoke");
/** 自检扩展：额外做一次备份→恢复往返（会暂存恢复，下次启动生效） */
const isRestoreSmoke = process.argv.includes("--tbm-smoke-restore");
/** 自检扩展：额外跑一次旧数据导入（目录取 TBM_LEGACY_DIR 或自动探测） */
const isLegacySmoke = process.argv.includes("--tbm-smoke-legacy");
/** 自检扩展：额外导出一次钉钉模板（验证模板解析 + jszip 打包可用） */
const isExportSmoke = process.argv.includes("--tbm-smoke-export");

// ── 窗口 ────────────────────────────────────────────────

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    icon: path.join(process.env.VITE_PUBLIC ?? "", "logo.png"),
    ...(FRAMELESS
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: "#ffffff",
            symbolColor: "#1f2937",
            height: TITLEBAR_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });
  win.maximize();

  win.on("closed", () => {
    win = null;
  });

  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

// ── 数据准备（门禁 + 迁移） ─────────────────────────────

async function migrateWithBackup(): Promise<void> {
  const report = await applyMigrations({
    async beforeMigrate(from, to) {
      const entry = await createBackupNow("pre-migrate", `${from}-${to}`);
      return entry.filePath;
    },
  });
  if (report.applied.length > 0) {
    updateMeta({
      schemaVersion: report.to,
      lastMigration: {
        from: report.from,
        to: report.to,
        at: new Date().toISOString(),
        backup: report.backupPath,
      },
    });
    logger.info({ from: report.from, to: report.to, steps: report.applied }, "数据迁移完成");
  } else if (readMeta()?.schemaVersion !== report.to) {
    updateMeta({ schemaVersion: report.to });
  }
}

/** 版本门禁 / 损坏自愈交互；返回 false 表示应终止启动 */
async function resolveGuard(guard: GuardResult): Promise<boolean> {
  if (guard.status === "ok" || guard.status === "dirty-exit") return true;

  // 自检/无界面模式不做交互，直接判定不可启动
  if (isSmokeTest) {
    logger.error({ status: guard.status, detail: guard.detail }, "自检模式下数据门禁未通过");
    return false;
  }

  const incompatible = guard.status === "higher-schema" || guard.status === "older-app";
  const latest = backupService.latest();
  const buttons = ["退出", "从备份恢复", "打开数据目录"];
  const choice = dialog.showMessageBoxSync({
    type: "error",
    title: incompatible ? "数据版本不兼容" : "数据库损坏",
    message: incompatible ? "无法使用当前数据目录" : "数据库文件已损坏",
    detail: `${guard.detail}\n\n数据目录：${pathManager.getRoot()}${
      latest ? `\n最近备份：${latest.fileName}（${latest.createdAt}）` : "\n（尚无可用备份）"
    }`,
    buttons,
    defaultId: latest ? 1 : 2,
    cancelId: 0,
    noLink: true,
  });

  if (choice === 2) {
    await shell.openPath(pathManager.getRoot());
    return false;
  }
  if (choice === 1) {
    if (!latest) {
      dialog.showErrorBox("无法恢复", "还没有可用的备份文件，请手动处理数据目录后重试。");
      return false;
    }
    try {
      await backupService.stageRestore(latest.id);
      logger.audit({ action: "restore-on-guard", target: latest.fileName, result: "ok" });
      app.relaunch();
      app.exit(0);
      return false;
    } catch (err) {
      dialog.showErrorBox("恢复失败", err instanceof Error ? err.message : String(err));
      return false;
    }
  }
  return false;
}

async function prepareData(): Promise<boolean> {
  // 换库必须在任何数据库连接建立之前完成（Windows 下 libsql 不释放文件句柄）
  const restoreResult = applyPendingRestore();
  if (restoreResult.applied) {
    logger.info({ source: restoreResult.source }, "已完成备份恢复（启动阶段换库）");
  } else if (restoreResult.reason) {
    logger.warn({ reason: restoreResult.reason }, "备份恢复未应用");
  }

  // 先做门禁（含可读性探测），再设置 PRAGMA 基线：
  // 损坏的库必须能被识别为 corrupt，而不是卡在 PRAGMA 报错上
  const { created } = ensureMeta();

  let ready = false;
  for (let attempt = 0; attempt < 3 && !ready; attempt += 1) {
    const guard = await inspectDataGuard({ freshInstall: created });
    if (guard.status === "ok" || guard.status === "dirty-exit") {
      ready = true;
      break;
    }
    ready = await resolveGuard(guard);
    // 恢复成功则进入下一轮重新校验
  }
  if (!ready) return false;

  await bootstrapDb();
  await migrateWithBackup();
  await markBoot(await getSchemaVersion());
  await runHousekeeping();
  await backupService.onAppStart();
  return true;
}

// ── 启动 ────────────────────────────────────────────────

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    task,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function runSmokeTest(): Promise<void> {
  try {
    const prepared = await prepareData();
    let restoreRoundTrip: unknown = null;
    if (prepared && isRestoreSmoke) {
      // 恢复往返测试：阶段一（暂存）→ 阶段二在下次启动验证
      const backups = backupService.list();
      const target = backups.find((entry) => entry.kind === "auto") ?? backups[0];
      if (target) {
        const staged = await backupService.stageRestore(target.id);
        restoreRoundTrip = {
          target: target.fileName,
          schemaVersion: staged.schemaVersion,
          preBackup: staged.preBackup?.fileName ?? null,
          pendingMarker: backupService.pendingRestore(),
        };
      }
    }
    const health = await getHealth({ check: true });
    const issues = await scanIssues();

    let legacy: unknown = null;
    if (prepared && isLegacySmoke) {
      const explicit = process.env.TBM_LEGACY_DIR?.trim();
      const target = explicit || detectLegacySources().find((item) => item.readable)?.dir;
      if (target) {
        const preview = await previewLegacyImport(target);
        const imported = await importLegacyData(target);
        legacy = { target, preview, imported };
      }
    }

    let dingtalk: unknown = null;
    if (prepared && isExportSmoke) {
      const requirements = await requirementService.listRequirements();
      // 取明细最多的一份需求书，覆盖面最大
      let bestRequirement = requirements[0];
      let targetItems: Awaited<ReturnType<typeof requirementService.listItems>> = [];
      for (const requirement of requirements) {
        const rows = await requirementService.listItems(requirement.xqaapj, requirement.xqaa001);
        if (rows.length > targetItems.length) {
          bestRequirement = requirement;
          targetItems = rows;
        }
      }
      const first = bestRequirement;
      const items = targetItems;
      const buffer = await buildDingtalkWorkbook(
        items.map((item) => ({
          seq: item.xqabseq,
          description: item.xqab002,
          jobCode: item.xqab003,
          jobName: item.xqab007,
          hours: item.xqab004,
        })),
      );
      const target = path.join(pathManager.getTmpPath(), "dingtalk-smoke.xlsx");
      writeFileAtomic(target, buffer);
      dingtalk = {
        template: templateFilePath(),
        defaultFileName: first ? dingtalkFileName({ project: first.xqaapj, requirement: first.xqaa001 }) : null,
        sourceRequirement: first ? `${first.xqaapj}|${first.xqaa001}` : null,
        rowCount: items.length,
        sizeBytes: buffer.length,
        output: target,
      };
    }

    const report = {
      prepared,
      dataRoot: pathManager.getRoot(),
      dataRootNotes: pathManager.notes(),
      schemaVersion: await getSchemaVersion(),
      health,
      issues,
      restoreRoundTrip,
      legacy,
      dingtalk,
    };
    process.stdout.write(`SMOKE_REPORT ${JSON.stringify(report, null, 2)}\n`);
    // Windows GUI 子系统进程的 stdout 不接到控制台，因此同时落盘一份，便于打包后验证
    try {
      writeJsonAtomic(path.join(pathManager.getLogsPath(), "smoke-report.json"), report);
    } catch {
      // 忽略：仅诊断用途
    }
    await closeDb();
    app.exit(prepared ? 0 : 1);
  } catch (err) {
    process.stderr.write(`SMOKE_FAIL ${err instanceof Error ? err.stack : String(err)}\n`);
    app.exit(1);
  }
}

function onBeforeQuit(event: Electron.Event): void {
  if (quitting || isSmokeTest) return;
  quitting = true;
  event.preventDefault();
  void (async () => {
    try {
      await withTimeout(backupService.onAppQuit(), 5000);
    } catch (err) {
      logger.warn({ error: String(err) }, "退出备份失败");
    }
    try {
      await closeDb();
    } catch {
      // ignore
    }
    markCleanExit();
    logger.info("TBM Lite 已退出");
    app.exit(0);
  })();
}

function startApp(): void {
  // 数据根目录必须在 ready 之前确定（便携模式需要 setPath("userData")）
  pathManager.init();
  setResourceRoot(process.resourcesPath ?? process.env.APP_ROOT ?? "");
  for (const note of pathManager.notes()) logger.warn({ note }, "数据目录调整");

  app.on("second-instance", () => {
    if (!win) {
      createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("before-quit", onBeforeQuit);

  maintenance.onStateChange((state) => broadcast("maintenance:state", state));

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    if (isSmokeTest) {
      await runSmokeTest();
      return;
    }

    try {
      const prepared = await prepareData();
      if (!prepared) {
        logger.error("数据准备未通过，终止启动");
        app.exit(1);
        return;
      }
      logger.info(
        { version: app.getVersion(), dataRoot: pathManager.getRoot() },
        "TBM Lite 启动",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, "数据库初始化失败");
      dialog.showErrorBox(
        "数据初始化失败",
        `${message}\n\n数据目录：${pathManager.getRoot()}\n可尝试从备份恢复，或将数据目录改名后重新启动。`,
      );
      app.exit(1);
      return;
    }

    registerHandlers(() => win);
    createWindow();
  });
}

// 单实例：避免两个进程同时写同一个 SQLite 文件
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  startApp();
}
