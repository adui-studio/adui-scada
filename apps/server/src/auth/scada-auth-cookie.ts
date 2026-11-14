export const SCADA_SESSION_COOKIE_NAME = "__Host-adui-scada-session";
export const SCADA_CSRF_COOKIE_NAME = "__Host-adui-scada-csrf";

const SESSION_TOKEN_PATTERN = /^scada_s_[A-Za-z0-9_-]{43}$/;
const CSRF_TOKEN_PATTERN = /^scada_csrf_[A-Za-z0-9_-]{43}$/;
const COOKIE_EPOCH = "Thu, 01 Jan 1970 00:00:00 GMT";

export interface ScadaSessionCookiePayload {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
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
