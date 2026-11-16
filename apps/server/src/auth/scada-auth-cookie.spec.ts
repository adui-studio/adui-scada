import { describe, expect, it } from "vite-plus/test";
import {
  createClearedScadaSessionCookieHeaders,
  createScadaOidcBrowserBindingCookieHeader,
  createScadaSessionCookieHeaders,
  readScadaCookieValue,
  SCADA_CSRF_COOKIE_NAME,
  SCADA_OIDC_BROWSER_COOKIE_NAME,
  SCADA_SESSION_COOKIE_NAME,
} from "./scada-auth-cookie.js";

const SESSION_TOKEN = "scada_s_" + "s".repeat(43);
const CSRF_TOKEN = "scada_csrf_" + "c".repeat(43);
const BROWSER_BINDING = "scada_oidc_b_" + "b".repeat(43);

describe("BFF 会话与 CSRF Cookie", () => {
  it("签发 Host Cookie 并严格设置安全属性", () => {
    const headers = createScadaSessionCookieHeaders({
      sessionToken: SESSION_TOKEN,
      csrfToken: CSRF_TOKEN,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    expect(headers).toHaveLength(2);
    expect(headers[0]).toContain(`${SCADA_SESSION_COOKIE_NAME}=${SESSION_TOKEN};`);
    expect(headers[0]).toContain("Path=/");
    expect(headers[0]).toContain("HttpOnly");
    expect(headers[0]).toContain("Secure");
    expect(headers[0]).toContain("SameSite=Lax");
    expect(headers[0]).not.toContain("Domain=");
    expect(headers[1]).toContain(`${SCADA_CSRF_COOKIE_NAME}=${CSRF_TOKEN};`);
    expect(headers[1]).toContain("Path=/");
    expect(headers[1]).toContain("Secure");
    expect(headers[1]).toContain("SameSite=Lax");
    expect(headers[1]).not.toContain("HttpOnly");
    expect(headers[1]).not.toContain("Domain=");
  });

  it("设置短时 HttpOnly 浏览器绑定 Cookie 以支持 IdP 顶层回调", () => {
    const header = createScadaOidcBrowserBindingCookieHeader(
      BROWSER_BINDING,
      new Date(Date.now() + 5 * 60 * 1000),
    );

    expect(header).toContain(`${SCADA_OIDC_BROWSER_COOKIE_NAME}=${BROWSER_BINDING}`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toContain("Domain=");
  });

  it("读取唯一 Cookie 并拒绝重复、超长或多值请求头", () => {
    const header = [
      "other=value",
      `${SCADA_OIDC_BROWSER_COOKIE_NAME}=${BROWSER_BINDING}`,
      `${SCADA_SESSION_COOKIE_NAME}=${SESSION_TOKEN}`,
    ].join("; ");
    expect(readScadaCookieValue(header, SCADA_OIDC_BROWSER_COOKIE_NAME)).toBe(BROWSER_BINDING);
    expect(
      readScadaCookieValue(
        [
          `${SCADA_OIDC_BROWSER_COOKIE_NAME}=${BROWSER_BINDING}`,
          `${SCADA_OIDC_BROWSER_COOKIE_NAME}=${BROWSER_BINDING}`,
        ].join("; "),
        SCADA_OIDC_BROWSER_COOKIE_NAME,
      ),
    ).toBeUndefined();
    expect(readScadaCookieValue(["重复请求头"], SCADA_OIDC_BROWSER_COOKIE_NAME)).toBeUndefined();
    expect(readScadaCookieValue("x".repeat(4097), SCADA_OIDC_BROWSER_COOKIE_NAME)).toBeUndefined();
    expect(readScadaCookieValue(undefined, SCADA_OIDC_BROWSER_COOKIE_NAME)).toBeUndefined();
  });

  it("拒绝无效浏览器绑定值与过期的浏览器绑定 Cookie", () => {
    expect(() =>
      createScadaOidcBrowserBindingCookieHeader("伪造绑定", new Date(Date.now() + 60_000)),
    ).toThrow("OIDC 浏览器绑定 Cookie 参数无效");
    expect(() =>
      createScadaOidcBrowserBindingCookieHeader(
        BROWSER_BINDING,
        new Date(Date.now() + 6 * 60 * 1000),
      ),
    ).toThrow("OIDC 浏览器绑定 Cookie 有效期超出允许范围");
  });

  it("使用相同的 Path 与安全属性清除两个 Cookie", () => {
    const headers = createClearedScadaSessionCookieHeaders();

    expect(headers[0]).toContain(`${SCADA_SESSION_COOKIE_NAME}=;`);
    expect(headers[0]).toContain("Path=/");
    expect(headers[0]).toContain("Max-Age=0");
    expect(headers[0]).toContain("HttpOnly");
    expect(headers[0]).toContain("Secure");
    expect(headers[0]).toContain("SameSite=Lax");
    expect(headers[1]).toContain(`${SCADA_CSRF_COOKIE_NAME}=;`);
    expect(headers[1]).toContain("Path=/");
    expect(headers[1]).toContain("Max-Age=0");
    expect(headers[1]).toContain("Secure");
    expect(headers[1]).toContain("SameSite=Lax");
    expect(headers[1]).not.toContain("HttpOnly");
  });

  it("拒绝无效令牌、过期或超长会话有效期", () => {
    expect(() =>
      createScadaSessionCookieHeaders({
        sessionToken: "伪造会话",
        csrfToken: CSRF_TOKEN,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toThrow("会话 Cookie 参数无效");

    expect(() =>
      createScadaSessionCookieHeaders({
        sessionToken: SESSION_TOKEN,
        csrfToken: CSRF_TOKEN,
        expiresAt: new Date(Date.now() - 1000),
      }),
    ).toThrow("会话 Cookie 有效期超出允许范围");

    expect(() =>
      createScadaSessionCookieHeaders({
        sessionToken: SESSION_TOKEN,
        csrfToken: CSRF_TOKEN,
        expiresAt: new Date(Date.now() + 16 * 60 * 1000),
      }),
    ).toThrow("会话 Cookie 有效期超出允许范围");
  });
});
