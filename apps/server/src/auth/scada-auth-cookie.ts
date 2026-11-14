export const SCADA_SESSION_COOKIE_NAME = "__Host-adui-scada-session";
export const SCADA_CSRF_COOKIE_NAME = "__Host-adui-scada-csrf";
export const SCADA_OIDC_BROWSER_COOKIE_NAME = "__Host-adui-scada-oidc-browser";

const SESSION_TOKEN_PATTERN = /^scada_s_[A-Za-z0-9_-]{43}$/;
const CSRF_TOKEN_PATTERN = /^scada_csrf_[A-Za-z0-9_-]{43}$/;
const OIDC_BROWSER_BINDING_PATTERN = /^scada_oidc_b_[A-Za-z0-9_-]{43}$/;
const COOKIE_EPOCH = "Thu, 01 Jan 1970 00:00:00 GMT";
const MAX_COOKIE_HEADER_LENGTH = 4096;

export interface ScadaSessionCookiePayload {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
}

/** 读取单个 Cookie；重复名称、重复请求头或格式异常均按缺失处理。 */
export function readScadaCookieValue(
  header: string | string[] | undefined,
  cookieName: string,
): string | undefined {
  if (
    typeof header !== "string" ||
    header.length > MAX_COOKIE_HEADER_LENGTH ||
    cookieName.length === 0 ||
    cookieName.includes("=") ||
    cookieName.includes(";")
  ) {
    return undefined;
  }

  let found = false;
  let value: string | undefined;
  for (const rawPart of header.split(";")) {
    const part = rawPart.trim();
    if (part.length === 0) continue;
    const separator = part.indexOf("=");
    if (separator <= 0) return undefined;

    const name = part.slice(0, separator).trim();
    if (name !== cookieName) continue;
    if (found) return undefined;

    found = true;
    value = part.slice(separator + 1).trim();
    if (!value || value.length > 256) return undefined;
  }

  return value;
}

/**
 * 构造 OIDC 登录浏览器绑定 Cookie。
 * 绑定 Cookie 需在 IdP 顶层 GET 回调时发送，因此使用 SameSite=Lax。
 */
export function createScadaOidcBrowserBindingCookieHeader(
  value: string,
  expiresAt: Date,
): string {
  if (
    !OIDC_BROWSER_BINDING_PATTERN.test(value) ||
    !(expiresAt instanceof Date) ||
    !Number.isFinite(expiresAt.getTime())
  ) {
    throw new Error("OIDC 浏览器绑定 Cookie 参数无效");
  }

  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (maxAge < 1 || maxAge > 300) {
    throw new Error("OIDC 浏览器绑定 Cookie 有效期超出允许范围");
  }

  return [
    `${SCADA_OIDC_BROWSER_COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    `Expires=${expiresAt.toUTCString()}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/**
 * 构造严格的 Host Cookie 响应头。
 * Session Cookie 为 HttpOnly；CSRF Cookie 刻意保持可读，以便前端写入请求头。
 */
export function createScadaSessionCookieHeaders(
  payload: ScadaSessionCookiePayload,
): readonly [string, string] {
  if (
    !SESSION_TOKEN_PATTERN.test(payload.sessionToken) ||
    !CSRF_TOKEN_PATTERN.test(payload.csrfToken) ||
    !(payload.expiresAt instanceof Date) ||
    !Number.isFinite(payload.expiresAt.getTime())
  ) {
    throw new Error("会话 Cookie 参数无效");
  }

  const maxAge = Math.floor((payload.expiresAt.getTime() - Date.now()) / 1000);
  if (maxAge < 1 || maxAge > 900) {
    throw new Error("会话 Cookie 有效期超出允许范围");
  }

  const expires = payload.expiresAt.toUTCString();
  const sessionCookie = [
    `${SCADA_SESSION_COOKIE_NAME}=${payload.sessionToken}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    `Expires=${expires}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
  const csrfCookie = [
    `${SCADA_CSRF_COOKIE_NAME}=${payload.csrfToken}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    `Expires=${expires}`,
    "Secure",
    "SameSite=Lax",
  ].join("; ");
  return Object.freeze([sessionCookie, csrfCookie] as const);
}

/** 登出时使用与签发完全一致的 Cookie 名称、Path 和安全属性清除浏览器状态。 */
export function createClearedScadaSessionCookieHeaders(): readonly [string, string] {
  const sessionCookie = [
    `${SCADA_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    `Expires=${COOKIE_EPOCH}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
  const csrfCookie = [
    `${SCADA_CSRF_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    `Expires=${COOKIE_EPOCH}`,
    "Secure",
    "SameSite=Lax",
  ].join("; ");
  return Object.freeze([sessionCookie, csrfCookie] as const);
}
