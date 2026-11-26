import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 独立离线迁移包不加载环境文件或配置数据库连接。
export default definePrismaConfig({
  parent: false,
  skills: { agents: ["agents"], check: true },
  orm: definePostgresConfig({
    contract: ".artifacts/prisma8-native-check-repair-package/complete/contract.prisma",
    output: ".artifacts/prisma8-native-check-repair-package/complete",
    migrations: { dir: ".artifacts/prisma8-native-check-repair-package/complete/migrations" },
  }),
});
