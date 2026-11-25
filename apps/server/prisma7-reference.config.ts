import { defineConfig } from "@prisma/prisma7/config";
import { requirePrisma8ReadOnlyReferenceUrl } from "./src/database/prisma8-readonly-target.ts";

// 仅供已明确确认的独立空库重放使用，不加载根 .env 或业务数据库 URL。
if (process.env.SCADA_MIGRATION_REFERENCE_REPLAY_CONFIRMATION !== "adui_scada_fresh_prisma8_ref") {
  throw new Error("未确认独立参考库历史重放");
}
const url = new URL(
  requirePrisma8ReadOnlyReferenceUrl(process.env.SCADA_MIGRATION_REFERENCE_DATABASE_URL),
);
if (url.hostname !== "127.0.0.1") {
  throw new Error("独立参考库重放仅允许显式 IPv4 回环地址");
}
url.searchParams.set("schema", "public");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: url.toString() },
});
