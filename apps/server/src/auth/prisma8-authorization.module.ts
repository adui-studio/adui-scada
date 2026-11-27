import { Module } from "@nestjs/common";
import { Prisma8DatabaseModule } from "../database/prisma8-database.module.js";
import { AuthorizationReadStore } from "./authorization-read-store.js";
import { Prisma8AuthorizationReadStore } from "./prisma8-authorization-read-store.js";

/** 原生身份与 ACL 查询装配；暂不导入正式 HTTP 根模块，不挂载会话写入或工程路由。 */
@Module({
  imports: [Prisma8DatabaseModule],
  providers: [{ provide: AuthorizationReadStore, useClass: Prisma8AuthorizationReadStore }],
  exports: [AuthorizationReadStore],
})
export class Prisma8AuthorizationModule {}
