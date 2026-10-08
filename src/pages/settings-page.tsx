import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  DatabaseBackup,
  Info,
  KeyRound,
  Loader2,
  Moon,
  Palette,
  PlugZap,
  Save,
  Sun,
} from "lucide-react";
import { DataManager } from "@/components/data/data-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SECTION_ICONS = {
  ai: PlugZap,
  appearance: Palette,
  data: DatabaseBackup,
  about: Info,
} as const;

type SectionKey = keyof typeof SECTION_ICONS;

const SECTIONS: Array<{ key: SectionKey; label: string; description: string }> = [
  { key: "ai", label: "AI 配置", description: "需求书解析与 AI 搜索使用的接口" },
  { key: "appearance", label: "外观", description: "主题明暗模式" },
  { key: "data", label: "数据与备份", description: "数据目录、备份恢复、旧数据导入与重置" },
  { key: "about", label: "关于", description: "版本与运行环境信息" },
];

export function SettingsPage() {
  const [section, setSection] = useState<SectionKey>("ai");
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [model, setModel] = useState("deepseek-chat");
  const [apiKey, setApiKey] = useState("");
  const [keyState, setKeyState] = useState<AiConfigView["keyState"]>("missing");
  const [keyEncrypted, setKeyEncrypted] = useState(true);
  const [appInfo, setAppInfo] = useState<AppInfoView | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  useEffect(() => {
    window.api.ai.config
      .get()
      .then((cfg) => {
        if (cfg) {
          setBaseUrl(cfg.baseUrl);
          setModel(cfg.model);
          setKeyState(cfg.keyState);
          setKeyEncrypted(cfg.keyEncrypted);
        }
      })
      .catch(() => toast.error("读取配置失败"))
      .finally(() => setLoading(false));
    window.api.app.info().then(setAppInfo).catch(() => undefined);
  }, []);

  const save = async () => {
    if (!baseUrl.trim() || !model.trim()) {
      toast.warning("请填写 API 地址与模型名称");
      return;
    }
    setSaving(true);
    try {
      await window.api.ai.config.save({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        // 留空表示保持已保存的 Key 不变
        apiKey: apiKey.trim() ? apiKey.trim() : null,
      });
      toast.success("配置已保存");
      const cfg = await window.api.ai.config.get();
      setKeyState(cfg.keyState);
      setApiKey("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await window.api.ai.testConnection();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTesting(false);
    }
  };

  const activeSection = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0];

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* 目录式分类菜单 */}
      <div className="flex w-52 shrink-0 flex-col border-r">
        <div className="px-4 py-3 text-[11px] font-medium tracking-wider text-muted-foreground">
          设置
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {SECTIONS.map(({ key, label }) => {
            const Icon = SECTION_ICONS[key];
            const active = section === key;
            return (
              <button
                key={key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setSection(key)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </nav>
        <div className="px-4 py-3 text-[11px] text-muted-foreground">
          TBM Lite v{appInfo?.version ?? "-"}
        </div>
      </div>

      {/* 分类内容 */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold">{activeSection.label}</h2>
            <p className="text-xs text-muted-foreground">{activeSection.description}</p>
          </div>

          {section === "ai" ? (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle className="text-sm">AI API 配置</CardTitle>
                  <CardDescription className="text-xs">
                    需求书解析与 AI 搜索均通过该 OpenAI 兼容接口完成。API Key 使用系统安全存储
                    （Windows DPAPI）加密后保存在数据目录的 config/aj-api.json；需求书内容会发送至
                    该接口，请确认服务方可接受。
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() => void save()}
                  disabled={saving || loading}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Save />} 保存配置
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <>
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="base-url">API 地址（Base URL）</Label>
                      <Input
                        id="base-url"
                        placeholder="https://api.deepseek.com/v1"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="model">模型名称</Label>
                      <Input
                        id="model"
                        placeholder="deepseek-chat"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="api-key" className="flex items-center gap-1.5">
                        <KeyRound className="size-3.5" /> API Key
                      </Label>
                      <Input
                        id="api-key"
                        type="password"
                        placeholder={
                          keyState === "undecryptable"
                            ? "原 Key 无法解密（可能更换了机器），请重新填写"
                            : keyState === "ok" || keyState === "plaintext"
                              ? "已保存，留空保持不变"
                              : "sk-..."
                        }
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                      {!keyEncrypted && (
                        <p className="text-[11px] text-destructive">
                          当前系统不支持安全存储，Key 只能以明文保存
                        </p>
                      )}
                      {keyState === "plaintext" && keyEncrypted && (
                        <p className="text-[11px] text-muted-foreground">
                          检测到历史明文 Key，保存后会自动加密存储
                        </p>
                      )}
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => void test()} disabled={testing}>
                        {testing ? <Loader2 className="animate-spin" /> : <PlugZap />} 测试连接
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {section === "appearance" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">主题</CardTitle>
                <CardDescription className="text-xs">
                  明暗模式切换，选择会自动保存并同步窗口标题带配色
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
                    <span>{isDark ? "暗色主题" : "浅色主题"}</span>
                  </div>
                  <Switch
                    checked={isDark}
                    onCheckedChange={(v) => setTheme(v ? "dark" : "light")}
                    aria-label="切换暗色主题"
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {section === "data" ? <DataManager /> : null}

          {section === "about" ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">版本与环境</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-4">
                    <span>程序版本</span>
                    <span className="font-mono">v{appInfo?.version ?? "-"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>数据结构版本</span>
                    <span className="font-mono">
                      v{appInfo?.schemaVersion ?? 0} / 程序支持 v{appInfo?.currentSchemaVersion ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>运行方式</span>
                    <span className="font-mono">{appInfo?.packaged ? "安装版" : "开发版"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="shrink-0">数据目录</span>
                    <span className="truncate font-mono" title={appInfo?.dataRoot}>
                      {appInfo?.dataRoot ?? "-"}
                    </span>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void window.api.app.openDataDir("root")}
                    >
                      打开数据目录
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void window.api.app.openLog()}>
                      打开日志
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">功能</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  项目管理 · 需求书上传（.docx AI 解析）· 需求明细维护与「导出钉钉模板」· 开发人员填写 ·
                  AI 搜索 · 自动备份与恢复 · 旧 TBM 数据导入
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
