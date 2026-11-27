import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 原生运行时离线生成，不接收数据库连接，不覆盖旧候选生成物。
export default definePrismaConfig({
  parent: false,
  skills: { agents: ["agents"], check: true },
  orm: definePostgresConfig({
    contract: "prisma/contract.prisma",
    output: "src/generated/prisma8-runtime",
  }),
});
