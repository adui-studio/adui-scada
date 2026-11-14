import "reflect-metadata";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TerminusModule } from "@nestjs/terminus";
import { LoggerModule } from "nestjs-pino";
import { createHttpLoggingOptions } from "./observability/http-logging.config.js";
import { AppController } from "./app.controller.js";
import { ScadaIdentityModule } from "./auth/scada-identity.module.js";
import { AppService } from "./app.service.js";
import { LocalDemoTelemetryModule } from "./demo/local-demo-telemetry.module.js";
import { HttpReadinessController } from "./health/http-readiness.controller.js";
import { HttpReadinessIndicator } from "./health/http-readiness.indicator.js";

@Module({
  imports: [
    // 根目录 .env 由 main.ts 统一加载，避免模块重复解析配置文件。
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    LoggerModule.forRoot({ pinoHttp: createHttpLoggingOptions() }),
    TerminusModule,
  ],
  controllers: [AppController, HttpReadinessController],
  providers: [AppService, HttpReadinessIndicator],
})
export class AppModule {}

/** 只供满足本机非生产白名单的启动入口使用，不影响正式 AppModule 路由。 */
@Module({ imports: [AppModule, LocalDemoTelemetryModule] })
export class LocalDemoAppModule {}


/**
 * 仅在 OIDC 配置完整且显式启用时使用。
 * 工程持久化模块仍未挂载，当前只开放身份认证与本地会话接口。
 */
@Module({ imports: [AppModule, ScadaIdentityModule] })
export class OidcEnabledAppModule {}
