import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  FileDown,
  FileUp,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CURRENT_USER,
  ITEM_STATUS,
  REQUIREMENT_STATUS,
  findStatus,
} from "@/lib/constants";

const masterSchema = z.object({
  xqaa002: z.string().trim().min(1, "请输入需求书名称"),
  xqaa003: z.string().trim().min(1, "请选择日期"),
  xqaa004: z.string().min(1, "请选择状态"),
  xqaa005: z.string().trim(),
});

type MasterValues = z.infer<typeof masterSchema>;

interface ItemDraft {
  key: number;
  seq: string;
  description: string;
  jobCode: string;
  jobName: string;
  hours: number;
  status: string;
  developer: string;
}

export function RequirementDetailPage() {
  const navigate = useNavigate();
  const { pj = "", req = "" } = useParams();
  const [master, setMaster] = useState<RequirementRow | null>(null);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingAttachment, setDeletingAttachment] = useState<AttachmentRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAll = useCallback(async () => {
    try {
      const [m, itemRows, atts] = await Promise.all([
        window.api.requirement.get(pj, req),
        window.api.requirement.items(pj, req),
        window.api.attachment.list(pj, req),
      ]);
      setMaster(m);
      setItems(
        itemRows.map((r, idx) => ({
          key: idx + 1,
          seq: r.xqabseq,
          description: r.xqab002,
          jobCode: r.xqab003,
          jobName: r.xqab007,
          hours: r.xqab004,
          status: r.xqab005,
          developer: r.xqab006,
        })),
      );
      setAttachments(atts);
      if (!m) {
        toast.error("需求书不存在");
        navigate("/requirements");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [pj, req, navigate]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── 主档 ─────────────────────────────────────────────

  const masterForm = useForm<MasterValues>({
    resolver: zodResolver(masterSchema),
    defaultValues: { xqaa002: "", xqaa003: "", xqaa004: "1", xqaa005: "" },
  });

  useEffect(() => {
    if (editOpen && master) {
      masterForm.reset({
        xqaa002: master.xqaa002,
        xqaa003: master.xqaa003,
        xqaa004: master.xqaa004,
        xqaa005: master.xqaa005,
      });
    }
  }, [editOpen, master, masterForm]);

  const onSaveMaster = async (values: MasterValues) => {
    try {
      await window.api.requirement.update(pj, req, values, CURRENT_USER);
      toast.success("需求书主档已更新");
      setEditOpen(false);
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    }
  };

  // ── 明细编辑 ─────────────────────────────────────────

  const updateItem = (key: number, field: keyof ItemDraft, value: unknown) => {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item)),
    );
    setDirty(true);
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        key: Math.max(0, ...prev.map((i) => i.key)) + 1,
        seq: String(prev.length + 1),
        description: "",
        jobCode: "",
        jobName: "",
        hours: 0,
        status: "1",
        developer: "",
      },
    ]);
    setDirty(true);
  };

  const deleteItem = (key: number) => {
    setItems((prev) =>
      prev.filter((i) => i.key !== key).map((i, idx) => ({ ...i, seq: String(idx + 1) })),
    );
    setDirty(true);
  };

  const persistItems = async (): Promise<boolean> => {
    try {
      await window.api.requirement.syncItems(
        pj,
        req,
        items.map((i) => ({
          seq: i.seq,
          description: i.description,
          jobCode: i.jobCode,
          jobName: i.jobName,
          hours: Number(i.hours) || 0,
          status: i.status,
          developer: i.developer,
        })),
        CURRENT_USER,
      );
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
      return false;
    }
  };

  const saveItems = async () => {
    setSaving(true);
    const ok = await persistItems();
    if (ok) {
      toast.success("需求明细已保存");
      setDirty(false);
      await loadAll();
    }
    setSaving(false);
  };

  const discardChanges = async () => {
    await loadAll(); // 从数据库重新加载，丢弃草稿
    setDirty(false);
  };

  // ── 离开拦截：未保存修改时提示保存 / 放弃 / 取消 ────────

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  const saveAndLeave = async () => {
    setSaving(true);
    const ok = await persistItems();
    if (ok) {
      toast.success("需求明细已保存");
      setDirty(false);
      blocker.proceed?.();
    } else {
      blocker.reset?.();
    }
    setSaving(false);
  };

  const discardAndLeave = async () => {
    await discardChanges();
    blocker.proceed?.();
  };

  // ── 附件 ─────────────────────────────────────────────

  /** 导出钉钉需求评估导入模板（按当前明细，含未保存的修改） */
  const exportDingtalk = async () => {
    if (items.length === 0) {
      toast.warning("没有可导出的需求明细");
      return;
    }
    setExporting(true);
    try {
      const result = await window.api.export.dingtalkTemplate(
        items.map((item) => ({
          seq: item.seq,
          description: item.description,
          jobCode: item.jobCode,
          jobName: item.jobName,
          hours: item.hours,
        })),
        { project: pj, requirement: req },
      );
      if (result.ok) toast.success(`已导出 ${result.rowCount} 条明细分`);
      else if (!result.canceled) toast.error("导出失败");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleAttachmentFile = async (file: File) => {
    setUploading(true);
    try {
      const filePath = window.api.getPathForFile(file);
      if (!filePath) {
        toast.error("无法获取文件路径");
        return;
      }
      if (attachments.length > 0) {
        await window.api.attachment.replace(filePath, pj, req, CURRENT_USER);
        toast.success("附件已替换");
      } else {
        await window.api.attachment.import(filePath, pj, req, CURRENT_USER);
        toast.success("附件已上传");
      }
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "附件操作失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmDeleteAttachment = async () => {
    if (!deletingAttachment) return;
    try {
      const result = await window.api.attachment.delete(deletingAttachment.ffff002.split("|")[0], pj, deletingAttachment.ffff004);
      if (result.ok) {
        toast.success("附件已删除");
        await loadAll();
      } else {
        toast.error(result.reason ?? "删除失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingAttachment(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader title="需求书详情" description="加载中…" />
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!master) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={`需求书详情`}
        description={`${master.xqaapj} / ${master.xqaa001} - ${master.xqaa002}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate("/requirements")}>
              <ArrowLeft /> 返回列表
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil /> 编辑主档
            </Button>
            <Button size="sm" onClick={() => void saveItems()} disabled={saving || !dirty}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              保存明细
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {/* 信息区（主档 + 附件） */}
        <div className="border bg-card">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 px-4 py-3 md:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">项目编号</span>
              <span className="font-mono text-sm font-medium">{master.xqaapj}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">需求书编号</span>
              <span className="font-mono text-sm font-medium">{master.xqaa001}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">需求书日期</span>
              <span className="text-sm font-medium">{master.xqaa003}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">状态</span>
              <div>
                <StatusBadge
                  item={findStatus(REQUIREMENT_STATUS, master.xqaa004)}
                  label={
                    REQUIREMENT_STATUS.find((s) => s.code === master.xqaa004)?.label ?? master.xqaa004
                  }
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">资料创建</span>
              <span className="text-sm">{master.xqaacrtid}（{master.xqaacrtdt}）</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">最近修改</span>
              <span className="text-sm">{master.xqaamodit}（{master.xqaamoddt}）</span>
            </div>
          </div>

          {master.xqaa005 ? (
            <div className="px-4 pb-2.5 text-sm">
              <span className="text-xs text-muted-foreground">备注：</span>
              <span className="whitespace-pre-wrap">{master.xqaa005}</span>
            </div>
          ) : null}

          <div className="px-4 pb-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">附件（{attachments.length}）</span>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAttachmentFile(file);
                }}
              />
            </div>
            {attachments.length === 0 ? (
              <button
                type="button"
                className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FileUp className="size-3.5" />
                )}
                {uploading ? "上传中…" : "暂无附件，点击上传原始需求书文档"}
              </button>
            ) : (
              <ul className="space-y-1">
                {attachments.map((a) => (
                  <li
                    key={a.ffff004}
                    className="flex items-center gap-2 border bg-background px-2.5 py-1.5"
                  >
                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-start text-sm hover:underline"
                      title={a.ffff005}
                      onClick={() => void window.api.attachment.open(a.ffff003)}
                    >
                      {a.ffff005}
                    </button>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {a.ffffecrtid} {a.ffffcrtdt}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="替换附件"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="打开"
                      onClick={() => void window.api.attachment.open(a.ffff003)}
                    >
                      <ExternalLink />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="另存为"
                      onClick={() => void window.api.attachment.saveAs(a.ffff003, a.ffff005)}
                    >
                      <Download />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-destructive hover:text-destructive"
                      title="删除附件"
                      onClick={() => setDeletingAttachment(a)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 明细 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              需求明细
              <Badge variant="secondary">{items.length}</Badge>
              {dirty ? (
                <Badge variant="outline" className="border-orange-300 text-orange-600">
                  未保存
                </Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="xs"
                onClick={() => void exportDingtalk()}
                disabled={items.length === 0 || exporting}
              >
                {exporting ? <Loader2 className="animate-spin" /> : <FileDown />} 导出钉钉模板
              </Button>
              {dirty ? (
                <Button variant="ghost" size="xs" onClick={() => void discardChanges()}>
                  <Check /> 放弃修改
                </Button>
              ) : null}
              <Button variant="outline" size="xs" onClick={addItem}>
                <Plus /> 新增明细行
              </Button>
            </div>
          </div>
          <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">项次</TableHead>
                    <TableHead className="min-w-64">需求描述</TableHead>
                    <TableHead className="w-28">作业编号</TableHead>
                    <TableHead className="w-28">作业名称</TableHead>
                    <TableHead className="w-20">工时</TableHead>
                    <TableHead className="w-32">状态</TableHead>
                    <TableHead className="w-40">开发人员</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                        暂无明细项
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => (
                      <TableRow key={item.key}>
                        <TableCell className="font-mono text-xs">{item.seq}</TableCell>
                        <TableCell className="p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60">
                          <textarea
                            rows={2}
                            className="cell-input"
                            value={item.description}
                            onChange={(e) => updateItem(item.key, "description", e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60">
                          <input
                            className="cell-input font-mono"
                            value={item.jobCode}
                            onChange={(e) => updateItem(item.key, "jobCode", e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60">
                          <input
                            className="cell-input"
                            value={item.jobName}
                            onChange={(e) => updateItem(item.key, "jobName", e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60">
                          <input
                            className="cell-input"
                            type="number"
                            value={item.hours}
                            onChange={(e) => updateItem(item.key, "hours", Number(e.target.value))}
                          />
                        </TableCell>
                        <TableCell className="p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60">
                          <Select
                            value={item.status}
                            onValueChange={(v) => updateItem(item.key, "status", v)}
                          >
                            <SelectTrigger className="cell-select-trigger">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ITEM_STATUS.map((s) => (
                                <SelectItem key={s.code} value={s.code}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60">
                          <input
                            className="cell-input"
                            placeholder="开发人员姓名"
                            value={item.developer}
                            onChange={(e) => updateItem(item.key, "developer", e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className={cn("text-destructive hover:text-destructive")}
                            title="删除行"
                            onClick={() => deleteItem(item.key)}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
        </div>
      </div>

      {/* 主档编辑对话框 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑需求书主档</DialogTitle>
            <DialogDescription>
              {master.xqaapj} / {master.xqaa001}（编号不可修改）
            </DialogDescription>
          </DialogHeader>
          <Form {...masterForm}>
            <form onSubmit={masterForm.handleSubmit(onSaveMaster)} className="space-y-4">
              <FormField
                control={masterForm.control}
                name="xqaa002"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>需求书名称</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={masterForm.control}
                  name="xqaa003"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>需求书日期</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={masterForm.control}
                  name="xqaa004"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>状态</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {REQUIREMENT_STATUS.map((s) => (
                            <SelectItem key={s.code} value={s.code}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={masterForm.control}
                name="xqaa005"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>备注</FormLabel>
                    <FormControl>
                      <Textarea rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  取消
                </Button>
                <Button type="submit">保存</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* 离开拦截：未保存修改确认 */}
      <AlertDialog open={blocker.state === "blocked"} onOpenChange={(o) => !o && blocker.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有未保存的明细修改</AlertDialogTitle>
            <AlertDialogDescription>
              离开本页前，是否保存需求明细的修改？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button variant="outline" onClick={discardAndLeave}>
              放弃修改
            </Button>
            <Button onClick={() => void saveAndLeave()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              保存并离开
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 附件删除确认 */}
      <AlertDialog
        open={!!deletingAttachment}
        onOpenChange={(o) => !o && setDeletingAttachment(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除附件？</AlertDialogTitle>
            <AlertDialogDescription>
              即将删除附件「{deletingAttachment?.ffff005}」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDeleteAttachment()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
