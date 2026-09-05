/** 状态码常量 —— 与原 TBM 的 sscc 分类码保持一致（主进程 electron/core/constants.ts 另有一份同构定义） */

export interface StatusItem {
  code: string;
  label: string;
  /** 对应 Badge 变体 */
  color: "blue" | "green" | "orange" | "purple" | "geekblue";
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

export function findStatus(list: StatusItem[], code: string): StatusItem | undefined {
  return list.find((s) => s.code === code);
}

export function statusLabel(list: StatusItem[], code: string): string {
  return findStatus(list, code)?.label ?? code;
}

export const CURRENT_USER = "admin";
