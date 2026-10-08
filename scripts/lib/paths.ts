import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 读取 `--flag value` 形式的命令行参数 */
export function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

export function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/**
 * 解析数据目录（优先级：命令行 > 环境变量 > 默认值）。
 * 数据目录结构：<dir>/db/app.db、<dir>/files/...
 */
export function resolveDataDir(opts: {
  flag: string;
  env: string;
  fallback: string;
  label: string;
  requireFiles?: boolean;
}): string {
  const raw = argValue(opts.flag) ?? process.env[opts.env] ?? opts.fallback;
  const dir = path.resolve(raw);
  if (!fs.existsSync(path.join(dir, "db", "app.db"))) {
    throw new Error(
      `${opts.label} 下未找到 db/app.db：${dir}\n` +
        `可用 ${opts.flag} <目录> 或环境变量 ${opts.env} 指定数据目录`,
    );
  }
  if (opts.requireFiles && !fs.existsSync(path.join(dir, "files"))) {
    throw new Error(`${opts.label} 下未找到 files 目录：${dir}`);
  }
  return dir;
}

export function sqliteUrl(dbFile: string): string {
  return pathToFileURL(dbFile).href;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
