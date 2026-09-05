/** 状态码常量 —— 与原 TBM 的 sscc 分类码保持一致（渲染层另有一份同构定义） */

export interface StatusItem {
  code: string;
  label: string;
  color: string;
}

/** 需求书状态 [0001] */
export const REQUIREMENT_STATUS: StatusItem[] = [
  { code: "1", label: "进行中", color: "blue" },
  { code: "2", label: "已结案", color: "green" },
];

/** 需求项状态 [0002] */
export const ITEM_STATUS: StatusItem[] = [
  { code: "1", label: "需求评估", color: "blue" },
  { code: "2", label: "需求开发", color: "geekblue" },
  { code: "3", label: "顾问确认", color: "orange" },
  { code: "4", label: "用户确认", color: "purple" },
  { code: "5", label: "已结案", color: "green" },
];

export function labelOf(list: StatusItem[], code: string): string {
  return list.find((s) => s.code === code)?.label ?? code;
}

export const requirementStatusLabel = (code: string) => labelOf(REQUIREMENT_STATUS, code);
export const itemStatusLabel = (code: string) => labelOf(ITEM_STATUS, code);
