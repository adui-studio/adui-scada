import { Module } from "@nestjs/common";
import { Prisma8DatabaseModule } from "../database/prisma8-database.module.js";
import { Prisma8RuntimeProjectVersionStore } from "./prisma8-runtime-project-version-store.js";
import { Prisma8RuntimeProjectReleaseStore } from "./prisma8-runtime-project-release-store.js";

/** 正式工程模块共享的原生版本与发布仓储，不直接注册控制器。 */
@Module({
  imports: [Prisma8DatabaseModule],
  providers: [Prisma8RuntimeProjectVersionStore, Prisma8RuntimeProjectReleaseStore],
  exports: [Prisma8RuntimeProjectVersionStore, Prisma8RuntimeProjectReleaseStore],
})
export class Prisma8ProjectPersistenceModule {}
