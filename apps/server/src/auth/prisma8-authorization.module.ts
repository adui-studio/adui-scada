import { Module } from "@nestjs/common";
import { Prisma8DatabaseModule } from "../database/prisma8-database.module.js";
import { AuthorizationReadStore } from "./authorization-read-store.js";
import { Prisma8AuthorizationReadStore } from "./prisma8-authorization-read-store.js";

/** 正式身份模块共享的原生身份映射及工程 ACL 读取端口。 */
@Module({
  imports: [Prisma8DatabaseModule],
  providers: [{ provide: AuthorizationReadStore, useClass: Prisma8AuthorizationReadStore }],
  exports: [AuthorizationReadStore],
})
export class Prisma8AuthorizationModule {}
