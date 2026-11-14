import { Inject, Injectable } from "@nestjs/common";
import * as oidc from "openid-client";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";

export const SCADA_OIDC_STARTUP_CONFIG = Symbol("SCADA_OIDC_STARTUP_CONFIG");

const DISCOVERY_TIMEOUT_SECONDS = 10;
const DISCOVERY_FAILURE_MESSAGE = "OIDC 身份提供方发现失败或元数据不符合安全要求";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

type DiscoveredMetadata = ReturnType<oidc.Configuration["serverMetadata"]>;

/** 只允许 HTTPS；本机 HTTP 测试必须由启动配置显式放行。 */
function assertAllowedOidcUrl(value: unknown, allowInsecureLoopback: boolean): URL {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error("OIDC 元数据端点格式无效");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OIDC 元数据端点格式无效");
  }

  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  const allowedProtocol =
    url.protocol === "https:" || (allowInsecureLoopback && loopback && url.protocol === "http:");

  if (!allowedProtocol || url.username || url.password || url.hash) {
    throw new Error("OIDC 元数据端点必须使用可信 HTTPS 地址");
  }

  return url;
}

/** 只接受本批 Authorization Code + PKCE S256 所需的最小 OIDC 能力。 */
function validateDiscoveredMetadata(
  metadata: DiscoveredMetadata,
  expectedIssuer: URL,
  allowInsecureLoopback: boolean,
): void {
  if (metadata.issuer !== expectedIssuer.href) {
    throw new Error("OIDC 元数据 Issuer 与固定配置不一致");
  }
  if (!metadata.response_types_supported?.includes("code")) {
    throw new Error("OIDC 身份提供方不支持授权码响应");
  }
  if (
    !metadata.subject_types_supported?.some((value) => value === "public" || value === "pairwise")
  ) {
    throw new Error("OIDC 身份提供方未声明受支持的主体标识类型");
  }
  if (!metadata.id_token_signing_alg_values_supported?.includes("RS256")) {
    throw new Error("OIDC 身份提供方不支持 RS256 ID Token 签名");
  }
  if (!metadata.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("OIDC 身份提供方不支持 PKCE S256");
  }

  // 未声明时按 OIDC Discovery 默认的 client_secret_basic 处理。
  if (
    metadata.token_endpoint_auth_methods_supported !== undefined &&
    !metadata.token_endpoint_auth_methods_supported.includes("client_secret_basic")
  ) {
    throw new Error("OIDC 身份提供方不支持 client_secret_basic");
  }
  if (
    metadata.grant_types_supported !== undefined &&
    !metadata.grant_types_supported.includes("authorization_code")
  ) {
    throw new Error("OIDC 身份提供方不支持授权码许可");
  }
  if (metadata.scopes_supported !== undefined && !metadata.scopes_supported.includes("openid")) {
    throw new Error("OIDC 身份提供方未声明 openid 范围");
  }

  assertAllowedOidcUrl(metadata.authorization_endpoint, allowInsecureLoopback);
  assertAllowedOidcUrl(metadata.token_endpoint, allowInsecureLoopback);
  assertAllowedOidcUrl(metadata.jwks_uri, allowInsecureLoopback);
}

/**
 * 固定 Issuer 的 OIDC Discovery。
 * 首次调用时才访问身份提供方；并发调用共享同一发现任务，失败后允许重试。
 */
@Injectable()
export class OidcProviderDiscoveryService {
  private discoveryPromise: Promise<oidc.Configuration> | undefined;

  constructor(
    @Inject(SCADA_OIDC_STARTUP_CONFIG)
    private readonly startupConfig: EnabledOidcConfig,
  ) {}

  getConfiguration(): Promise<oidc.Configuration> {
    if (this.discoveryPromise) return this.discoveryPromise;

    const pending = this.discover();
    this.discoveryPromise = pending;
    void pending.catch(() => {
      if (this.discoveryPromise === pending) this.discoveryPromise = undefined;
    });
    return pending;
  }

  private async discover(): Promise<oidc.Configuration> {
    try {
      const allowInsecureLoopback = this.startupConfig.issuer.protocol === "http:";
      const secureFetch: oidc.CustomFetch = async (url, options) => {
        assertAllowedOidcUrl(url, allowInsecureLoopback);
        // openid-client 使用 redirect: manual；不允许 Fetch 自动跟随端点重定向。
        return globalThis.fetch(url, options as RequestInit);
      };

      const configuration = await oidc.discovery(
        this.startupConfig.issuer,
        this.startupConfig.clientId,
        { id_token_signed_response_alg: "RS256" },
        oidc.ClientSecretBasic(this.startupConfig.clientSecret),
        {
          [oidc.customFetch]: secureFetch,
          timeout: DISCOVERY_TIMEOUT_SECONDS,
          ...(allowInsecureLoopback ? { execute: [oidc.allowInsecureRequests] } : {}),
        },
      );

      validateDiscoveredMetadata(
        configuration.serverMetadata(),
        this.startupConfig.issuer,
        allowInsecureLoopback,
      );
      return configuration;
    } catch {
      // 不向启动日志或 HTTP 响应传播 Issuer、端点、响应体或底层异常。
      throw new Error(DISCOVERY_FAILURE_MESSAGE);
    }
  }
}
