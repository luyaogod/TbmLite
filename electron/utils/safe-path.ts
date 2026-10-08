import fs from "node:fs";
import path from "node:path";

/** 判断 child 是否位于 parent 之内（含 parent 自身） */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * 把外部传入的相对路径收敛到 base 之内，拒绝 `..` 穿越与绝对路径。
 * 所有「由用户 / 渲染层 / 数据库」决定落点的文件访问都必须经过这里。
 */
export function resolveWithin(base: string, relative: string): string {
  if (typeof relative !== "string" || relative.length === 0) {
    throw new Error("非法路径：路径为空");
  }
  if (relative.includes("\u0000")) {
    throw new Error("非法路径：包含空字节");
  }
  const abs = path.resolve(base, relative);
  if (!isInside(path.resolve(base), abs)) {
    throw new Error(`非法路径：${relative}`);
  }
  return abs;
}

/** 同 resolveWithin，但对已存在的文件额外做真实路径（符号链接）校验 */
export function resolveExistingWithin(base: string, relative: string): string {
  const abs = resolveWithin(base, relative);
  const realBase = fs.realpathSync(base);
  const real = fs.realpathSync(abs);
  if (!isInside(realBase, real)) {
    throw new Error(`非法路径：${relative}`);
  }
  return real;
}
