import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { CustomFetch } from "openid-client";
import { resolveOidcStartupConfig } from "../config/oidc-startup.config.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import { OidcProviderDiscoveryService } from "./oidc-provider-discovery.service.js";

const DISCOVERY_FAILURE_MESSAGE = "OIDC 身份提供方发现失败或元数据不符合安全要求";

interface TestMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported?: string[];
  grant_types_supported?: string[];
  scopes_supported?: string[];
}

function createConfig(overrides: Readonly<Record<string, string>> = {}): EnabledOidcConfig {
  const result = resolveOidcStartupConfig({
    NODE_ENV: "test",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ISSUER: "https://id.example.org/realms/scada",
    SCADA_OIDC_CLIENT_ID: "adui-scada",
    SCADA_OIDC_CLIENT_SECRET: "discovery-test-client-secret",
    SCADA_OIDC_REDIRECT_URI: "https://scada.example.org/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: "https://scada.example.org",
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    ...overrides,
  });
  if (!result.enabled) throw new Error("测试 OIDC 配置未启用");
  return result;
}

function createMetadata(issuer: string, overrides: Partial<TestMetadata> = {}): TestMetadata {
  return {
    issuer,
    authorization_endpoint: "https://id.example.org/realms/scada/authorize",
    token_endpoint: "https://id.example.org/realms/scada/token",
    jwks_uri: "https://id.example.org/realms/scada/jwks",
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    grant_types_supported: ["authorization_code"],
    scopes_supported: ["openid", "profile"],
    ...overrides,
  };
}

function createResponse(metadata: unknown): Response {
  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubDiscoveryFetch(metadata: unknown) {
  const requests: Array<{ readonly url: string; readonly redirect: string }> = [];
  const fetchMock = vi.fn<CustomFetch>(async (url, options) => {
    requests.push({ url, redirect: options.redirect });
    return createResponse(metadata);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OIDC 固定 Issuer Discovery", () => {
  it("按固定 Issuer 获取元数据并复用同一个客户端配置", async () => {
    const startupConfig = createConfig();
    const { fetchMock, requests } = stubDiscoveryFetch(createMetadata(startupConfig.issuer.href));
    const service = new OidcProviderDiscoveryService(startupConfig);

    const [first, second] = await Promise.all([
      service.getConfiguration(),
      service.getConfiguration(),
    ]);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requests[0]?.url).toBe(
      "https://id.example.org/realms/scada/.well-known/openid-configuration",
    );
    expect(requests[0]?.redirect).toBe("manual");
    expect(first.serverMetadata().issuer).toBe(startupConfig.issuer.href);
    expect(first.clientMetadata().id_token_signed_response_alg).toBe("RS256");
  });

  it("拒绝发现文档返回的 Issuer 与固定配置不一致", async () => {
    const startupConfig = createConfig();
    stubDiscoveryFetch(createMetadata("https://attacker.example.org"));
    const service = new OidcProviderDiscoveryService(startupConfig);

    await expect(service.getConfiguration()).rejects.toThrow(DISCOVERY_FAILURE_MESSAGE);
  });

  it("拒绝不满足授权码、PKCE、签名算法和主体标识要求的元数据", async () => {
    const startupConfig = createConfig();
    const invalidMetadata = [
      createMetadata(startupConfig.issuer.href, { response_types_supported: ["id_token"] }),
      createMetadata(startupConfig.issuer.href, { code_challenge_methods_supported: ["plain"] }),
      createMetadata(startupConfig.issuer.href, {
        id_token_signing_alg_values_supported: ["ES256"],
      }),
      createMetadata(startupConfig.issuer.href, { subject_types_supported: ["unsupported"] }),
      createMetadata(startupConfig.issuer.href, {
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      }),
      createMetadata(startupConfig.issuer.href, {
        token_endpoint: "https://client:secret@id.example.org/realms/scada/token",
      }),
      createMetadata(startupConfig.issuer.href, { grant_types_supported: ["client_credentials"] }),
      createMetadata(startupConfig.issuer.href, { scopes_supported: ["profile"] }),
    ];

    for (const metadata of invalidMetadata) {
      vi.stubGlobal(
        "fetch",
        vi.fn<CustomFetch>(async () => createResponse(metadata)),
      );
      const service = new OidcProviderDiscoveryService(startupConfig);
      await expect(service.getConfiguration()).rejects.toThrow(DISCOVERY_FAILURE_MESSAGE);
      vi.unstubAllGlobals();
    }
  });

  it("拒绝非 HTTPS 或包含凭据的元数据端点", async () => {
    const startupConfig = createConfig();
    const metadata = createMetadata(startupConfig.issuer.href, {
      authorization_endpoint: "http://id.example.org/authorize",
    });
    stubDiscoveryFetch(metadata);
    const service = new OidcProviderDiscoveryService(startupConfig);

    await expect(service.getConfiguration()).rejects.toThrow(DISCOVERY_FAILURE_MESSAGE);
  });

  it("仅在显式本机测试模式下允许回环 HTTP 端点", async () => {
    const startupConfig = createConfig({
      NODE_ENV: "development",
      SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "true",
      SCADA_OIDC_ISSUER: "http://127.0.0.1:18089",
      SCADA_OIDC_REDIRECT_URI: "http://127.0.0.1:13001/api/v1/auth/oidc/callback",
      SCADA_OIDC_WEB_ORIGINS: "http://127.0.0.1:15173",
    });
    const metadata = createMetadata(startupConfig.issuer.href, {
      authorization_endpoint: "http://127.0.0.1:18089/authorize",
      token_endpoint: "http://127.0.0.1:18089/token",
      jwks_uri: "http://127.0.0.1:18089/jwks",
    });
    const { requests } = stubDiscoveryFetch(metadata);
    const service = new OidcProviderDiscoveryService(startupConfig);

    await expect(service.getConfiguration()).resolves.toBeDefined();
    expect(requests[0]?.url).toBe("http://127.0.0.1:18089/.well-known/openid-configuration");
  });

  it("本机 HTTP 测试模式仍拒绝非回环 HTTP 元数据端点", async () => {
    const startupConfig = createConfig({
      NODE_ENV: "development",
      SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "true",
      SCADA_OIDC_ISSUER: "http://127.0.0.1:18089",
      SCADA_OIDC_REDIRECT_URI: "http://127.0.0.1:13001/api/v1/auth/oidc/callback",
      SCADA_OIDC_WEB_ORIGINS: "http://127.0.0.1:15173",
    });
    const metadata = createMetadata(startupConfig.issuer.href, {
      authorization_endpoint: "http://id.example.org/authorize",
    });
    stubDiscoveryFetch(metadata);
    const service = new OidcProviderDiscoveryService(startupConfig);

    await expect(service.getConfiguration()).rejects.toThrow(DISCOVERY_FAILURE_MESSAGE);
  });

  it("发现失败不泄漏底层错误并允许后续重试", async () => {
    const startupConfig = createConfig();
    const metadata = createMetadata(startupConfig.issuer.href);
    const fetchMock = vi
      .fn<CustomFetch>()
      .mockRejectedValueOnce(new Error("不得泄漏的网络异常和秘密"))
      .mockResolvedValueOnce(createResponse(metadata));
    vi.stubGlobal("fetch", fetchMock);
    const service = new OidcProviderDiscoveryService(startupConfig);

    await expect(service.getConfiguration()).rejects.toThrow(DISCOVERY_FAILURE_MESSAGE);
    await expect(service.getConfiguration()).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
