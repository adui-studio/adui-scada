import { Module } from "@nestjs/common";
import { Prisma8DatabaseModule } from "../database/prisma8-database.module.js";
import { Prisma8RuntimeProjectQueryStore } from "./prisma8-runtime-project-query-store.js";

/** 独立原生工程查询模块，不装配旧数据库或正式工程控制器。 */
@Module({
  imports: [Prisma8DatabaseModule],
  providers: [Prisma8RuntimeProjectQueryStore],
  exports: [Prisma8RuntimeProjectQueryStore],
})
export class Prisma8ProjectQueryModule {}
