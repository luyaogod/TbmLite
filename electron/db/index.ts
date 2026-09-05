import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import fs from "node:fs";
import { pathManager } from "../utils/paths";

const dbPath = pathManager.getSqliteDBPath();
const dbDir = pathManager.getDbPath();

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const client = createClient({
  url: `file:${dbPath}`,
});

export const db = drizzle(client);
