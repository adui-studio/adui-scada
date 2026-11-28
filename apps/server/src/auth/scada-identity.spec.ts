import "reflect-metadata";
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthorizationReadStore } from "./authorization-read-store.js";
import type { Prisma8Transaction } from "../database/prisma8-read-transaction.js";
import type { Prisma8Service } from "../database/prisma8.service.js";
import { resolveOidcStartupConfig } from "../config/oidc-startup.config.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import type {
  SecurityAuditDecision,
  SecurityAuditReporter,
} from "../security/scada-security-audit.js";
import { Prisma8RuntimeAuthSessionService } from "./prisma8-runtime-identity.service.js";
import { SCADA_PROJECT_PERMISSION, ScadaProjectGuard } from "./scada-project.guard.js";
import type { ScadaAuthenticatedRequest } from "./scada-session.guard.js";
import { ScadaSessionGuard } from "./scada-session.guard.js";

const principal = { tenantId: "tenant-a", subjectId: "engineer-1" };

function makeAuditRecorder() {
  const records: SecurityAuditDecision[] = [];
  const audit: SecurityAuditReporter = {
    record(decision) {
      records.push(decision);
    },
  };
  return { audit, records };
}

interface StoredSession {
  sessionId: string;
  tenantId: string;
  subjectId: string;
  tokenHash: string;
  csrfTokenHash: string | null;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  identity: { status: string };
}

function makeOidcConfig(): EnabledOidcConfig {
  const result = resolveOidcStartupConfig({
    NODE_ENV: "test",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ISSUER: "https://id.example.org/realms/scada",
    SCADA_OIDC_CLIENT_ID: "adui-scada",
    SCADA_OIDC_CLIENT_SECRET: "identity-test-client-secret",
    SCADA_OIDC_REDIRECT_URI: "https://scada.example.org/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: "https://scada.example.org",
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  });
  if (!result.enabled) throw new Error("测试 OIDC 配置未启用");
  return result;
}

function stringParameter(value: unknown): string {
  if (typeof value !== "string") throw new Error("测试事务参数必须为字符串");
  return value;
}

type Plan = { text: string; parameters: unknown[] };

function makeSessionService() {
  let status = "active";
  const sessions = new Map<string, StoredSession>();
  const tx = {
    raw: {
      sql: (strings: TemplateStringsArray, ...parameters: unknown[]) => {
        const plan = { text: strings.join("?"), parameters };
        return {
          returnsRow: () => ({ build: () => plan }),
          affectedCount: () => ({ build: () => plan }),
        };
      },
    },
    query(plan: Plan) {
      const parameters = plan.parameters.map(stringParameter);
      if (plan.text === "SELECT status FROM public.scada_lock_identity(?::text, ?::text)") {
        return {
          toArray: () =>
            Promise.resolve(
              parameters[0] === principal.tenantId && parameters[1] === principal.subjectId
                ? [{ status }]
                : [],
            ),
        };
      }
      if (!plan.text.includes("FROM public.scada_auth_sessions")) {
        throw new Error("测试出现未预期会话查询");
      }
      const session = sessions.get(parameters[0] ?? "");
      return {
        toArray: () =>
          Promise.resolve(
            session && session.revokedAt === null && status === "active"
              ? [
                  {
                    session_id: session.sessionId,
                    tenant_id: session.tenantId,
                    subject_id: session.subjectId,
                    csrf_hash: session.csrfTokenHash ?? "",
                    csrf_is_null: String(session.csrfTokenHash === null),
                    issued_at: session.issuedAt.toISOString(),
                    expires_at: session.expiresAt.toISOString(),
                  },
                ]
              : [],
          ),
      };
    },
    execute(plan: Plan) {
      const parameters = plan.parameters.map(stringParameter);
      if (plan.text.includes("INSERT INTO public.scada_auth_sessions")) {
        const [sessionId, tenantId, subjectId, tokenHash, csrfTokenHash, issuedAt, expiresAt] =
          parameters;
        if (
          !sessionId ||
          !tenantId ||
          !subjectId ||
          !tokenHash ||
          !csrfTokenHash ||
          !issuedAt ||
          !expiresAt
        ) {
          throw new Error("测试会话创建参数不完整");
        }
        sessions.set(tokenHash, {
          sessionId,
          tenantId,
          subjectId,
          tokenHash,
          csrfTokenHash,
          issuedAt: new Date(issuedAt),
          expiresAt: new Date(expiresAt),
          revokedAt: null,
          identity: { status },
        });
        return Promise.resolve({ affectedRows: 1 });
      }
      if (!plan.text.includes("UPDATE public.scada_auth_sessions")) {
        throw new Error("测试出现未预期会话写入");
      }
      const session = [...sessions.values()].find(
        (row) =>
          row.sessionId === parameters[1] &&
          row.tenantId === parameters[2] &&
          row.subjectId === parameters[3] &&
          row.revokedAt === null,
      );
      if (session) session.revokedAt = new Date(stringParameter(parameters[0]));
      return Promise.resolve({ affectedRows: session ? 1 : 0 });
    },
  };
  const transaction = <T>(operation: (value: Prisma8Transaction) => Promise<T>) =>
    operation(tx as unknown as Prisma8Transaction);
  const database = {
    readTransaction: transaction,
    writeTransaction: transaction,
    assertWritable: () => undefined,
  } as unknown as Prisma8Service;
  return {
    service: new Prisma8RuntimeAuthSessionService(database),
    sessions,
    disable: () => {
      status = "disabled";
    },
  };
}

function makeGrantStore(
  read: (scope: {
    tenantId: string;
    subjectId: string;
    projectId: string;
  }) => Promise<readonly { readonly permission: string }[]>,
): AuthorizationReadStore {
  return {
    findActiveExternalIdentity: () => Promise.resolve(null),
    readProjectGrants: (actor, projectId) =>
      read({
        tenantId: actor.tenantId,
        subjectId: actor.subjectId,
        projectId,
      }),
  };
}

function context(
  request: ScadaAuthenticatedRequest,
  action?: "project:read" | "version:read" | "version:append",
  responseHeaders = new Map<string, string>(),
): ExecutionContext {
  const handler = () => undefined;
  if (action) Reflect.defineMetadata(SCADA_PROJECT_PERMISSION, action, handler);
  return {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => class TestRoute {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader(name: string, value: string) {
          responseHeaders.set(name.toLowerCase(), value);
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe("可信会话与工程 Guard", () => {
  it("签发高熵会话时只将摘要保存到数据库", async () => {
    const fake = makeSessionService();
    const issued = await fake.service.issueForVerifiedSubject(principal);
    expect(issued.token).toMatch(/^scada_s_[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const hash = createHash("sha256").update(issued.token).digest("hex");
    expect(fake.sessions.get(hash)?.tokenHash).toBe(hash);
    expect(fake.sessions.get(issued.token)).toBeUndefined();
    expect(await fake.service.authenticate(issued.token)).toEqual(principal);
  });

  it("新会话只保存 CSRF 摘要，旧 Bearer 会话不能升级为 Cookie 会话", async () => {
    const fake = makeSessionService();
    const issued = await fake.service.issueForVerifiedSubject(principal);
    const tokenHash = createHash("sha256").update(issued.token).digest("hex");
    const csrfHash = createHash("sha256").update(issued.csrfToken).digest("hex");
    const stored = fake.sessions.get(tokenHash);

    expect(issued.csrfToken).toMatch(/^scada_csrf_[A-Za-z0-9_-]{43}$/);
    expect(stored?.csrfTokenHash).toBe(csrfHash);
    expect(stored?.csrfTokenHash).not.toBe(issued.csrfToken);
    expect(await fake.service.authenticateCookieSession(issued.token)).toEqual({
      authenticated: true,
      sessionId: issued.sessionId,
      principal,
    });
    expect(await fake.service.authenticateCookieSession(issued.token, issued.csrfToken)).toEqual({
      authenticated: true,
      sessionId: issued.sessionId,
      principal,
    });
    expect(
      await fake.service.authenticateCookieSession(issued.token, "scada_csrf_" + "x".repeat(43)),
    ).toEqual({ authenticated: false, reason: "csrf_rejected" });

    if (!stored) throw new Error("测试会话不存在");
    stored.csrfTokenHash = null;
    expect(await fake.service.authenticateCookieSession(issued.token)).toEqual({
      authenticated: false,
      reason: "invalid_session",
    });
    expect(await fake.service.authenticate(issued.token)).toEqual(principal);
  });

  it("不存在的主体、无效主体和禁用主体均不能签发会话", async () => {
    const fake = makeSessionService();
    await expect(
      fake.service.issueForVerifiedSubject({ tenantId: "tenant-b", subjectId: "engineer-1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      fake.service.issueForVerifiedSubject({ tenantId: "../x", subjectId: "engineer-1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      fake.service.issueForVerifiedSubject({ ...principal, subjectId: "engineer-2" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    fake.disable();
    await expect(fake.service.issueForVerifiedSubject(principal)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(fake.sessions.size).toBe(0);
  });

  it("被撤销的会话即时失效且不能被别的租户撤销", async () => {
    const fake = makeSessionService();
    const issued = await fake.service.issueForVerifiedSubject(principal);
    expect(
      await fake.service.revokeForVerifiedSubject(
        { tenantId: "tenant-b", subjectId: principal.subjectId },
        issued.sessionId,
      ),
    ).toBe(false);
    expect(await fake.service.authenticate(issued.token)).toEqual(principal);
    expect(await fake.service.revokeForVerifiedSubject(principal, issued.sessionId)).toBe(true);
    expect(await fake.service.authenticate(issued.token)).toBeNull();
    expect(await fake.service.revokeForVerifiedSubject(principal, issued.sessionId)).toBe(false);
  });

  it("到期令牌和停用主体不能通过服务端验证", async () => {
    const fake = makeSessionService();
    const issued = await fake.service.issueForVerifiedSubject(principal);
    fake.disable();
    expect(await fake.service.authenticate(issued.token)).toBeNull();

    const second = makeSessionService();
    const token = await second.service.issueForVerifiedSubject(principal);
    const hash = createHash("sha256").update(token.token).digest("hex");
    second.sessions.get(hash)!.expiresAt = new Date(Date.now() - 1000);
    expect(await second.service.authenticate(token.token)).toBeNull();
  });

  it("伪造、空值或错误格式的令牌不执行数据库查询", async () => {
    const fake = makeSessionService();
    for (const candidate of [null, undefined, 12, "", "fake", "scada_s_incomplete"]) {
      expect(await fake.service.authenticate(candidate)).toBeNull();
    }
    expect(fake.sessions.size).toBe(0);
  });

  it("会话 Guard 拒绝缺失、重复或伪造的 Bearer 请求头", async () => {
    const fake = makeSessionService();
    const guard = new ScadaSessionGuard(fake.service, makeAuditRecorder().audit, makeOidcConfig());
    for (const header of [undefined, ["Bearer fake"], "Basic fake", "Bearer fake"]) {
      const responseHeaders = new Map<string, string>();
      await expect(
        guard.canActivate(
          context({ headers: { authorization: header } }, undefined, responseHeaders),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(responseHeaders.get("cache-control")).toBe("no-store");
      expect(responseHeaders.get("pragma")).toBe("no-cache");
    }
  });

  it("会话 Guard 将数据库验证后的租户和主体写入请求上下文", async () => {
    const fake = makeSessionService();
    const issued = await fake.service.issueForVerifiedSubject(principal);
    const guard = new ScadaSessionGuard(fake.service, makeAuditRecorder().audit, makeOidcConfig());
    const request: ScadaAuthenticatedRequest = {
      headers: { authorization: `Bearer ${issued.token}` },
    };
    const responseHeaders = new Map<string, string>();
    expect(await guard.canActivate(context(request, undefined, responseHeaders))).toBe(true);
    expect(request.scadaPrincipal).toEqual(principal);
    expect(responseHeaders.get("cache-control")).toBe("no-store");
    expect(responseHeaders.get("pragma")).toBe("no-cache");
  });

  it("工程 Guard 缺少权限元数据时默认拒绝", async () => {
    const db = { client: { scadaProjectGrant: { findMany: async () => [] } } };
    const guard = new ScadaProjectGuard(
      makeGrantStore(db.client.scadaProjectGrant.findMany),
      new Reflector(),
      makeAuditRecorder().audit,
    );
    await expect(
      guard.canActivate(
        context({ headers: {}, params: { projectId: "project-a" }, scadaPrincipal: principal }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("工程 Guard 拒绝无身份、跨租户路径和无对应工程权限", async () => {
    let queries = 0;
    const db = {
      client: {
        scadaProjectGrant: {
          findMany: async () => {
            queries += 1;
            return [{ permission: "version:read" }];
          },
        },
      },
    };
    const guard = new ScadaProjectGuard(
      makeGrantStore(db.client.scadaProjectGrant.findMany),
      new Reflector(),
      makeAuditRecorder().audit,
    );
    await expect(
      guard.canActivate(
        context({ headers: {}, params: { projectId: "project-a" } }, "version:read"),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(
        context(
          {
            headers: {},
            params: {
              tenantId: "tenant-b",
              projectId: "project-a",
            },
            scadaPrincipal: principal,
          },
          "version:read",
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queries).toBe(0);
  });

  it("工程 Guard 仅授予当前租户、主体、工程匹配的精确操作", async () => {
    const seen: unknown[] = [];
    const db = {
      client: {
        scadaProjectGrant: {
          findMany: async (query: unknown) => {
            seen.push(query);
            return [{ permission: "version:read" }];
          },
        },
      },
    };
    const guard = new ScadaProjectGuard(
      makeGrantStore(db.client.scadaProjectGrant.findMany),
      new Reflector(),
      makeAuditRecorder().audit,
    );
    const request: ScadaAuthenticatedRequest = {
      headers: {},
      params: { projectId: "project-a" },
      scadaPrincipal: principal,
    };
    expect(await guard.canActivate(context(request, "version:read"))).toBe(true);
    await expect(guard.canActivate(context(request, "version:append"))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(seen[0]).toEqual({
      tenantId: principal.tenantId,
      projectId: "project-a",
      subjectId: principal.subjectId,
    });
  });

  it("工程 Guard 查询故障返回固定服务不可用提示且不记录授权成功", async () => {
    const { audit, records } = makeAuditRecorder();
    const db = {
      client: {
        scadaProjectGrant: {
          findMany: () => Promise.reject(new Error("不得泄漏的数据库异常")),
        },
      },
    };
    const guard = new ScadaProjectGuard(
      makeGrantStore(db.client.scadaProjectGrant.findMany),
      new Reflector(),
      audit,
    );
    await expect(
      guard.canActivate(
        context(
          { headers: {}, params: { projectId: "project-a" }, scadaPrincipal: principal },
          "version:read",
        ),
      ),
    ).rejects.toThrow("工程权限查询暂不可用，请稍后重试");
    expect(records).toEqual([]);
  });

  it("会话 Guard 只发送固定审计原因码，不记录伪造凭据和有效令牌", async () => {
    const fake = makeSessionService();
    const { audit, records } = makeAuditRecorder();
    const guard = new ScadaSessionGuard(fake.service, audit, makeOidcConfig());
    const fakeHeader = "Bearer 此处为恶意令牌";
    await expect(
      guard.canActivate(context({ headers: { authorization: fakeHeader } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(records).toEqual([
      { action: "session.authenticate", outcome: "denied", reason: "malformed_authorization" },
    ]);

    const issued = await fake.service.issueForVerifiedSubject(principal);
    const request: ScadaAuthenticatedRequest = {
      headers: { authorization: `Bearer ${issued.token}` },
    };
    expect(await guard.canActivate(context(request))).toBe(true);
    expect(records[1]).toEqual({
      action: "session.authenticate",
      outcome: "allowed",
      reason: "verified",
    });
    expect(await fake.service.revokeForVerifiedSubject(principal, issued.sessionId)).toBe(true);
    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(records[2]).toEqual({
      action: "session.authenticate",
      outcome: "denied",
      reason: "invalid_session",
    });
    const output = JSON.stringify(records);
    expect(output).not.toContain(issued.token);
    expect(output).not.toContain(fakeHeader);
    expect(output).not.toContain(principal.subjectId);
  });

  it("工程 Guard 记录缺失权限与拒绝原因，不记录工程路径和主体标识", async () => {
    const { audit, records } = makeAuditRecorder();
    const db = {
      client: {
        scadaProjectGrant: {
          findMany: async () => [{ permission: "version:read" }],
        },
      },
    };
    const guard = new ScadaProjectGuard(
      makeGrantStore(db.client.scadaProjectGrant.findMany),
      new Reflector(),
      audit,
    );
    const request: ScadaAuthenticatedRequest = {
      headers: { authorization: "Bearer 不应写入日志" },
      params: { projectId: "project-private" },
      scadaPrincipal: principal,
    };
    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(NotFoundException);
    await expect(guard.canActivate(context(request, "version:append"))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await guard.canActivate(context(request, "version:read"))).toBe(true);
    const crossTenantRequest: ScadaAuthenticatedRequest = {
      ...request,
      params: { projectId: "project-private", tenantId: "tenant-other" },
    };
    await expect(
      guard.canActivate(context(crossTenantRequest, "version:read")),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(records).toEqual([
      { action: "project.authorize", outcome: "denied", reason: "missing_policy" },
      { action: "project.authorize", outcome: "denied", reason: "permission_denied" },
      { action: "project.authorize", outcome: "allowed", reason: "permission_granted" },
      { action: "project.authorize", outcome: "denied", reason: "invalid_scope" },
    ]);
    const output = JSON.stringify(records);
    expect(output).not.toContain("project-private");
    expect(output).not.toContain(principal.tenantId);
    expect(output).not.toContain(principal.subjectId);
    expect(output).not.toContain("Bearer");
  });
});
