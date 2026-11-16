import "reflect-metadata";
import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { OidcEnabledAppModule } from "../src/app.module.js";
import { SCADA_OIDC_STARTUP_CONFIG } from "../src/auth/oidc-provider-discovery.service.js";
import { resolveOidcStartupConfig } from "../src/config/oidc-startup.config.js";
import { PrismaService } from "../src/database/prisma.service.js";

/**
 * 使用真实 NestJS OIDC 根模块装配图，仅替换外部数据库和联调凭据。
 * 防止 Controller 局部 Mock 测试遗漏跨模块 Guard 依赖，且不连接真实数据库或 IdP。
 */
describe("OIDC 根模块与工程 API Guard 启动装配（端到端）", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const config = resolveOidcStartupConfig({
      NODE_ENV: "test",
      SCADA_OIDC_ENABLED: "true",
      SCADA_OIDC_ISSUER: "https://id.example.org/realms/scada",
      SCADA_OIDC_CLIENT_ID: "bootstrap-test-client",
      SCADA_OIDC_CLIENT_SECRET: "bootstrap-test-client-secret",
      SCADA_OIDC_REDIRECT_URI: "https://scada.example.org/api/v1/auth/oidc/callback",
      SCADA_OIDC_WEB_ORIGINS: "https://scada.example.org",
      SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    });
    if (!config.enabled) throw new Error("测试 OIDC 配置未启用");

    const moduleRef = await Test.createTestingModule({
      imports: [OidcEnabledAppModule],
    })
      // 阻止连接任何本地或生产数据库，只验证真实模块依赖装配及无凭据拒绝路径。
      .overrideProvider(PrismaService)
      .useValue({ client: {} })
      .overrideProvider(SCADA_OIDC_STARTUP_CONFIG)
      .useValue(config)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("真实身份模块装配后无凭据身份请求返回 401 JSON", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);
    expect(response.status).toBe(401);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.body).toMatchObject({
      statusCode: 401,
      message: "缺少有效的身份凭据",
    });
  });

  it("真实工程模块装配后无凭据工程读取仍拒绝访问", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/projects").expect(401);
    expect(response.status).toBe(401);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.headers.location).toBeUndefined();
  });
});
