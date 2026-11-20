import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  armPublishedOfflineFaultInPage,
  clickPublishedReadControlInPage,
  describePublishedOfflineFailure,
  installPublishedOfflineFaultInPage,
  parsePublishedOfflineMode,
  publishedOfflineFaultStateInPage,
  requirePublishedOfflineReadGuards,
  requirePublishedOfflineState,
} from "./test-oidc-published-runtime-offline.mjs";
import {
  installPublishedReadGuardInPage,
  publishedReadGuardStateInPage,
} from "./test-oidc-published-runtime-readonly.mjs";

const PROJECT_ID = "d5b-unreleased-12345678-1234-4234-8234-123456789abc";
const ORIGIN = "https://127.0.0.1:15173";
const PATH = "/api/v1/projects/" + PROJECT_ID + "/releases/current";

function offlinePage() {
  return {
    status: "offline",
    sameProject: true,
    releaseGeneration: null,
    releasedRevision: null,
    snapshot: false,
    quality: true,
  };
}

function setup() {
  const calls = [];
  const runtime = {
    location: { origin: ORIGIN },
    fetch: async (input, init) => {
      calls.push({ input, init });
      return { status: 200, ok: true };
    },
  };
  installPublishedReadGuardInPage(ORIGIN, runtime);
  return { runtime, calls };
}

function isolate(fn) {
  return runInNewContext("(" + fn.toString() + ")", { URL });
}

void describe("D5b2 双框架真实授权发布离线模拟与恢复安全门禁", () => {
  void it("只接受现有专用未发布 UUIDv4 工程；任何数据库写入参数均拒绝", () => {
    assert.deepEqual(parsePublishedOfflineMode(["--project-id", PROJECT_ID]), {
      projectId: PROJECT_ID,
    });
    for (const args of [
      [],
      ["--project-id", "d5b-released-12345678-1234-4234-8234-123456789abc"],
      ["--project-id", "existing-project"],
      ["--project-id", "../secrets"],
      ["--project-id", PROJECT_ID, "--confirm-lab", "adui_scada"],
      ["--apply", "--project-id", PROJECT_ID],
    ]) {
      assert.throws(() => parsePublishedOfflineMode(args), /仅允许现有专用/);
    }
  });

  void it("注入前必须已经安装只读门禁，并匹配可信 origin 和专用工程", () => {
    const { runtime } = setup();
    const install = isolate(installPublishedOfflineFaultInPage);
    assert.throws(
      () => install("https://evil.invalid", PROJECT_ID, runtime),
      /故障模拟门禁未就绪/,
    );
    assert.throws(() => install(ORIGIN, "../other", runtime), /故障模拟门禁未就绪/);
    delete runtime.__aduiPublishedReadGuard;
    assert.throws(() => install(ORIGIN, PROJECT_ID, runtime), /故障模拟门禁未就绪/);
    runtime.__aduiPublishedReadGuard = { paths: [], statuses: [], blocked: 0 };
    assert.equal(install(ORIGIN, PROJECT_ID, runtime), true);
    assert.throws(() => install(ORIGIN, PROJECT_ID, runtime), /故障模拟门禁未就绪/);
  });

  void it("未 arm 时真实 GET 必须进入只读门禁且返回真实 HTTP 状态", async () => {
    const { runtime, calls } = setup();
    isolate(installPublishedOfflineFaultInPage)(ORIGIN, PROJECT_ID, runtime);
    const response = await runtime.fetch(PATH, { method: "GET" });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(publishedReadGuardStateInPage(runtime), {
      paths: [PATH],
      statuses: [200],
      blocked: 0,
    });
    assert.deepEqual(publishedOfflineFaultStateInPage(runtime), { injected: 0, armed: false });
  });

  void it("只拒绝精确目标的一次 GET，不能执行第二次故障", async () => {
    const { runtime, calls } = setup();
    isolate(installPublishedOfflineFaultInPage)(ORIGIN, PROJECT_ID, runtime);
    const arm = isolate(armPublishedOfflineFaultInPage);
    assert.equal(arm(runtime), true);
    await assert.rejects(runtime.fetch(PATH, { method: "GET" }), /模拟单次/);
    assert.deepEqual(publishedOfflineFaultStateInPage(runtime), { injected: 1, armed: false });
    assert.equal(calls.length, 0);
    assert.throws(() => arm(runtime), /限定为一次/);
    assert.equal((await runtime.fetch(PATH, { method: "GET" })).status, 200);
    assert.deepEqual(publishedReadGuardStateInPage(runtime), {
      paths: [PATH],
      statuses: [200],
      blocked: 0,
    });
    assert.equal(calls.length, 1);
  });

  void it("跨 Origin、其他接口及非 GET 均不能触发注入并仍经过只读门禁", async () => {
    const { runtime, calls } = setup();
    isolate(installPublishedOfflineFaultInPage)(ORIGIN, PROJECT_ID, runtime);
    isolate(armPublishedOfflineFaultInPage)(runtime);
    await runtime.fetch("/api/v1/auth/me", { method: "GET" });
    await runtime.fetch("/api/v1/health", { method: "GET" });
    assert.equal(calls.length, 2);
    for (const [path, options] of [
      [PATH, { method: "POST" }],
      ["https://evil.invalid" + PATH, { method: "GET" }],
      [PATH, { method: "GET", body: "{}" }],
      [PATH, { method: "GET", headers: { Authorization: "Bearer fake" } }],
    ]) {
      assert.throws(() => runtime.fetch(path, options), /拒绝非只读/);
    }
    assert.equal(runtime.__aduiPublishedReadGuard.blocked, 4);
    assert.deepEqual(publishedOfflineFaultStateInPage(runtime), { injected: 0, armed: true });
  });

  void it("只允许点击真实刷新与停止按钮，其他 DOM 操作不得绕过", () => {
    const clicks = [];
    const buttons = ["立即刷新", "停止读取", "读取正式发布"].map((label) => ({
      textContent: label,
      disabled: false,
      click() {
        clicks.push(label);
      },
    }));
    const runtime = {
      document: {
        querySelector() {
          return { querySelector: () => ({ querySelectorAll: () => buttons }) };
        },
      },
    };
    const click = isolate(clickPublishedReadControlInPage);
    assert.equal(click("立即刷新", runtime), true);
    assert.equal(click("停止读取", runtime), true);
    assert.deepEqual(clicks, ["立即刷新", "停止读取"]);
    assert.throws(() => click("读取正式发布", runtime), /故障模拟门禁未就绪/);
    buttons[0].disabled = true;
    assert.throws(() => click("立即刷新", runtime), /故障模拟门禁未就绪/);
  });

  void it("离线状态必须清空发布代次与快照并保留不可用质量", () => {
    assert.equal(requirePublishedOfflineState(offlinePage()), true);
    for (const diff of [
      { status: "unreleased" },
      { sameProject: false },
      { releaseGeneration: 1 },
      { releasedRevision: 1 },
      { snapshot: true },
      { quality: false },
    ]) {
      assert.throws(() => requirePublishedOfflineState({ ...offlinePage(), ...diff }), /离线终态/);
    }
  });

  void it("故障前后只允许两条真实 200 和一个注入失败，拒绝额外 GET 或写入", () => {
    const base = { paths: [PATH], statuses: [200], blocked: 0 };
    const fault = { injected: 1, armed: false };
    assert.equal(requirePublishedOfflineReadGuards(base, fault, PROJECT_ID, false), true);
    assert.equal(
      requirePublishedOfflineReadGuards(
        { paths: [PATH, PATH], statuses: [200, 200], blocked: 0 },
        fault, PROJECT_ID, true,
      ),
      true,
    );
    for (const guard of [
      { ...base, blocked: 1 },
      { ...base, paths: [PATH, "/api/v1/projects/other"] },
      { ...base, statuses: [200, 404] },
      { ...base, paths: [PATH, PATH] },
    ]) {
      assert.throws(
        () => requirePublishedOfflineReadGuards(guard, fault, PROJECT_ID, false),
        /额外请求或非只读写入/,
      );
    }
    assert.throws(
      () =>
        requirePublishedOfflineReadGuards(
          base,
          { injected: 0, armed: true },
          PROJECT_ID,
          false,
        ),
      /额外请求或非只读写入/,
    );
  });

  void it("阶段和异常信息只允许白名单中文，不泄露凭据或工程正文", () => {
    const problem = new Error("D5b2 浏览器阶段失败");
    problem.phase = "React：验证离线清理";
    problem.safeReason = "D5b2 模拟网络故障未产生离线终态";
    assert.equal(
      describePublishedOfflineFailure(problem),
      "D5b2 React：验证离线清理失败：D5b2 模拟网络故障未产生离线终态",
    );
    problem.phase = "Cookie=SECRET; access_token=SECRET";
    assert.equal(
      describePublishedOfflineFailure(problem),
      "D5b2 真实只读离线恢复专项失败，内部诊断已脱敏",
    );
    assert.equal(
      describePublishedOfflineFailure(new Error("Cookie=SECRET; access_token=SECRET")),
      "D5b2 真实只读离线恢复专项失败，内部诊断已脱敏",
    );
  });
});
