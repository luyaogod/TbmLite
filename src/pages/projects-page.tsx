import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import { ProjectDialog } from "@/components/projects/project-dialog";

export function ProjectsPage() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setRows(await window.api.project.list(search || undefined));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const result = await window.api.project.delete(deleting.pjaa001);
      if (result.ok) {
        toast.success("项目删除成功");
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
        title="项目管理"
        description="创建并维护项目信息"
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus /> 新增项目
          </Button>
        }
      />

      <div className="shrink-0 border-b p-4">
        <div className="relative w-80">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索项目编号或名称"
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
                <TableHead className="w-36">项目编号</TableHead>
                <TableHead>项目名称</TableHead>
                <TableHead className="w-32">资料创建日</TableHead>
                <TableHead className="w-28">资料创建人</TableHead>
                <TableHead className="w-32">最近修改日</TableHead>
                <TableHead className="w-28">最近修改人</TableHead>
                <TableHead className="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    {search ? "没有匹配的项目" : "暂无项目，点击右上角「新增项目」开始"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.pjaa001}>
                    <TableCell className="font-mono font-medium">{r.pjaa001}</TableCell>
                    <TableCell>{r.pjaa002}</TableCell>
                    <TableCell>{r.pjaacrtdt}</TableCell>
                    <TableCell>{r.pjaacrtid}</TableCell>
                    <TableCell>{r.pjaamoddt}</TableCell>
                    <TableCell>{r.pjaamodit}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="编辑"
                          onClick={() => {
                            setEditing(r);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
                          title="删除"
                          onClick={() => setDeleting(r)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        record={editing}
        onSaved={() => void fetchData()}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除项目？</AlertDialogTitle>
            <AlertDialogDescription>
              即将删除项目「{deleting?.pjaa001} {deleting?.pjaa002}」。项目下存在需求书时将无法删除。
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
