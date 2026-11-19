import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { PrismaProjectVersionStore } from "./prisma-project-version-store.js";
import { PrismaProjectReleaseStore } from "./prisma-project-release-store.js";
import { ProjectReleaseSafetyGate } from "./project-release-safety-gate.js";

/**
 * 工程持久化仓储只由 ProjectApiModule 显式导入。
 * ProjectApiModule 仅由 OIDC 启用根模块挂载，默认 AppModule 不连接数据库。
 */
@Module({
  imports: [DatabaseModule],
  providers: [PrismaProjectVersionStore, PrismaProjectReleaseStore, ProjectReleaseSafetyGate],
  exports: [PrismaProjectVersionStore, PrismaProjectReleaseStore],
})
export class ProjectPersistenceModule {}
