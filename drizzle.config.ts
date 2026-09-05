import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./electron/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./electron/app-data/dev/db/app.db",
  },
});
