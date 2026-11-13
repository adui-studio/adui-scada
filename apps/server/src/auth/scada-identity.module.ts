import { Module } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { ScadaSecurityAuditService } from "../security/scada-security-audit.js";
import { AuthSessionService } from "./auth-session.service.js";
import { ScadaProjectGuard } from "./scada-project.guard.js";
import { ScadaSessionGuard } from "./scada-session.guard.js";

/**
 * 仅包含会话身份与工程 ACL 基础，当前不导入 AppModule，也不注册认证或写入 HTTP 路由。
 * 未来集成时必须将 PrismaService 调整为与工程事务仓储共享的单实例提供方。
 */
@Module({
  providers: [
    PrismaService,
    AuthSessionService,
    ScadaSecurityAuditService,
    ScadaSessionGuard,
    ScadaProjectGuard,
  ],
  exports: [AuthSessionService, ScadaSessionGuard, ScadaProjectGuard],
})
export class ScadaIdentityModule {}
