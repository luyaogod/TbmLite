export class MaintenanceError extends Error {
  readonly code = "MAINTENANCE";
  constructor(tag: string) {
    super(`正在执行「${label(tag)}」，请稍候再试`);
    this.name = "MaintenanceError";
  }
}

function label(tag: string): string {
  const map: Record<string, string> = {
    restore: "恢复备份",
    reset: "重置数据",
    import: "导入旧数据",
    migration: "数据迁移",
    backup: "创建备份",
    gc: "清理孤立文件",
  };
  return map[tag] ?? tag;
}

type Listener = (state: { active: boolean; tag: string | null }) => void;

let tail: Promise<unknown> = Promise.resolve();
let activeTag: string | null = null;
const listeners = new Set<Listener>();

function broadcast(): void {
  const state = { active: activeTag !== null, tag: activeTag };
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // 监听方异常不影响维护流程
    }
  }
}

export const maintenance = {
  isActive(): boolean {
    return activeTag !== null;
  },

  currentTag(): string | null {
    return activeTag;
  },

  onStateChange(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** 写操作入口校验：维护期间抛出可读错误，渲染层按普通异常提示即可 */
  assertWritable(): void {
    if (activeTag !== null) throw new MaintenanceError(activeTag);
  },

  /**
   * 串行化独占任务（备份、恢复、迁移、导入、重置）。
   * 队列不因单个任务失败而中断。
   */
  async runExclusive<T>(tag: string, fn: () => Promise<T>): Promise<T> {
    const run = tail.then(async () => {
      activeTag = tag;
      broadcast();
      try {
        return await fn();
      } finally {
        activeTag = null;
        broadcast();
      }
    });
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  },
};
