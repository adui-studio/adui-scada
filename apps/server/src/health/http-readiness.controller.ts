import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { HttpReadinessIndicator } from "./http-readiness.indicator.js";

/**
 * 独立 HTTP 就绪探针。存活接口 /health 的响应契约保持不变。
 * 未挂载数据库与工业网关，不得把本探针解释为工业现场可用性。
 */
@ApiTags("健康检查")
@Controller("health")
export class HttpReadinessController {
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(HttpReadinessIndicator) private readonly http: HttpReadinessIndicator,
  ) {}

  @Get("ready")
  @HealthCheck({ noCache: true, swaggerDocumentation: false })
  @ApiOperation({ summary: "检查 HTTP 服务是否完成启动并可接受请求" })
  @ApiOkResponse({ description: "只表示 HTTP 子系统已就绪，未检查数据库或工业网关" })
  @ApiServiceUnavailableResponse({ description: "HTTP 子系统尚未就绪或正在关闭" })
  getReadiness() {
    return this.health.check([() => this.http.check()]);
  }
}
