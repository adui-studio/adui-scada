import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { resolveOidcStartupConfig } from "./oidc-startup.config.js";

const validKey = randomBytes(32).toString("base64url");
const configured = Object.freeze({
  SCADA_OIDC_ENABLED: "true",
  SCADA_OIDC_ISSUER: "https://id.example.org/realms/scada",
  SCADA_OIDC_CLIENT_ID: "adui-scada",
  SCADA_OIDC_CLIENT_SECRET: "only-for-configuration-test-123",
  SCADA_OIDC_REDIRECT_URI: "https://scada.example.org/api/v1/auth/oidc/callback",
  SCADA_OIDC_WEB_ORIGINS: "https://scada.example.org,https://studio.example.org",
  SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: validKey,
});

describe("OIDC 服务端启动安全配置", () => {
  it("默认关闭且不读取缺失或无效的身份凭据", () => {
    expect(resolveOidcStartupConfig({})).toEqual({ enabled: false });
    expect(
      resolveOidcStartupConfig({
        SCADA_OIDC_ENABLED: "false",
        SCADA_OIDC_CLIENT_SECRET: "敏感内容",
        SCADA_OIDC_ISSUER: "非 URL",
      }),
    ).toEqual({ enabled: false });
  });

  it("只接受明确的布尔开关", () => {
    for (const enabled of ["TRUE", "1", "", "是"]) {
      expect(() => resolveOidcStartupConfig({ SCADA_OIDC_ENABLED: enabled })).toThrow(
        "SCADA_OIDC_ENABLED 只能设置为 true 或 false",
      );
    }
    expect(() =>
      resolveOidcStartupConfig({
        ...configured,
        SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "yes",
      }),
    ).toThrow("SCADA_OIDC_ALLOW_INSECURE_LOOPBACK 只能设置为 true 或 false");
  });

  it("接受可信 HTTPS Issuer、固定回调和独立的浏览器 Origin", () => {
    const value = resolveOidcStartupConfig(configured);
    expect(value.enabled).toBe(true);
    if (!value.enabled) throw new Error("OIDC 配置未启用");
    expect(value.issuer.href).toBe("https://id.example.org/realms/scada");
    expect(value.webOrigins).toEqual(["https://scada.example.org", "https://studio.example.org"]);
    expect(value.transactionEncryptionKey).toHaveLength(32);
    expect(value.redirectUri.pathname).toBe("/api/v1/auth/oidc/callback");
  });

  it("拒绝 HTTP 外部地址、携带账号或查询参数的 Issuer 和 Redirect URI", () => {
    for (const issuer of [
      "http://id.example.org",
      "https://user:pass@id.example.org",
      "https://id.example.org/?token=secret",
      "javascript:alert(1)",
      "not-a-url",
    ]) {
      expect(() => resolveOidcStartupConfig({ ...configured, SCADA_OIDC_ISSUER: issuer })).toThrow();
    }
    for (const redirect of [
      "https://scada.example.org/path",
      "https://scada.example.org/api/v1/auth/oidc/callback?next=/",
      "http://scada.example.org/api/v1/auth/oidc/callback",
    ]) {
      expect(() =>
        resolveOidcStartupConfig({ ...configured, SCADA_OIDC_REDIRECT_URI: redirect }),
      ).toThrow();
    }
  });

  it("严格校验 Origin 的 HTTPS、路径和重复项", () => {
    for (const origins of [
      "http://scada.example.org",
      "https://scada.example.org/path",
      "https://scada.example.org,https://scada.example.org",
      "https://scada.example.org,",
      "https://scada.example.org/?a=1",
    ]) {
      expect(() =>
        resolveOidcStartupConfig({ ...configured, SCADA_OIDC_WEB_ORIGINS: origins }),
      ).toThrow();
    }
  });

  it("拒绝错误长度与非法编码的事务加密密钥，异常不泄漏秘密", () => {
    for (const key of [
      "",
      "invalid",
      "0".repeat(43),
      randomBytes(31).toString("base64url"),
      randomBytes(33).toString("base64url"),
    ]) {
      expect(() =>
        resolveOidcStartupConfig({ ...configured, SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: key }),
      ).toThrow("SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY");
    }
    try {
      resolveOidcStartupConfig({ ...configured, SCADA_OIDC_CLIENT_SECRET: "敏感\n内容" });
      throw new Error("错误配置未被拒绝");
    } catch (error) {
      expect((error as Error).message).not.toContain("敏感");
    }
  });

  it("仅允许非生产环境明确启用的本机回环 HTTP 测试", () => {
    const dev = {
      ...configured,
      NODE_ENV: "development",
      SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "true",
      SCADA_OIDC_ISSUER: "http://127.0.0.1:18089",
      SCADA_OIDC_REDIRECT_URI: "http://127.0.0.1:13001/api/v1/auth/oidc/callback",
      SCADA_OIDC_WEB_ORIGINS: "http://127.0.0.1:15173,http://127.0.0.1:15174",
    };
    expect(resolveOidcStartupConfig(dev).enabled).toBe(true);
    expect(() =>
      resolveOidcStartupConfig({ ...dev, NODE_ENV: "production" }),
    ).toThrow("生产环境禁止启用不安全的本机 HTTP OIDC 测试模式");
    expect(() =>
      resolveOidcStartupConfig({ ...dev, SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "false" }),
    ).toThrow();
    expect(() =>
      resolveOidcStartupConfig({ ...dev, SCADA_OIDC_ISSUER: "http://192.168.0.1" }),
    ).toThrow();
  });
});
