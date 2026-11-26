import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 只允许独立源文件离线发射，不继承环境文件或配置数据库连接。
export default definePrismaConfig({
  parent: false,
  skills: { agents: ["agents"], check: true },
  orm: definePostgresConfig({
    contract: "../../.artifacts/prisma8-native-check-repair/contract.prisma",
    output: "../../.artifacts/prisma8-native-check-repair",
    migrations: { dir: "../../.artifacts/prisma8-native-check-repair/migrations" },
  }),
});
