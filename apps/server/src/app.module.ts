import "reflect-metadata";
import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { createHttpLoggingOptions } from "./observability/http-logging.config.js";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";

@Module({
  imports: [LoggerModule.forRoot({ pinoHttp: createHttpLoggingOptions() })],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
