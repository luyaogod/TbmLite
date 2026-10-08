import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { writeFileAtomic } from "../utils/fsx";
import logger from "../utils/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");

/** 钉钉「需求评估导入模板」——以官方模板为底稿，只替换数据行 */
const TEMPLATE_FILE = "需求评估导入模板.xlsx";
const SHEET_PATH = "xl/worksheets/sheet1.xml";
const SST_PATH = "xl/sharedStrings.xml";

export interface DingtalkExportItem {
  seq?: string | number;
  description?: string;
  jobCode?: string;
  jobName?: string;
  hours?: number | string;
}

export interface DingtalkExportResult {
  filePath: string;
  rowCount: number;
  sizeBytes: number;
}

/** 模板中示例行给出的默认值（除按需求映射的字段外，其余照抄示例） */
const SAMPLE_DEFAULTS = {
  customType: "2.修改标准", // H 客制类型(*)
  difficulty: "1:一级(入门)", // I 难度等级(*)
  devClass: "101:确认(通用)", // J 开发分类(*)
  integrateProduct: "", // K 集成产品编号
  urgent: "N", // L 急单
  remark: "", // M 备注
} as const;

export function templateFilePath(): string {
  const roots = [resourceRoot, process.resourcesPath, APP_ROOT].filter(
    (root): root is string => typeof root === "string" && root.length > 0,
  );
  for (const root of roots) {
    const candidate = path.join(root, "templates", TEMPLATE_FILE);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`未找到钉钉导入模板文件（templates/${TEMPLATE_FILE}）`);
}

let resourceRoot: string | null = null;

/** 由 main 注入打包后的 resources 目录（开发态回退到仓库根目录） */
export function setResourceRoot(root: string): void {
  resourceRoot = root;
}

// ── XML 工具 ────────────────────────────────────────────

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>]/g, (char) => XML_ESCAPES[char]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function clip(value: string, limit = 32000): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

/** 解析 sharedStrings.xml：文本 → 索引 */
function parseSharedStrings(xml: string): Map<string, number> {
  const map = new Map<string, number>();
  const items = xml.match(/<si>[\s\S]*?<\/si>/g) ?? [];
  items.forEach((item, index) => {
    const text = [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((m) => m[1])
      .join("")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
    if (!map.has(text)) map.set(text, index);
  });
  return map;
}

interface SharedStringsEditor {
  indexOf(text: string): number;
  appendTo(xml: string, addedReferences: number): { xml: string; added: number };
}

function createSharedStringsEditor(xml: string): SharedStringsEditor {
  const map = parseSharedStrings(xml);
  let uniqueCount = (xml.match(/<si>/g) ?? []).length;
  const appended: string[] = [];

  return {
    indexOf(text: string): number {
      const existing = map.get(text);
      if (existing !== undefined) return existing;
      const index = uniqueCount++;
      map.set(text, index);
      appended.push(`<si><t xml:space="preserve">${escapeXml(clip(text))}</t></si>`);
      return index;
    },
    appendTo(source: string, addedReferences: number): { xml: string; added: number } {
      if (appended.length === 0) {
        return { xml: source.replace(/(<sst[^>]*\bcount=")(\d+)(")/, (_m, a, count, c) => `${a}${Number(count) + addedReferences}${c}`), added: 0 };
      }
      const next = source.replace(/<\/sst>$/, `${appended.join("")}</sst>`);
      const withCounts = next.replace(/(<sst[^>]*\bcount=")(\d+)("[^>]*\buniqueCount=")(\d+)(")/, (_m, p1, count, p2, unique, p3) => {
        void unique;
        return `${p1}${Number(count) + addedReferences}${p2}${uniqueCount}${p3}`;
      });
      return { xml: withCounts, added: appended.length };
    },
  };
}

// ── 行数据 ──────────────────────────────────────────────

interface RowValues {
  seq: string;
  programCode: string;
  programName: string;
  billableHours: number;
  devHours: number;
  systemCode: string;
  spec: string;
  customType: string;
  difficulty: string;
  devClass: string;
  integrateProduct: string;
  urgent: string;
  remark: string;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 映射规则：程序代号=作业编号；程序名称缺省取程序代号；系统代号=作业编号前三位大写；
 *  规格说明=需求描述；计费时数/软代派工时数=工时（缺省 0）；其余字段取模板示例默认值 */
export function mapItemToRow(item: DingtalkExportItem, index: number): RowValues {
  const programCode = (item.jobCode ?? "").trim();
  const programName = (item.jobName ?? "").trim() || programCode;
  const hours = toNumber(item.hours);
  return {
    seq: String(index + 1),
    programCode,
    programName,
    billableHours: hours,
    devHours: hours,
    systemCode: programCode.slice(0, 3).toUpperCase(),
    spec: (item.description ?? "").trim(),
    ...SAMPLE_DEFAULTS,
  };
}

/** 生成数据行 XML（样式索引与模板一致：文本 s=2，数字 s=3） */
function buildRowsXml(rows: RowValues[], sst: SharedStringsEditor): { xml: string; stringRefs: number } {
  let stringRefs = 0;
  const text = (ref: string, value: string): string => {
    stringRefs++;
    return `<c r="${ref}" s="2" t="s"><v>${sst.indexOf(value)}</v></c>`;
  };
  const number = (ref: string, value: number): string => `<c r="${ref}" s="3"><v>${value}</v></c>`;

  const body = rows
    .map((row, index) => {
      const r = index + 2; // 第 1 行为表头
      const cells = [
        text(`A${r}`, row.seq),
        text(`B${r}`, row.programCode),
        text(`C${r}`, row.programName),
        number(`D${r}`, row.billableHours),
        number(`E${r}`, row.devHours),
        text(`F${r}`, row.systemCode),
        text(`G${r}`, row.spec),
        text(`H${r}`, row.customType),
        text(`I${r}`, row.difficulty),
        text(`J${r}`, row.devClass),
        text(`K${r}`, row.integrateProduct),
        text(`L${r}`, row.urgent),
        text(`M${r}`, row.remark),
      ].join("");
      return `<row r="${r}" ht="19" customHeight="1" spans="1:13">${cells}</row>`;
    })
    .join("");

  return { xml: body, stringRefs };
}

/** 用数据行替换模板行（保留表头行、列宽、数据校验与隐藏选项表） */
function patchSheet(xml: string, rowsXml: string, rowCount: number): string {
  // 表头行必须原样保留，仅替换从第 2 行（模板示例行）开始的内容
  const headerRow = /<row r="1"[\s\S]*?<\/row>/.exec(xml)?.[0];
  if (!headerRow) throw new Error("钉钉导入模板结构异常：未找到表头行");

  const sheetData = `<sheetData>${headerRow}${rowsXml}</sheetData>`;
  const dimension = `<dimension ref="A1:M${Math.max(rowCount + 1, 2)}"/>`;
  return xml
    .replace(/<dimension ref="[^"]*"\/>/, dimension)
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, sheetData)
    // 模板示例行选中 G2，替换数据后无意义，回到 A2
    .replace(/<selection activeCell="[^"]*" sqref="[^"]*"\/>/, '<selection activeCell="A2" sqref="A2"/>');
}

/** 仅保留表头 + 模板示例行（无数据时的导出结果） */
export async function buildDingtalkWorkbook(items: DingtalkExportItem[]): Promise<Buffer> {
  const templatePath = templateFilePath();
  const template = fs.readFileSync(templatePath);
  const zip = await JSZip.loadAsync(template);

  const sheetFile = zip.file(SHEET_PATH);
  const sstFile = zip.file(SST_PATH);
  if (!sheetFile || !sstFile) {
    throw new Error("钉钉导入模板结构异常：缺少 sheet1.xml 或 sharedStrings.xml");
  }

  const sheetXml = await sheetFile.async("string");
  const sstXml = await sstFile.async("string");

  if (items.length === 0) {
    // 无数据时保留模板原样（表头 + 示例行）
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }

  const editor = createSharedStringsEditor(sstXml);
  const rows = items.map((item, index) => mapItemToRow(item, index));
  const { xml: rowsXml, stringRefs } = buildRowsXml(rows, editor);
  const oldSampleRefs = 11; // 模板示例行中的字符串单元格数量，被替换掉
  const { xml: nextSst } = editor.appendTo(sstXml, stringRefs - oldSampleRefs);

  const nextSheet = patchSheet(sheetXml, rowsXml, rows.length);
  zip.file(SHEET_PATH, nextSheet);
  zip.file(SST_PATH, nextSst);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function writeDingtalkTemplate(
  items: DingtalkExportItem[],
  targetPath: string,
): Promise<DingtalkExportResult> {
  const buffer = await buildDingtalkWorkbook(items);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileAtomic(targetPath, buffer);
  logger.info({ targetPath, rowCount: items.length, sizeBytes: buffer.length }, "导出钉钉模板");
  return { filePath: targetPath, rowCount: items.length, sizeBytes: buffer.length };
}

/** 默认文件名：优先 需求书编号，其次项目编号 */
export function defaultFileName(opts: { requirement?: string; project?: string }): string {
  const parts = [opts.project, opts.requirement].filter((part): part is string => Boolean(part && part.trim()));
  const base = parts.length > 0 ? parts.join("-") : `需求评估导入-${new Date().toISOString().slice(0, 10)}`;
  return `${base}-钉钉导入模板.xlsx`;
}
