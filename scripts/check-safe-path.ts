/**
 * 路径收敛自测：npx tsx scripts/check-safe-path.ts
 * 验证附件/数据文件访问无法穿越到数据目录之外（IPC 传入路径的安全闸门）。
 */
import fs from "node:fs";
import path from "node:path";
import { resolveExistingWithin, resolveWithin } from "../electron/utils/safe-path";

const base = path.resolve(".tmp-impl/safepath/base");
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(path.join(base, "files"), { recursive: true });
fs.writeFileSync(path.join(base, "files", "ok.docx"), "x");

const reject: string[] = [
  "../etc/passwd",
  "..\\..\\windows\\win.ini",
  "/absolute/absolute.txt",
  "C:\\Windows\\win.ini",
  "files/../../outside.txt",
  "",
  "a\u0000b",
];
const accept: Array<[string, string]> = [
  ["ok.docx", path.join("files", "ok.docx")],
  ["xqaa_t/abc.docx", path.join("files", "xqaa_t", "abc.docx")],
];

let failures = 0;
for (const relative of reject) {
  try {
    const result = resolveWithin(path.join(base, "files"), relative);
    console.log(`✗ 未拒绝: ${JSON.stringify(relative)} → ${result}`);
    failures++;
  } catch {
    console.log(`✓ 已拒绝: ${JSON.stringify(relative)}`);
  }
}
for (const [relative, expected] of accept) {
  const result = resolveWithin(path.join(base, "files"), relative);
  const ok = result === path.resolve(base, expected);
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} 允许: ${JSON.stringify(relative)} → ${result}`);
}

// 符号链接逃逸
const linkDir = path.join(base, "files", "link");
fs.mkdirSync(linkDir, { recursive: true });
try {
  fs.symlinkSync(path.join(base, ".."), path.join(linkDir, "escape"), "dir");
  try {
    resolveExistingWithin(path.join(base, "files"), path.join("link", "escape", "safepath"));
    console.log("✗ 符号链接逃逸未被拦截");
    failures++;
  } catch {
    console.log("✓ 符号链接逃逸已拦截");
  }
} catch {
  console.log("- 跳过符号链接测试（当前账户无权限）");
}

console.log(failures === 0 ? "\n路径收敛自测通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
