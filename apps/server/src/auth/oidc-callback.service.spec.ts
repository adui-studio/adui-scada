import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import * as oidc from "openid-client";
import {
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { resolveOidcStartupConfig } from "../config/oidc-startup.config.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { AuthSessionService, IssuedAuthSession } from "./auth-session.service.js";
import type {
  ConsumedOidcLoginTransaction,
  OidcLoginTransactionService,
} from "./oidc-login-transaction.service.js";
import type { OidcProviderDiscoveryService } from "./oidc-provider-discovery.service.js";
import {
  OidcCallbackService,
  type OidcAuthorizationCodeGrant,
} from "./oidc-callback.service.js";

const VALID_STATE = "s".repeat(43);
const VALID_BROWSER_BINDING = "scada_oidc_b_" + "b".repeat(43);
const VALID_NONCE = "n".repeat(43);
const VALID_VERIFIER = "v".repeat(43);
const ACCESS_TOKEN = "不得持久化的 IdP Access Token";
const REFRESH_TOKEN = "不得持久化的 IdP Refresh Token";
const ID_TOKEN = "不得持久化的 IdP ID Token";

interface ExternalIdentityResult {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly identity: { readonly status: string };
}

interface ExternalIdentityQuery {
  readonly where: {
    readonly issuer_subject: {
      readonly issuer: string;
      readonly subject: string;
    };
  };
  readonly select: {
    readonly tenantId: true;
    readonly subjectId: true;
    readonly identity: { readonly select: { readonly status: true } };
  };
}

interface GrantCall {
  readonly callbackUrl: URL;
  readonly checks: {
    readonly expectedState?: string;
    readonly expectedNonce?: string;
    readonly pkceCodeVerifier?: string;
    readonly idTokenExpected?: boolean;
  };
}

function createConfig(): EnabledOidcConfig {
  const result = resolveOidcStartupConfig({
    NODE_ENV: "test",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ISSUER: "https://id.example.org/realms/scada",
    SCADA_OIDC_CLIENT_ID: "adui-scada",
    SCADA_OIDC_CLIENT_SECRET: "oidc-callback-test-client-secret",
    SCADA_OIDC_REDIRECT_URI: "https://scada.example.org/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: "https://scada.example.org",
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  });
  if (!result.enabled) throw new Error("测试 OIDC 配置未启用");
  return result;
}

function createConfiguration(config: EnabledOidcConfig): oidc.Configuration {
  return new oidc.Configuration(
    {
      issuer: config.issuer.href,
      authorization_endpoint: "https://id.example.org/realms/scada/authorize",
      token_endpoint: "https://id.example.org/realms/scada/token",
      jwks_uri: "https://id.example.org/realms/scada/jwks",
      authorization_response_iss_parameter_supported: true,
    },
    config.clientId,
    {
      client_secret: config.clientSecret,
      id_token_signed_response_alg: "RS256",
    },
    oidc.ClientSecretBasic(config.clientSecret),
  );
}

function createClaims(
  config: EnabledOidcConfig,
  overrides: Partial<oidc.IDToken> = {},
): oidc.IDToken {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: config.issuer.href,
    sub: "external-engineer-1",
    aud: config.clientId,
    exp: now + 300,
    iat: now,
    nonce: VALID_NONCE,
    azp: config.clientId,
    ...overrides,
  };
}

function createTokenResponse(
  claims: oidc.IDToken | undefined,
): Awaited<ReturnType<OidcAuthorizationCodeGrant>> {
  return {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    id_token: ID_TOKEN,
    token_type: "bearer",
    claims: () => claims,
    expiresIn: () => 300,
  } as unknown as Awaited<ReturnType<OidcAuthorizationCodeGrant>>;
}

function createHarness() {
  const config = createConfig();
  const configuration = createConfiguration(config);
  const transaction: ConsumedOidcLoginTransaction = {
    issuer: config.issuer.href,
    nonce: VALID_NONCE,
    codeVerifier: VALID_VERIFIER,
    returnPath: "/studio/projects",
  };
  const transactionCalls: Array<{ readonly state: unknown; readonly binding: unknown }> = [];
  const grantCalls: GrantCall[] = [];
  const identityQueries: ExternalIdentityQuery[] = [];
  const issuedPrincipals: Array<{ readonly tenantId: string; readonly subjectId: string }> = [];
  let identity: ExternalIdentityResult | null = {
    tenantId: "tenant-a",
    subjectId: "engineer-1",
    identity: { status: "active" },
  };
  let claims: oidc.IDToken | undefined = createClaims(config);
  let transactionAvailable = true;
  let providerFailure = false;
  let identityQueryFailure = false;
  let sessionFailure: "none" | "forbidden" | "database" = "none";
  let grantFailure = false;

  const transactions = {
    consume: async (state: unknown, binding: unknown) => {
      transactionCalls.push({ state, binding });
      return transactionAvailable &&
        state === VALID_STATE &&
        binding === VALID_BROWSER_BINDING
        ? transaction
        : null;
    },
  };

  const discovery = {
    getConfiguration: async () => {
      if (providerFailure) throw new Error("不得泄漏的身份提供方异常");
      return configuration;
    },
  };

  const database = {
    client: {
      scadaExternalIdentity: {
        findUnique: async (query: ExternalIdentityQuery) => {
          identityQueries.push(query);
          if (identityQueryFailure) throw new Error("不得泄漏的数据库异常");
          return identity;
        },
      },
    },
  };

  const sessions = {
    issueForVerifiedSubject: async (principal: {
      readonly tenantId: string;
      readonly subjectId: string;
    }): Promise<IssuedAuthSession> => {
      if (sessionFailure === "forbidden") {
        throw new ForbiddenException("主体状态发生变化");
      }
      if (sessionFailure === "database") throw new Error("不得泄漏的会话数据库异常");
      issuedPrincipals.push(principal);
      return {
        sessionId: "9b0d8c2d-6d45-4f0f-8d5c-12e4a0d3a7a1",
        token: "scada_s_" + "t".repeat(43),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      };
    },
  };

  const grant: OidcAuthorizationCodeGrant = async (_configuration, currentUrl, checks) => {
    if (!(currentUrl instanceof URL)) throw new Error("回调地址类型无效");
    grantCalls.push({
      callbackUrl: currentUrl,
      checks: {
        expectedState: checks?.expectedState,
        expectedNonce: checks?.expectedNonce,
        pkceCodeVerifier: checks?.pkceCodeVerifier,
        idTokenExpected: checks?.idTokenExpected,
      },
    });
    if (grantFailure) throw new Error("不得泄漏的 Token Endpoint 异常");
    return createTokenResponse(claims);
  };

  const service = new OidcCallbackService(
    database as unknown as PrismaService,
    discovery as unknown as OidcProviderDiscoveryService,
    transactions as unknown as OidcLoginTransactionService,
    sessions as unknown as AuthSessionService,
    config,
    grant,
  );

  return {
    service,
    config,
    transactionCalls,
    grantCalls,
    identityQueries,
    issuedPrincipals,
    set identity(value: ExternalIdentityResult | null) {
      identity = value;
    },
    set claims(value: oidc.IDToken | undefined) {
      claims = value;
    },
    set transactionAvailable(value: boolean) {
      transactionAvailable = value;
    },
    set providerFailure(value: boolean) {
      providerFailure = value;
    },
    set identityQueryFailure(value: boolean) {
      identityQueryFailure = value;
    },
    set sessionFailure(value: "none" | "forbidden" | "database") {
      sessionFailure = value;
    },
    set grantFailure(value: boolean) {
      grantFailure = value;
    },
  };
}

function validResponse(overrides: Record<string, unknown> = {}) {
  return {
    state: VALID_STATE,
    code: "authorization-code-from-provider",
    issuer: "https://id.example.org/realms/scada",
    ...overrides,
  };
}

describe("OIDC 授权码回调与预绑定身份验证", () => {
  it("验证固定回调地址、State、Nonce 和 PKCE 后签发本地会话", async () => {
    const harness = createHarness();
    const result = await harness.service.complete(validResponse(), VALID_BROWSER_BINDING);

    expect(result.sessionId).toBe("9b0d8c2d-6d45-4f0f-8d5c-12e4a0d3a7a1");
    expect(result.sessionToken).toMatch(/^scada_s_[A-Za-z0-9_-]{43}$/);
    expect(result.returnPath).toBe("/studio/projects");
    expect(harness.transactionCalls).toEqual([
      { state: VALID_STATE, binding: VALID_BROWSER_BINDING },
    ]);
    expect(harness.grantCalls).toHaveLength(1);
    expect(harness.grantCalls[0]?.callbackUrl.href).toBe(
      "https://scada.example.org/api/v1/auth/oidc/callback?code=authorization-code-from-provider&state=" +
        VALID_STATE +
        "&iss=https%3A%2F%2Fid.example.org%2Frealms%2Fscada",
    );
    expect(harness.grantCalls[0]?.checks).toEqual({
      expectedState: VALID_STATE,
      expectedNonce: VALID_NONCE,
      pkceCodeVerifier: VALID_VERIFIER,
      idTokenExpected: true,
    });
    expect(harness.identityQueries).toEqual([
      {
        where: {
          issuer_subject: {
            issuer: harness.config.issuer.href,
            subject: "external-engineer-1",
          },
        },
        select: {
          tenantId: true,
          subjectId: true,
          identity: { select: { status: true } },
        },
      },
    ]);
    expect(harness.issuedPrincipals).toEqual([
      { tenantId: "tenant-a", subjectId: "engineer-1" },
    ]);
    const output = JSON.stringify(result);
    expect(output).not.toContain(ACCESS_TOKEN);
    expect(output).not.toContain(REFRESH_TOKEN);
    expect(output).not.toContain(ID_TOKEN);
  });

  it("拒绝无效 State 或浏览器绑定且不调用 Token Endpoint", async () => {
    const harness = createHarness();
    await expect(
      harness.service.complete(validResponse({ state: "伪造 State" }), VALID_BROWSER_BINDING),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.service.complete(validResponse(), "scada_oidc_b_" + "x".repeat(43)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.grantCalls).toHaveLength(0);
  });

  it("OAuth 错误响应先消费登录事务，不兑换授权码", async () => {
    const harness = createHarness();
    await expect(
      harness.service.complete(
        validResponse({ code: undefined, error: "access_denied" }),
        VALID_BROWSER_BINDING,
      ),
    ).rejects.toThrow("OIDC 登录验证失败，请重新发起登录");
    expect(harness.transactionCalls).toHaveLength(1);
    expect(harness.grantCalls).toHaveLength(0);
  });

  it("要求身份提供方声明支持时必须携带匹配的响应 Issuer", async () => {
    const harness = createHarness();
    await expect(
      harness.service.complete(validResponse({ issuer: undefined }), VALID_BROWSER_BINDING),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.service.complete(
        validResponse({ issuer: "https://attacker.example.org" }),
        VALID_BROWSER_BINDING,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.grantCalls).toHaveLength(0);
  });

  it("拒绝缺失、重复类型或包含控制字符的授权码", async () => {
    const harness = createHarness();
    await expect(
      harness.service.complete(validResponse({ code: undefined }), VALID_BROWSER_BINDING),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.service.complete(validResponse({ code: ["code-a", "code-b"] }), VALID_BROWSER_BINDING),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.service.complete(
        validResponse({ code: "authorization-code\nforged" }),
        VALID_BROWSER_BINDING,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.grantCalls).toHaveLength(0);
  });

  it("拒绝 Issuer、Nonce、Audience 或授权方不匹配的 ID Token", async () => {
    const harness = createHarness();
    const invalidClaims: Partial<oidc.IDToken>[] = [
      { iss: "https://attacker.example.org" },
      { nonce: "n".repeat(42) },
      { aud: "another-client" },
      { aud: [harness.config.clientId, "another-client"], azp: undefined },
      { aud: harness.config.clientId, azp: "another-client" },
      { sub: "" },
      { sub: "非 ASCII 主体" },
      { exp: Number.NaN },
      { iat: Number.POSITIVE_INFINITY },
      { iat: Math.floor(Date.now() / 1000) + 120 },
    ];

    for (const overrides of invalidClaims) {
      const current = createHarness();
      current.claims = createClaims(current.config, overrides);
      await expect(
        current.service.complete(validResponse(), VALID_BROWSER_BINDING),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(current.issuedPrincipals).toHaveLength(0);
    }
  });

  it("拒绝没有 ID Token 的授权响应", async () => {
    const harness = createHarness();
    harness.claims = undefined;
    await expect(
      harness.service.complete(validResponse(), VALID_BROWSER_BINDING),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.issuedPrincipals).toHaveLength(0);
  });

  it("拒绝没有预绑定或已停用的本地身份，不自动创建主体", async () => {
    const missing = createHarness();
    missing.identity = null;
    await expect(
      missing.service.complete(validResponse(), VALID_BROWSER_BINDING),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(missing.issuedPrincipals).toHaveLength(0);

    const disabled = createHarness();
    disabled.identity = {
      tenantId: "tenant-a",
      subjectId: "engineer-1",
      identity: { status: "disabled" },
    };
    await expect(
      disabled.service.complete(validResponse(), VALID_BROWSER_BINDING),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(disabled.issuedPrincipals).toHaveLength(0);
  });

  it("拒绝 IdP 兑换失败且不泄漏 Token Endpoint 异常", async () => {
    const harness = createHarness();
    harness.grantFailure = true;
    await expect(
      harness.service.complete(validResponse(), VALID_BROWSER_BINDING),
    ).rejects.toThrow("OIDC 登录验证失败，请重新发起登录");
  });

  it("Discovery 或身份映射数据库不可用时返回固定中文错误", async () => {
    const provider = createHarness();
    provider.providerFailure = true;
    await expect(
      provider.service.complete(validResponse(), VALID_BROWSER_BINDING),
    ).rejects.toThrow("OIDC 身份提供方暂时不可用，请稍后重试");

    const database = createHarness();
    database.identityQueryFailure = true;
    await expect(
      database.service.complete(validResponse(), VALID_BROWSER_BINDING),
    ).rejects.toThrow("本地身份映射暂时不可用，请稍后重试");
  });

  it("本地身份在会话签发时停用则拒绝登录", async () => {
    const harness = createHarness();
    harness.sessionFailure = "forbidden";
    await expect(
      harness.service.complete(validResponse(), VALID_BROWSER_BINDING),
    ).rejects.toThrow("OIDC 登录验证失败，请重新发起登录");
  });

  it("本地会话数据库不可用时不泄漏底层异常", async () => {
    const harness = createHarness();
    harness.sessionFailure = "database";
    await expect(
      harness.service.complete(validResponse(), VALID_BROWSER_BINDING),
    ).rejects.toThrow("本地会话创建失败，请稍后重试");
  });
});
