import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 在服务端工作区内保留独立候选，复用已安装依赖，不加载环境或连接数据库。
export default definePrismaConfig({
  parent: false,
  skills: { agents: ["agents"], check: true },
  orm: definePostgresConfig({
    contract: ".artifacts/prisma8-native-baseline-comments/contract.prisma",
    output: ".artifacts/prisma8-native-baseline-comments",
    migrations: { dir: ".artifacts/prisma8-native-baseline-comments/migrations" },
  }),
});
