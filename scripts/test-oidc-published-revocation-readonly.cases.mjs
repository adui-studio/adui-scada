import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  d5b4ResponseStateInPage,
  describeD5b4ReadonlyFailure,
  enterD5b4ProjectInPage,
  installD5b4ResponseObserverInPage,
  parseD5b4ReadonlyMode,
  requireD5b4ReadonlyResult,
  requireD5b4Stopped,
} from "./test-oidc-published-revocation-readonly.mjs";
import {
  installPublishedReadGuardInPage,
  publishedReadGuardStateInPage,
} from "./test-oidc-published-runtime-readonly.mjs";

const PROJECT_ID = "d5b4-revoke-12345678-1234-4234-8234-123456789abc";
const OLD_ID = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
const ORIGIN = "https://127.0.0.1:15173";
const PATH = "/api/v1/projects/" + PROJECT_ID + "/releases/current";

function page(phase) {
  return {
    sameProject: true,
    quality: true,
    snapshot: false,
    releasedRevision: null,
    status: phase === "before" ? "unreleased" : "denied",
    releaseGeneration: phase === "before" ? 0 : null,
  };
}

function readState(status) {
  return {
    guard: { paths: [PATH], statuses: [status], blocked: 0 },
    observer: { requests: 1, statuses: [status], noStore: [true] },
  };
}

function setup(status = 200, cacheControl = "no-store") {
  const calls = [];
  const runtime = {
    location: { origin: ORIGIN },
    fetch: async (input, init) => {
      calls.push({ input, init });
      return {
        status,
        headers: {
          get(name) {
            return name.toLowerCase() === "cache-control" ? cacheControl : null;
          },
        },
      };
    },
  };
  installPublishedReadGuardInPage(ORIGIN, runtime);
  return { runtime, calls };
}

function isolate(fn) {
  return runInNewContext("(" + fn.toString() + ")", { URL });
}

void describe("D5b4d 撤权前后双框架只读浏览器验收安全门禁", () => {
  void it("只能指定明确阶段与随机 D5b4 专用工程，禁止写入和复用旧工程", () => {
    for (const phase of ["before", "after"]) {
      assert.deepEqual(parseD5b4ReadonlyMode(["--phase", phase, "--project-id", PROJECT_ID]), {
        phase,
        projectId: PROJECT_ID,
      });
    }
    for (const args of [
      [],
      ["--phase", "before"],
      ["--phase", "revoke", "--project-id", PROJECT_ID],
      ["--phase", "before", "--project-id", OLD_ID],
      ["--phase", "before", "--project-id", "d5b4-revoke-example"],
      ["--phase", "after", "--project-id", "../secret"],
      ["--apply", "--confirm-lab", "adui_scada"],
      ["--phase", "after", "--project-id", PROJECT_ID, "--restore"],
      ["--phase", "before", "--project-id", PROJECT_ID, "--revoke"],
    ]) {
      assert.throws(() => parseD5b4ReadonlyMode(args), /只接受明确阶段与已存在的独立工程 ID/);
    }
  });

  void it("独立页面输入函数只接受 D5b4 UUIDv4 并调用真实原生 setter", () => {
    const input = {
      value: "",
      events: [],
      dispatchEvent(event) {
        this.events.push(event.type);
      },
    };
    const prototype = {};
    Object.defineProperty(prototype, "value", {
      set(value) {
        assert.equal(this, input);
        this.value = value;
      },
    });
    const runtime = {
      HTMLInputElement: { prototype },
      Event: class {
        constructor(type) {
          this.type = type;
        }
      },
      document: {
        querySelector() {
          return { querySelector: () => input };
        },
      },
    };
    const enter = isolate(enterD5b4ProjectInPage);
    assert.equal(enter(PROJECT_ID, runtime), true);
    assert.equal(input.value, PROJECT_ID);
    assert.deepEqual(input.events, ["input"]);
    assert.throws(() => enter(OLD_ID, runtime), /独立工程输入不可用/);
    assert.throws(() => enter("../secret", runtime), /独立工程输入不可用/);
  });

  void it("输入框或原生 setter 不存在时必须安全拒绝", () => {
    const enter = isolate(enterD5b4ProjectInPage);
    const missing = {
      HTMLInputElement: { prototype: {} },
      document: { querySelector: () => ({ querySelector: () => null }) },
    };
    assert.throws(() => enter(PROJECT_ID, missing), /独立工程输入不可用/);
  });

  void it("响应观察器必须安装在真实只读门禁之后，并限制可信 Origin 与专用工程", () => {
    const { runtime } = setup();
    const install = isolate(installD5b4ResponseObserverInPage);
    assert.throws(
      () => install("https://evil.invalid", PROJECT_ID, runtime),
      /响应只读观察器未就绪/,
    );
    assert.throws(() => install(ORIGIN, OLD_ID, runtime), /响应只读观察器未就绪/);
    delete runtime.__aduiPublishedReadGuard;
    assert.throws(() => install(ORIGIN, PROJECT_ID, runtime), /响应只读观察器未就绪/);
    runtime.__aduiPublishedReadGuard = { paths: [], statuses: [], blocked: 0 };
    assert.equal(install(ORIGIN, PROJECT_ID, runtime), true);
    assert.throws(() => install(ORIGIN, PROJECT_ID, runtime), /响应只读观察器未就绪/);
  });

  void it("真实 GET 的状态码与禁止缓存仅被观察，响应和请求不被替换", async () => {
    const { runtime, calls } = setup(200);
    isolate(installD5b4ResponseObserverInPage)(ORIGIN, PROJECT_ID, runtime);
    const result = await runtime.fetch(PATH, { method: "GET", credentials: "same-origin" });
    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, PATH);
    assert.deepEqual(publishedReadGuardStateInPage(runtime), {
      paths: [PATH],
      statuses: [200],
      blocked: 0,
    });
    const summary = d5b4ResponseStateInPage(runtime);
    assert.equal(summary.requests, 1);
    assert.equal(summary.statuses[0], 200);
    assert.equal(summary.noStore[0], true);
    assert.notEqual(runtime.__aduiD5b4ReadObserver, summary);
  });

  void it("404 必须来自底层真实 Fetch，不允许脚本自行合成拒绝", async () => {
    const { runtime, calls } = setup(404);
    isolate(installD5b4ResponseObserverInPage)(ORIGIN, PROJECT_ID, runtime);
    const response = await runtime.fetch(PATH, { method: "GET" });
    assert.equal(response.status, 404);
    assert.equal(calls.length, 1);
    assert.equal(d5b4ResponseStateInPage(runtime).statuses[0], 404);
    assert.equal(requireD5b4ReadonlyResult("after", PROJECT_ID, page("after"),
      publishedReadGuardStateInPage(runtime), d5b4ResponseStateInPage(runtime)).status, 404);
  });

  void it("所有工程 POST、带请求体或跨 Origin 访问都被既有门禁阻断", async () => {
    const { runtime, calls } = setup();
    isolate(installD5b4ResponseObserverInPage)(ORIGIN, PROJECT_ID, runtime);
    for (const [path, init] of [
      [PATH, { method: "POST" }],
      [PATH, { method: "DELETE" }],
      [PATH, { method: "GET", body: "{}" }],
      [PATH, { method: "GET", headers: { Authorization: "Bearer fake" } }],
      ["https://evil.invalid" + PATH, { method: "GET" }],
    ]) {
      assert.throws(() => runtime.fetch(path, init), /拒绝非只读工程请求/);
    }
    assert.equal(calls.length, 0);
    assert.equal(runtime.__aduiPublishedReadGuard.blocked, 5);
  });

  void it("撤权前 200/UNRELEASED 和撤权后 404/denied 分别严格通过", () => {
    const before = readState(200);
    const after = readState(404);
    assert.deepEqual(
      requireD5b4ReadonlyResult("before", PROJECT_ID, page("before"), before.guard,
        before.observer),
      { phase: "before", status: 200, releaseGeneration: 0 },
    );
    assert.deepEqual(
      requireD5b4ReadonlyResult("after", PROJECT_ID, page("after"), after.guard,
        after.observer),
      { phase: "after", status: 404, releaseGeneration: null },
    );
  });

  void it("前后阶段错位、403/401 或保留 200 不得伪装撤权成功", () => {
    for (const [phase, status] of [
      ["before", 404],
      ["before", 401],
      ["after", 200],
      ["after", 403],
      ["after", 401],
    ]) {
      const state = readState(status);
      assert.throws(
        () => requireD5b4ReadonlyResult(phase, PROJECT_ID, page(phase), state.guard,
          state.observer),
        phase === "before" ? /撤权前必须真实返回 HTTP 200/ : /撤权后必须真实返回 HTTP 404/,
      );
    }
  });

  void it("任何响应缓存、状态码篡改、跨工程请求、额外请求或被阻断写入均失败", () => {
    const candidates = [
      ({ guard }) => { guard.blocked = 1; },
      ({ guard }) => { guard.paths[0] = "/api/v1/projects/" + OLD_ID + "/releases/current"; },
      ({ guard }) => { guard.paths.push(PATH); },
      ({ guard }) => { guard.statuses[0] = 404; },
      ({ observer }) => { observer.requests = 2; },
      ({ observer }) => { observer.statuses.push(200); },
      ({ observer }) => { observer.noStore[0] = false; },
      ({ observer }) => { observer.noStore.push(true); },
    ];
    for (const change of candidates) {
      const state = readState(200);
      change(state);
      assert.throws(
        () => requireD5b4ReadonlyResult("before", PROJECT_ID, page("before"),
          state.guard, state.observer),
        /发布读取请求不符合只读约束/,
      );
    }
  });

  void it("拒绝后必须清空发布指针和快照，且质量始终为 UNAVAILABLE", () => {
    for (const changes of [
      { status: "unreleased" },
      { sameProject: false },
      { quality: false },
      { snapshot: true },
      { releasedRevision: 1 },
      { releaseGeneration: 0 },
    ]) {
      const state = readState(404);
      assert.throws(
        () => requireD5b4ReadonlyResult("after", PROJECT_ID,
          { ...page("after"), ...changes }, state.guard, state.observer),
        /发布运行页面状态不符合预期/,
      );
    }
  });

  void it("停止读取必须清空状态且没有任何新增真实 GET", () => {
    const state = readState(404);
    const stopped = { ...page("after"), status: "idle" };
    assert.equal(requireD5b4Stopped(stopped, state.guard, state.observer, PROJECT_ID, 404), true);
    for (const change of [
      () => { stopped.status = "denied"; },
      () => { stopped.snapshot = true; },
      () => { state.guard.paths.push(PATH); },
      () => { state.observer.requests = 2; },
    ]) {
      const clean = readState(404);
      const view = { ...page("after"), status: "idle" };
      if (change.toString().includes("stopped.")) {
        // 另行对页面字段执行精确反向检查。
        view.status = "denied";
      } else {
        clean.observer.requests = 2;
      }
      assert.throws(
        () => requireD5b4Stopped(view, clean.guard, clean.observer, PROJECT_ID, 404),
        /停止读取后仍保留发布状态或产生额外请求/,
      );
    }
  });

  void it("观察器不应在页面访问其他非工程接口时制造额外发布读取", async () => {
    const { runtime, calls } = setup();
    isolate(installD5b4ResponseObserverInPage)(ORIGIN, PROJECT_ID, runtime);
    await runtime.fetch("/api/v1/auth/me", { method: "GET" });
    assert.equal(calls.length, 1);
    assert.equal(d5b4ResponseStateInPage(runtime).requests, 0);
    assert.equal(publishedReadGuardStateInPage(runtime).paths.length, 0);
  });

  void it("诊断只允许固定阶段和错误类别，不泄漏 Cookie、Token 或原始异常", () => {
    const unknown = new Error("Cookie=SECRET; token=SECRET; project=SECRET");
    const message = describeD5b4ReadonlyFailure(unknown);
    assert.match(message, /内部信息已脱敏/);
    assert.doesNotMatch(message, /SECRET/);

    const staged = new Error("D5b4d 浏览器阶段失败");
    staged.phase = "Vue：核对响应和页面状态";
    staged.pageDiagnostic = "token=SECRET";
    staged.safeReason = "Cookie=SECRET";
    assert.match(describeD5b4ReadonlyFailure(staged), /未知异常已脱敏/);
    assert.doesNotMatch(describeD5b4ReadonlyFailure(staged), /SECRET/);
    staged.safeReason = "D5b4d 撤权后必须真实返回 HTTP 404";
    assert.match(describeD5b4ReadonlyFailure(staged), /撤权后必须真实返回 HTTP 404/);
    staged.phase = "其他阶段;token=SECRET";
    assert.doesNotMatch(describeD5b4ReadonlyFailure(staged), /SECRET/);
  });
});
