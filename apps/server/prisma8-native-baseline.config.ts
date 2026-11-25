import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 仅消费独立基线目录中的保留候选副本，不加载环境文件或配置数据库连接。
export default definePrismaConfig({
  parent: false,
  skills: { agents: ["agents"], check: true },
  orm: definePostgresConfig({
    contract: "../../.artifacts/prisma8-native-baseline/contract.prisma",
    output: "../../.artifacts/prisma8-native-baseline",
    migrations: { dir: "../../.artifacts/prisma8-native-baseline/migrations" },
  }),
});
