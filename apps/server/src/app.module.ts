import "reflect-metadata";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { createHttpLoggingOptions } from "./observability/http-logging.config.js";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";

@Module({
  imports: [
    // 根目录 .env 由 main.ts 统一加载，避免模块重复解析配置文件。
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    LoggerModule.forRoot({ pinoHttp: createHttpLoggingOptions() }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
