import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CURRENT_USER } from "@/lib/constants";

const schema = z.object({
  pjaa001: z.string().trim().min(1, "请输入项目编号"),
  pjaa002: z.string().trim().min(1, "请输入项目名称"),
});

type FormValues = z.infer<typeof schema>;

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入则为编辑模式 */
  record: ProjectRow | null;
  onSaved: () => void;
}

export function ProjectDialog({ open, onOpenChange, record, onSaved }: ProjectDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { pjaa001: "", pjaa002: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset(record ? { pjaa001: record.pjaa001, pjaa002: record.pjaa002 } : { pjaa001: "", pjaa002: "" });
    }
  }, [open, record, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      if (record) {
        await window.api.project.update(record.pjaa001, values.pjaa002, CURRENT_USER);
        toast.success("项目编辑成功");
      } else {
        const now = new Date().toISOString().slice(0, 10);
        await window.api.project.create({
          pjaa001: values.pjaa001,
          pjaa002: values.pjaa002,
          pjaacrtdt: now,
          pjaacrtid: CURRENT_USER,
          pjaamoddt: now,
          pjaamodit: CURRENT_USER,
        });
        toast.success("项目添加成功");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{record ? "编辑项目" : "新增项目"}</DialogTitle>
          <DialogDescription>
            {record ? "修改项目名称，项目编号不可更改" : "填写项目编号与名称，编号保存后不可修改"}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="pjaa001"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>项目编号</FormLabel>
                  <FormControl>
                    <Input placeholder="例如：HZJD" disabled={!!record} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pjaa002"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>项目名称</FormLabel>
                  <FormControl>
                    <Input placeholder="例如：合肥恒烁 - Wafer 快捷回货" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit">保存</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
