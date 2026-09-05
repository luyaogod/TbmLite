import OpenAI from "openai";
import { db } from "../../db/index";
import { xqab_t, xqaa_t, pjaa } from "../../db/schema";
import { loadConfig } from "./config";
import { sessionStore, type ChatSession } from "./session-store";
import { requirementStatusLabel, itemStatusLabel } from "../constants";
import { attachmentService } from "../../services/attachment-service";
import logger from "../../utils/logger";

// ── 数据查询 & system prompt 构建 ───────────────────────

interface SystemPromptResult {
  prompt: string;
  dataLen: number;
}

async function buildSystemPrompt(projectCode?: string): Promise<SystemPromptResult> {
  let [xqaaRows, xqabRows] = await Promise.all([
    db.select().from(xqaa_t).all(),
    db.select().from(xqab_t).all(),
  ]);
  const [pjaaRows, attachmentMap] = await Promise.all([
    db.select().from(pjaa).all(),
    attachmentService.xqaa.listAllByRequirement(),
  ]);

  if (projectCode) {
    xqaaRows = xqaaRows.filter((r) => r.xqaapj === projectCode);
    xqabRows = xqabRows.filter((r) => r.xqabpj === projectCode);
  }

  logger.info(
    { xqaa: xqaaRows.length, xqab: xqabRows.length, pjaa: pjaaRows.length },
    "数据查询完成",
  );

  const projectNameMap = new Map<string, string>();
  for (const r of pjaaRows) projectNameMap.set(r.pjaa001, r.pjaa002);

  const parts: string[] = [];

  // 项目清单
  if (pjaaRows.length > 0) {
    parts.push("## 项目清单");
    parts.push("");
    parts.push("| 项目编号 | 项目名称 |");
    parts.push("|---------|---------|");
    for (const r of pjaaRows) parts.push(`| ${r.pjaa001} | ${r.pjaa002} |`);
    parts.push("");
  }

  // 需求书
  for (const master of xqaaRows) {
    const projectName = projectNameMap.get(master.xqaapj) ?? master.xqaapj;
    const items = xqabRows.filter(
      (i) => i.xqabpj === master.xqaapj && i.xqab001 === master.xqaa001,
    );
    const attachments = attachmentMap.get(`${master.xqaapj}|${master.xqaa001}`) ?? [];

    parts.push(`## 需求书: ${projectName} ${master.xqaa002} (${master.xqaapj}#${master.xqaa001})`);
    parts.push(`- 日期: ${master.xqaa003}`);
    parts.push(`- 状态: ${requirementStatusLabel(master.xqaa004)}`);
    if (master.xqaa005) parts.push(`- 备注: ${master.xqaa005}`);
    if (attachments.length > 0) parts.push(`- 附件: ${attachments.join("、")}`);
    parts.push("");

    if (items.length > 0) {
      parts.push("| 项次 | 需求描述 | 作业编号 | 作业名称 | 核定工时 | 需求项状态 | 开发人 |");
      parts.push("|------|---------|---------|---------|---------|-----------|--------|");
      for (const i of items) {
        parts.push(
          `| ${i.xqabseq} | ${i.xqab002} | ${i.xqab003} | ${i.xqab007} | ${i.xqab004} | ${itemStatusLabel(i.xqab005)} | ${i.xqab006} |`,
        );
      }
    } else {
      parts.push("（暂无明细项）");
    }
    parts.push("");
  }

  const dataMarkdown = parts.join("\n");

  const MAX_LEN = 100_000;
  let contextData = dataMarkdown;
  if (dataMarkdown.length > MAX_LEN) {
    contextData =
      dataMarkdown.slice(0, MAX_LEN) +
      "\n\n**注意：数据量过大，已截断部分内容。请尽量缩小查询范围（可在下方选择项目过滤）。**";
    logger.warn({ totalLen: dataMarkdown.length }, "数据超过限制，已截断");
  }

  const systemPrompt =
    "你是一个需求管理数据分析助手。以下是数据库中的项目、需求书与需求明细数据，以 Markdown 表格形式呈现。请根据这些数据回答用户的问题。如果用户的问题与数据无关，请如实说明。" +
    "\n\n回答请尽量详细、结构化，使用 Markdown 格式；与需求书、需求明细相关的内容尽量使用 Markdown 表格呈现。" +
    "\n\n【重要】当你在回答中引用某个需求书时，请使用 Markdown 链接格式 `[需求书名称](项目编号#需求书编号)`，例如 `[主页新增字段需求确认书](HZJD#TB20261230001)`；引用某个具体的需求明细项时使用 `[需求书名称-项次](项目编号#需求书编号#项次)`，例如 `[主页新增字段需求确认书-1](HZJD#TB20261230001#1)`。" +
    "\n\n" +
    contextData;

  return { prompt: systemPrompt, dataLen: contextData.length };
}

// ── 会话裁剪 ───────────────────────────────────────────

const MAX_TURNS = 20;

function trimHistory(session: ChatSession): void {
  const maxMessages = MAX_TURNS * 2;
  if (session.messages.length > maxMessages) {
    const trimmed = session.messages.slice(session.messages.length - maxMessages);
    logger.debug({ sessionId: session.sessionId, before: session.messages.length, after: trimmed.length }, "历史已裁剪");
    session.messages = trimmed;
  }
}

// ── 流式 LLM 调用 ──────────────────────────────────────

async function streamLLM(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onChunk: (text: string) => void,
): Promise<string> {
  const config = loadConfig();

  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });

  const stream = await client.chat.completions.create({
    model: config.model,
    messages,
    stream: true,
    temperature: 0.3,
  });

  let fullText = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      onChunk(delta);
      fullText += delta;
    }
  }
  return fullText;
}

// ── 带会话的查询 ───────────────────────────────────────

export async function runSearchWithSession(
  sessionId: string,
  question: string,
  onChunk: (text: string) => void,
  projectCode?: string,
): Promise<void> {
  const t0 = performance.now();
  logger.info({ sessionId, questionLen: question.length, projectCode }, "开始 AI 搜索");

  // 加载或创建 session
  let session = sessionStore.load(sessionId);
  if (!session) {
    session = {
      sessionId,
      projectCode,
      systemPrompt: "",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    logger.info({ sessionId }, "新建会话");
  }

  // projectCode 变化时重建 system prompt
  if (projectCode !== session.projectCode) {
    logger.info({ sessionId, oldPj: session.projectCode, newPj: projectCode }, "项目变更，重建 system prompt");
    const result = await buildSystemPrompt(projectCode);
    session.systemPrompt = result.prompt;
    session.projectCode = projectCode;
    session.messages = [];
    logger.info({ dataLen: result.dataLen }, "system prompt 已更新");
  }

  // 首次或 system prompt 为空时构建
  if (!session.systemPrompt) {
    const result = await buildSystemPrompt(projectCode);
    session.systemPrompt = result.prompt;
    logger.info({ dataLen: result.dataLen }, "system prompt 已构建");
  }

  // 构建 messages: [system] + 历史对话 + 当前问题
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: session.systemPrompt },
    ...session.messages.map(
      (m) => ({ role: m.role, content: m.content }) as { role: "user" | "assistant"; content: string },
    ),
    { role: "user", content: question },
  ];

  logger.info({ historyTurns: session.messages.length / 2, dataLen: session.systemPrompt.length }, "上下文构建完成");

  // 调用 LLM
  const answer = await streamLLM(messages, onChunk);

  // 追加到历史
  session.messages.push({ role: "user", content: question });
  session.messages.push({ role: "assistant", content: answer });

  // 裁剪
  trimHistory(session);

  // 持久化
  session.updatedAt = Date.now();
  sessionStore.save(session);

  logger.info({ totalDurationMs: Math.round(performance.now() - t0), turns: session.messages.length / 2 }, "AI 搜索完成");
}

export function deleteSession(sessionId: string): void {
  sessionStore.delete(sessionId);
}

/** 测试 API 连通性 */
export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const config = loadConfig();
    const client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      timeout: 15000,
    });
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 5,
    });
    const content = response.choices[0]?.message?.content ?? "";
    return { ok: true, message: `连接成功（模型 ${config.model} 响应正常${content ? `：${content}` : ""}）` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, "API 连接测试失败");
    return { ok: false, message: `连接失败：${message}` };
  }
}
