import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 保留历史配置路径；实际一次迁移已经消耗，直接加载此配置也必须拒绝。
function requireConnection(): never {
  throw new Error("第四座单次迁移许可已消耗，当前配置永久冻结");
}

export default definePrismaConfig({
  parent: false,
  skills: { agents: ["agents"], check: true },
  orm: definePostgresConfig({
    contract: ".artifacts/prisma8-native-repro-candidate/contract.prisma",
    output: ".artifacts/prisma8-native-repro-candidate",
    migrations: { dir: ".artifacts/prisma8-native-repro-candidate/migrations" },
    db: { connection: requireConnection() },
  }),
});
