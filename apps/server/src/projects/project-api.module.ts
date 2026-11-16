import { Module } from "@nestjs/common";
import { ScadaIdentityModule } from "../auth/scada-identity.module.js";
import { ProjectPersistenceModule } from "./project-persistence.module.js";
import { ProjectApiController } from "./project-api.controller.js";
import { ProjectApiExceptionFilter } from "./project-api.exception-filter.js";

/** 只由 OIDC 启用根模块导入，确保默认 AppModule 不暴露工程 API。 */
@Module({
  imports: [ScadaIdentityModule, ProjectPersistenceModule],
  controllers: [ProjectApiController],
  providers: [ProjectApiExceptionFilter],
})
export class ProjectApiModule {}
