import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  describePublishedReadonlyFailure,
  enterPublishedProjectInPage,
  installPublishedReadGuardInPage,
  openPublishedRuntimeInPage,
  publishedReadGuardStateInPage,
  publishedRuntimeUiStateInPage,
  requirePublishedReadonlyMode,
  submitPublishedProjectInPage,
} from "./test-oidc-published-runtime-readonly.mjs";

const origin = "https://127.0.0.1:15173";
const projectId = "d5a-missing-01234567-89ab-4cde-8123-456789abcdef";

function fixture() {
  const calls = [];
  const runtime = {
    location: { origin },
    async fetch(path, options) {
      calls.push({ path, options });
      return { status: 404 };
    },
  };
  return { runtime, calls };
}

void describe("正式发布运行真实 OIDC 双框架只读门禁", () => {
  void it("无参模式唯一允许，任何写入开关和 Lab 确认均拒绝", () => {
    assert.equal(requirePublishedReadonlyMode([]), true);
    for (const args of [
      ["--write"],
      ["--confirm-lab", "adui_scada"],
      ["--run"],
      ["--project", "other"],
    ]) {
      assert.throws(() => requirePublishedReadonlyMode(args), /只接受无参数/);
    }
  });

  void it("工程 GET 只能位于当前同源，且不携带认证头或正文", async () => {
    const { runtime, calls } = fixture();
    assert.equal(installPublishedReadGuardInPage(origin, runtime), true);
    const result = await runtime.fetch("/api/v1/projects/" + projectId + "/releases/current", {
      method: "GET",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    assert.equal(result.status, 404);
    assert.equal(calls.length, 1);
    assert.deepEqual(publishedReadGuardStateInPage(runtime), {
      paths: ["/api/v1/projects/" + projectId + "/releases/current"],
      statuses: [404],
      blocked: 0,
    });
  });

  void it("拦截工程 POST/DELETE、跨 Origin 以及带正文或 Authorization 的伪装 GET", async () => {
    const { runtime, calls } = fixture();
    installPublishedReadGuardInPage(origin, runtime);
    for (const [path, options] of [
      ["/api/v1/projects", { method: "POST" }],
      ["/api/v1/projects/" + projectId, { method: "DELETE" }],
      ["https://outside.example/api/v1/projects", { method: "GET" }],
      ["/api/v1/projects/" + projectId, { method: "GET", body: "{}" }],
      [
        "/api/v1/projects/" + projectId,
        { method: "GET", headers: { Authorization: "Bearer secret" } },
      ],
    ]) {
      assert.throws(() => runtime.fetch(path, options), /拒绝非只读/);
    }
    assert.equal(calls.length, 0);
    assert.equal(publishedReadGuardStateInPage(runtime).blocked, 5);
  });

  void it("不拦截正常认证路由，只记录工程 API 而不读取正文", async () => {
    const { runtime, calls } = fixture();
    installPublishedReadGuardInPage(origin, runtime);
    await runtime.fetch("/api/v1/auth/me", { method: "GET" });
    assert.equal(calls.length, 1);
    assert.deepEqual(publishedReadGuardStateInPage(runtime).paths, []);
  });

  void it("非本机受信 Origin 或重复安装必须拒绝", () => {
    const { runtime } = fixture();
    assert.throws(
      () => installPublishedReadGuardInPage("https://127.0.0.1:15174", runtime),
      /门禁安装失败/,
    );
    installPublishedReadGuardInPage(origin, runtime);
    assert.throws(() => installPublishedReadGuardInPage(origin, runtime), /门禁安装失败/);
  });

  void it("CDP 页面函数无 Node 作用域引用且按独立上下文可运行", async () => {
    const isolated = runInNewContext("(" + installPublishedReadGuardInPage.toString() + ")", {
      URL,
    });
    const { runtime } = fixture();
    assert.equal(isolated(origin, runtime), true);
    await runtime.fetch("/api/v1/projects/" + projectId + "/releases/current", {
      method: "GET",
    });
    assert.equal(publishedReadGuardStateInPage(runtime).paths.length, 1);
  });

  void it("双框架真实导航只点击正式入口，不访问内部方法", () => {
    let clicks = 0;
    const runtime = {
      document: {
        querySelectorAll() {
          return [
            {
              textContent: "已发布运行",
              disabled: false,
              click() {
                clicks++;
              },
            },
          ];
        },
      },
    };
    assert.equal(openPublishedRuntimeInPage(runtime), true);
    assert.equal(clicks, 1);
  });

  void it("工程 ID 校验、原生 setter 赋值和输入事件不绕过真实表单", () => {
    const runtime = {
      document: {
        querySelector() {
          return null;
        },
      },
    };
    assert.throws(() => enterPublishedProjectInPage("../other", runtime), /工程标识不安全/);
    assert.throws(() => submitPublishedProjectInPage(runtime), /按钮不可用/);

    const events = [];
    const input = {
      dispatchEvent(event) {
        events.push({ type: event.type, bubbles: event.bubbles });
      },
    };
    Object.defineProperty(input, "value", {
      set() {
        throw new Error("不得通过受控输入框自身的 setter 赋值");
      },
    });
    const inputPrototype = {};
    Object.defineProperty(inputPrototype, "value", {
      set(value) {
        assert.equal(this, input);
        this.nativeValue = value;
      },
    });
    const browserRuntime = {
      HTMLInputElement: { prototype: inputPrototype },
      Event: class {
        constructor(type, options) {
          this.type = type;
          this.bubbles = options.bubbles;
        }
      },
      document: {
        querySelector() {
          return {
            querySelector() {
              return input;
            },
          };
        },
      },
    };
    const isolated = runInNewContext("(" + enterPublishedProjectInPage.toString() + ")");
    assert.equal(isolated(projectId, browserRuntime), true);
    assert.equal(input.nativeValue, projectId);
    assert.deepEqual(events, [{ type: "input", bubbles: true }]);

    browserRuntime.HTMLInputElement.prototype = {};
    assert.throws(() => isolated(projectId, browserRuntime), /输入接口不可用/);
  });

  void it("只返回可展示状态、画面存在与否和质量标识，不返回工程正文", () => {
    const root = {
      querySelector(selector) {
        if (selector === ".scada-status") {
          return {
            getAttribute() {
              return "denied";
            },
          };
        }
        if (selector === '[data-testid="published-runtime-svg"]') return null;
        return null;
      },
      querySelectorAll() {
        return [{ textContent: "不可用 · UNAVAILABLE" }];
      },
    };
    const runtime = {
      document: {
        querySelector() {
          return root;
        },
      },
    };
    assert.deepEqual(publishedRuntimeUiStateInPage(runtime), {
      status: "denied",
      snapshot: false,
      quality: true,
    });
  });

  void it("未知浏览器异常必须脱敏，不输出 Cookie 和令牌", () => {
    const unsafe = new Error("Cookie=secret; access_token=private");
    const message = describePublishedReadonlyFailure(unsafe);
    assert.equal(message, "正式发布运行只读专项未通过，内部诊断已脱敏");
    assert.equal(message.includes("secret"), false);
    assert.equal(message.includes("private"), false);
    assert.equal(
      describePublishedReadonlyFailure(new Error("正式发布运行只读专项发布读取没有受控拒绝")),
      "正式发布运行只读专项发布读取没有受控拒绝",
    );
  });
});
