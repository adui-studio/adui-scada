import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 独立原生候选仅生成到本地忽略目录，不提供数据库连接。
export default definePrismaConfig({
  parent: false,
  orm: definePostgresConfig({
    contract: "../../.artifacts/prisma8-native/contract.prisma",
    output: "../../.artifacts/prisma8-native",
  }),
});
