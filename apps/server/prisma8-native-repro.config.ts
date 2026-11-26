/// <reference types="node" />

import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 第四座实例专用配置；不继承根环境文件、第三座连接或正式 Provider。
function requireConnection(): string {
  const input = process.env.SCADA_PRISMA8_NATIVE_REPRO_DATABASE_URL;
  if (
    typeof input !== "string" ||
    !/^postgresql:\/\/adui_scada_native_repro:[a-f0-9]{64}@127\.0\.0\.1:15433\/adui_scada_fresh_prisma8_repro$/u.test(input) ||
    input.trim() !== input
  ) {
    throw new Error("第四座独立迁移配置连接地址无效");
  }
  return input;
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
