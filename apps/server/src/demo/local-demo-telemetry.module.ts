import { Module } from "@nestjs/common";
import { LocalDemoTelemetryController } from "./local-demo-telemetry.controller.js";
import { LocalDemoTelemetryService } from "./local-demo-telemetry.service.js";

/** 仅供显式允许的本机开发根模块导入，正式 AppModule 不注册此模块。 */
@Module({
  controllers: [LocalDemoTelemetryController],
  providers: [LocalDemoTelemetryService],
})
export class LocalDemoTelemetryModule {}
