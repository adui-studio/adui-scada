import { Module } from "@nestjs/common";
import { ProjectVersionStore } from "./project-version-store.js";
import { ProjectReleaseStore } from "./project-release-store.js";
import { Prisma8ProjectPersistenceModule } from "./prisma8-project-persistence.module.js";
import { Prisma8RuntimeProjectVersionStore } from "./prisma8-runtime-project-version-store.js";
import { Prisma8RuntimeProjectReleaseStore } from "./prisma8-runtime-project-release-store.js";

/** 正式工程 HTTP 仓储装配；业务端口只引用同一个原生实例。 */
@Module({
  imports: [Prisma8ProjectPersistenceModule],
  providers: [
    { provide: ProjectVersionStore, useExisting: Prisma8RuntimeProjectVersionStore },
    { provide: ProjectReleaseStore, useExisting: Prisma8RuntimeProjectReleaseStore },
  ],
  exports: [Prisma8ProjectPersistenceModule, ProjectVersionStore, ProjectReleaseStore],
})
export class ProjectPersistenceModule {}
