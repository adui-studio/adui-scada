import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { resolveOidcStartupConfig } from "../src/config/oidc-startup.config.js";
import type { EnabledOidcConfig } from "../src/config/oidc-startup.config.js";
import { AuthSessionService } from "../src/auth/auth-session.service.js";
import { OidcCallbackService } from "../src/auth/oidc-callback.service.js";
import { OidcLoginTransactionService } from "../src/auth/oidc-login-transaction.service.js";
import { ScadaAuthController } from "../src/auth/scada-auth.controller.js";
import {
  SCADA_CSRF_COOKIE_NAME,
  SCADA_OIDC_BROWSER_COOKIE_NAME,
  SCADA_SESSION_COOKIE_NAME,
} from "../src/auth/scada-auth-cookie.js";
import { ScadaSessionGuard } from "../src/auth/scada-session.guard.js";
import { SCADA_OIDC_STARTUP_CONFIG } from "../src/auth/oidc-provider-discovery.service.js";
import type {
  SecurityAuditDecision,
  SecurityAuditReporter,
} from "../src/security/scada-security-audit.js";
import { ScadaSecurityAuditService } from "../src/security/scada-security-audit.js";

const PRINCIPAL = Object.freeze({ tenantId: "tenant-a", subjectId: "engineer-1" });
const SESSION_TOKEN = "scada_s_" + "s".repeat(43);
const CSRF_TOKEN = "scada_csrf_" + "c".repeat(43);
const BROWSER_BINDING = "scada_oidc_b_" + "b".repeat(43);
const SESSION_ID = "9b0d8c2d-6d45-4f0f-8d5c-12e4a0d3a7a1";
const RETURN_PATH = "/studio/projects?source=oidc";

/**
 * Supertest 类型将 Set-Cookie 声明为字符串；兼容运行时数组和合并字符串。
 * 仅在下一个受控 Cookie 名称前拆分，避免误拆 Expires 属性中的逗号。
 */
function getSetCookieHeaders(header: string | readonly string[] | undefined): readonly string[] {
  if (typeof header !== "string") return header ?? [];
  return header.split(/,\s*(?=__Host-adui-scada-(?:session|csrf|oidc-browser)=)/);
}

function createConfig(): EnabledOidcConfig {
  const result = resolveOidcStartupConfig({
    NODE_ENV: "test",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ISSUER: "https://id.example.org/realms/scada",
    SCADA_OIDC_CLIENT_ID: "adui-scada",
    SCADA_OIDC_CLIENT_SECRET: "controller-test-client-secret",
    SCADA_OIDC_REDIRECT_URI: "https://scada.example.org/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: "https://scada.example.org",
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  });
  if (!result.enabled) throw new Error("测试 OIDC 配置未启用");
  return result;
}

describe("OIDC BFF 认证 HTTP 接口（端到端）", () => {
  let app: INestApplication;
  const startCalls: Array<{ readonly returnPath: unknown; readonly browserBinding: unknown }> = [];
  const callbackCalls: Array<{ readonly response: unknown; readonly browserBinding: unknown }> = [];
  const revocations: Array<{
    readonly tenantId: string;
    readonly subjectId: string;
    readonly sessionId: string;
  }> = [];
  const auditRecords: SecurityAuditDecision[] = [];

  beforeAll(async () => {
    const config = createConfig();
    const transactions = {
      start: async (returnPath: unknown, browserBinding?: unknown) => {
        startCalls.push({ returnPath, browserBinding });
        return {
          authorizationUrl: "https://id.example.org/realms/scada/authorize?state=" + "s".repeat(43),
          browserBindingCookie: BROWSER_BINDING,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        };
      },
    };
    const callbacks = {
      complete: async (response: unknown, browserBinding: unknown) => {
        callbackCalls.push({ response, browserBinding });
        return {
          sessionId: SESSION_ID,
          sessionToken: SESSION_TOKEN,
          csrfToken: CSRF_TOKEN,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          returnPath: RETURN_PATH,
        };
      },
    };
    const sessions = {
      authenticateWithSession: async (token: unknown) =>
        token === SESSION_TOKEN ? { sessionId: SESSION_ID, principal: PRINCIPAL } : null,
      authenticateCookieSession: async (token: unknown, csrfToken?: unknown) => {
        if (token !== SESSION_TOKEN) {
          return { authenticated: false as const, reason: "invalid_session" as const };
        }
        if (csrfToken !== undefined && csrfToken !== CSRF_TOKEN) {
          return { authenticated: false as const, reason: "csrf_rejected" as const };
        }
        return {
          authenticated: true as const,
          sessionId: SESSION_ID,
          principal: PRINCIPAL,
        };
      },
      revokeForVerifiedSubject: async (
        principal: { readonly tenantId: string; readonly subjectId: string },
        sessionId: string,
      ) => {
        revocations.push({
          tenantId: principal.tenantId,
          subjectId: principal.subjectId,
          sessionId,
        });
        return true;
      },
    };
    const audit: SecurityAuditReporter = {
      record(decision) {
        auditRecords.push(decision);
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ScadaAuthController],
      providers: [
        { provide: OidcLoginTransactionService, useValue: transactions },
        { provide: OidcCallbackService, useValue: callbacks },
        { provide: AuthSessionService, useValue: sessions },
        { provide: SCADA_OIDC_STARTUP_CONFIG, useValue: config },
        { provide: ScadaSecurityAuditService, useValue: audit },
        ScadaSessionGuard,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("登录发起只设置短时 HttpOnly 浏览器绑定 Cookie 并重定向到固定 Issuer", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/auth/oidc/start")
      .query({ returnTo: "/studio/projects" })
      .expect(302);

    expect(response.headers.location).toBe(
      "https://id.example.org/realms/scada/authorize?state=" + "s".repeat(43),
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    const setCookies = getSetCookieHeaders(response.headers["set-cookie"]);
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toContain(`${SCADA_OIDC_BROWSER_COOKIE_NAME}=${BROWSER_BINDING}`);
    expect(setCookies[0]).toContain("HttpOnly");
    expect(setCookies[0]).toContain("Secure");
    expect(setCookies[0]).toContain("SameSite=Lax");
    expect(setCookies[0]).not.toContain("Domain=");
    expect(startCalls[0]).toEqual({
      returnPath: "/studio/projects",
      browserBinding: undefined,
    });
  });

  it("同一浏览器的多个标签页复用短时绑定 Cookie", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/auth/oidc/start")
      .set("Cookie", `${SCADA_OIDC_BROWSER_COOKIE_NAME}=${BROWSER_BINDING}`)
      .expect(302);

    expect(startCalls[1]).toEqual({
      returnPath: undefined,
      browserBinding: BROWSER_BINDING,
    });
  });

  it("OIDC 回调转发单次参数与浏览器绑定并只通过 Cookie 建立本地会话", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/auth/oidc/callback")
      .query({
        state: "s".repeat(43),
        code: "authorization-code",
        iss: "https://id.example.org/realms/scada",
      })
      .set("Cookie", `${SCADA_OIDC_BROWSER_COOKIE_NAME}=${BROWSER_BINDING}`)
      .expect(302);

    expect(callbackCalls[0]).toEqual({
      response: {
        state: "s".repeat(43),
        code: "authorization-code",
        error: undefined,
        issuer: "https://id.example.org/realms/scada",
      },
      browserBinding: BROWSER_BINDING,
    });
    expect(response.headers.location).toBe(RETURN_PATH);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    const setCookies = getSetCookieHeaders(response.headers["set-cookie"]);
    expect(setCookies).toHaveLength(2);
    expect(setCookies[0]).toContain(`${SCADA_SESSION_COOKIE_NAME}=${SESSION_TOKEN}`);
    expect(setCookies[0]).toContain("HttpOnly");
    expect(setCookies[1]).toContain(`${SCADA_CSRF_COOKIE_NAME}=${CSRF_TOKEN}`);
    expect(setCookies[1]).not.toContain("HttpOnly");
    expect(setCookies.join(";")).not.toContain("Domain=");
    expect(JSON.stringify(response.body)).not.toContain(SESSION_TOKEN);
    expect(JSON.stringify(response.body)).not.toContain(CSRF_TOKEN);
  });

  it("已认证身份接口只返回服务端可信主体且禁止缓存", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Cookie", `${SCADA_SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .expect(200);

    expect(response.body).toEqual({
      authenticated: true,
      principal: PRINCIPAL,
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(response.body)).not.toContain(SESSION_TOKEN);
    expect(JSON.stringify(response.body)).not.toContain(CSRF_TOKEN);
  });

  it("未认证请求不能读取当前身份", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);

    expect(response.status).toBe(401);
  });

  it("Cookie 注销必须携带同源来源与 CSRF 双提交并撤销当前会话", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set(
        "Cookie",
        `${SCADA_SESSION_COOKIE_NAME}=${SESSION_TOKEN}; ${SCADA_CSRF_COOKIE_NAME}=${CSRF_TOKEN}`,
      )
      .set("Origin", "https://scada.example.org")
      .set("Sec-Fetch-Site", "same-origin")
      .set("X-SCADA-CSRF", CSRF_TOKEN)
      .expect(204);

    expect(revocations).toEqual([
      { tenantId: PRINCIPAL.tenantId, subjectId: PRINCIPAL.subjectId, sessionId: SESSION_ID },
    ]);
    const setCookies = getSetCookieHeaders(response.headers["set-cookie"]);
    expect(setCookies).toHaveLength(2);
    expect(setCookies[0]).toContain("Max-Age=0");
    expect(setCookies[1]).toContain("Max-Age=0");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("缺少 CSRF 令牌时拒绝注销且不撤销服务端会话", async () => {
    const before = revocations.length;
    await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Cookie", `${SCADA_SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set("Origin", "https://scada.example.org")
      .set("Sec-Fetch-Site", "same-origin")
      .expect(403);
    expect(revocations).toHaveLength(before);
  });

  it("Bearer 兼容路径可注销当前会话且不依赖 Cookie CSRF", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${SESSION_TOKEN}`)
      .expect(204);

    expect(revocations.at(-1)).toEqual({
      tenantId: PRINCIPAL.tenantId,
      subjectId: PRINCIPAL.subjectId,
      sessionId: SESSION_ID,
    });
    const setCookies = getSetCookieHeaders(response.headers["set-cookie"]);
    expect(setCookies).toHaveLength(2);
  });

  it("安全审计只记录固定原因码，不记录会话或 CSRF 令牌", () => {
    const serialized = JSON.stringify(auditRecords);
    expect(serialized).not.toContain(SESSION_TOKEN);
    expect(serialized).not.toContain(CSRF_TOKEN);
    expect(serialized).not.toContain("scada.example.org");
  });
});
