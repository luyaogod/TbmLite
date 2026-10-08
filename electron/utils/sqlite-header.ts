import fs from "node:fs";

/**
 * 直接读 SQLite 文件头（不打开数据库连接）。
 *
 * 为什么不用 libsql 校验：libsql 的原生客户端在 Windows 上 close() 后仍持有文件句柄，
 * 一旦打开某个 .db 文件，本进程内就无法再删除/重命名它。恢复流程需要在换库前判断
 * 文件可用性，因此这里改用「读文件头」的方式，零句柄、零副作用。
 *
 * SQLite 文件头布局：
 *   0..15   "SQLite format 3\0"
 *   60..63  user_version（大端 4 字节）
 */
const MAGIC = "SQLite format 3\u0000";

export interface SqliteHeaderInfo {
  ok: boolean;
  sizeBytes: number;
  schemaVersion: number;
  message?: string;
}

export function readSqliteHeader(file: string): SqliteHeaderInfo {
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(file).size;
  } catch {
    return { ok: false, sizeBytes: 0, schemaVersion: 0, message: "文件不存在" };
  }
  if (sizeBytes < 100) {
    return { ok: false, sizeBytes, schemaVersion: 0, message: "文件过小，不是有效的 SQLite 数据库" };
  }
  let buffer: Buffer;
  try {
    const fd = fs.openSync(file, "r");
    try {
      buffer = Buffer.alloc(100);
      fs.readSync(fd, buffer, 0, 100, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return {
      ok: false,
      sizeBytes,
      schemaVersion: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (buffer.subarray(0, 16).toString("latin1") !== MAGIC) {
    return { ok: false, sizeBytes, schemaVersion: 0, message: "文件头不是 SQLite 格式" };
  }
  return { ok: true, sizeBytes, schemaVersion: buffer.readUInt32BE(60) };
}
