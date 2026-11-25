import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig, prisma7Schema } from "@prisma/orm-postgres/config";

// 过渡阶段只生成 Prisma 8 契约，不读取数据库凭据或接管迁移。
export default definePrismaConfig({
  parent: false,
  // Skills 仅同步到根目录 .agents/skills，保留版本过期检查。
  skills: { agents: ["agents"], check: true },
  orm: definePostgresConfig({
    contract: prisma7Schema("prisma/schema.prisma"),
    output: "src/generated/prisma8",
  }),
});
