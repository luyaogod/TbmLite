/// <reference types="vite/client" />

interface Window {
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
      delete(hash: string): Promise<DeleteResult>;
      open(relativePath: string): Promise<string>;
      saveAs(relativePath: string, defaultName: string): Promise<boolean>;
      getDataUrl(relativePath: string): Promise<string | null>;
    };
    ai: {
      parseDocx(filePath: string): Promise<ParseDocxResult>;
      testConnection(): Promise<{ ok: boolean; message: string }>;
      config: {
        get(): Promise<Record<string, string> | null>;
        save(data: Record<string, string>): Promise<void>;
      };
      search(sessionId: string, prompt: string, projectCode: string | undefined, onChunk: (chunk: string) => void): Promise<void>;
      deleteSession(sessionId: string): Promise<void>;
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
