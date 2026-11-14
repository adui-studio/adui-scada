import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { PrismaProjectVersionStore } from "./prisma-project-version-store.js";

/**
 * 仅供未来完成认证与工程权限 Guard 后显式导入。
 * 当前 AppModule 不导入此模块，不能通过 HTTP 访问工程版本仓储。
 */
@Module({
  imports: [DatabaseModule],
  providers: [PrismaProjectVersionStore],
  exports: [PrismaProjectVersionStore],
})
export class ProjectPersistenceModule {}
