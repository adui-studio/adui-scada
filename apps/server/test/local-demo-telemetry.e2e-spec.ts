import "reflect-metadata";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import request from "supertest";
import { LocalDemoAppModule } from "../src/app.module.js";

describe("本机只读模拟工程与 Tag 接口（端到端）", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LocalDemoAppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo | null;
    if (!address) throw new Error("本机模拟测试服务未能获取回环监听端口");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("只读获取共享水处理工程，不依赖数据库或工业网关", async () => {
    const response = await request(app.getHttpServer()).get("/api/dev/demo/project").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.projectId).toBe("water-demo");
    expect(response.body.pages[0].nodes).toHaveLength(5);
  });

  it("获取共享 TagStore 快照且保留协议质量与递增序列号", async () => {
    const response = await request(app.getHttpServer()).get("/api/dev/demo/tags").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.kind).toBe("snapshot");
    expect(response.body.values).toHaveLength(3);
    expect(response.body.values.every((tag: { quality: string }) => tag.quality === "GOOD")).toBe(
      true,
    );
    expect(response.body.values[0].sequence).toBeGreaterThanOrEqual(1);
  });

  it("SSE 首条事件为共享 snapshot 格式，关闭连接后正常释放资源", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const response = await fetch(`${baseUrl}/api/dev/demo/events`, {
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      reader = response.body?.getReader();
      if (!reader) throw new Error("模拟 SSE 响应缺少可读取的数据流");

      let received = "";
      const decoder = new TextDecoder();
      while (!received.includes("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("模拟 SSE 流在首条快照前结束");
        received += decoder.decode(chunk.value, { stream: true });
        if (received.length > 32_768) throw new Error("模拟 SSE 首条事件超出安全大小");
      }
      const raw = received.match(/^data: ([^\r\n]+)/m)?.[1];
      if (!raw) throw new Error("模拟 SSE 首条事件缺少数据字段");
      const event: unknown = JSON.parse(raw);
      expect(event).toMatchObject({ kind: "snapshot" });
      expect((event as { values: unknown[] }).values).toHaveLength(3);
    } finally {
      clearTimeout(timeout);
      controller.abort();
      await reader?.cancel().catch(() => {});
    }
  });
});
