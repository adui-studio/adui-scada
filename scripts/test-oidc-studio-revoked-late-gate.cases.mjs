import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  d5b5cLateReadStateInPage,
  installD5b5cLateGateInPage,
  releaseD5b5cLateReadInPage,
  requireD5b5cLateReadState,
  startD5b5cLateReadInPage,
} from "./test-oidc-studio-revoked-late-gate.mjs";
import { D5B5_PROTECTION_REASONS } from "./test-oidc-studio-revoked-multitab.mjs";
import { describeD5b5cBrowserFailure } from "./test-oidc-studio-revoked-late-multitab.mjs";

const ORIGIN = "https://127.0.0.1:15173";
const PROJECT = "d5b4-revoke-12345678-1234-4234-8234-123456789abc";
const PATH = "/api/v1/projects/" + PROJECT + "/releases/current";

function fixture({ status = 404, cache = "no-store", redirected = false, fail = false } = {}) {
  const calls = [];
  const guard = { blocked: 0 };
  const runtime = {
    location: { origin: ORIGIN },
    __aduiPublishedReadGuard: guard,
    fetch: (input, options) => {
      const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
      const method = options?.method ?? "GET";
      if (url.pathname.startsWith("/api/v1/projects") && method !== "GET") {
        guard.blocked += 1;
        throw new Error("模拟页面工程写入被只读门禁拒绝");
      }
      calls.push({ path: url.pathname, method });
      if (fail) return Promise.reject(new Error("私密网络错误 Cookie=SECRET"));
      return Promise.resolve({
        status,
        redirected,
        url: ORIGIN + url.pathname,
        headers: { get: (name) => (name === "cache-control" ? cache : null) },
      });
    },
  };
  return { runtime, calls, guard };
}

async function until(check) {
  for (let index = 0; index < 50; index += 1) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("等待页面只读状态变化超时");
}

void describe("D5b5c 已撤权工程双标签页真实响应逆序交付安全门禁", () => {
  void it("仅接受本机可信 Origin、D5b4 随机专用工程和已安装只读守卫", () => {
    const { runtime } = fixture();
    assert.equal(installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime), true);
    const { runtime: missing } = fixture();
    delete missing.__aduiPublishedReadGuard;
    assert.throws(
      () => installD5b5cLateGateInPage(ORIGIN, PROJECT, missing),
      /真实只读响应门禁安装失败/,
    );
    const { runtime: wrong } = fixture();
    assert.throws(
      () => installD5b5cLateGateInPage("https://external.invalid", PROJECT, wrong),
      /真实只读响应门禁安装失败/,
    );
    assert.throws(
      () => installD5b5cLateGateInPage(ORIGIN, "../old-project", wrong),
      /真实只读响应门禁安装失败/,
    );
  });

  void it("同一页面禁止重复安装真实响应门禁", () => {
    const { runtime } = fixture();
    installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
    assert.throws(
      () => installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime),
      /真实只读响应门禁安装失败/,
    );
  });

  void it("一次真实 404 必须在释放前完成网络读取但保持页面 Promise 未完成", async () => {
    const { runtime, calls } = fixture();
    installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
    assert.equal(startD5b5cLateReadInPage(runtime), true);
    await until(() => d5b5cLateReadStateInPage(runtime).pending);
    const state = d5b5cLateReadStateInPage(runtime);
    assert.equal(requireD5b5cLateReadState(state, "pending"), true);
    assert.deepEqual(calls, [{ path: PATH, method: "GET" }]);
    assert.equal(state.settled, false);
    assert.equal(releaseD5b5cLateReadInPage(runtime), true);
    await until(() => d5b5cLateReadStateInPage(runtime).settled);
    assert.equal(requireD5b5cLateReadState(d5b5cLateReadStateInPage(runtime), "settled"), true);
  });

  void it("两份独立标签响应能同时挂起并按第二页优先顺序交付", async () => {
    const first = fixture();
    const second = fixture();
    for (const { runtime } of [first, second]) {
      installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
      startD5b5cLateReadInPage(runtime);
    }
    await until(() =>
      [first, second].every(({ runtime }) => d5b5cLateReadStateInPage(runtime).pending),
    );
    releaseD5b5cLateReadInPage(second.runtime);
    await until(() => d5b5cLateReadStateInPage(second.runtime).settled);
    assert.equal(
      requireD5b5cLateReadState(d5b5cLateReadStateInPage(first.runtime), "pending"),
      true,
    );
    assert.equal(
      requireD5b5cLateReadState(d5b5cLateReadStateInPage(second.runtime), "settled"),
      true,
    );
    releaseD5b5cLateReadInPage(first.runtime);
    await until(() => d5b5cLateReadStateInPage(first.runtime).settled);
    assert.equal(
      requireD5b5cLateReadState(d5b5cLateReadStateInPage(first.runtime), "settled"),
      true,
    );
  });

  void it("未发起请求时拒绝提前释放，完成后拒绝重复释放", async () => {
    const { runtime } = fixture();
    installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
    assert.throws(() => releaseD5b5cLateReadInPage(runtime), /尚未处于可释放状态/);
    startD5b5cLateReadInPage(runtime);
    await until(() => d5b5cLateReadStateInPage(runtime).pending);
    releaseD5b5cLateReadInPage(runtime);
    assert.throws(() => releaseD5b5cLateReadInPage(runtime), /尚未处于可释放状态/);
    await until(() => d5b5cLateReadStateInPage(runtime).settled);
  });

  void it("挂起期间重复启动必须失败且不能发出额外网络请求", async () => {
    const { runtime, calls } = fixture();
    installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
    startD5b5cLateReadInPage(runtime);
    await until(() => d5b5cLateReadStateInPage(runtime).pending);
    assert.throws(() => startD5b5cLateReadInPage(runtime), /真实只读请求启动失败/);
    assert.equal(calls.length, 1);
    releaseD5b5cLateReadInPage(runtime);
    await until(() => d5b5cLateReadStateInPage(runtime).settled);
  });

  void it("相同发布路径的额外 GET 在接触原生 Fetch 前拒绝", async () => {
    const { runtime, calls } = fixture();
    installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
    startD5b5cLateReadInPage(runtime);
    await until(() => d5b5cLateReadStateInPage(runtime).pending);
    assert.throws(
      () =>
        runtime.fetch(PATH, {
          method: "GET",
          cache: "no-store",
          redirect: "error",
          credentials: "same-origin",
        }),
      /只允许一次精确的无缓存同源 GET/,
    );
    assert.equal(calls.length, 1);
    assert.throws(
      () => requireD5b5cLateReadState(d5b5cLateReadStateInPage(runtime), "pending"),
      /真实 404 响应挂起或释放时序不符合预期/,
    );
    releaseD5b5cLateReadInPage(runtime);
  });

  void it("其他工程 GET 透传原有只读守卫，发布目标附加查询参数不被误截获", async () => {
    const { runtime, calls } = fixture();
    installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
    await runtime.fetch(PATH + "?unexpected=1", { method: "GET" });
    await runtime.fetch("/api/v1/projects/" + PROJECT, { method: "GET" });
    assert.equal(d5b5cLateReadStateInPage(runtime).intercepted, 0);
    assert.equal(calls.length, 2);
  });

  void it("工程 POST 必须交给已存在的只读守卫阻断且零服务端请求", () => {
    const { runtime, calls, guard } = fixture();
    installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
    assert.throws(() => runtime.fetch(PATH, { method: "POST" }), /工程写入被只读门禁拒绝/);
    assert.equal(guard.blocked, 1);
    assert.equal(calls.length, 0);
  });

  void it("真实 200、401 与 403 都不得伪装撤权后 404", async () => {
    for (const status of [200, 401, 403]) {
      const { runtime } = fixture({ status });
      installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
      startD5b5cLateReadInPage(runtime);
      await until(() => d5b5cLateReadStateInPage(runtime).pending);
      assert.throws(
        () => requireD5b5cLateReadState(d5b5cLateReadStateInPage(runtime), "pending"),
        /真实 404 响应挂起或释放时序不符合预期/,
      );
      releaseD5b5cLateReadInPage(runtime);
    }
  });

  void it("缺少 no-store 或真实 HTTP 重定向必须失败", async () => {
    for (const options of [{ cache: "public" }, { redirected: true }]) {
      const { runtime } = fixture(options);
      installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
      startD5b5cLateReadInPage(runtime);
      await until(() => d5b5cLateReadStateInPage(runtime).pending);
      assert.throws(
        () => requireD5b5cLateReadState(d5b5cLateReadStateInPage(runtime), "pending"),
        /真实 404 响应挂起或释放时序不符合预期/,
      );
      releaseD5b5cLateReadInPage(runtime);
    }
  });

  void it("真实网络失败只能变成固定状态，不回显敏感异常", async () => {
    const { runtime } = fixture({ fail: true });
    installD5b5cLateGateInPage(ORIGIN, PROJECT, runtime);
    startD5b5cLateReadInPage(runtime);
    await until(() => d5b5cLateReadStateInPage(runtime).failed);
    const state = d5b5cLateReadStateInPage(runtime);
    assert.equal(state.failed, true);
    assert.equal(JSON.stringify(state).includes("SECRET"), false);
    assert.throws(
      () => requireD5b5cLateReadState(state, "pending"),
      /真实 404 响应挂起或释放时序不符合预期/,
    );
  });

  void it("真实浏览器保护断言类别必须透传至受审白名单且不泄漏敏感原文", () => {
    const failure = new Error("D5b5c 浏览器阶段失败");
    failure.stage = "React：先交付第二标签页真实 404";
    failure.safeReason = D5B5_PROTECTION_REASONS[3];
    assert.equal(
      describeD5b5cBrowserFailure(failure),
      "D5b5c React：先交付第二标签页真实 404失败：" + "D5b5 双标签读取期间工程请求数量不符",
    );
    failure.safeReason = "D5b5c 真实 404 响应挂起或释放时序不符合预期";
    assert.match(describeD5b5cBrowserFailure(failure), /响应挂起或释放时序不符合预期/);
    failure.safeReason = "Cookie=SECRET Token=SECRET";
    assert.doesNotMatch(describeD5b5cBrowserFailure(failure), /SECRET/);
    failure.stage = "私密工程阶段 Cookie=SECRET";
    assert.doesNotMatch(describeD5b5cBrowserFailure(failure), /SECRET/);
  });

  void it("四个 CDP 页面函数单独序列化后不依赖 Node 模块闭包", async () => {
    const { runtime } = fixture();
    const context = { ...runtime, URL };
    const install = runInNewContext("(" + installD5b5cLateGateInPage.toString() + ")", context);
    const start = runInNewContext("(" + startD5b5cLateReadInPage.toString() + ")", context);
    const inspect = runInNewContext("(" + d5b5cLateReadStateInPage.toString() + ")", context);
    const release = runInNewContext("(" + releaseD5b5cLateReadInPage.toString() + ")", context);
    assert.equal(install(ORIGIN, PROJECT, context), true);
    assert.equal(start(context), true);
    await until(() => inspect(context).pending);
    assert.equal(requireD5b5cLateReadState(inspect(context), "pending"), true);
    assert.equal(release(context), true);
    await until(() => inspect(context).settled);
    assert.equal(requireD5b5cLateReadState(inspect(context), "settled"), true);
  });
});
