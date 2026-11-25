import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 仅由根目录白名单包装器为 schema-only 验证临时提供隔离库连接。
const readOnlyConnection = process.env.SCADA_TEST_DATABASE_URL;

export default definePrismaConfig({
  parent: false,
  // 与正式配置共用根目录 Skills，保留版本过期检查。
  skills: { agents: ["agents"], check: true },
  orm: definePostgresConfig({
    contract: "../../.artifacts/prisma8-native/contract.prisma",
    output: "../../.artifacts/prisma8-native",
    ...(readOnlyConnection ? { db: { connection: readOnlyConnection } } : {}),
  }),
});
