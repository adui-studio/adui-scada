import { describe, expect, it } from "vite-plus/test";
import {
  createClearedScadaSessionCookieHeaders,
  createScadaSessionCookieHeaders,
  SCADA_CSRF_COOKIE_NAME,
  SCADA_SESSION_COOKIE_NAME,
} from "./scada-auth-cookie.js";

const SESSION_TOKEN = "scada_s_" + "s".repeat(43);
const CSRF_TOKEN = "scada_csrf_" + "c".repeat(43);

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

  it("拒绝无效令牌、过期或超长有效期", () => {
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
