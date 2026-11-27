import { Module } from "@nestjs/common";
import * as oidc from "openid-client";
import { ScadaSecurityAuditService } from "../security/scada-security-audit.js";
import {
  OidcCallbackService,
  SCADA_OIDC_AUTHORIZATION_CODE_GRANT,
} from "./oidc-callback.service.js";
import { Prisma8IdentityModule } from "./prisma8-identity.module.js";
import { ScadaAuthController } from "./scada-auth.controller.js";
import { ScadaProjectGuard } from "./scada-project.guard.js";
import { ScadaSessionGuard } from "./scada-session.guard.js";

/** 正式 OIDC HTTP 身份模块；身份、会话、授权和登录事务统一使用原生提供方。 */
@Module({
  imports: [Prisma8IdentityModule],
  controllers: [ScadaAuthController],
  providers: [
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
    // 工程控制器上下文需要原生身份端口、可信配置及两个 Guard 的完整依赖。
    Prisma8IdentityModule,
    OidcCallbackService,
    ScadaSecurityAuditService,
    ScadaSessionGuard,
    ScadaProjectGuard,
  ],
})
export class ScadaIdentityModule {}
