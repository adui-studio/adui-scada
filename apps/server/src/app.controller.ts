import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AppService } from "./app.service.js";
import type { HealthResponse } from "./app.service.js";

@ApiTags("健康检查")
@Controller("health")
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: "检查服务端进程存活" })
  @ApiOkResponse({
    description: "仅表示 NestJS 进程存活，不表示数据库或工业网关就绪",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "ok" },
        service: { type: "string", example: "adui-scada-server" },
      },
      required: ["status", "service"],
    },
  })
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
