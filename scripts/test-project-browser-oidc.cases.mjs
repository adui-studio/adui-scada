import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeBrowserPageException,
  describeProjectBrowserFailure,
  inspectStudioState,
  requireAuthorizedProjectPage,
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
      /只读 HTTPS 探针要求显式启用可信 OIDC 开发代理/,
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
    assert.equal(
      describeProjectBrowserFailure(
        new Error("React 隔离 Lab 没有授权工程，请先由维护者按受控流程准备至少一份工程"),
      ),
      "React 隔离 Lab 没有授权工程，请先由维护者按受控流程准备至少一份工程",
    );
  });

  void it("CDP 异常只返回白名单错误原因或安全类别，不泄漏原始堆栈", () => {
    assert.equal(
      describeBrowserPageException({
        exception: {
          className: "Error",
          description: "Error: 未找到工程管理入口\n堆栈和私密内容不得展示",
        },
      }),
      "未找到工程管理入口",
    );
    assert.equal(
      describeBrowserPageException({
        exception: {
          className: "ReferenceError",
          description: "ReferenceError: 包含私密 Cookie 的未知变量",
        },
      }),
      "页面脚本引用异常",
    );
    assert.equal(
      describeBrowserPageException({ exception: { className: "OtherError" } }),
      "页面脚本异常（已脱敏）",
    );
  });

  void it("授权工程列表 HTTP 拒绝只显示状态码，不能返回正文", () => {
    assert.deepEqual(requireAuthorizedProjectPage({ status: 200, projects: [] }), []);
    assert.throws(
      () => requireAuthorizedProjectPage({ status: 403, projects: ["敏感工程"] }),
      (error) => describeProjectBrowserFailure(error) === "工程列表接口返回 HTTP 403",
    );
    assert.throws(
      () => requireAuthorizedProjectPage({ status: 0, projects: [] }),
      (error) => describeProjectBrowserFailure(error) === "工程列表接口状态异常",
    );
  });

  void it("页面安全诊断不得输出任意未知错误内容", () => {
    const error = new Error("浏览器页面操作失败，请检查当前 Studio 状态");
    error.pageDiagnostic = "包含 Token 的异常详情";
    assert.equal(
      describeProjectBrowserFailure(error),
      "浏览器页面操作失败，请检查当前 Studio 状态",
    );
    error.pageDiagnostic = "页面脚本类型异常";
    assert.equal(describeProjectBrowserFailure(error), "浏览器页面操作失败：页面脚本类型异常");
  });

  void it("CDP 页面状态与 IndexedDB 读取分别序列化执行，防止跨作用域引用异常", async () => {
    const actions = [];
    const page = {
      canvas: "<svg></svg>",
      server: "当前工程：demo；CAS 基线：1",
      autoSave: true,
    };
    const drafts = { count: 1, hash: "只供测试的摘要" };
    const session = {
      async evaluate(action) {
        actions.push({ name: action.name, source: action.toString() });
        if (action.name === "stateInPage") return page;
        if (action.name === "readBrowserDraftsInPage") return drafts;
        throw new Error("测试收到了意外的浏览器动作");
      },
    };

    assert.deepEqual(await inspectStudioState(session), { ...page, drafts });
    assert.deepEqual(
      actions.map((action) => action.name),
      ["stateInPage", "readBrowserDraftsInPage"],
    );
    assert.equal(actions[0].source.includes("readBrowserDraftsInPage"), false);
    assert.equal(actions[1].source.includes("indexedDB.open"), true);
  });

  void it("不允许生产模式启动交互式本机测试", () => {
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, NODE_ENV: "production" }),
      /只允许安全的本机非生产环境/,
    );
  });
});
