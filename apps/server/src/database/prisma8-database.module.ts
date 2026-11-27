import { Module } from "@nestjs/common";
import { PRISMA8_RUNTIME_CONFIG, Prisma8Service } from "./prisma8.service.js";
import type { Prisma8RuntimeConfig } from "./prisma8-runtime-boundary.js";

/** 独立原生模块；后续业务仓储统一导入此模块，禁止逐请求创建连接池。 */
@Module({
  providers: [
    {
      provide: PRISMA8_RUNTIME_CONFIG,
      useFactory: (): Prisma8RuntimeConfig => {
        if (process.env.NODE_ENV === "production") {
          throw new Error("Prisma 8 正式部署连接边界尚未验收");
        }
        return { connectionString: process.env.SCADA_DATABASE_URL, readOnly: false };
      },
    },
    Prisma8Service,
  ],
  exports: [Prisma8Service],
})
export class Prisma8DatabaseModule {}
