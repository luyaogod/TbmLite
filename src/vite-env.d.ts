/// <reference types="vite/client" />

// 预加载层暴露的接口类型（与 electron/preload.ts 保持一致）
type DataSubDirName = "root" | "db" | "files" | "config" | "logs" | "backups" | "tmp";
type BackupKindName =
  | "auto"
  | "manual"
  | "pre-migrate"
  | "pre-restore"
  | "pre-import"
  | "pre-reset"
  | "pre-update";

interface IdleState {
  active: boolean;
  tag: string | null;
}

interface AiConfigView {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  keyState: "ok" | "missing" | "undecryptable" | "plaintext";
  keyEncrypted: boolean;
}

interface AppInfoView {
  version: string;
  schemaVersion: number;
  currentSchemaVersion: number;
  dataRoot: string;
  userData: string;
  packaged: boolean;
  maintenance: boolean;
  firstRunCompleted: boolean;
}

interface LegacyCandidateView {
  dir: string;
  dbFile: string;
  hasFiles: boolean;
  readable: boolean;
  sizeBytes: number;
}

interface LegacyTablePreviewView {
  table: string;
  source: number;
  insertable: number;
  duplicate: number;
  missingColumns: string[];
}

interface LegacyPreviewView {
  sourceDir: string;
  tables: LegacyTablePreviewView[];
  attachments: { records: number; insertable: number; missingFiles: number; missingSamples: string[] };
  warnings: string[];
}

interface LegacyImportReportView {
  ok: boolean;
  sourceDir: string;
  tables: Array<{ table: string; source: number; inserted: number; duplicate: number; orphan: number }>;
  files: { copied: number; existing: number; missing: number; missingSamples: string[] };
  warnings: string[];
  preBackup: string | null;
  durationMs: number;
  rolledBack: boolean;
  error?: string;
}

interface BackupEntryView {
  id: string;
  fileName: string;
  filePath: string;
  kind: BackupKindName;
  sizeBytes: number;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
}

interface DatabaseCheckView {
  ok: boolean;
  messages: string[];
  mode: "quick" | "full";
  durationMs: number;
}

interface IntegrityIssueView {
  kind: string;
  count: number;
  samples: string[];
  hint: string;
}

interface DataHealthView {
  appVersion: string;
  schemaVersion: number;
  currentSchemaVersion: number;
  minReaderVersion: string | null;
  installId: string | null;
  dataRoot: string;
  firstRunCompleted: boolean;
  lastBackupAt: string | null;
  lastRestoreAt: string | null;
  lastMigration: { from: number; to: number; at: string; backup: string | null } | null;
  sizes: { db: number; files: number; logs: number; backups: number; total: number };
  counts: { projects: number; requirements: number; items: number; attachments: number; sessions: number };
  backups: { count: number; latestAt: string | null; latestFile: string | null };
  integrity: DatabaseCheckView | null;
}

interface Window {
  ipcRenderer: {
    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): () => void;
    off(channel: string, listener: (...args: unknown[]) => void): void;
    send(channel: string, ...args: unknown[]): void;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  };
  api: {
    getPathForFile(file: File): string;
    project: {
      list(search?: string): Promise<ProjectRow[]>;
      get(pjaa001: string): Promise<ProjectRow | null>;
      create(row: ProjectRow): Promise<void>;
      update(pjaa001: string, pjaa002: string, modifier: string): Promise<void>;
      delete(pjaa001: string): Promise<DeleteResult>;
    };
    requirement: {
      list(search?: string, xqaapj?: string): Promise<RequirementRow[]>;
      get(xqaapj: string, xqaa001: string): Promise<RequirementRow | null>;
      items(xqaapj: string, xqaa001: string): Promise<RequirementItemRow[]>;
      create(master: RequirementMasterInput, items: RequirementItemInput[], userId: string): Promise<void>;
      update(xqaapj: string, xqaa001: string, data: Pick<RequirementRow, "xqaa002" | "xqaa003" | "xqaa004" | "xqaa005">, modifier: string): Promise<void>;
      syncItems(xqaapj: string, xqaa001: string, rows: RequirementItemInput[], userId: string): Promise<void>;
      updateItem(xqaapj: string, xqaa001: string, seq: string, data: Partial<Pick<RequirementItemRow, "xqab002" | "xqab003" | "xqab004" | "xqab005" | "xqab006">>, modifier: string): Promise<void>;
      delete(xqaapj: string, xqaa001: string): Promise<DeleteResult>;
    };
    attachment: {
      import(sourcePath: string, pj: string, req: string, userId: string): Promise<AttachmentRow>;
      replace(sourcePath: string, pj: string, req: string, userId: string): Promise<AttachmentRow>;
      list(pj: string, req: string): Promise<AttachmentRow[]>;
      delete(pj: string, req: string, hash: string): Promise<DeleteResult>;
      open(relativePath: string): Promise<string>;
      saveAs(relativePath: string, defaultName: string): Promise<boolean>;
      getDataUrl(relativePath: string): Promise<string | null>;
    };
    ai: {
      parseDocx(filePath: string): Promise<ParseDocxResult>;
      testConnection(): Promise<{ ok: boolean; message: string }>;
      status(): Promise<{ configured: boolean }>;
      config: {
        get(): Promise<AiConfigView>;
        save(data: { baseUrl: string; model: string; apiKey?: string | null }): Promise<void>;
      };
      search(sessionId: string, prompt: string, projectCode: string | undefined, onChunk: (chunk: string) => void): Promise<void>;
      deleteSession(sessionId: string): Promise<void>;
    };
    app: {
      info(): Promise<AppInfoView>;
      openDataDir(sub?: DataSubDirName): Promise<string>;
      openLog(): Promise<string>;
      pickDirectory(title?: string): Promise<string | null>;
      onMaintenance(listener: (state: IdleState) => void): () => void;
    };
    legacy: {
      detect(): Promise<LegacyCandidateView[]>;
      preview(dir: string): Promise<LegacyPreviewView>;
      import(dir: string): Promise<LegacyImportReportView>;
    };
    export: {
      dingtalkTemplate(
        items: Array<{ seq?: string; description?: string; jobCode?: string; jobName?: string; hours?: number | string }>,
        options?: { fileName?: string; project?: string; requirement?: string; silentTarget?: string },
      ): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; rowCount?: number; sizeBytes?: number }>;
    };
    data: {
      health(check?: boolean): Promise<DataHealthView>;
      checkIntegrity(): Promise<{ check: DatabaseCheckView; issues: IntegrityIssueView[] }>;
      gcOrphanFiles(dryRun?: boolean): Promise<{ count: number; bytes: number; samples: string[] }>;
      reset(scope: "business" | "factory", confirm: string): Promise<{ backupId: string }>;
    };
    backup: {
      list(): Promise<BackupEntryView[]>;
      create(label?: string): Promise<BackupEntryView>;
      prune(): Promise<{ removed: number }>;
      delete(id: string): Promise<{ ok: boolean }>;
      restore(id: string): Promise<{ ok: boolean; preBackup: string | null; schemaVersion: number; restarting: boolean }>;
      saveAs(id: string, defaultName?: string): Promise<{ ok: boolean; path?: string }>;
    };
  };
}

interface ProjectRow {
  pjaa001: string;
  pjaa002: string;
  pjaacrtdt: string;
  pjaacrtid: string;
  pjaamoddt: string;
  pjaamodit: string;
}

interface RequirementRow {
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

interface RequirementMasterInput {
  xqaapj: string;
  xqaa001: string;
  xqaa002: string;
  xqaa003: string;
  xqaa004: string;
  xqaa005?: string;
}

interface RequirementItemInput {
  seq: string;
  description: string;
  jobCode: string;
  jobName: string;
  hours: number;
  status: string;
  developer: string;
}

interface RequirementItemRow {
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

interface AttachmentRow {
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

interface DeleteResult {
  ok: boolean;
  reason?: string;
}

interface RequirementItem {
  seq: string;
  jobCode: string;
  modification: string;
  summary: string;
  hours: string;
}

interface RequirementExtraction {
  requirementNumber: string;
  items: RequirementItem[];
}

interface ParseDocxResult extends RequirementExtraction {
  title: string;
}
