import { Module } from "@nestjs/common";
import { PrismaProjectVersionStore } from "./prisma-project-version-store.js";
import { PrismaProjectReleaseStore } from "./prisma-project-release-store.js";
import { Prisma8ProjectPersistenceModule } from "./prisma8-project-persistence.module.js";
import { Prisma8RuntimeProjectVersionStore } from "./prisma8-runtime-project-version-store.js";
import { Prisma8RuntimeProjectReleaseStore } from "./prisma8-runtime-project-release-store.js";

/** 正式工程 HTTP 仓储装配；现有控制器令牌仅引用同一个原生实例，不实例化旧仓储。 */
@Module({
  imports: [Prisma8ProjectPersistenceModule],
  providers: [
    { provide: PrismaProjectVersionStore, useExisting: Prisma8RuntimeProjectVersionStore },
    { provide: PrismaProjectReleaseStore, useExisting: Prisma8RuntimeProjectReleaseStore },
  ],
  exports: [
    Prisma8ProjectPersistenceModule,
    PrismaProjectVersionStore,
    PrismaProjectReleaseStore,
  ],
})
export class ProjectPersistenceModule {}
