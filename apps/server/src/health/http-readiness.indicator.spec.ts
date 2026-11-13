import { describe, expect, it } from "vite-plus/test";
import { HealthIndicatorService } from "@nestjs/terminus";
import { HttpReadinessIndicator } from "./http-readiness.indicator.js";

describe("服务端 HTTP 就绪指示器", () => {
  it("启动完成前返回未就绪，不伪装为数据库或网关健康", () => {
    const indicator = new HttpReadinessIndicator(new HealthIndicatorService());
    expect(indicator.check()).toEqual({
      http: { scope: "http", dependencies: "not_checked", status: "down" },
    });
  });

  it("NestJS 启动完成后只报告 HTTP 子系统已就绪", () => {
    const indicator = new HttpReadinessIndicator(new HealthIndicatorService());
    indicator.onApplicationBootstrap();
    expect(indicator.check()).toEqual({
      http: { scope: "http", dependencies: "not_checked", status: "up" },
    });
  });

  it("关闭流程开始时立即撤销 HTTP 就绪状态", () => {
    const indicator = new HttpReadinessIndicator(new HealthIndicatorService());
    indicator.onApplicationBootstrap();
    indicator.beforeApplicationShutdown();
    expect(indicator.check()).toEqual({
      http: { scope: "http", dependencies: "not_checked", status: "down" },
    });
  });
});
