import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeProjectBrowserFailure,
  resolveProjectBrowserLab,
} from "./test-project-browser-oidc.mjs";

const sample = {
  NODE_ENV: "development",
  NODE_EXTRA_CA_CERTS: process.execPath,
  SCADA_OIDC_ENABLED: "true",
  SCADA_OIDC_DEV_HTTPS_ENABLED: "true",
  SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "false",
  SCADA_LOCAL_DEMO_API_ENABLED: "false",
  SCADA_WEB_HOST: "127.0.0.1",
  SCADA_SERVER_HOST: "127.0.0.1",
  SCADA_SERVER_PORT: "13001",
  SCADA_REACT_DEV_PORT: "15173",
  SCADA_VUE_DEV_PORT: "15174",
  SCADA_LAB_KEYCLOAK_PORT: "18443",
  SCADA_LAB_POSTGRES_PORT: "15432",
  SCADA_OIDC_ISSUER: "https://127.0.0.1:18443/realms/adui-scada",
  SCADA_OIDC_WEB_ORIGINS: "https://127.0.0.1:15173,https://127.0.0.1:15174",
  SCADA_OIDC_REDIRECT_URI: "https://127.0.0.1:15173/api/v1/auth/oidc/callback",
  SCADA_DATABASE_URL: "postgresql://127.0.0.1:15432/adui_scada",
};

void describe("OIDC 工程浏览器专项环境保护", () => {
  void it("只接受两套本机 HTTPS Origin 与受控 Keycloak Realm", () => {
    assert.deepEqual(resolveProjectBrowserLab(sample), [
      "https://127.0.0.1:15173",
      "https://127.0.0.1:15174",
    ]);
  });

  void it("拒绝远程 Keycloak Issuer 和不受信的回调地址", () => {
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, SCADA_OIDC_ISSUER: "https://example.com" }),
      /仅允许本机 Keycloak 隔离 Realm/,
    );
    assert.throws(
      () =>
        resolveProjectBrowserLab({
          ...sample,
          SCADA_OIDC_REDIRECT_URI: "https://example.com/callback",
        }),
      /OIDC 回调必须与已登记的 HTTPS Origin 一致/,
    );
  });

  void it("拒绝远程数据库、其他库名与端口", () => {
    for (const url of [
      "postgresql://db.example.com:15432/adui_scada",
      "postgresql://127.0.0.1:15432/business",
      "postgresql://127.0.0.1:5432/adui_scada",
    ]) {
      assert.throws(
        () => resolveProjectBrowserLab({ ...sample, SCADA_DATABASE_URL: url }),
        /拒绝非本机隔离数据库目标/,
      );
    }
  });

  void it("关闭可信 OIDC 或允许不安全回环时拒绝执行", () => {
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, SCADA_OIDC_ENABLED: "false" }),
      /必须显式启用可信 OIDC 开发代理/,
    );
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "true" }),
      /只允许安全的本机非生产环境/,
    );
  });

  void it("缺少可信 Node.js 根证书时拒绝执行", () => {
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, NODE_EXTRA_CA_CERTS: undefined }),
      /保持 TLS 校验/,
    );
    assert.throws(
      () =>
        resolveProjectBrowserLab({
          ...sample,
          NODE_EXTRA_CA_CERTS: "Z:/__adui_missing_ca__/rootCA.pem",
        }),
      /本机根证书无法读取/,
    );
  });

  void it("错误诊断不得泄漏原始凭据、路径和堆栈", () => {
    assert.equal(
      describeProjectBrowserFailure(new Error("内部请求包含敏感 Cookie")),
      "浏览器安全回归断言失败，检查终端测试条件及真实页面状态",
    );
    assert.equal(
      describeProjectBrowserFailure(new Error("工程浏览器测试拒绝非本机隔离数据库目标")),
      "工程浏览器测试拒绝非本机隔离数据库目标",
    );
    assert.equal(
      describeProjectBrowserFailure({ code: "ECONNREFUSED" }),
      "本机 Web 或浏览器调试端口未监听",
    );
  });

  void it("不允许生产模式启动交互式本机测试", () => {
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, NODE_ENV: "production" }),
      /只允许安全的本机非生产环境/,
    );
  });
});
