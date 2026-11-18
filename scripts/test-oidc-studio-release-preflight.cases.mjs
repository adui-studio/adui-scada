import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  armStudioPreflightReadGuardInPage,
  clickStudioPreflightInPage,
  describeStudioPreflightFailure,
  installStudioPreflightReadGuardInPage,
  requireReadonlyStudioPreflightMode,
  studioPreflightGuardStateInPage,
  studioPreflightUiStateInPage,
} from "./test-oidc-studio-release-preflight.mjs";

const origin = "https://127.0.0.1:15173";
const projectId = "water-demo";
const base = "/api/v1/projects/" + projectId;

function fixture() {
  const calls = [];
  const runtime = {
    location: { origin },
    Response,
    fetch: async (input, options) => {
      calls.push({ input, options });
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
  return { runtime, calls };
}

void describe("真实 Keycloak Studio 发布预检浏览器只读安全门禁", () => {
  void it("默认只有无参数只读模式，拒绝写入或 Lab 确认参数", () => {
    assert.equal(requireReadonlyStudioPreflightMode([]), true);
    for (const args of [
      ["--run"],
      ["--write"],
      ["--confirm-lab", "adui_scada"],
      ["--run", "--confirm-lab", "adui_scada"],
    ]) {
      assert.throws(
        () => requireReadonlyStudioPreflightMode(args),
        /真实 Studio 发布预检仅允许无参数只读验收/,
      );
    }
  });

  void it("只在可信双 HTTPS Origin 安装页面保护，其他 Origin 不改动 fetch", () => {
    const { runtime } = fixture();
    runtime.location.origin = "https://untrusted.example.org";
    const original = runtime.fetch;
    assert.equal(
      installStudioPreflightReadGuardInPage([origin, "https://127.0.0.1:15174"], runtime),
      false,
    );
    assert.equal(runtime.fetch, original);
    assert.equal(runtime.__aduiScadaStudioPreflightGuard, undefined);
  });

  void it("真实只读按钮的四条工程 GET 依次记录当前水位、快照、预检、最终水位", async () => {
    const { runtime, calls } = fixture();
    assert.equal(installStudioPreflightReadGuardInPage([origin], runtime), true);
    assert.equal(armStudioPreflightReadGuardInPage(origin, projectId, 2, null, runtime), true);
    for (const path of [
      base,
      base + "/versions/2",
      base + "/versions/2/release-preflight",
      base,
    ]) {
      const response = await runtime.fetch(path, {
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
      });
      assert.equal(response.status, 200);
    }
    assert.deepEqual(studioPreflightGuardStateInPage(runtime), {
      requests: ["head", "snapshot", "preflight", "head"],
      blockedWrites: 0,
      simulatedResponses: 0,
    });
    assert.equal(calls.length, 4);
    assert.ok(calls.every(({ options }) => options.method === "GET"));
    assert.ok(calls.every(({ options }) => options.credentials === "same-origin"));
    assert.ok(calls.every(({ options }) => !Object.hasOwn(options, "body")));
  });

  void it("在模拟模式关闭时不拦截登录接口或其他正常非工程请求", async () => {
    const { runtime, calls } = fixture();
    installStudioPreflightReadGuardInPage([origin], runtime);
    await runtime.fetch("/api/v1/auth/me", { method: "GET" });
    await runtime.fetch("/images/demo.svg", { method: "GET" });
    assert.equal(calls.length, 2);
    assert.deepEqual(studioPreflightGuardStateInPage(runtime)?.requests, []);
  });

  void it("任何工程 POST/DELETE 及跨 Origin 工程调用都在到达原生 fetch 前阻断", async () => {
    const { runtime, calls } = fixture();
    installStudioPreflightReadGuardInPage([origin], runtime);
    for (const [path, method] of [
      [base, "POST"],
      [base + "/versions", "POST"],
      [base, "DELETE"],
      ["https://untrusted.example.org/api/v1/projects/a", "GET"],
    ]) {
      await assert.rejects(runtime.fetch(path, { method }), /真实 Studio 发布预检/);
    }
    assert.equal(calls.length, 0);
    assert.equal(studioPreflightGuardStateInPage(runtime)?.blockedWrites, 4);
  });

  void it("只在预检 GET 上模拟 401/404/409，不修改真实工程请求与 ACL", async () => {
    const { runtime, calls } = fixture();
    installStudioPreflightReadGuardInPage([origin], runtime);
    for (const status of [401, 404, 409]) {
      armStudioPreflightReadGuardInPage(origin, projectId, 2, status, runtime);
      assert.equal((await runtime.fetch(base + "/versions/2")).status, 200);
      const denied = await runtime.fetch(base + "/versions/2/release-preflight", {
        method: "GET",
      });
      assert.equal(denied.status, status);
      assert.deepEqual(studioPreflightGuardStateInPage(runtime)?.requests, [
        "snapshot",
        "preflight",
      ]);
      assert.equal(studioPreflightGuardStateInPage(runtime)?.simulatedResponses, 1);
    }
    assert.equal(calls.length, 3);
  });

  void it("模拟参数必须匹配当前 Origin、合法工程及正安全整数，拒绝后保持状态", () => {
    const { runtime } = fixture();
    installStudioPreflightReadGuardInPage([origin], runtime);
    armStudioPreflightReadGuardInPage(origin, projectId, 2, null, runtime);
    for (const args of [
      ["https://127.0.0.1:15174", projectId, 2, null],
      [origin, "../unsafe", 2, null],
      [origin, projectId, 0, null],
      [origin, projectId, 1.5, null],
      [origin, projectId, Number.MAX_SAFE_INTEGER + 1, null],
      [origin, projectId, 2, 503],
    ]) {
      assert.throws(
        () => armStudioPreflightReadGuardInPage(...args, runtime),
        /真实 Studio 发布预检安全门禁参数无效/,
      );
    }
    assert.deepEqual(studioPreflightGuardStateInPage(runtime)?.requests, []);
    assert.equal(runtime.__aduiScadaStudioPreflightGuard.simulatedStatus, null);
  });

  void it("安全门禁在同一页面不允许重复安装，防止双重拦截", () => {
    const { runtime } = fixture();
    installStudioPreflightReadGuardInPage([origin], runtime);
    assert.throws(
      () => installStudioPreflightReadGuardInPage([origin], runtime),
      /真实 Studio 发布预检安全门禁重复安装/,
    );
  });

  void it("按钮只通过正式面板 DOM 触发，禁用或不存在时明确拒绝", () => {
    const button = {
      disabled: false,
      textContent: "检查服务端已保存版本",
      clickCount: 0,
      click() {
        this.clickCount += 1;
      },
    };
    const menu = { open: false };
    const panel = {
      closest() {
        return menu;
      },
      querySelectorAll() {
        return [button];
      },
    };
    const runtime = {
      document: {
        querySelector() {
          return panel;
        },
      },
    };
    assert.equal(clickStudioPreflightInPage(runtime), true);
    assert.equal(menu.open, true);
    assert.equal(button.clickCount, 1);
    button.disabled = true;
    assert.throws(
      () => clickStudioPreflightInPage(runtime),
      /真实 Studio 发布预检按钮不可用/,
    );
  });

  void it("未点击的预检面板不能被当作服务端通过，当前修订和错误均为空", () => {
    const panel = {
      textContent: "服务端预检仅检查已保存的当前修订。",
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const runtime = {
      document: {
        querySelector(value) {
          if (value === '[aria-label="服务端已保存版本发布预检"]') return panel;
          return null;
        },
      },
    };
    assert.deepEqual(studioPreflightUiStateInPage(runtime), {
      buttonReady: false,
      revision: null,
      passed: null,
      sameContent: false,
      unsaved: false,
      stale: false,
      notPublished: false,
      issueCount: 0,
      error: false,
      baselineCleared: false,
    });
  });

  void it("CDP 独立函数序列化后不引用 Node 作用域变量", async () => {
    const isolated = runInNewContext(
      "(" + installStudioPreflightReadGuardInPage.toString() + ")",
      { URL },
    );
    const { runtime, calls } = fixture();
    assert.equal(isolated([origin], runtime), true);
    armStudioPreflightReadGuardInPage(origin, projectId, 2, 409, runtime);
    const response = await runtime.fetch(base + "/versions/2/release-preflight");
    assert.equal(response.status, 409);
    assert.equal(calls.length, 0);
  });

  void it("任何浏览器异常及隐藏密钥都只能输出固定中文类别", () => {
    assert.equal(
      describeStudioPreflightFailure(new Error("Cookie=private access_token=secret")),
      "真实 Studio 发布预检专项未通过，内部信息已脱敏",
    );
    assert.equal(
      describeStudioPreflightFailure({ pageDiagnostic: "Cookie=secret" }),
      "真实 Studio 发布预检浏览器页面操作失败，内部诊断已脱敏",
    );
    assert.equal(
      describeStudioPreflightFailure(new Error("真实 Studio 发布预检未保护当前画布和草稿")),
      "真实 Studio 发布预检未保护当前画布和草稿",
    );
  });
});
