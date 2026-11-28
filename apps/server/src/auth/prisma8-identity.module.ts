import { Module } from "@nestjs/common";
import { resolveOidcStartupConfig } from "../config/oidc-startup.config.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import { Prisma8DatabaseModule } from "../database/prisma8-database.module.js";
import { AuthSessionService } from "./auth-session.service.js";
import { OidcLoginTransactionService } from "./oidc-login-transaction.service.js";
import {
  OidcProviderDiscoveryService,
  SCADA_OIDC_STARTUP_CONFIG,
} from "./oidc-provider-discovery.service.js";
import { Prisma8AuthorizationModule } from "./prisma8-authorization.module.js";
import {
  Prisma8RuntimeAuthSessionService,
  Prisma8RuntimeOidcLoginTransactionService,
} from "./prisma8-runtime-identity.service.js";

/** 正式身份 HTTP 模块共享的原生业务提供方，不重复注册控制器或数据库。 */
@Module({
  imports: [Prisma8DatabaseModule, Prisma8AuthorizationModule],
  providers: [
    {
      provide: SCADA_OIDC_STARTUP_CONFIG,
      useFactory: (): EnabledOidcConfig => {
        const config = resolveOidcStartupConfig(process.env);
        if (!config.enabled) throw new Error("原生 OIDC 身份模块只能在显式启用后加载");
        return config;
      },
    },
    { provide: AuthSessionService, useClass: Prisma8RuntimeAuthSessionService },
    { provide: OidcLoginTransactionService, useClass: Prisma8RuntimeOidcLoginTransactionService },
    OidcProviderDiscoveryService,
  ],
  exports: [
    Prisma8DatabaseModule,
    Prisma8AuthorizationModule,
    AuthSessionService,
    OidcLoginTransactionService,
    OidcProviderDiscoveryService,
    SCADA_OIDC_STARTUP_CONFIG,
  ],
})
export class Prisma8IdentityModule {}
