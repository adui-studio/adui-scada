import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// Prisma CLI 与 NestJS 一致，仅从仓库根目录读取 .env。
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

// generate/validate 无需数据库连接；迁移命令必须显式提供数据库 URL。
const databaseUrl = process.env.SCADA_DATABASE_URL;
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
