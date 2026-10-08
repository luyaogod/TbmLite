import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileDown, FileUp, Loader2, Pencil, Plus, Trash2, Check } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CURRENT_USER, ITEM_STATUS, REQUIREMENT_STATUS } from "@/lib/constants";

const masterSchema = z.object({
  xqaapj: z.string().trim().min(1, "请选择项目"),
  xqaa001: z.string().trim().min(1, "请输入需求书编号"),
  xqaa002: z.string().trim().min(1, "请输入需求书名称"),
  xqaa003: z.string().trim().min(1, "请选择需求书日期"),
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

let itemKey = 1;

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadDialog({ open, onOpenChange }: UploadDialogProps) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [editing, setEditing] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [docxPath, setDocxPath] = useState<string | null>(null);
  const [docxName, setDocxName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<MasterValues>({
    resolver: zodResolver(masterSchema),
    defaultValues: {
      xqaapj: "",
      xqaa001: "",
      xqaa002: "",
      xqaa003: new Date().toISOString().slice(0, 10),
      xqaa004: "1",
      xqaa005: "",
    },
  });

  const loadOptions = useCallback(async () => {
    try {
      setProjects(await window.api.project.list());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载选项失败");
    }
  }, []);

  useEffect(() => {
    if (open) {
      form.reset({
        xqaapj: "",
        xqaa001: "",
        xqaa002: "",
        xqaa003: new Date().toISOString().slice(0, 10),
        xqaa004: "1",
        xqaa005: "",
      });
      setItems([]);
      setEditing(false);
      setParsing(false);
      setDocxPath(null);
      setDocxName(null);
      setDragging(false);
      void loadOptions();
    }
  }, [open, form, loadOptions]);

  const handleParseFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      toast.error("仅支持 .docx 格式文件");
      return;
    }
    setParsing(true);
    setDocxName(file.name);
    try {
      const filePath = window.api.getPathForFile(file);
      if (!filePath) {
        toast.error("无法获取文件路径");
        return;
      }
      const result = await window.api.ai.parseDocx(filePath);
      setDocxPath(filePath);
      form.setValue("xqaa001", result.requirementNumber || "");
      form.setValue("xqaa002", file.name.replace(/\.docx$/i, ""));

      itemKey = result.items.length + 1;
      setItems(
        result.items.map((item, idx) => {
          // 解析 jobCode 中括号携带的作业名称：apmp530（引导式收货） → code=apmp530, name=引导式收货
          const m = /^([^(（]+)[(（]([^)）]+)[)）]/.exec(item.jobCode ?? "");
          return {
            key: idx + 1,
            seq: item.seq,
            description: item.summary || item.modification,
            jobCode: m ? m[1].trim() : (item.jobCode ?? ""),
            jobName: m ? m[2].trim() : "",
            hours: Number(item.hours) || 0,
            status: "1",
            developer: "",
          };
        }),
      );
      setEditing(false);
      toast.success(`解析完成，提取到 ${result.items.length} 条需求项`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "解析失败");
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /** 拖拽/选择共用入口：只接受单个 .docx */
  const handleDroppedFiles = (files: FileList | null | undefined) => {
    if (parsing || !files || files.length === 0) return;
    if (files.length > 1) toast.warning("一次只能解析一个文件，已使用第一个");
    void handleParseFile(files[0]);
  };

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
        {
          project: form.getValues("xqaapj"),
          requirement: form.getValues("xqaa001"),
        },
      );
      if (result.ok) toast.success(`已导出 ${result.rowCount} 条明细分`);
      else if (!result.canceled) toast.error("导出失败");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const updateItem = (key: number, field: keyof ItemDraft, value: unknown) => {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item)),
    );
  };

  const addItem = () => {
    const key = itemKey++;
    setItems((prev) => [
      ...prev,
      {
        key,
        seq: String(prev.length + 1),
        description: "",
        jobCode: "",
        jobName: "",
        hours: 0,
        status: "1",
        developer: "",
      },
    ]);
    setEditing(true);
  };

  const deleteItem = (key: number) => {
    setItems((prev) =>
      prev
        .filter((i) => i.key !== key)
        .map((i, idx) => ({ ...i, seq: String(idx + 1) })),
    );
  };

  const onSubmit = async (values: MasterValues) => {
    if (items.length === 0) {
      toast.warning("请至少添加一条需求项（可上传 .docx 自动解析或手动新增）");
      return;
    }
    setSaving(true);
    try {
      await window.api.requirement.create(
        { ...values, xqaa004: values.xqaa004, xqaa005: values.xqaa005 ?? "" },
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
      if (docxPath) {
        await window.api.attachment.import(docxPath, values.xqaapj, values.xqaa001, CURRENT_USER);
      }
      toast.success("需求书新建成功");
      onOpenChange(false);
      navigate(`/requirements/${values.xqaapj}/${values.xqaa001}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,900px)] w-[min(1200px,95vw)] max-w-none flex-col gap-4 sm:max-w-none">
        <DialogHeader className="shrink-0">
          <DialogTitle>新增需求书</DialogTitle>
          <DialogDescription>
            上传 .docx 需求确认书，AI 将自动提取需求书编号与需求明细；也可以手动维护明细
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pr-1">
          {/* 主档表单 + 上传 */}
          <Form {...form}>
            <form id="requirement-master-form" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="grid grid-cols-2 items-start gap-4">
                <FormField
                  control={form.control}
                  name="xqaapj"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>项目编号 *</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="选择项目" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {projects.map((p) => (
                            <SelectItem key={p.pjaa001} value={p.pjaa001}>
                              {p.pjaa001} - {p.pjaa002}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="xqaa001"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>需求书编号 *</FormLabel>
                      <FormControl>
                        <Input placeholder="AI 解析自动填入" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="xqaa002"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>需求书名称 *</FormLabel>
                      <FormControl>
                        <Input placeholder="例如：主页新增字段需求确认书" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="xqaa003"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>需求书日期 *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="xqaa004"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>需求书状态 *</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="选择状态" />
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
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium leading-none">需求书文档</span>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-disabled={parsing}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      if (!parsing) setDragging(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      if (!parsing) setDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      handleDroppedFiles(e.dataTransfer?.files);
                    }}
                    className={cn(
                      "flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-2 text-center transition-colors outline-none",
                      dragging
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-input hover:border-primary/60 hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      parsing && "cursor-wait opacity-60",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      {parsing ? (
                        <Loader2 className="size-4 shrink-0 animate-spin" />
                      ) : (
                        <FileUp className="size-4 shrink-0" />
                      )}
                      <span className="truncate">
                        {parsing
                          ? "AI 解析中…"
                          : docxName
                            ? docxName
                            : dragging
                              ? "松开即开始解析"
                              : "拖拽 .docx 到此处，或点击选择"}
                      </span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {docxName ? "已选择，点击或拖入新文件可重选" : "AI 将自动提取需求书编号与需求明细"}
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleParseFile(file);
                    }}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="xqaa005"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>备注</FormLabel>
                      <FormControl>
                        <Textarea rows={2} placeholder="备注信息（可选）" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>

          {/* 明细列表：固定高度，内部自行滚动 */}
          <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                需求明细
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void exportDingtalk()}
                  disabled={items.length === 0 || exporting}
                >
                  {exporting ? <Loader2 className="animate-spin" /> : <FileDown />} 导出钉钉模板
                </Button>
                <Button type="button" variant="outline" size="xs" onClick={addItem}>
                  <Plus /> 新增行
                </Button>
                <Button
                  type="button"
                  variant={editing ? "secondary" : "outline"}
                  size="xs"
                  onClick={() => setEditing((v) => !v)}
                >
                  {editing ? <Check /> : <Pencil />}
                  {editing ? "完成编辑" : "编辑明细"}
                </Button>
              </div>
            </div>

            <div className="h-[260px] overflow-auto rounded-md border">
              <Table containerClassName="overflow-visible">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-12">项次</TableHead>
                    <TableHead className="min-w-56">需求描述</TableHead>
                    <TableHead className="w-28">作业编号</TableHead>
                    <TableHead className="w-20">工时</TableHead>
                    <TableHead className="w-28">状态</TableHead>
                    <TableHead className="w-36">开发人员</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-[216px] text-center text-muted-foreground">
                        暂无明细，上传 .docx 自动解析或点击「新增行」
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => (
                      <TableRow key={item.key}>
                        <TableCell className="text-xs">{item.seq}</TableCell>
                        <TableCell
                          className={cn(
                            editing &&
                              "p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60",
                          )}
                        >
                          {editing ? (
                            <input
                              className="cell-input"
                              value={item.description}
                              onChange={(e) => updateItem(item.key, "description", e.target.value)}
                            />
                          ) : (
                            <span className="line-clamp-2 text-xs">{item.description || "-"}</span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            editing &&
                              "p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60",
                          )}
                        >
                          {editing ? (
                            <input
                              className="cell-input font-mono"
                              value={item.jobCode}
                              onChange={(e) => updateItem(item.key, "jobCode", e.target.value)}
                            />
                          ) : (
                            <span className="font-mono text-xs">{item.jobCode || "-"}</span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            editing &&
                              "p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60",
                          )}
                        >
                          {editing ? (
                            <input
                              className="cell-input"
                              type="number"
                              value={item.hours}
                              onChange={(e) => updateItem(item.key, "hours", Number(e.target.value))}
                            />
                          ) : (
                            <span className="text-xs">{item.hours || 0}</span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            editing &&
                              "p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60",
                          )}
                        >
                          {editing ? (
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
                          ) : (
                            <span className="text-xs">
                              {ITEM_STATUS.find((s) => s.code === item.status)?.label ?? "-"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            editing &&
                              "p-0 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/60",
                          )}
                        >
                          {editing ? (
                            <input
                              className="cell-input"
                              placeholder="开发人员姓名"
                              value={item.developer}
                              onChange={(e) => updateItem(item.key, "developer", e.target.value)}
                            />
                          ) : (
                            <span className="text-xs">{item.developer || "-"}</span>
                          )}
                        </TableCell>
                        <TableCell className="p-1">
                          {editing ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteItem(item.key)}
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="submit" form="requirement-master-form" disabled={parsing || saving}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            保存需求书
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
