import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// remark 插件：把 [pj#req] / [pj#req#seq] 风格的链接转成应用内路由
const remarkInternalLinks: Plugin<[], Root> = () => {
  return (tree: Root) => {
    const walk = (nodes: Root["children"]) => {
      for (const node of nodes) {
        if (node.type === "link") {
          const m = /^([^#/]+)#([^#/]+?)(?:#(\d+))?$/.exec(node.url);
          if (m) {
            node.url = `#/requirements/${m[1]}/${m[2]}`;
          }
        }
        if ("children" in node) walk(node.children);
      }
    };
    walk(tree.children);
  };
};

export function AiSearchPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectCode, setProjectCode] = useState<string>("all");
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const cancelledRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.api.project
      .list()
      .then(setProjects)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    lastMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, running]);

  const startNewSession = () => {
    void window.api.ai.deleteSession(sessionIdRef.current);
    sessionIdRef.current = crypto.randomUUID();
    setMessages([]);
  };

  const changeProject = (value: string) => {
    if (value === projectCode) return;
    setProjectCode(value);
    startNewSession();
  };

  const send = async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || running) return;
    setInput("");
    setRunning(true);
    cancelledRef.current = false;

    const sessionId = sessionIdRef.current;
    const code = projectCode === "all" ? undefined : projectCode;
    const userMsg: ChatMessage = { role: "user", content: question };
    setMessages((prev) => [...prev, userMsg]);

    let answer = "";
    const updateAnswer = (chunk: string) => {
      answer += chunk;
      if (!cancelledRef.current) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: answer };
          return next;
        });
      }
    };

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      await window.api.ai.search(sessionId, question, code, updateAnswer);
    } catch (err) {
      if (!cancelledRef.current) {
        toast.error(err instanceof Error ? err.message : "AI 搜索失败");
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: `> 查询失败：${err instanceof Error ? err.message : String(err)}`,
          };
          return next;
        });
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    cancelledRef.current = true;
  };

  const markdownComponents = useMemo<Components>(
    () => ({
      h1: (props) => (
        <h1 className="mb-2 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0" {...props} />
      ),
      h2: (props) => (
        <h2 className="mb-1.5 mt-3 scroll-m-20 text-sm font-semibold first:mt-0 last:mb-0" {...props} />
      ),
      h3: (props) => (
        <h3 className="mb-1 mt-2.5 scroll-m-20 text-sm font-semibold first:mt-0 last:mb-0" {...props} />
      ),
      p: (props) => <p className="my-2 leading-normal first:mt-0 last:mb-0" {...props} />,
      a: (props) => (
        <a className="text-primary underline underline-offset-2 hover:opacity-80" {...props} />
      ),
      ul: (props) => <ul className="my-2 ms-4 list-disc [&>li]:mt-1" {...props} />,
      ol: (props) => <ol className="my-2 ms-4 list-decimal [&>li]:mt-1" {...props} />,
      blockquote: (props) => (
        <blockquote
          className="my-2 border-s-2 border-muted ps-3 italic text-muted-foreground"
          {...props}
        />
      ),
      table: (props) => (
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs" {...props} />
        </div>
      ),
      th: (props) => (
        <th
          className="border border-border bg-muted/50 px-2 py-1 text-start font-medium"
          {...props}
        />
      ),
      td: (props) => <td className="border border-border px-2 py-1 text-start" {...props} />,
      code: ({ className, children, ...props }: { className?: string; children?: ReactNode }) => {
        const isBlock = typeof children === "string" && children.includes("\n");
        return (
          <code
            className={cn(
              "font-mono text-[0.85em]",
              isBlock
                ? "block overflow-x-auto border bg-muted/50 p-2.5 text-xs"
                : "border bg-muted/60 px-1 py-0.5",
              className,
            )}
            {...props}
          >
            {children}
          </code>
        );
      },
      pre: (props) => <pre className="my-2" {...props} />,
    }),
    [],
  );

  // ── 输入条（Codex 风格） ─────────────────────────────
  const composer = (
    <div className="flex items-center gap-2 border bg-card px-2.5 py-2 shadow-xs transition-colors focus-within:border-ring/70">
      <Select value={projectCode} onValueChange={changeProject}>
        <SelectTrigger
          size="sm"
          className="w-auto shrink-0 border-0 bg-transparent px-1 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent"
        >
          <SelectValue placeholder="全部项目" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部项目</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.pjaa001} value={p.pjaa001}>
              {p.pjaa001} - {p.pjaa002}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea
        className="min-h-6 max-h-40 flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 focus-visible:border-0 dark:bg-transparent"
        rows={1}
        placeholder="询问 TBM…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {running ? (
        <Button variant="ghost" size="sm" onClick={stop}>
          停止
        </Button>
      ) : (
        <Button size="sm" onClick={() => void send()} disabled={!input.trim()}>
          发送
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        title="清空上下文"
        aria-label="清空上下文"
        onClick={startNewSession}
        disabled={messages.length === 0}
      >
        <Eraser />
      </Button>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {messages.length === 0 ? (
        /* 未开始对话：提示 + 输入区靠上居中 */
        <div className="flex min-h-0 flex-1 flex-col items-center gap-4 px-4 pt-24">
          <p className="text-sm text-muted-foreground">询问项目、需求书与明细数据</p>
          <div className="w-full max-w-2xl">{composer}</div>
        </div>
      ) : (
        /* 对话进行中：消息区 + 底部输入区 */
        <>
          <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.map((m, idx) =>
                m.role === "user" ? (
                  <div key={idx} className="flex justify-end">
                    <div className="max-w-[80%] bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                  </div>
                ) : (
                  <div key={idx} className="flex justify-start">
                    <div className="max-w-[85%] min-w-0">
                      {m.content ? (
                        <div className="border bg-card px-4 py-2.5 text-sm shadow-xs">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkInternalLinks]}
                            components={markdownComponents}
                          >
                            {m.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <div className="border bg-card px-4 py-2.5 text-sm text-muted-foreground">
                          思考中…
                        </div>
                      )}
                      {idx === messages.length - 1 && running && m.content ? (
                        <span className="ml-1 inline-block animate-pulse text-primary">▍</span>
                      ) : null}
                    </div>
                  </div>
                ),
              )}
              <div ref={lastMessageRef} />
            </div>
          </div>
          <div className="shrink-0 bg-background p-3">
            <div className="mx-auto max-w-3xl">{composer}</div>
          </div>
        </>
      )}
    </div>
  );
}
