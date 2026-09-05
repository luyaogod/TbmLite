import { cn } from "@/lib/utils";
import type { StatusItem } from "@/lib/constants";

const colorClasses: Record<StatusItem["color"], string> = {
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  green: "border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300",
  orange: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
  purple: "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300",
  geekblue: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300",
};

interface StatusBadgeProps {
  item?: StatusItem;
  label: string;
  className?: string;
}

export function StatusBadge({ item, label, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        item ? colorClasses[item.color] : "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  );
}
