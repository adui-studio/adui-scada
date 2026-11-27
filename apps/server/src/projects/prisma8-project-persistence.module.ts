import { Module } from "@nestjs/common";
import { Prisma8DatabaseModule } from "../database/prisma8-database.module.js";
import { Prisma8RuntimeProjectVersionStore } from "./prisma8-runtime-project-version-store.js";
import { Prisma8RuntimeProjectReleaseStore } from "./prisma8-runtime-project-release-store.js";

/** 全新业务库工程读写统一装配，不连接旧数据库或注册正式 HTTP 路由。 */
@Module({
  imports: [Prisma8DatabaseModule],
  providers: [Prisma8RuntimeProjectVersionStore, Prisma8RuntimeProjectReleaseStore],
  exports: [Prisma8RuntimeProjectVersionStore, Prisma8RuntimeProjectReleaseStore],
})
export class Prisma8ProjectPersistenceModule {}
