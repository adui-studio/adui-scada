import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  resolveReadonlyProbeOrigins,
  verifyAnonymousMeResponse,
  verifyReadonlyHttps,
} from "./verify-oidc-https-readonly.mjs";

const env = () => ({
  NODE_ENV: "development",
  SCADA_OIDC_ENABLED: "true",
  SCADA_OIDC_DEV_HTTPS_ENABLED: "true",
  SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "false",
  SCADA_LOCAL_DEMO_API_ENABLED: "false",
  SCADA_WEB_HOST: "127.0.0.1",
  SCADA_SERVER_HOST: "127.0.0.1",
  SCADA_SERVER_PORT: "13001",
  SCADA_REACT_DEV_PORT: "15173",
  SCADA_VUE_DEV_PORT: "15174",
  SCADA_OIDC_WEB_ORIGINS: "https://127.0.0.1:15173,https://127.0.0.1:15174",
  SCADA_OIDC_REDIRECT_URI: "https://127.0.0.1:15173/api/v1/auth/oidc/callback",
});

const unauthorized = () => ({
  status: 401,
  type: "application/json; charset=utf-8",
  body: JSON.stringify({
    statusCode: 401,
    message: "缺少有效的身份凭据",
    error: "Unauthorized",
  }),
});

void describe("真实 OIDC HTTPS 本机匿名只读探针", () => {
  void it("只接受两套可信 HTTPS Origin", () => {
    assert.deepEqual(resolveReadonlyProbeOrigins(env()), [
      "https://127.0.0.1:15173",
      "https://127.0.0.1:15174",
    ]);
  });

  void it("缺少开关或启用生产模式均拒绝", () => {
    assert.throws(
      () => resolveReadonlyProbeOrigins({ ...env(), SCADA_OIDC_ENABLED: "false" }),
      /显式启用/,
    );
    assert.throws(
      () => resolveReadonlyProbeOrigins({ ...env(), NODE_ENV: "production" }),
      /非生产环境/,
    );
  });

  void it("拒绝非回环地址和不安全模式", () => {
    for (const difference of [
      { SCADA_WEB_HOST: "0.0.0.0" },
      { SCADA_SERVER_HOST: "localhost" },
      { SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "true" },
      { SCADA_LOCAL_DEMO_API_ENABLED: "true" },
    ]) {
      assert.throws(() => resolveReadonlyProbeOrigins({ ...env(), ...difference }), /安全的本机/);
    }
  });

  void it("拒绝非法、重复的端口与不可信 Origin", () => {
    assert.throws(
      () => resolveReadonlyProbeOrigins({ ...env(), SCADA_VUE_DEV_PORT: "65536" }),
      /端口无效/,
    );
    assert.throws(
      () => resolveReadonlyProbeOrigins({ ...env(), SCADA_VUE_DEV_PORT: "15173" }),
      /互不相同/,
    );
    assert.throws(
      () =>
        resolveReadonlyProbeOrigins({
          ...env(),
          SCADA_OIDC_WEB_ORIGINS: "https://example.com,https://127.0.0.1:15174",
        }),
      /精确配置/,
    );
  });

  void it("拒绝不匹配的 OIDC 回调", () => {
    assert.throws(
      () =>
        resolveReadonlyProbeOrigins({
          ...env(),
          SCADA_OIDC_REDIRECT_URI: "https://example.com/api/v1/auth/oidc/callback",
        }),
      /回调必须/,
    );
  });

  void it("接受受控未登录 JSON", () => {
    assert.doesNotThrow(() => verifyAnonymousMeResponse(unauthorized()));
  });

  void it("拒绝跳转、服务端异常和前端 HTML 回退", () => {
    for (const response of [
      { ...unauthorized(), status: 302, location: "https://example.com" },
      { ...unauthorized(), status: 200 },
      { ...unauthorized(), type: "text/html", body: "<html></html>" },
    ]) {
      assert.throws(() => verifyAnonymousMeResponse(response), /必须返回 401|没有返回 JSON/);
    }
  });

  void it("拒绝无效 JSON 与非预期的认证契约", () => {
    assert.throws(() => verifyAnonymousMeResponse({ ...unauthorized(), body: "{" }), /无效 JSON/);
    assert.throws(
      () =>
        verifyAnonymousMeResponse({
          ...unauthorized(),
          body: JSON.stringify({ statusCode: 401, message: "未知错误" }),
        }),
      /安全契约/,
    );
  });

  void it("逐一检查 React/Vue 两端，并在出现异常时失败", async () => {
    const visited = [];
    const count = await verifyReadonlyHttps(env(), async (origin) => {
      visited.push(origin);
      return unauthorized();
    });
    assert.equal(count, 2);
    assert.deepEqual(visited, ["https://127.0.0.1:15173", "https://127.0.0.1:15174"]);

    await assert.rejects(
      () => verifyReadonlyHttps(env(), async () => ({ ...unauthorized(), status: 503 })),
      /必须返回 401/,
    );
  });
});
