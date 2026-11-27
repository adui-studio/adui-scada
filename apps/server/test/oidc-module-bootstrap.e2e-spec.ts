import "reflect-metadata";
import { createHash, randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ModulesContainer } from "@nestjs/core";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { OidcEnabledAppModule } from "../src/app.module.js";
import {
  SCADA_CSRF_COOKIE_NAME,
  SCADA_SESSION_COOKIE_NAME,
} from "../src/auth/scada-auth-cookie.js";
import { SCADA_OIDC_STARTUP_CONFIG } from "../src/auth/oidc-provider-discovery.service.js";
import { resolveOidcStartupConfig } from "../src/config/oidc-startup.config.js";
import { PRISMA8_RUNTIME_CONFIG, Prisma8Service } from "../src/database/prisma8.service.js";
import type { Prisma8Transaction } from "../src/database/prisma8-read-transaction.js";
import { AuthSessionService } from "../src/auth/auth-session.service.js";
import { Prisma8RuntimeAuthSessionService } from "../src/auth/prisma8-runtime-identity.service.js";
import { ProjectVersionStore } from "../src/projects/project-version-store.js";
import { ProjectReleaseStore } from "../src/projects/project-release-store.js";
import { Prisma8RuntimeProjectVersionStore } from "../src/projects/prisma8-runtime-project-version-store.js";
import { Prisma8RuntimeProjectReleaseStore } from "../src/projects/prisma8-runtime-project-release-store.js";

const actor = { tenantId: "tenant-native-root", subjectId: "operator-native-root" };
const token = "scada_s_" + "a".repeat(43);
const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
const project = {
  projectId: "native-root-project",
  headRevision: 1,
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
};
type Plan = { text: string; parameters: unknown[] };

/**
 * 使用真实 NestJS OIDC 根模块装配图，仅替换外部数据库和联调凭据。
 * 防止 Controller 局部 Mock 测试遗漏跨模块 Guard 依赖，且不连接真实数据库或 IdP。
 */
describe("OIDC 根模块与工程 API Guard 启动装配（端到端）", () => {
  let app: INestApplication;
  const reads: Plan[] = [];
  const tx = {
    raw: {
      sql: (strings: TemplateStringsArray, ...parameters: unknown[]) => ({
        returnsRow: () => ({
          build: () => ({ text: strings.join("?"), parameters }),
        }),
      }),
    },
    query(plan: Plan) {
      reads.push(plan);
      if (plan.text.includes("FROM public.scada_auth_sessions")) {
        return {
          toArray: () =>
            Promise.resolve(
              plan.parameters[0] === tokenHash
                ? [
                    {
                      session_id: "2e9453fa-b5ed-4fc8-83d8-e042735dcdba",
                      tenant_id: actor.tenantId,
                      subject_id: actor.subjectId,
                      csrf_hash: "",
                      csrf_is_null: "true",
                      issued_at: new Date(Date.now() - 1000).toISOString(),
                      expires_at: new Date(Date.now() + 60_000).toISOString(),
                    },
                  ]
                : [],
            ),
        };
      }
      if (plan.text.includes("FROM public.scada_projects p")) {
        if (plan.parameters[0] !== actor.tenantId || plan.parameters[3] !== actor.subjectId) {
          throw new Error("根模块工程查询未使用可信主体");
        }
        return {
          toArray: () =>
            Promise.resolve([
              {
                project_id: project.projectId,
                head_revision: String(project.headRevision),
                created_at: project.createdAt,
                updated_at: project.updatedAt,
              },
            ]),
        };
      }
      throw new Error("根模块测试出现未预期查询");
    },
  };
  const database = {
    writable: false,
    readTransaction: <T>(operation: (tx: Prisma8Transaction) => Promise<T>) =>
      operation(tx as unknown as Prisma8Transaction),
    assertWritable: () => {
      throw new Error("根模块测试禁止数据库写入");
    },
    writeTransaction: () => {
      throw new Error("根模块测试禁止数据库写入");
    },
  };

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
      // 外部数据库全部使用内存事务。
      .overrideProvider(PRISMA8_RUNTIME_CONFIG)
      .useValue({ connectionString: undefined, readOnly: true })
      .overrideProvider(Prisma8Service)
      .useValue(database)
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
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.body).toMatchObject({
      statusCode: 401,
      message: "缺少有效的身份凭据",
    });
  });

  it("真实工程模块装配后无凭据工程读取仍拒绝访问", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/projects").expect(401);
    expect(response.status).toBe(401);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers.location).toBeUndefined();
  });

  it("真实根模块拒绝缺失 CSRF 请求头的注销，403 响应禁止缓存且不清除 Cookie", async () => {
    const sessionToken = "scada_s_" + "s".repeat(43);
    const csrfToken = "scada_csrf_" + "c".repeat(43);
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set(
        "Cookie",
        `${SCADA_SESSION_COOKIE_NAME}=${sessionToken}; ${SCADA_CSRF_COOKIE_NAME}=${csrfToken}`,
      )
      .set("Origin", "https://scada.example.org")
      .set("Sec-Fetch-Site", "same-origin")
      .expect(403);

    expect(response.status).toBe(403);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(response.body).toMatchObject({ statusCode: 403, message: "CSRF 校验失败" });
  });

  it("真实根模块拒绝不可信 Origin 的注销，403 响应禁止缓存且不清除 Cookie", async () => {
    const sessionToken = "scada_s_" + "s".repeat(43);
    const csrfToken = "scada_csrf_" + "c".repeat(43);
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set(
        "Cookie",
        `${SCADA_SESSION_COOKIE_NAME}=${sessionToken}; ${SCADA_CSRF_COOKIE_NAME}=${csrfToken}`,
      )
      .set("Origin", "https://untrusted.example.org")
      .set("Sec-Fetch-Site", "same-origin")
      .set("X-SCADA-CSRF", csrfToken)
      .expect(403);

    expect(response.status).toBe(403);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(response.body).toMatchObject({
      statusCode: 403,
      message: "请求来源不在可信站点白名单中",
    });
  });

  it("真实根模块只有一个原生数据库并将控制器令牌绑定同一原生仓储", () => {
    const modules = Array.from(app.get(ModulesContainer).values());
    expect(
      modules.some(
        (module) => module.metatype?.name === "DatabaseModule" ||
          [...module.providers.keys()].some((token) => typeof token === "function" && token.name === "PrismaService"),
      ),
    ).toBe(false);
    expect(app.get(Prisma8Service, { each: true })).toEqual([database]);
    expect(app.get(AuthSessionService)).toBeInstanceOf(Prisma8RuntimeAuthSessionService);
    expect(app.get(ProjectVersionStore)).toBe(app.get(Prisma8RuntimeProjectVersionStore));
    expect(app.get(ProjectReleaseStore)).toBe(app.get(Prisma8RuntimeProjectReleaseStore));
  });

  it("已验证会话通过正式原生身份与工程仓储返回授权列表", async () => {
    reads.length = 0;
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects")
      .set("Authorization", "Bearer " + token)
      .expect(200);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual([project]);
    expect(reads).toHaveLength(2);
    expect(reads[0]?.parameters).toEqual([tokenHash]);
    expect(reads[1]?.parameters).toEqual([actor.tenantId, "", "", actor.subjectId, 20]);
    expect(reads[1]?.text).toContain("g.permission = 'project:read'");
  });
});
