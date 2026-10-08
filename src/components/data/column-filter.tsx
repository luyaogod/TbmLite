import { useMemo, useState } from "react";
import { Check, ListFilter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * 表头筛选：按选项（该列去重值，多选）+ 关键字（包含匹配）。
 * 不提供排序 / 颜色 / 条件等 Excel 高级筛选，保持简单。
 */
export interface ColumnFilterState {
  /** 选中的去重值；空数组 = 不限制 */
  options: string[];
  /** 关键字（包含匹配，忽略大小写） */
  keyword: string;
}

export const EMPTY_FILTER: ColumnFilterState = { options: [], keyword: "" };

export function isFilterActive(state: ColumnFilterState | undefined): boolean {
  if (!state) return false;
  return state.options.length > 0 || state.keyword.trim().length > 0;
}

/** 单元格值是否通过该列筛选 */
export function matchesFilter(state: ColumnFilterState | undefined, value: unknown): boolean {
  if (!state) return true;
  const text = value === null || value === undefined ? "" : String(value);
  if (state.options.length > 0 && !state.options.includes(text)) return false;
  const keyword = state.keyword.trim().toLowerCase();
  if (keyword && !text.toLowerCase().includes(keyword)) return false;
  return true;
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

/** 从列值生成选项（去重 + 计数，按出现频次/字典序） */
export function buildFilterOptions(
  values: string[],
  format?: (value: string) => string,
): FilterOption[] {
  const counter = new Map<string, number>();
  for (const value of values) {
    counter.set(value, (counter.get(value) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([value, count]) => ({ value, label: format ? format(value) : value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-Hans-CN"));
}

interface ColumnFilterHeaderProps {
  label: string;
  options: FilterOption[];
  state: ColumnFilterState | undefined;
  onChange: (state: ColumnFilterState) => void;
  className?: string;
}

export function ColumnFilterHeader({
  label,
  options,
  state,
  onChange,
  className,
}: ColumnFilterHeaderProps) {
  const [open, setOpen] = useState(false);
  const current = state ?? EMPTY_FILTER;
  const active = isFilterActive(current);

  // 关键字同时用于：① 过滤该列的行（包含匹配）② 收窄下方选项列表
  const visibleOptions = useMemo(() => {
    const keyword = current.keyword.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter((option) => option.label.toLowerCase().includes(keyword));
  }, [options, current.keyword]);

  const toggle = (value: string) => {
    const selected = current.options.includes(value)
      ? current.options.filter((item) => item !== value)
      : [...current.options, value];
    onChange({ ...current, options: selected });
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span className="truncate">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={`筛选：${label}`}
            aria-label={`筛选：${label}`}
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-accent",
              active ? "text-primary" : "text-muted-foreground/50 hover:text-foreground",
            )}
          >
            <ListFilter className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={current.keyword}
              onChange={(event) => onChange({ ...current, keyword: event.target.value })}
              placeholder="关键字筛选（包含匹配）"
              className="h-8 pl-7 text-xs"
            />
          </div>

          <div className="flex items-center justify-between px-1 py-1.5 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="hover:text-foreground hover:underline"
                onClick={() => onChange({ ...current, options: options.map((o) => o.value) })}
              >
                全选
              </button>
              <button
                type="button"
                className="hover:text-foreground hover:underline"
                onClick={() => onChange({ ...current, options: [] })}
              >
                清空选项
              </button>
            </div>
            <span className="tabular-nums">
              已选 {current.options.length}/{options.length}
            </span>
          </div>

          <div className="max-h-52 overflow-auto rounded-sm border">
            {visibleOptions.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">无匹配选项</p>
            ) : (
              visibleOptions.map((option) => {
                const selected = current.options.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggle(option.value)}
                    className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-accent"
                  >
                    <span
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {selected ? <Check className="size-2.5" /> : null}
                    </span>
                    <span className="flex-1 truncate" title={option.label}>
                      {option.label || "（空）"}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {option.count}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {active ? (
            <Button
              variant="ghost"
              size="xs"
              className="mt-1.5 w-full"
              onClick={() => onChange(EMPTY_FILTER)}
            >
              <X /> 清除该列筛选
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** 表格容器 class：固定高度由父级 flex 决定，内部自行滚动 */
export const tableScrollBoxClass = "min-h-0 flex-1 overflow-auto";
