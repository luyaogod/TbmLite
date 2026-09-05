import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Trash2, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { UploadDialog } from "@/components/requirements/upload-dialog";
import { toast } from "sonner";
import { REQUIREMENT_STATUS, findStatus } from "@/lib/constants";

export function RequirementsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RequirementRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterPj, setFilterPj] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<RequirementRow | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setRows(
        await window.api.requirement.list(
          search || undefined,
          filterPj === "all" ? undefined : filterPj,
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [search, filterPj]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    window.api.project
      .list()
      .then(setProjects)
      .catch(() => undefined);
  }, []);

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const result = await window.api.requirement.delete(deleting.xqaapj, deleting.xqaa001);
      if (result.ok) {
        toast.success("需求书删除成功");
        await fetchData();
      } else {
        toast.error(result.reason ?? "删除失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="需求书"
        description="上传 .docx 需求书，AI 自动解析需求明细"
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus /> 新增需求书
          </Button>
        }
      />

      <div className="flex shrink-0 items-center gap-3 border-b p-4">
        <Select value={filterPj} onValueChange={setFilterPj}>
          <SelectTrigger className="w-64">
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
        <div className="relative w-80">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索需求书编号或名称"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">项目编号</TableHead>
                <TableHead className="w-44">需求书编号</TableHead>
                <TableHead>需求书名称</TableHead>
                <TableHead className="w-32">需求书日期</TableHead>
                <TableHead className="w-28">状态</TableHead>
                <TableHead>备注</TableHead>
                <TableHead className="w-24">创建人</TableHead>
                <TableHead className="w-20 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-1">
                      <FileText className="size-5 text-muted-foreground/60" />
                      {search || filterPj !== "all"
                        ? "没有匹配的需求书"
                        : "暂无需求书，点击右上角「新增需求书」上传"}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={`${r.xqaapj}|${r.xqaa001}`}>
                    <TableCell className="font-mono">{r.xqaapj}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="font-mono font-medium text-primary underline-offset-4 hover:underline"
                        onClick={() => navigate(`/requirements/${r.xqaapj}/${r.xqaa001}`)}
                      >
                        {r.xqaa001}
                      </button>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="text-start underline-offset-4 hover:underline"
                        onClick={() => navigate(`/requirements/${r.xqaapj}/${r.xqaa001}`)}
                      >
                        {r.xqaa002}
                      </button>
                    </TableCell>
                    <TableCell>{r.xqaa003}</TableCell>
                    <TableCell>
                      <StatusBadge
                        item={findStatus(REQUIREMENT_STATUS, r.xqaa004)}
                        label={REQUIREMENT_STATUS.find((s) => s.code === r.xqaa004)?.label ?? r.xqaa004}
                      />
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">
                      {r.xqaa005 || "-"}
                    </TableCell>
                    <TableCell>{r.xqaacrtid}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        title="删除（级联删除明细与附件）"
                        onClick={() => setDeleting(r)}
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

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除需求书？</AlertDialogTitle>
            <AlertDialogDescription>
              即将删除需求书「{deleting?.xqaa001} {deleting?.xqaa002}」，其全部明细项与附件将一并删除，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleDelete}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
