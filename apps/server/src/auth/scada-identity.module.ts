import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { ScadaSecurityAuditService } from "../security/scada-security-audit.js";
import { AuthSessionService } from "./auth-session.service.js";
import { ScadaProjectGuard } from "./scada-project.guard.js";
import { ScadaSessionGuard } from "./scada-session.guard.js";

/**
 * 仅包含会话身份与工程 ACL 基础，当前不导入 AppModule，也不注册认证或写入 HTTP 路由。
 * PrismaService 由共享 DatabaseModule 提供，避免与工程仓储重复连接数据库。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    AuthSessionService,
    ScadaSecurityAuditService,
    ScadaSessionGuard,
    ScadaProjectGuard,
  ],
  exports: [AuthSessionService, ScadaSessionGuard, ScadaProjectGuard],
})
export class ScadaIdentityModule {}
