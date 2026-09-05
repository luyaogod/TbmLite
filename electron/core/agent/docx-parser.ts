import OpenAI from "openai";
import { parseOffice } from "@jose.espana/docstream";
import logger from "../../utils/logger";
import { loadConfig } from "./config";

// ── 结构化输出定义 ────────────────────────────────────

export interface RequirementItem {
  /** 需求项次 */
  seq: string;
  /** 作业代码 */
  jobCode: string;
  /** 修改内容（原文） */
  modification: string;
  /** 修改内容摘要（≤50字） */
  summary: string;
  /** 核定工时 */
  hours: string;
}

export interface RequirementExtraction {
  /** 需求书编号 */
  requirementNumber: string;
  /** 需求项列表 */
  items: RequirementItem[];
}

// ── System Prompt ─────────────────────────────────────

const SYSTEM_PROMPT = `你是一个需求确认书格式化提取器。输入是从 DOCX 提取的纯文本内容，内容是一份「客户需求确认书」。

请从中提取以下信息，严格按 JSON 格式输出：

{
  "requirementNumber": "需求书编号（如 TB20260126056）",
  "items": [
    {
      "seq": "需求项次序号",
      "jobCode": "作业代码",
      "modification": "修改内容原文",
      "summary": "修改内容摘要（一句话概括，≤50字）",
      "hours": "核定工时"
    }
  ]
}

规则：
1. requirementNumber 从表头「需求确认书编号：XXX」中提取，去除前后空格
2. items 从表格中提取，表格结构为：需求 | 作业代码（作业名称） | 修改内容 | (H)
3. 如果作业代码包含括号中的作业名称，将作业名称并入 jobCode 字段，如果包含多个作业名称，用逗号（","）分隔
4. summary 是对 modification 的一句话总结，保留关键信息，不超过 50 个字
5. 缺失字段用空字符串 "" 代替，不要编造数据
6. 输出必须是合法的 JSON，不要包含 markdown 代码块标记
7. seq 必须是纯数字字符串（如 "1"、"2"），不能包含字母或其他字符`;

// ── 校验 ──────────────────────────────────────────────

function validateExtraction(data: unknown): RequirementExtraction {
  if (!data || typeof data !== "object") {
    throw new Error("响应不是有效的 JSON 对象");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.requirementNumber !== "string") {
    throw new Error("缺少 requirementNumber 字段或类型错误");
  }

  if (!Array.isArray(obj.items)) {
    throw new Error("缺少 items 数组");
  }

  const items: RequirementItem[] = obj.items.map((item: unknown, idx: number) => {
    const i = item as Record<string, unknown>;
    const rawSeq = String(i.seq ?? "");
    const seq = /^\d+$/.test(rawSeq) ? rawSeq : String(idx + 1);
    return {
      seq,
      jobCode: String(i.jobCode ?? "").replace(/[A-Z]+/g, (m) => m.toLowerCase()),
      modification: String(i.modification ?? ""),
      summary: String(i.summary ?? ""),
      hours: String(i.hours ?? ""),
    };
  });

  return { requirementNumber: obj.requirementNumber, items };
}

// ── 提取核心 ──────────────────────────────────────────

export async function extractRequirement(
  markdown: string,
): Promise<RequirementExtraction> {
  const t0 = performance.now();
  const inputLen = markdown.length;
  logger.info({ inputLen }, "开始需求书提取");

  const config = loadConfig();
  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const attemptStart = performance.now();
    logger.info({ attempt, maxRetries: config.maxRetries }, `第 ${attempt} 次尝试`);

    try {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: markdown },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const apiDuration = Math.round(performance.now() - attemptStart);
      const usage = response.usage;
      logger.info(
        {
          apiDurationMs: apiDuration,
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
          totalTokens: usage?.total_tokens,
          finishReason: response.choices[0]?.finish_reason,
        },
        "API 请求完成",
      );

      const content = response.choices[0]?.message?.content;
      if (!content) {
        logger.error({ attempt }, "模型返回空内容");
        throw new Error("模型返回空内容");
      }

      const parsed = JSON.parse(content);
      const result = validateExtraction(parsed);

      logger.info(
        {
          totalDurationMs: Math.round(performance.now() - t0),
          itemCount: result.items.length,
          requirementNumber: result.requirementNumber,
        },
        "提取成功",
      );
      return result;
    } catch (err) {
      const attemptDuration = Math.round(performance.now() - attemptStart);
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        { attempt, attemptDurationMs: attemptDuration, error: lastError.message },
        `第 ${attempt} 次尝试失败`,
      );
      if (attempt < config.maxRetries) {
        const waitMs = 500 * attempt;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  logger.error({ totalDurationMs: Math.round(performance.now() - t0), error: lastError?.message }, "提取失败：超过最大重试次数");
  throw lastError ?? new Error("提取失败：超过最大重试次数");
}

// ── 文档解析 + 提取 ────────────────────────────────────

export interface ParseDocxResult extends RequirementExtraction {
  title: string;
}

export async function parseDocx(filePath: string): Promise<ParseDocxResult> {
  logger.info({ filePath }, "开始解析 DOCX");
  const parseStart = performance.now();

  const ast = await parseOffice(filePath);
  const markdown = ast.toMarkdown();
  const parseDuration = Math.round(performance.now() - parseStart);
  logger.info(
    { parseDurationMs: parseDuration, markdownLen: markdown.length, docType: ast.type },
    "DOCX 转 Markdown 完成",
  );

  const extraction = await extractRequirement(markdown);

  return {
    title: ast.metadata?.title ?? extraction.requirementNumber,
    ...extraction,
  };
}
