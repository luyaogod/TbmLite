import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { KeyRound, Loader2, Moon, PlugZap, Save, Sun } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [model, setModel] = useState("deepseek-chat");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  useEffect(() => {
    window.api.ai.config
      .get()
      .then((cfg) => {
        if (cfg) {
          setBaseUrl(cfg.ANTHROPIC_BASE_URL ?? baseUrl);
          setModel(cfg.ANTHROPIC_MODEL ?? model);
          setApiKey(cfg.ANTHROPIC_AUTH_TOKEN ?? "");
        }
      })
      .catch(() => toast.error("读取配置失败"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!baseUrl.trim() || !model.trim()) {
      toast.warning("请填写 API 地址与模型名称");
      return;
    }
    setSaving(true);
    try {
      await window.api.ai.config.save({
        ANTHROPIC_BASE_URL: baseUrl.trim(),
        ANTHROPIC_MODEL: model.trim(),
        ANTHROPIC_AUTH_TOKEN: apiKey.trim(),
      });
      toast.success("配置已保存");
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="设置"
        description="AI 服务配置（OpenAI 兼容接口）"
        actions={
          <Button size="sm" onClick={() => void save()} disabled={saving || loading}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} 保存配置
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">AI API 配置</CardTitle>
              <CardDescription className="text-xs">
                需求书解析与 AI 搜索均通过该 OpenAI 兼容接口完成，配置保存在应用数据目录
                的 config/aj-api.json
              </CardDescription>
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
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
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

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">外观</CardTitle>
              <CardDescription className="text-xs">
                主题明暗模式切换，选择将自动保存
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

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">关于</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              <p>TBM Lite v0.1.0 — 需求书管理系统（shadcn/ui 重写版）</p>
              <p className="mt-1">
                功能：项目管理 · 需求书上传（.docx AI 解析）· 开发人员填写 · AI 搜索
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
