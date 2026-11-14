import { Buffer } from "node:buffer";
import { z } from "zod";

const booleanFlag = z.enum(["true", "false"]);
const secretKeyPattern = /^[A-Za-z0-9_-]{43}$/;
const clientIdPattern = /^[^\r\n\u0000-\u001f]{1,256}$/;
const CALLBACK_PATH = "/api/v1/auth/oidc/callback";

export interface DisabledOidcConfig {
  readonly enabled: false;
}

export interface EnabledOidcConfig {
  readonly enabled: true;
  readonly issuer: URL;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: URL;
  readonly webOrigins: readonly string[];
  readonly transactionEncryptionKey: Uint8Array<ArrayBuffer>;
}

export type OidcStartupConfig = DisabledOidcConfig | EnabledOidcConfig;

function parseFlag(raw: string | undefined, name: string): boolean {
  const parsed = booleanFlag.safeParse(raw ?? "false");
  if (!parsed.success) throw new Error(name + " 只能设置为 true 或 false");
  return parsed.data === "true";
}

function requiredString(raw: string | undefined, name: string, maximum = 2048): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > maximum || raw.trim() !== raw) {
    throw new Error(name + " 未设置或格式无效");
  }
  if (/[\r\n\u0000-\u001f]/.test(raw)) throw new Error(name + " 包含非法字符");
  return raw;
}

function parseSecureUrl(raw: string | undefined, name: string, allowLoopbackHttp: boolean): URL {
  const value = requiredString(raw, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(name + " 必须是有效的绝对 URL");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== "https:" && !(allowLoopbackHttp && loopback && url.protocol === "http:"))
  ) {
    throw new Error(name + " 必须使用可信 HTTPS 地址或明确允许的本机测试 HTTP 地址");
  }
  return url;
}

/**
 * 只校验服务端白名单环境变量；错误消息不得包含任何秘密、Issuer 或回调原始值。
 * OIDC 默认关闭，未启用时不读取凭据、不连接数据库，也不进行网络发现。
 */
export function resolveOidcStartupConfig(
  env: Readonly<Record<string, string | undefined>>,
): OidcStartupConfig {
  if (!parseFlag(env.SCADA_OIDC_ENABLED, "SCADA_OIDC_ENABLED")) {
    return Object.freeze({ enabled: false });
  }

  const allowInsecureLoopback = parseFlag(
    env.SCADA_OIDC_ALLOW_INSECURE_LOOPBACK,
    "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK",
  );
  if (allowInsecureLoopback && env.NODE_ENV === "production") {
    throw new Error("生产环境禁止启用不安全的本机 HTTP OIDC 测试模式");
  }
  const allowHttp = allowInsecureLoopback && env.NODE_ENV !== "production";
  const issuer = parseSecureUrl(env.SCADA_OIDC_ISSUER, "SCADA_OIDC_ISSUER", allowHttp);
  const redirectUri = parseSecureUrl(
    env.SCADA_OIDC_REDIRECT_URI,
    "SCADA_OIDC_REDIRECT_URI",
    allowHttp,
  );
  if (redirectUri.pathname !== CALLBACK_PATH) {
    throw new Error("SCADA_OIDC_REDIRECT_URI 必须指向固定 OIDC 回调路径");
  }

  const clientId = requiredString(env.SCADA_OIDC_CLIENT_ID, "SCADA_OIDC_CLIENT_ID", 256);
  if (!clientIdPattern.test(clientId)) {
    throw new Error("SCADA_OIDC_CLIENT_ID 格式无效");
  }
  const clientSecret = requiredString(env.SCADA_OIDC_CLIENT_SECRET, "SCADA_OIDC_CLIENT_SECRET");
  if (clientSecret.length < 16) {
    throw new Error("SCADA_OIDC_CLIENT_SECRET 长度不足");
  }

  const rawOrigins = requiredString(env.SCADA_OIDC_WEB_ORIGINS, "SCADA_OIDC_WEB_ORIGINS");
  const origins = rawOrigins.split(",");
  if (origins.length > 8) {
    throw new Error("SCADA_OIDC_WEB_ORIGINS 超出允许的站点数量");
  }
  const webOrigins = origins.map((entry) => {
    const origin = parseSecureUrl(entry, "SCADA_OIDC_WEB_ORIGINS", allowHttp);
    if (origin.href !== origin.origin + "/") {
      throw new Error("SCADA_OIDC_WEB_ORIGINS 必须只包含 Origin，不允许路径");
    }
    return origin.origin;
  });
  if (new Set(webOrigins).size !== webOrigins.length) {
    throw new Error("SCADA_OIDC_WEB_ORIGINS 不允许重复的站点");
  }

  const encoded = requiredString(
    env.SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY,
    "SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY",
    43,
  );
  if (!secretKeyPattern.test(encoded)) {
    throw new Error("SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY 必须是 32 字节 Base64URL 密钥");
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded) {
    throw new Error("SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY 必须是 32 字节 Base64URL 密钥");
  }

  return {
    enabled: true,
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    webOrigins: Object.freeze(webOrigins),
    transactionEncryptionKey: Uint8Array.from(key),
  };
}
