import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  DatabaseBackup,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

const KIND_LABEL: Record<BackupKindName, string> = {
  auto: "自动",
  manual: "手动",
  "pre-migrate": "迁移前",
  "pre-restore": "恢复前",
  "pre-import": "导入前",
  "pre-reset": "重置前",
  "pre-update": "更新前",
};

export function DataManager() {
  const [health, setHealth] = useState<DataHealthView | null>(null);
  const [backups, setBackups] = useState<BackupEntryView[]>([]);
  const [issues, setIssues] = useState<IntegrityIssueView[] | null>(null);
  const [checkInfo, setCheckInfo] = useState<DatabaseCheckView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoreTarget, setRestoreTarget] = useState<BackupEntryView | null>(null);
  const [resetScope, setResetScope] = useState<"business" | "factory" | null>(null);
  const [confirmWord, setConfirmWord] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [h, list] = await Promise.all([
        window.api.data.health(false),
        window.api.backup.list(),
      ]);
      setHealth(h);
      setBackups(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "读取数据状态失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withBusy = async (tag: string, task: () => Promise<void>) => {
    setBusy(tag);
    try {
      await task();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const createBackup = () =>
    withBusy("backup", async () => {
      const entry = await window.api.backup.create();
      toast.success(`已创建备份：${entry.fileName}`);
      await refresh();
    });

  const runCheck = () =>
    withBusy("check", async () => {
      const result = await window.api.data.checkIntegrity();
      setCheckInfo(result.check);
      setIssues(result.issues);
      if (result.check.ok && result.issues.length === 0) toast.success("数据完整性检查通过");
      else if (result.check.ok) toast.warning(`发现 ${result.issues.length} 类数据问题`);
      else toast.error("数据库完整性校验未通过");
    });

  const gcFiles = () =>
    withBusy("gc", async () => {
      const preview = await window.api.data.gcOrphanFiles(true);
      if (preview.count === 0) {
        toast.success("没有孤立附件文件");
        return;
      }
      const result = await window.api.data.gcOrphanFiles(false);
      toast.success(`已移动 ${result.count} 个孤立文件到回收站（${formatBytes(result.bytes)}）`);
      await refresh();
    });

  const doRestore = (entry: BackupEntryView) =>
    withBusy("restore", async () => {
      const result = await window.api.backup.restore(entry.id);
      toast.success(
        `已从 ${entry.fileName} 恢复，应用正在重启${
          result.preBackup ? `（恢复前副本：${result.preBackup}）` : ""
        }`,
        { duration: 8000 },
      );
      setRestoreTarget(null);
    });

  const doReset = (scope: "business" | "factory") =>
    withBusy("reset", async () => {
      const result = await window.api.data.reset(scope, confirmWord);
      toast.success(`已重置（备份：${result.backupId}），界面将重新加载`);
      setResetScope(null);
      setConfirmWord("");
      window.location.reload();
    });

  if (loading && !health) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">数据与备份</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 读取中…
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">数据与备份</CardTitle>
          <CardDescription className="text-xs">
            用户数据保存在本机数据目录，程序升级不会覆盖。自动备份按日滚动保留（最近 30 天 /
            最多 20 份），手动备份不会被自动清理。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>数据目录</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={health?.dataRoot ?? ""} className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={() => void window.api.app.openDataDir("root")}>
                <FolderOpen /> 打开
              </Button>
              <Button variant="outline" size="sm" onClick={() => void window.api.app.openLog()}>
                日志
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">数据库</div>
              <div className="mt-0.5 font-medium">{formatBytes(health?.sizes.db ?? 0)}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">附件</div>
              <div className="mt-0.5 font-medium">{formatBytes(health?.sizes.files ?? 0)}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">备份</div>
              <div className="mt-0.5 font-medium">
                {health?.backups.count ?? 0} 份 · {formatBytes(health?.sizes.backups ?? 0)}
              </div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">结构版本</div>
              <div className="mt-0.5 font-medium">
                v{health?.schemaVersion ?? 0} / v{health?.currentSchemaVersion ?? 0}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              项目 {health?.counts.projects ?? 0} · 需求书 {health?.counts.requirements ?? 0} · 明细{" "}
              {health?.counts.items ?? 0} · 附件记录 {health?.counts.attachments ?? 0}
            </span>
            <span>最近备份：{health?.lastBackupAt ? formatTime(health.lastBackupAt) : "无"}</span>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void createBackup()} disabled={busy !== null}>
              {busy === "backup" ? <Loader2 className="animate-spin" /> : <Save />} 立即备份
            </Button>
            <Button variant="outline" size="sm" onClick={() => void runCheck()} disabled={busy !== null}>
              {busy === "check" ? <Loader2 className="animate-spin" /> : <ShieldCheck />} 完整性检查
            </Button>
            <Button variant="outline" size="sm" onClick={() => void gcFiles()} disabled={busy !== null}>
              {busy === "gc" ? <Loader2 className="animate-spin" /> : <Trash2 />} 清理孤立附件
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy !== null}>
              <RefreshCw /> 刷新
            </Button>
          </div>

          {checkInfo && (
            <div className="space-y-2 rounded-md border p-3 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant={checkInfo.ok ? "secondary" : "destructive"}>
                  {checkInfo.ok ? "校验通过" : "校验未通过"}
                </Badge>
                <span className="text-muted-foreground">
                  {checkInfo.mode === "full" ? "完整校验" : "快速校验"} · {checkInfo.durationMs}ms
                </span>
              </div>
              {!checkInfo.ok && (
                <p className="text-destructive">{checkInfo.messages.join("; ")}</p>
              )}
              {issues?.length === 0 && <p className="text-muted-foreground">未发现悬挂引用或孤立文件</p>}
              {issues?.map((issue) => (
                <div key={issue.kind}>
                  <span className="font-medium">{issue.kind}</span>
                  <span className="text-muted-foreground">
                    （{issue.count} 项）— {issue.hint}
                  </span>
                  {issue.samples.length > 0 && (
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {issue.samples.join(", ")}
                      {issue.count > issue.samples.length ? " …" : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <div className="text-xs font-medium">备份列表（{backups.length}）</div>
            <div className="max-h-64 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">时间</TableHead>
                    <TableHead className="text-xs">类型</TableHead>
                    <TableHead className="text-xs">大小</TableHead>
                    <TableHead className="text-xs">版本</TableHead>
                    <TableHead className="text-right text-xs">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-xs text-muted-foreground">
                        暂无备份
                      </TableCell>
                    </TableRow>
                  )}
                  {backups.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs">{formatTime(entry.createdAt)}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={entry.kind === "manual" ? "default" : "secondary"}>
                          {KIND_LABEL[entry.kind] ?? entry.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{formatBytes(entry.sizeBytes)}</TableCell>
                      <TableCell className="text-xs">
                        {entry.appVersion || "-"} / v{entry.schemaVersion}
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={busy !== null}
                          onClick={() => setRestoreTarget(entry)}
                        >
                          <HardDriveDownload /> 恢复
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={busy !== null}
                          onClick={() =>
                            void withBusy("save", async () => {
                              const result = await window.api.backup.saveAs(
                                entry.id,
                                entry.fileName,
                              );
                              if (result.ok) toast.success(`已另存为 ${result.path}`);
                            })
                          }
                        >
                          另存为
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4" /> 危险操作
          </CardTitle>
          <CardDescription className="text-xs">
            两项操作都会先自动备份；业务数据重置会把附件移入回收站（7 天后清除）。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setConfirmWord("");
              setResetScope("business");
            }}
          >
            清空业务数据
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setConfirmWord("");
              setResetScope("factory");
            }}
          >
            <DatabaseBackup /> 恢复出厂设置
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={restoreTarget !== null} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>用该备份覆盖当前数据？</AlertDialogTitle>
            <AlertDialogDescription>
              当前数据会先自动备份为 pre-restore 副本，然后用
              <span className="font-mono"> {restoreTarget?.fileName} </span>
              覆盖，应用会自动重启完成换库。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={() => restoreTarget && void doRestore(restoreTarget)}
            >
              恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetScope !== null} onOpenChange={(open) => !open && setResetScope(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {resetScope === "factory" ? "恢复出厂设置？" : "清空业务数据？"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {resetScope === "factory"
                    ? "将删除全部项目、需求书、附件、AI 配置与会话记录（保留备份与日志）。"
                    : "将删除全部项目、需求书与附件，保留 AI 配置与偏好设置。"}
                </p>
                <p>
                  请输入
                  <span className="font-mono font-medium">
                    {" "}
                    {resetScope === "factory" ? "RESET" : "CLEAR"}{" "}
                  </span>
                  以确认。
                </p>
                <Input
                  value={confirmWord}
                  onChange={(event) => setConfirmWord(event.target.value)}
                  placeholder={resetScope === "factory" ? "RESET" : "CLEAR"}
                  className="font-mono"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                busy !== null ||
                confirmWord !== (resetScope === "factory" ? "RESET" : "CLEAR")
              }
              onClick={() => resetScope && void doReset(resetScope)}
            >
              确认重置
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
