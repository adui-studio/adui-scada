import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { allowLocalOpenApi, setupLocalOpenApi } from "../src/openapi/scada-openapi.js";
import { applyHttpSecurityHeaders } from "../src/security/http-security.js";

describe("应用控制器（端到端）", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyHttpSecurityHeaders(app, false);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("GET /health 仅返回进程存活状态", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "adui-scada-server",
    });
  });

  it("未实现的工业设备写入接口返回 404", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/devices/write")
      .send({ value: 1 });
    expect(response.status).toBe(404);
  });

  it("尚未开放的服务端工程版本写入接口返回 404", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/projects/water-demo/versions")
      .send({ expectedRevision: null, document: {} });
    expect(response.status).toBe(404);
  });

  it("尚未开放的服务端工程版本读取接口返回 404", async () => {
    const response = await request(app.getHttpServer()).get("/api/projects/water-demo/versions");
    expect(response.status).toBe(404);
  });
  it("未开放的身份登录与会话签发接口返回 404", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/auth/sessions")
      .send({ tenantId: "tenant-a", subjectId: "engineer-1" });
    expect(response.status).toBe(404);
  });
  it("HTTP 默认添加安全响应头和可信请求关联 ID", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("未显式启用时 Swagger 文档和 JSON 契约均返回 404", async () => {
    const docsResponse = await request(app.getHttpServer()).get("/api/docs");
    const jsonResponse = await request(app.getHttpServer()).get("/api/docs-json");
    expect(docsResponse.status).toBe(404);
    expect(jsonResponse.status).toBe(404);
  });

  it("仅本机开发模式可生成只包含现有健康接口的 OpenAPI 文档", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const localApp = moduleRef.createNestApplication();
    const allowed = allowLocalOpenApi({
      enabled: "true",
      nodeEnv: "development",
      host: "127.0.0.1",
    });
    applyHttpSecurityHeaders(localApp, allowed);
    await setupLocalOpenApi(localApp, allowed);
    await localApp.init();
    try {
      const response = await request(localApp.getHttpServer()).get("/api/docs-json").expect(200);
      expect(response.body.openapi).toMatch(/^3\./);
      expect(response.body.paths["/health"]).toBeDefined();
      expect(response.body.paths["/api/auth/sessions"]).toBeUndefined();
      expect(response.body.paths["/api/devices/write"]).toBeUndefined();
      expect(response.body.paths["/api/projects/{projectId}/versions"]).toBeUndefined();
    } finally {
      await localApp.close();
    }
  });
});
