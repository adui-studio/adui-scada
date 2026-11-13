import { Inject, Injectable } from "@nestjs/common";
import type { BeforeApplicationShutdown, OnApplicationBootstrap } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";

/**
 * 只判断 NestJS HTTP 子系统是否完成启动、是否进入关闭流程。
 * 不检查 PostgreSQL、Redis、工业网关或设备数据质量，不能作为它们的就绪证明。
 */
@Injectable()
export class HttpReadinessIndicator implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private acceptingRequests = false;

  constructor(
    @Inject(HealthIndicatorService) private readonly indicators: HealthIndicatorService,
  ) {}

  onApplicationBootstrap(): void {
    this.acceptingRequests = true;
  }

  beforeApplicationShutdown(): void {
    this.acceptingRequests = false;
  }

  check() {
    const indicator = this.indicators.check("http");
    const scope = { scope: "http", dependencies: "not_checked" } as const;
    return this.acceptingRequests ? indicator.up(scope) : indicator.down(scope);
  }
}
