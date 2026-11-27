/// <reference types="node" />
import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 全新安装专用配置，不加载根环境文件，不读取历史迁移目录。
const connection = process.env.SCADA_PRISMA8_FRESH_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (
    url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
    url.port !== "15432" || url.username !== "adui_scada" ||
    url.pathname !== "/adui_scada" || !url.password || url.hash
  ) {
    throw new Error("全新初始化配置只允许本机业务库");
  }
}

export default definePrismaConfig({
  parent: false,
  skills: { agents: ["agents"], check: true },
  orm: definePostgresConfig({
    contract: "prisma/contract.prisma",
    output: "../../.artifacts/prisma8-fresh",
    migrations: { dir: "../../.artifacts/prisma8-fresh/migrations" },
    ...(connection ? { db: { connection } } : {}),
  }),
});
