import { Module } from "@nestjs/common";
import { resolveOidcStartupConfig } from "../config/oidc-startup.config.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import { DatabaseModule } from "../database/database.module.js";
import { ScadaSecurityAuditService } from "../security/scada-security-audit.js";
import { AuthSessionService } from "./auth-session.service.js";
import { ScadaProjectGuard } from "./scada-project.guard.js";
import { ScadaSessionGuard } from "./scada-session.guard.js";
import {
  OidcProviderDiscoveryService,
  SCADA_OIDC_STARTUP_CONFIG,
} from "./oidc-provider-discovery.service.js";

/**
 * 仅包含会话身份与工程 ACL 基础，当前不导入 AppModule，也不注册认证或写入 HTTP 路由。
 * PrismaService 由共享 DatabaseModule 提供，避免与工程仓储重复连接数据库。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: SCADA_OIDC_STARTUP_CONFIG,
      useFactory: (): EnabledOidcConfig => {
        const config = resolveOidcStartupConfig(process.env);
        if (!config.enabled) {
          throw new Error("OIDC 身份模块只能在显式启用后加载");
        }
        return config;
      },
    },
    AuthSessionService,
    OidcProviderDiscoveryService,
    ScadaSecurityAuditService,
    ScadaSessionGuard,
    ScadaProjectGuard,
  ],
  exports: [AuthSessionService, OidcProviderDiscoveryService, ScadaSessionGuard, ScadaProjectGuard],
})
export class ScadaIdentityModule {}
