import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { resolveOidcStartupConfig } from "../config/oidc-startup.config.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import type {
  AuthSessionService,
  CookieSessionAuthenticationResult,
} from "./auth-session.service.js";
import {
  SCADA_CSRF_COOKIE_NAME,
  SCADA_SESSION_COOKIE_NAME,
} from "./scada-auth-cookie.js";
import { ScadaSessionGuard } from "./scada-session.guard.js";
import type { ScadaAuthenticatedRequest } from "./scada-session.guard.js";
import type {
  SecurityAuditDecision,
  SecurityAuditReporter,
} from "../security/scada-security-audit.js";

const PRINCIPAL = Object.freeze({ tenantId: "tenant-a", subjectId: "engineer-1" });
const SESSION_TOKEN = "scada_s_" + "s".repeat(43);
const CSRF_TOKEN = "scada_csrf_" + "c".repeat(43);
const SESSION_ID = "9b0d8c2d-6d45-4f0f-8d5c-12e4a0d3a7a1";

function createConfig(): EnabledOidcConfig {
  const result = resolveOidcStartupConfig({
    NODE_ENV: "test",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ISSUER: "https://id.example.org/realms/scada",
    SCADA_OIDC_CLIENT_ID: "adui-scada",
    SCADA_OIDC_CLIENT_SECRET: "guard-test-client-secret",
    SCADA_OIDC_REDIRECT_URI: "https://scada.example.org/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: "https://scada.example.org,https://scada-admin.example.org",
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  });
  if (!result.enabled) throw new Error("测试 OIDC 配置未启用");
  return result;
}

function context(request: ScadaAuthenticatedRequest): ExecutionContext {
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function cookieHeader(options: {
  readonly session?: string;
  readonly csrf?: string;
} = {}): string {
  const values: string[] = [];
  if (options.session !== undefined) {
    values.push(`${SCADA_SESSION_COOKIE_NAME}=${options.session}`);
  }
  if (options.csrf !== undefined) {
    values.push(`${SCADA_CSRF_COOKIE_NAME}=${options.csrf}`);
  }
  return values.join("; ");
}

function createHarness() {
  const auditRecords: SecurityAuditDecision[] = [];
  const bearerTokens: unknown[] = [];
  const cookieCalls: Array<{ readonly token: unknown; readonly csrfToken: unknown }> = [];
  let bearerPrincipal: typeof PRINCIPAL | null = PRINCIPAL;
  let cookieResult: CookieSessionAuthenticationResult = {
    authenticated: true,
    sessionId: SESSION_ID,
    principal: PRINCIPAL,
  };
  const audit: SecurityAuditReporter = {
    record(decision) {
      auditRecords.push(decision);
    },
  };
  const sessions = {
    authenticate: async (token: unknown) => {
      bearerTokens.push(token);
      return bearerPrincipal;
    },
    authenticateCookieSession: async (token: unknown, csrfToken?: unknown) => {
      cookieCalls.push({ token, csrfToken });
      return cookieResult;
    },
  };
  const guard = new ScadaSessionGuard(
    sessions as unknown as AuthSessionService,
    audit,
    createConfig(),
  );

  return {
    guard,
    auditRecords,
    bearerTokens,
    cookieCalls,
    set bearerPrincipal(value: typeof PRINCIPAL | null) {
      bearerPrincipal = value;
    },
    set cookieResult(value: CookieSessionAuthenticationResult) {
      cookieResult = value;
    },
  };
}

describe("浏览器 Cookie 会话与 CSRF Guard", () => {
  it("保留显式 Bearer 认证并标记认证方式", async () => {
    const harness = createHarness();
    const request: ScadaAuthenticatedRequest = {
      method: "GET",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
    };

    expect(await harness.guard.canActivate(context(request))).toBe(true);
    expect(harness.bearerTokens).toEqual([SESSION_TOKEN]);
    expect(request.scadaPrincipal).toEqual(PRINCIPAL);
    expect(request.scadaAuthMethod).toBe("bearer");
    expect(request.scadaSessionId).toBeUndefined();
  });

  it("Bearer 与 Session/CSRF Cookie 同时出现时拒绝混用且不回退", async () => {
    const harness = createHarness();
    const request: ScadaAuthenticatedRequest = {
      method: "GET",
      headers: {
        authorization: `Bearer ${SESSION_TOKEN}`,
        cookie: cookieHeader({ session: SESSION_TOKEN, csrf: CSRF_TOKEN }),
      },
    };

    await expect(harness.guard.canActivate(context(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(harness.bearerTokens).toHaveLength(0);
    expect(harness.cookieCalls).toHaveLength(0);
    expect(harness.auditRecords).toEqual([
      {
        action: "session.authenticate",
        outcome: "denied",
        reason: "ambiguous_credentials",
      },
    ]);
  });

  it("安全读取请求允许使用有效 Cookie 会话且不要求 CSRF 请求头", async () => {
    const harness = createHarness();
    const request: ScadaAuthenticatedRequest = {
      method: "GET",
      headers: { cookie: cookieHeader({ session: SESSION_TOKEN }) },
    };

    expect(await harness.guard.canActivate(context(request))).toBe(true);
    expect(harness.cookieCalls).toEqual([{ token: SESSION_TOKEN, csrfToken: undefined }]);
    expect(request.scadaPrincipal).toEqual(PRINCIPAL);
    expect(request.scadaSessionId).toBe(SESSION_ID);
    expect(request.scadaAuthMethod).toBe("cookie");
  });

  it("写请求必须通过可信 Origin、同源 Fetch Metadata 和 CSRF 双提交校验", async () => {
    const harness = createHarness();
    const request: ScadaAuthenticatedRequest = {
      method: "POST",
      headers: {
        cookie: cookieHeader({ session: SESSION_TOKEN, csrf: CSRF_TOKEN }),
        origin: "https://scada.example.org",
        "sec-fetch-site": "same-origin",
        "x-scada-csrf": CSRF_TOKEN,
      },
    };

    expect(await harness.guard.canActivate(context(request))).toBe(true);
    expect(harness.cookieCalls).toEqual([{ token: SESSION_TOKEN, csrfToken: CSRF_TOKEN }]);
    expect(request.scadaAuthMethod).toBe("cookie");
    expect(request.scadaSessionId).toBe(SESSION_ID);
  });

  it("拒绝跨 Origin、跨站 Fetch Metadata、缺失或不匹配的 CSRF 令牌", async () => {
    const invalidRequests: Array<{
      readonly request: ScadaAuthenticatedRequest;
      readonly exception: typeof ForbiddenException;
      readonly reason: SecurityAuditDecision["reason"];
    }> = [
      {
        request: {
          method: "POST",
          headers: {
            cookie: cookieHeader({ session: SESSION_TOKEN, csrf: CSRF_TOKEN }),
            origin: "https://attacker.example.org",
            "sec-fetch-site": "same-origin",
            "x-scada-csrf": CSRF_TOKEN,
          },
        },
        exception: ForbiddenException,
        reason: "origin_rejected",
      },
      {
        request: {
          method: "POST",
          headers: {
            cookie: cookieHeader({ session: SESSION_TOKEN, csrf: CSRF_TOKEN }),
            origin: "https://scada.example.org",
            "sec-fetch-site": "cross-site",
            "x-scada-csrf": CSRF_TOKEN,
          },
        },
        exception: ForbiddenException,
        reason: "fetch_metadata_rejected",
      },
      {
        request: {
          method: "POST",
          headers: {
            cookie: cookieHeader({ session: SESSION_TOKEN, csrf: CSRF_TOKEN }),
            origin: "https://scada.example.org",
            "sec-fetch-site": "same-origin",
          },
        },
        exception: ForbiddenException,
        reason: "csrf_rejected",
      },
      {
        request: {
          method: "POST",
          headers: {
            cookie: cookieHeader({ session: SESSION_TOKEN, csrf: CSRF_TOKEN }),
            origin: "https://scada.example.org",
            "sec-fetch-site": "same-origin",
            "x-scada-csrf": "scada_csrf_" + "x".repeat(43),
          },
        },
        exception: ForbiddenException,
        reason: "csrf_rejected",
      },
    ];

    for (const entry of invalidRequests) {
      const harness = createHarness();
      await expect(harness.guard.canActivate(context(entry.request))).rejects.toBeInstanceOf(
        entry.exception,
      );
      expect(harness.auditRecords[harness.auditRecords.length - 1]).toEqual({
        action: "session.authenticate",
        outcome: "denied",
        reason: entry.reason,
      });
      expect(harness.cookieCalls).toHaveLength(0);
    }
  });

  it("拒绝重复认证 Cookie、孤立 CSRF Cookie 和错误 Cookie 头", async () => {
    const invalidHeaders: Array<string | string[]> = [
      cookieHeader({ session: SESSION_TOKEN }) + `; ${SCADA_SESSION_COOKIE_NAME}=${SESSION_TOKEN}`,
      cookieHeader({ csrf: CSRF_TOKEN }),
      ["重复的 Cookie 请求头"],
      "无法解析的 Cookie 片段",
    ];

    for (const cookie of invalidHeaders) {
      const harness = createHarness();
      const request: ScadaAuthenticatedRequest = {
        method: "GET",
        headers: { cookie },
      };
      await expect(harness.guard.canActivate(context(request))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(harness.cookieCalls).toHaveLength(0);
    }
  });

  it("数据库拒绝无效 Cookie 会话或错误的会话 CSRF 摘要", async () => {
    const invalidSession = createHarness();
    invalidSession.cookieResult = { authenticated: false, reason: "invalid_session" };
    await expect(
      invalidSession.guard.canActivate(
        context({
          method: "GET",
          headers: { cookie: cookieHeader({ session: SESSION_TOKEN }) },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const invalidCsrf = createHarness();
    invalidCsrf.cookieResult = { authenticated: false, reason: "csrf_rejected" };
    await expect(
      invalidCsrf.guard.canActivate(
        context({
          method: "POST",
          headers: {
            cookie: cookieHeader({ session: SESSION_TOKEN, csrf: CSRF_TOKEN }),
            origin: "https://scada.example.org",
            "sec-fetch-site": "same-origin",
            "x-scada-csrf": CSRF_TOKEN,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("认证审计只记录固定原因码，不包含 Cookie、令牌或 Origin", async () => {
    const harness = createHarness();
    const request: ScadaAuthenticatedRequest = {
      method: "POST",
      headers: {
        cookie: cookieHeader({ session: SESSION_TOKEN, csrf: CSRF_TOKEN }),
        origin: "https://attacker.example.org",
        "sec-fetch-site": "same-origin",
        "x-scada-csrf": CSRF_TOKEN,
      },
    };

    await expect(harness.guard.canActivate(context(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const auditText = JSON.stringify(harness.auditRecords);
    expect(auditText).not.toContain(SESSION_TOKEN);
    expect(auditText).not.toContain(CSRF_TOKEN);
    expect(auditText).not.toContain("attacker.example.org");
  });
});
