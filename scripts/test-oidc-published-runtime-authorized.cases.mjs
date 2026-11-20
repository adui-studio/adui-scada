import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  describePublishedAuthorizedFailure,
  enterPublishedAuthorizedProjectInPage,
  isPublishedAuthorizedTerminalState,
  parsePublishedAuthorizedMode,
  requirePublishedAuthorizedRead,
  publishedAuthorizedUiStateInPage,
  requirePublishedAuthorizedState,
} from "./test-oidc-published-runtime-authorized.mjs";
import {
  installPublishedReadGuardInPage,
  publishedReadGuardStateInPage,
} from "./test-oidc-published-runtime-readonly.mjs";

const unreleasedId = "d5b-unreleased-12345678-1234-4234-8234-123456789abc";
const releasedId = "d5b-released-12345678-1234-4234-8234-123456789abc";
const origin = "https://127.0.0.1:15173";

function state(status = "unreleased") {
  return {
    status,
    sameProject: true,
    releaseGeneration: status === "unreleased" ? 0 : 2,
    releasedRevision: status === "unreleased" ? null : 1,
    snapshot: status === "verified",
    quality: true,
  };
}

function pageFixture(expectedProjectId, status = "unreleased") {
  const values = new Map([
    ["工程", expectedProjectId],
    ["发布代次", status === "unreleased" ? "0" : "2"],
    ["发布修订", status === "unreleased" ? "--" : "1"],
  ]);
  const labels = [...values.entries()].map(([key, value]) => ({
    textContent: key,
    nextElementSibling: { textContent: value },
  }));
  const panel = {
    querySelector(selector) {
      if (selector === ".scada-status") {
        return {
          getAttribute() {
            return status;
          },
        };
      }
      if (selector === '[data-testid="published-runtime-svg"]') {
        return status === "verified" ? {} : null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "dt") return labels;
      if (selector === "dd") return [{ textContent: "不可用 · UNAVAILABLE" }];
      return [];
    },
  };
  return {
    document: {
      querySelector(selector) {
        return selector === '[data-testid="published-runtime-page"]' ? panel : null;
      },
    },
    entries: labels,
  };
}

void describe("D5b1 双框架真实发布授权只读专项", () => {
  void it("必须同时指定发布状态和预置 UUID v4 工程，参数无写入模式", () => {
    assert.deepEqual(
      parsePublishedAuthorizedMode(["--status", "UNRELEASED", "--project-id", unreleasedId]),
      { expectedStatus: "UNRELEASED", projectId: unreleasedId },
    );
    assert.deepEqual(
      parsePublishedAuthorizedMode(["--status", "RELEASED", "--project-id", releasedId]),
      { expectedStatus: "RELEASED", projectId: releasedId },
    );
    for (const args of [
      [],
      ["--write", "--confirm-lab", "adui_scada"],
      ["--status", "RELEASED", "--project-id", unreleasedId],
      ["--status", "UNRELEASED", "--project-id", releasedId],
      ["--status", "RELEASED", "--project-id", "../other"],
      ["--status", "RELEASED", "--project-id", "d5b-released-12345678-1234-1234-8234-123456789abc"],
      ["--status", "RELEASED", "--project-id", releasedId, "--force"],
    ]) {
      assert.throws(() => parsePublishedAuthorizedMode(args), /D5b1 只允许|预置工程名称/);
    }
  });

  void it("受控输入直接调用原生 setter 并派发冒泡事件，CDP 上下文自包含", () => {
    const events = [];
    const input = {
      dispatchEvent(event) {
        events.push([event.type, event.bubbles]);
      },
    };
    Object.defineProperty(input, "value", {
      set() {
        throw new Error("不得调用受控输入自身的 setter");
      },
    });
    const prototype = {};
    Object.defineProperty(prototype, "value", {
      set(value) {
        assert.equal(this, input);
        this.nativeValue = value;
      },
    });
    const panel = {
      querySelector() {
        return input;
      },
    };
    const runtime = {
      HTMLInputElement: { prototype },
      Event: class {
        constructor(type, options) {
          this.type = type;
          this.bubbles = options.bubbles;
        }
      },
      document: {
        querySelector() {
          return panel;
        },
      },
    };
    const isolated = runInNewContext("(" + enterPublishedAuthorizedProjectInPage.toString() + ")");
    assert.equal(isolated(unreleasedId, runtime), true);
    assert.equal(input.nativeValue, unreleasedId);
    assert.deepEqual(events, [["input", true]]);
    assert.throws(() => isolated("../other", runtime), /标识不符合隔离规则/);
    runtime.HTMLInputElement.prototype = {};
    assert.throws(() => isolated(unreleasedId, runtime), /受控输入接口不可用/);
  });

  void it("未发布状态仅返回脱敏页面摘要，不包含工程正文", () => {
    const fixture = pageFixture(unreleasedId);
    const isolated = runInNewContext("(" + publishedAuthorizedUiStateInPage.toString() + ")");
    const actual = isolated(unreleasedId, fixture);
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), state());
    assert.equal(JSON.stringify(actual).includes(unreleasedId), false);
    assert.deepEqual(requirePublishedAuthorizedState(actual, "UNRELEASED"), {
      status: "UNRELEASED",
      releaseGeneration: 0,
      releasedRevision: null,
    });
  });

  void it("已发布必须由已校验的快照画面组成，且代次修订为正", () => {
    const actual = publishedAuthorizedUiStateInPage(
      releasedId,
      pageFixture(releasedId, "verified"),
    );
    assert.deepEqual(actual, state("verified"));
    assert.deepEqual(requirePublishedAuthorizedState(actual, "RELEASED"), {
      status: "RELEASED",
      releaseGeneration: 2,
      releasedRevision: 1,
    });
    assert.throws(
      () => requirePublishedAuthorizedState({ ...actual, snapshot: false }, "RELEASED"),
      /状态与预期不一致/,
    );
    assert.throws(
      () => requirePublishedAuthorizedState({ ...actual, releaseGeneration: 0 }, "RELEASED"),
      /状态与预期不一致/,
    );
  });

  void it("错误工程、缺少质量、篡改状态或附带旧画面全部默认拒绝", () => {
    for (const sample of [
      { ...state(), sameProject: false },
      { ...state(), quality: false },
      { ...state(), snapshot: true },
      { ...state(), releasedRevision: 1 },
      { ...state(), releaseGeneration: 4 },
      { ...state(), status: "denied" },
      null,
    ]) {
      assert.throws(
        () => requirePublishedAuthorizedState(sample, "UNRELEASED"),
        /状态与预期不一致/,
      );
    }
    const fixture = pageFixture(unreleasedId);
    assert.equal(publishedAuthorizedUiStateInPage(releasedId, fixture).sameProject, false);
    fixture.entries.find((item) => item.textContent === "发布代次").nextElementSibling.textContent =
      "9007199254740992";
    assert.equal(publishedAuthorizedUiStateInPage(unreleasedId, fixture).releaseGeneration, null);
  });

  void it("复用 D5a 同源只读门禁，非法项目写入不得触达真实 Fetch", async () => {
    const calls = [];
    const runtime = {
      location: { origin },
      async fetch(path) {
        calls.push(path);
        return { status: 200 };
      },
    };
    assert.equal(installPublishedReadGuardInPage(origin, runtime), true);
    assert.throws(
      () => runtime.fetch("/api/v1/projects/" + releasedId, { method: "POST" }),
      /拒绝非只读/,
    );
    await runtime.fetch("/api/v1/projects/" + releasedId + "/releases/current", {
      method: "GET",
    });
    assert.deepEqual(calls, ["/api/v1/projects/" + releasedId + "/releases/current"]);
    assert.deepEqual(publishedReadGuardStateInPage(runtime), {
      blocked: 1,
      paths: ["/api/v1/projects/" + releasedId + "/releases/current"],
      statuses: [200],
    });
  });

  void it("真实页面必须识别已发布、未发布、拒绝、离线和异常终态", () => {
    for (const status of ["unreleased", "verified", "denied", "offline", "error"]) {
      assert.equal(isPublishedAuthorizedTerminalState({ status }), true);
    }
    for (const status of ["idle", "loading", "unknown", null]) {
      assert.equal(isPublishedAuthorizedTerminalState({ status }), false);
    }
    assert.equal(isPublishedAuthorizedTerminalState(null), false);
  });

  void it("HTTP 404 必须指出预置工程或发布读取 ACL 前置条件，不能伪装为超时", () => {
    const response = {
      blocked: 0,
      paths: ["/api/v1/projects/" + unreleasedId + "/releases/current"],
      statuses: [404],
    };
    assert.throws(
      () =>
        requirePublishedAuthorizedRead({ status: "denied" }, response, "UNRELEASED", unreleasedId),
      /HTTP 404：预置工程不存在或未授予 release:read/,
    );
    for (const [http, expected] of [
      [401, /HTTP 401：可信会话已失效/],
      [403, /HTTP 403：没有正式发布读取授权/],
      [500, /没有返回 HTTP 200/],
    ]) {
      assert.throws(
        () =>
          requirePublishedAuthorizedRead(
            { status: "denied" },
            { ...response, statuses: [http] },
            "UNRELEASED",
            unreleasedId,
          ),
        expected,
      );
    }
  });

  void it("HTTP 200 仍严格检查真实状态及只读请求，任何额外请求不得漏过", () => {
    const guard = {
      blocked: 0,
      paths: ["/api/v1/projects/" + unreleasedId + "/releases/current"],
      statuses: [200],
    };
    assert.deepEqual(requirePublishedAuthorizedRead(state(), guard, "UNRELEASED", unreleasedId), {
      status: "UNRELEASED",
      releaseGeneration: 0,
      releasedRevision: null,
    });
    assert.deepEqual(
      requirePublishedAuthorizedRead(
        state("verified"),
        {
          blocked: 0,
          paths: ["/api/v1/projects/" + releasedId + "/releases/current"],
          statuses: [200],
        },
        "RELEASED",
        releasedId,
      ),
      { status: "RELEASED", releaseGeneration: 2, releasedRevision: 1 },
    );
    for (const invalid of [
      { ...guard, blocked: 1 },
      { ...guard, paths: [...guard.paths, "/api/v1/projects/other"] },
      { ...guard, statuses: [200, 200] },
      { ...guard, paths: ["/api/v1/projects/other/releases/current"] },
    ]) {
      assert.throws(
        () => requirePublishedAuthorizedRead(state(), invalid, "UNRELEASED", unreleasedId),
        /不符合只读约束/,
      );
    }
    assert.throws(
      () =>
        requirePublishedAuthorizedRead(
          { ...state(), status: "denied" },
          guard,
          "UNRELEASED",
          unreleasedId,
        ),
      /页面状态与预期不一致/,
    );
    assert.throws(
      () => requirePublishedAuthorizedRead(state(), guard, "UNRELEASED", "../other"),
      /不符合只读约束/,
    );
  });

  void it("非白名单阶段和敏感诊断绝不回显，已审核阶段只输出固定类别", () => {
    const error = new Error("D5b1 浏览器阶段验证失败");
    error.phase = "React：发布读取";
    error.pageDiagnostic = "页面脚本类型异常";
    assert.equal(
      describePublishedAuthorizedFailure(error),
      "D5b1 React：发布读取失败：页面脚本类型异常",
    );
    error.safeReason = "D5b1 HTTP 404：预置工程不存在或未授予 release:read";
    assert.equal(
      describePublishedAuthorizedFailure(error),
      "D5b1 React：发布读取失败：D5b1 HTTP 404：预置工程不存在或未授予 release:read",
    );
    error.phase = "Cookie=secret; access_token=private";
    assert.equal(
      describePublishedAuthorizedFailure(error),
      "D5b1 真实授权只读验收失败，内部信息已脱敏",
    );
    error.phase = "Vue：对照发布状态";
    error.safeReason = "access_token=private";
    error.pageDiagnostic = "access_token=private";
    error.failureKind = "assertion";
    assert.equal(
      describePublishedAuthorizedFailure(error),
      "D5b1 Vue：对照发布状态失败：安全断言不符",
    );
  });
});
