import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 原子写：同目录 tmp → fsync → rename，避免半截文件被读取 */
export function writeFileAtomic(target: string, data: string | Buffer): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

export function writeJsonAtomic(target: string, value: unknown): void {
  writeFileAtomic(target, JSON.stringify(value, null, 2));
}

export function readJson<T>(target: string): T | null {
  try {
    if (!fs.existsSync(target)) return null;
    return JSON.parse(fs.readFileSync(target, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function rmIfExists(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

/** 时间戳，可直接用于文件名（Windows 安全） */
export function stamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function dayStamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function fileSize(target: string): number {
  try {
    return fs.statSync(target).size;
  } catch {
    return 0;
  }
}

/** 递归统计目录占用（字节），最多统计 maxFiles 个文件后提前返回 */
export function dirSize(dir: string, maxFiles = 20000): number {
  let total = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        total += fileSize(full);
        if (++seen >= maxFiles) return total;
      }
    }
  }
  return total;
}

export function listFilesRecursive(dir: string): string[] {
  const result: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) result.push(full);
    }
  }
  return result;
}

/** 复制并校验大小，用于恢复/迁移等不可容错场景 */
export function copyFileVerified(source: string, target: string): void {
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
  const expected = fileSize(source);
  const actual = fileSize(target);
  if (expected !== actual) {
    throw new Error(`文件复制校验失败：${source} → ${target}（${expected} ≠ ${actual}）`);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function tmpRoot(): string {
  return os.tmpdir();
}
