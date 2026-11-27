import "reflect-metadata";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TerminusModule } from "@nestjs/terminus";
import { LoggerModule } from "nestjs-pino";
import { createHttpLoggingOptions } from "./observability/http-logging.config.js";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { LocalDemoTelemetryModule } from "./demo/local-demo-telemetry.module.js";
import { HttpReadinessController } from "./health/http-readiness.controller.js";
import { HttpReadinessIndicator } from "./health/http-readiness.indicator.js";
import { ProjectApiModule } from "./projects/project-api.module.js";
import { Prisma8DatabaseModule } from "./database/prisma8-database.module.js";
import { DockerDatabaseReadinessController } from "./health/docker-database-readiness.controller.js";

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

/** 仅固定 Docker 本机模式挂载常驻只读原生提供方，不导入身份、工程或模拟 API。 */
@Module({
  imports: [AppModule, Prisma8DatabaseModule],
  controllers: [DockerDatabaseReadinessController],
})
export class DockerReadOnlyDatabaseAppModule {}

/** 只供满足本机非生产白名单的启动入口使用，不影响正式 AppModule 路由。 */
@Module({ imports: [AppModule, LocalDemoTelemetryModule] })
export class LocalDemoAppModule {}

/**
 * 仅在 OIDC 配置完整且显式启用时使用。
 * 统一挂载 Prisma 8 原生身份、工程 ACL 与工程持久化 API；默认 AppModule 仍保持数据库隔离。
 */
@Module({ imports: [AppModule, ProjectApiModule] })
export class OidcEnabledAppModule {}
