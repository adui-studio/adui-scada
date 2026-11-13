import { Controller, Get, Header, Inject, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import type { ScadaDocument, TagChange } from "@adui/scada-core";
import { Observable } from "rxjs";
import { LocalDemoTelemetryService } from "./local-demo-telemetry.service.js";

/**
 * 只读模拟路由仅由显式启用的本机开发根模块注册。
 * 生产与默认 AppModule 不包含该 Controller。
 */
@ApiTags("本机模拟数据（只读）")
@Controller("api/dev/demo")
export class LocalDemoTelemetryController {
  constructor(
    @Inject(LocalDemoTelemetryService) private readonly telemetry: LocalDemoTelemetryService,
  ) {}

  @Get("project")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "获取本机水处理模拟工程" })
  @ApiOkResponse({ description: "仅供本机开发演示，不是正式发布工程" })
  getProject(): ScadaDocument {
    return this.telemetry.project();
  }

  @Get("tags")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "获取本机模拟 Tag 快照" })
  @ApiOkResponse({ description: "返回共享 TagStore 的 snapshot 事件，不包含真实设备读数" })
  getTags(): TagChange {
    return this.telemetry.snapshot();
  }

  @Sse("events")
  @ApiProduces("text/event-stream")
  @ApiOperation({ summary: "订阅本机模拟 Tag 快照与增量" })
  @ApiOkResponse({ description: "初始 snapshot，之后 delta；30 秒周期内演练数据过期" })
  events(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((observer) => {
      const unsubscribe = this.telemetry.subscribe((change) => {
        observer.next({ data: change });
      });
      return () => {
        unsubscribe();
      };
    });
  }
}
