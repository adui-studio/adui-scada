import { Module } from "@nestjs/common";
import * as oidc from "openid-client";
import { resolveOidcStartupConfig } from "../config/oidc-startup.config.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import { DatabaseModule } from "../database/database.module.js";
import { ScadaSecurityAuditService } from "../security/scada-security-audit.js";
import { AuthSessionService } from "./auth-session.service.js";
import { AuthorizationReadStore } from "./authorization-read-store.js";
import { Prisma7AuthorizationReadStore } from "./prisma7-authorization-read-store.js";
import { OidcLoginTransactionService } from "./oidc-login-transaction.service.js";
import {
  OidcCallbackService,
  SCADA_OIDC_AUTHORIZATION_CODE_GRANT,
} from "./oidc-callback.service.js";
import { ScadaAuthController } from "./scada-auth.controller.js";
import { ScadaProjectGuard } from "./scada-project.guard.js";
import { ScadaSessionGuard } from "./scada-session.guard.js";
import {
  OidcProviderDiscoveryService,
  SCADA_OIDC_STARTUP_CONFIG,
} from "./oidc-provider-discovery.service.js";

/**
 * 仅在显式启用 OIDC 的根模块中加载身份路由与会话服务。
 * PrismaService 由共享 DatabaseModule 提供，避免与工程仓储重复连接数据库。
 */
@Module({
  imports: [DatabaseModule],
  controllers: [ScadaAuthController],
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
    { provide: AuthorizationReadStore, useClass: Prisma7AuthorizationReadStore },
    AuthSessionService,
    OidcProviderDiscoveryService,
    OidcLoginTransactionService,
    {
      provide: SCADA_OIDC_AUTHORIZATION_CODE_GRANT,
      useValue: oidc.authorizationCodeGrant,
    },
    OidcCallbackService,
    ScadaSecurityAuditService,
    ScadaSessionGuard,
    ScadaProjectGuard,
  ],
  exports: [
    // 工程控制器声明 @UseGuards 后，Nest 会在 ProjectApiModule 上下文解析 Guard 的依赖。
    // 除 Guard 类本身，还必须显式导出共享数据库、审计服务与可信 OIDC 配置。
    DatabaseModule,
    AuthorizationReadStore,
    SCADA_OIDC_STARTUP_CONFIG,
    ScadaSecurityAuditService,
    AuthSessionService,
    OidcProviderDiscoveryService,
    OidcLoginTransactionService,
    OidcCallbackService,
    ScadaSessionGuard,
    ScadaProjectGuard,
  ],
})
export class ScadaIdentityModule {}
