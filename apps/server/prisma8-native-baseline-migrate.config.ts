import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

// 只接受专用包装器传入的本机第三座数据库地址，不读取根环境文件。
function requireConnection(): string {
  const input = process.env.SCADA_PRISMA8_NATIVE_BASELINE_DATABASE_URL;
  try {
    if (typeof input !== "string") throw new Error("缺少第三座专用数据库地址");
    const url = new URL(input);
    if (
      url.protocol !== "postgresql:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== "15432" ||
      url.pathname !== "/adui_scada_fresh_prisma8_native" ||
      !url.username ||
      !url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("仅允许第三座专用数据库");
    }
    return url.href;
  } catch {
    throw new Error("第三座独立迁移配置连接地址无效");
  }
}

export default definePrismaConfig({
  parent: false,
  skills: { agents: ["agents"], check: true },
  orm: definePostgresConfig({
    contract: ".artifacts/prisma8-native-baseline-comments/contract.prisma",
    output: ".artifacts/prisma8-native-baseline-comments",
    migrations: { dir: ".artifacts/prisma8-native-baseline-comments/migrations" },
    db: { connection: requireConnection() },
  }),
});
