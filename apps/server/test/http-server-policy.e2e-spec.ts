import "reflect-metadata";
import type { AddressInfo } from "node:net";
import { Injectable } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vite-plus/test";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import {
  applyHttpServerPolicy,
  SCADA_NEST_HTTP_OPTIONS,
} from "../src/security/http-server-policy.js";

@Injectable()
class ShutdownBarrier implements OnModuleDestroy {
  private signalEntered!: () => void;
  private signalRelease!: () => void;

  readonly entered = new Promise<void>((resolve) => {
    this.signalEntered = resolve;
  });
  private readonly held = new Promise<void>((resolve) => {
    this.signalRelease = resolve;
  });

  onModuleDestroy(): Promise<void> {
    this.signalEntered();
    return this.held;
  }

  release(): void {
    this.signalRelease();
  }
}

describe("NestJS 原生 HTTP 接收限制与关闭保护（端到端）", () => {
  it("配置后健康接口仍可访问，且原生 HTTP 限制已生效", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication(SCADA_NEST_HTTP_OPTIONS);
    try {
      const server = app.getHttpServer();
      applyHttpServerPolicy(server);
      await app.init();

      expect(server.headersTimeout).toBe(15_000);
      expect(server.requestTimeout).toBe(60_000);
      expect(server.maxHeadersCount).toBe(100);
      expect(server.maxRequestsPerSocket).toBe(1_000);
      await request(server).get("/health").expect(200);
      await request(server).get("/health/ready").expect(200);
    } finally {
      await app.close();
    }
  });

  it("进入关闭流程后拒绝新请求并返回 503，释放原有连接后正常关闭", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [ShutdownBarrier],
    }).compile();
    const app = moduleRef.createNestApplication(SCADA_NEST_HTTP_OPTIONS);
    const barrier = app.get(ShutdownBarrier);
    let closing: Promise<void> | undefined;
    try {
      applyHttpServerPolicy(app.getHttpServer());
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address() as AddressInfo | null;
      if (!address) {
        throw new Error("无法获取 HTTP 关闭测试使用的本地临时端口");
      }

      closing = app.close();
      await barrier.entered;
      const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      expect(response.status).toBe(503);
      expect(response.headers.get("connection")).toBe("close");
    } finally {
      barrier.release();
      await (closing ?? app.close());
    }
  });
});
