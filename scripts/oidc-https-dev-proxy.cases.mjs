import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { resolveLoopbackOidcHttpsProxy } from "./oidc-https-dev-proxy.mjs";

const certPath = resolve("test-oidc-cert.pem");
const keyPath = resolve("test-oidc-key.pem");

function validEnv() {
  return {
    NODE_ENV: "development",
    SCADA_OIDC_DEV_HTTPS_ENABLED: "true",
    SCADA_WEB_HOST: "127.0.0.1",
    SCADA_SERVER_HOST: "127.0.0.1",
    SCADA_SERVER_PORT: "13001",
    SCADA_REACT_DEV_PORT: "15173",
    SCADA_VUE_DEV_PORT: "15174",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "false",
    SCADA_LOCAL_DEMO_API_ENABLED: "false",
    SCADA_OIDC_WEB_ORIGINS: "https://127.0.0.1:15173,https://127.0.0.1:15174",
    SCADA_OIDC_REDIRECT_URI: "https://127.0.0.1:15173/api/v1/auth/oidc/callback",
    SCADA_OIDC_DEV_HTTPS_CERT_FILE: certPath,
    SCADA_OIDC_DEV_HTTPS_KEY_FILE: keyPath,
  };
}

function safeDependencies() {
  return {
    readFile: () => Buffer.from("仅供测试的模拟数据"),
    verifyTls: () => undefined,
  };
}

void describe("OIDC 本机 HTTPS 同源代理安全策略", () => {
  void it("默认不开启 HTTPS 代理，不读取证书与密钥", () => {
    assert.equal(resolveLoopbackOidcHttpsProxy({ SCADA_OIDC_DEV_HTTPS_ENABLED: "false" }, 15173), null);
    assert.equal(resolveLoopbackOidcHttpsProxy({}, 15174), null);
  });

  void it("拒绝错误的开关格式和生产环境", () => {
    assert.throws(
      () => resolveLoopbackOidcHttpsProxy({ ...validEnv(), SCADA_OIDC_DEV_HTTPS_ENABLED: "1" }, 15173),
      /只能设置为 true 或 false/,
    );
    assert.throws(
      () => resolveLoopbackOidcHttpsProxy({ ...validEnv(), NODE_ENV: "production" }, 15173),
      /生产环境禁止/,
    );
  });

  void it("必须启用可信 OIDC，不能混用不安全 HTTP 或模拟身份", () => {
    for (const difference of [
      { SCADA_OIDC_ENABLED: "false" },
      { SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "true" },
      { SCADA_LOCAL_DEMO_API_ENABLED: "true" },
    ]) {
      assert.throws(
        () => resolveLoopbackOidcHttpsProxy({ ...validEnv(), ...difference }, 15173),
        /必须启用可信 OIDC/,
      );
    }
  });

  void it("拒绝 Web、NestJS 非回环地址", () => {
    for (const difference of [
      { SCADA_WEB_HOST: "0.0.0.0" },
      { SCADA_SERVER_HOST: "localhost" },
    ]) {
      assert.throws(
        () => resolveLoopbackOidcHttpsProxy({ ...validEnv(), ...difference }, 15173),
        /只允许 Web 与 NestJS 绑定/,
      );
    }
  });

  void it("拒绝非法端口、重叠端口和不属于两端 Web 的代理端口", () => {
    for (const difference of [
      { SCADA_SERVER_PORT: "0" },
      { SCADA_REACT_DEV_PORT: "65536" },
      { SCADA_VUE_DEV_PORT: "15173" },
      { SCADA_SERVER_PORT: "15174" },
      { SCADA_SERVER_PORT: "13001.1" },
    ]) {
      assert.throws(
        () => resolveLoopbackOidcHttpsProxy({ ...validEnv(), ...difference }, 15173),
        /端口|整数/,
      );
    }
    assert.throws(
      () => resolveLoopbackOidcHttpsProxy(validEnv(), 15175),
      /端口必须各自独立/,
    );
  });

  void it("必须精确列出 React/Vue 两个 HTTPS Origin，拒绝外站与路径", () => {
    for (const origins of [
      "https://127.0.0.1:15173",
      "https://127.0.0.1:15173,https://external.example",
      "http://127.0.0.1:15173,https://127.0.0.1:15174",
      "https://127.0.0.1:15173/x,https://127.0.0.1:15174",
      "https://127.0.0.1:15173,https://127.0.0.1:15173",
    ]) {
      assert.throws(
        () => resolveLoopbackOidcHttpsProxy({ ...validEnv(), SCADA_OIDC_WEB_ORIGINS: origins }, 15173),
        /必须精确配置/,
      );
    }
  });

  void it("回调必须使用其中一个可信 HTTPS Origin 和固定路径", () => {
    for (const redirect of [
      "https://external.example/api/v1/auth/oidc/callback",
      "https://127.0.0.1:15173/login",
      "http://127.0.0.1:15173/api/v1/auth/oidc/callback",
      "https://127.0.0.1:15173/api/v1/auth/oidc/callback?next=/",
    ]) {
      assert.throws(
        () => resolveLoopbackOidcHttpsProxy({ ...validEnv(), SCADA_OIDC_REDIRECT_URI: redirect }, 15173),
        /OIDC 回调必须使用/,
      );
    }
  });

  void it("拒绝未使用本机绝对路径或复用同一个文件作为证书和私钥", () => {
    for (const difference of [
      { SCADA_OIDC_DEV_HTTPS_CERT_FILE: "relative.pem" },
      { SCADA_OIDC_DEV_HTTPS_KEY_FILE: "relative-key.pem" },
      { SCADA_OIDC_DEV_HTTPS_KEY_FILE: certPath },
    ]) {
      assert.throws(
        () => resolveLoopbackOidcHttpsProxy({ ...validEnv(), ...difference }, 15173),
        /必须分别使用本机绝对路径/,
      );
    }
  });

  void it("读取或 TLS 校验失败时拒绝启动，错误信息不泄露证书路径", () => {
    const readError = assert.throws(
      () => resolveLoopbackOidcHttpsProxy(validEnv(), 15173, {
        readFile: () => { throw new Error("私钥文件路径不得泄露"); },
      }),
      /无法读取或校验/,
    );
    // Node 断言只检查受控异常消息；没有访问任何真实文件。
    assert.equal(readError, undefined);
    assert.throws(
      () => resolveLoopbackOidcHttpsProxy(validEnv(), 15173, {
        ...safeDependencies(),
        verifyTls: () => { throw new Error("证书私钥不匹配"); },
      }),
      /无法读取或校验/,
    );
  });

  void it("React/Vue 使用相同的固定同源代理目标，不转发跨站 WebSocket", () => {
    for (const port of [15173, 15174]) {
      const config = resolveLoopbackOidcHttpsProxy(validEnv(), port, safeDependencies());
      assert.ok(config, "HTTPS 开发代理应该启用");
      assert.equal(config.apiProxy.target, "http://127.0.0.1:13001");
      assert.equal(config.apiProxy.changeOrigin, false);
      assert.equal(config.apiProxy.ws, false);
      assert.equal(config.apiProxy.xfwd, false);
      assert.ok(Buffer.isBuffer(config.https.cert));
      assert.ok(Buffer.isBuffer(config.https.key));
    }
  });
});
