import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  D5B5_PROTECTION_REASONS,
  classifyD5b5PreservationFailure,
  describeD5b5MultiTabFailure,
  parseD5b5MultiTabArgs,
  requireD5b5NoBlockedWrites,
  requireD5b5ReadGuardProgress,
  requireD5b5SharedDraft,
  requireD5b5TabUnchanged,
  studioVisibilityInPage,
  waitForD5b5ReadGuardSettled,
} from "./test-oidc-studio-revoked-multitab.mjs";
import { requireD5b5Preserved } from "./test-oidc-studio-revoked-draft.mjs";

const ID = "d5b4-revoke-12345678-1234-4234-8234-123456789abc";
const ORIGINAL = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";

function state(symbol) {
  return {
    projectId: ID,
    canvas: "<svg>" + symbol + "</svg>",
    documentHash: (symbol === "甲" ? "a" : "b").repeat(64),
    draftCount: 1,
    draftHash: "c".repeat(64),
    autoSave: false,
    baselineRevision: 1,
  };
}

function guards() {
  return [
    {
      paths: ["/api/v1/projects/" + ID, "/api/v1/projects/" + ID + "/releases/current"],
      statuses: [200, 404],
      blocked: 0,
    },
    {
      paths: ["/api/v1/projects/" + ID + "/releases/current"],
      statuses: [404],
      blocked: 0,
    },
  ];
}

void describe("D5b5b 已撤权工程 React/Vue 同源双标签页只读安全门禁", () => {
  void it("仅接受真实已撤权专用工程 ID 格式，拒绝任意写入、恢复和阶段参数", () => {
    assert.deepEqual(parseD5b5MultiTabArgs(["--project-id", ID]), { projectId: ID });
    for (const args of [
      [],
      ["--project-id", ORIGINAL],
      ["--project-id", "d5b4-revoke-example"],
      ["--project-id", "../secret"],
      ["--project-id", ID, "--apply"],
      ["--project-id", ID, "--restore"],
      ["--project-id", ID, "--confirm-lab", "adui_scada"],
      ["--phase", "before", "--project-id", ID],
    ]) {
      assert.throws(() => parseD5b5MultiTabArgs(args), /只允许现有已撤权工程 ID/);
    }
  });

  void it("同源两个标签页共享一份已经保存的 IndexedDB 草稿与首版 CAS", () => {
    assert.equal(requireD5b5SharedDraft(state("甲"), state("乙"), ID), true);
    assert.notEqual(state("甲").canvas, state("乙").canvas);
    assert.notEqual(state("甲").documentHash, state("乙").documentHash);
  });

  void it("没有草稿或跨标签页草稿摘要不一致都必须拒绝", () => {
    for (const changed of [
      { draftCount: 0 },
      { draftCount: 2 },
      { draftCount: 1.5 },
      { draftHash: "wrong" },
      { draftHash: "d".repeat(64) },
    ]) {
      assert.throws(
        () => requireD5b5SharedDraft(state("甲"), { ...state("乙"), ...changed }, ID),
        /两个标签页未建立真实未保存编辑/,
      );
    }
    assert.throws(
      () => requireD5b5SharedDraft({ ...state("甲"), draftCount: 0 }, state("乙"), ID),
      /两个标签页未建立真实未保存编辑/,
    );
  });

  void it("错误工程、失效 CAS 与自动保存开启都不能作为稳定双标签页基线", () => {
    const variants = [
      { projectId: ORIGINAL },
      { baselineRevision: null },
      { baselineRevision: 2 },
      { autoSave: true },
    ];
    for (const changed of variants) {
      assert.throws(
        () => requireD5b5SharedDraft(state("甲"), { ...state("乙"), ...changed }, ID),
        /两个标签页未建立真实未保存编辑/,
      );
    }
    assert.throws(
      () => requireD5b5SharedDraft(state("甲"), state("乙"), ORIGINAL),
      /两个标签页未建立真实未保存编辑/,
    );
  });

  void it("各标签的未保存图元可不同，只要每个标签在真实 404 后原样保留", () => {
    assert.equal(requireD5b5TabUnchanged(ID, state("甲"), state("甲")), true);
    assert.equal(requireD5b5TabUnchanged(ID, state("乙"), state("乙")), true);
  });

  void it("任意标签页 SVG、JSON、草稿、自动保存、CAS 或工程发生变化都必须失败", () => {
    for (const changed of [
      { canvas: "<svg>修改</svg>" },
      { documentHash: "d".repeat(64) },
      { draftCount: 2 },
      { draftHash: "d".repeat(64) },
      { autoSave: true },
      { baselineRevision: null },
      { projectId: ORIGINAL },
    ]) {
      assert.throws(
        () => requireD5b5TabUnchanged(ID, state("甲"), { ...state("甲"), ...changed }),
        /SVG、工程 JSON、IndexedDB 草稿或 CAS 基线变化/,
      );
    }
  });

  void it("空快照、损坏摘要和错误基线必须安全失败，不能比较两个空值伪通过", () => {
    for (const pair of [
      [null, null],
      [state("甲"), null],
      [{ ...state("甲"), draftHash: "x" }, state("甲")],
      [state("甲"), { ...state("甲"), documentHash: "x" }],
      [state("甲"), { ...state("甲"), baselineRevision: 2 }],
    ]) {
      assert.throws(
        () => requireD5b5TabUnchanged(ID, pair[0], pair[1]),
        /SVG、工程 JSON、IndexedDB 草稿或 CAS 基线变化/,
      );
    }
    assert.throws(
      () => requireD5b5TabUnchanged(ORIGINAL, state("甲"), state("甲")),
      /SVG、工程 JSON、IndexedDB 草稿或 CAS 基线变化/,
    );
  });

  void it("两个标签的工程 API 门禁只允许真实 GET，阻断计数必须始终为零", () => {
    const [first, second] = guards();
    assert.equal(requireD5b5NoBlockedWrites(first, second), true);
    for (const corrupt of [
      (state) => ({ ...state, blocked: 1 }),
      (state) => ({ ...state, paths: state.paths.slice(1) }),
      (state) => ({ ...state, statuses: state.statuses.slice(0, -1) }),
      (state) => ({ ...state, paths: null }),
      (state) => ({ ...state, statuses: null }),
    ]) {
      assert.throws(
        () => requireD5b5NoBlockedWrites(corrupt(first), second),
        /工程 API 只读约束或发布 GET 404 不符合预期/,
      );
      assert.throws(
        () => requireD5b5NoBlockedWrites(first, corrupt(second)),
        /工程 API 只读约束或发布 GET 404 不符合预期/,
      );
    }
  });

  void it("任意缺失的页面工程写入守卫都必须拒绝", () => {
    const [first, second] = guards();
    assert.throws(
      () => requireD5b5NoBlockedWrites(null, second),
      /工程 API 只读约束或发布 GET 404 不符合预期/,
    );
    assert.throws(
      () => requireD5b5NoBlockedWrites(first, null),
      /工程 API 只读约束或发布 GET 404 不符合预期/,
    );
  });

  void it("页面可见性函数在独立 CDP Realm 可执行，不引用 Node 模块变量", () => {
    const page = runInNewContext("(" + studioVisibilityInPage.toString() + ")", {
      document: { visibilityState: "hidden" },
    });
    assert.equal(page(), "hidden");
    const visible = runInNewContext("(" + studioVisibilityInPage.toString() + ")", {
      document: { visibilityState: "visible" },
    });
    assert.equal(visible(), "visible");
  });

  void it("正在进行的只读 GET 仅使等待条件暂不满足，不得提前伪造已完成状态", () => {
    const pending = {
      paths: ["/api/v1/projects/" + ID],
      statuses: [],
      blocked: 0,
    };
    assert.equal(requireD5b5ReadGuardProgress(pending), false);
    const completed = { ...pending, statuses: [200] };
    assert.equal(requireD5b5ReadGuardProgress(completed), true);
    assert.deepEqual(pending.statuses, []);
  });

  void it("守卫等待器必须观察真实异步响应后才返回完整只读记录", async () => {
    const pathname = "/api/v1/projects/" + ID;
    const states = [
      { paths: [pathname], statuses: [], blocked: 0 },
      { paths: [pathname], statuses: [200], blocked: 0 },
    ];
    let reads = 0;
    const session = {
      evaluate: async () => {
        const value = states[Math.min(reads, states.length - 1)];
        reads += 1;
        return value;
      },
    };
    const settled = await waitForD5b5ReadGuardSettled(session);
    assert.equal(reads, 2);
    assert.deepEqual(settled, states[1]);
    assert.equal(settled.paths.length, settled.statuses.length);
  });

  void it("只读守卫阻断写入、结构错误或响应数反超路径数时立即拒绝", async () => {
    const pathname = "/api/v1/projects/" + ID;
    const invalidStates = [
      null,
      { paths: null, statuses: [404], blocked: 0 },
      { paths: [pathname], statuses: [200, 404], blocked: 0 },
      { paths: [pathname], statuses: [200], blocked: 1 },
    ];
    for (const guard of invalidStates) {
      assert.throws(
        () => requireD5b5ReadGuardProgress(guard),
        /D5b5b 工程 API 只读约束或发布 GET 404 不符合预期/,
      );
      await assert.rejects(
        waitForD5b5ReadGuardSettled({ evaluate: async () => guard }),
        /D5b5b 工程 API 只读约束或发布 GET 404 不符合预期/,
      );
    }
  });

  void it("等待已完成异步响应后仍须严格拒绝额外工程 GET", async () => {
    const pathname = "/api/v1/projects/" + ID;
    const target = pathname + "/releases/current";
    const base = { paths: [pathname], statuses: [200], blocked: 0 };
    const after = { paths: [pathname, target, target], statuses: [200, 404, 404], blocked: 0 };
    const idle = await waitForD5b5ReadGuardSettled({
      evaluate: async () => after,
    });
    assert.equal(requireD5b5ReadGuardProgress(idle), true);
    assert.throws(
      () =>
        requireD5b5Preserved(
          ID,
          state("甲"),
          state("甲"),
          { status: 404, noStore: true, direct: true },
          base,
          idle,
        ),
      /D5b5 浏览器工程请求不符合零写入约束/,
    );
  });

  void it("原有真实 404 与草稿保护断言保持严格通过条件", () => {
    const original = state("甲");
    const baseline = {
      paths: ["/api/v1/projects/" + ID],
      statuses: [200],
      blocked: 0,
    };
    const completed = {
      paths: [...baseline.paths, "/api/v1/projects/" + ID + "/releases/current"],
      statuses: [...baseline.statuses, 404],
      blocked: 0,
    };
    const response = { status: 404, noStore: true, direct: true };
    assert.equal(requireD5b5Preserved(ID, original, original, response, baseline, completed), true);
  });

  void it("额外工程 GET、响应计数错位和非只读请求仍被原始断言拒绝并分类", () => {
    const before = { paths: ["/api/v1/projects/" + ID], statuses: [200], blocked: 0 };
    const after = {
      paths: [...before.paths, "/api/v1/projects/" + ID + "/releases/current"],
      statuses: [200, 404],
      blocked: 0,
    };
    const response = { status: 404, noStore: true, direct: true };
    const cases = [
      {
        changed: { ...after, paths: [...before.paths, "/api/v1/projects/" + ID, after.paths[1]] },
        expected: "D5b5 双标签读取期间工程请求数量不符",
      },
      { changed: { ...after, statuses: [200] }, expected: "D5b5 双标签读取期间工程响应数量不符" },
      {
        changed: { ...after, statuses: [200, 401] },
        expected: "D5b5 双标签发布读取记录未返回 404",
      },
      { changed: { ...after, blocked: 1 }, expected: "D5b5 双标签出现非只读工程请求" },
    ];
    for (const { changed, expected } of cases) {
      let failure = null;
      try {
        requireD5b5Preserved(ID, state("甲"), state("甲"), response, before, changed);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof Error, "原有保护断言不能放过损坏请求");
      assert.equal(
        classifyD5b5PreservationFailure(
          failure,
          ID,
          state("甲"),
          state("甲"),
          response,
          before,
          changed,
        ),
        expected,
      );
    }
  });

  void it("真实 HTTP 状态、禁止缓存和重定向必须各自拒绝并安全分类", () => {
    const before = { paths: [], statuses: [], blocked: 0 };
    const after = {
      paths: ["/api/v1/projects/" + ID + "/releases/current"],
      statuses: [404],
      blocked: 0,
    };
    const cases = [
      {
        response: { status: 200, noStore: true, direct: true },
        expected: "D5b5 双标签真实发布响应不是 404",
      },
      {
        response: { status: 404, noStore: false, direct: true },
        expected: "D5b5 双标签真实发布响应缺少 no-store",
      },
      {
        response: { status: 404, noStore: true, direct: false },
        expected: "D5b5 双标签真实发布响应地址不符或发生重定向",
      },
    ];
    for (const { response, expected } of cases) {
      let failure = null;
      try {
        requireD5b5Preserved(ID, state("甲"), state("甲"), response, before, after);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof Error, "原有 HTTP 合约断言必须拒绝错误响应");
      assert.equal(
        classifyD5b5PreservationFailure(
          failure,
          ID,
          state("甲"),
          state("甲"),
          response,
          before,
          after,
        ),
        expected,
      );
    }
  });

  void it("SVG、JSON、IndexedDB、自动保存及 CAS 漂移仍严格失败且只报告固定类别", () => {
    const before = { paths: [], statuses: [], blocked: 0 };
    const after = {
      paths: ["/api/v1/projects/" + ID + "/releases/current"],
      statuses: [404],
      blocked: 0,
    };
    const response = { status: 404, noStore: true, direct: true };
    const cases = [
      { change: { canvas: "<svg>改</svg>" }, expected: "D5b5 双标签业务 SVG 内容变化" },
      { change: { documentHash: "d".repeat(64) }, expected: "D5b5 双标签工程 JSON 摘要变化" },
      { change: { draftCount: 2 }, expected: "D5b5 双标签 IndexedDB 草稿数量变化" },
      { change: { draftHash: "d".repeat(64) }, expected: "D5b5 双标签 IndexedDB 草稿摘要变化" },
      { change: { autoSave: true }, expected: "D5b5 双标签自动保存状态变化" },
      { change: { baselineRevision: null }, expected: "D5b5 双标签 CAS 基线变化" },
      { change: { projectId: ORIGINAL }, expected: "D5b5 双标签工程关联发生变化" },
    ];
    for (const { change, expected } of cases) {
      let failure = null;
      const changed = { ...state("甲"), ...change };
      try {
        requireD5b5Preserved(ID, state("甲"), changed, response, before, after);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof Error, "原有草稿和 CAS 断言必须拒绝本地变化");
      const category = classifyD5b5PreservationFailure(
        failure,
        ID,
        state("甲"),
        changed,
        response,
        before,
        after,
      );
      assert.equal(category, expected);
      assert.equal(D5B5_PROTECTION_REASONS.includes(category), true);
    }
  });

  void it("未知页面异常和敏感字符串不得进入诊断白名单", () => {
    const sensitive = "Cookie=SECRET Token=SECRET 工程私密正文";
    const result = classifyD5b5PreservationFailure(
      new Error(sensitive),
      sensitive,
      { canvas: sensitive },
      { draftHash: sensitive },
      { status: 401, url: sensitive },
      { paths: [sensitive], statuses: [200], blocked: 0 },
      { paths: [sensitive], statuses: [404], blocked: 0 },
    );
    assert.equal(result, "D5b5 双标签保护断言异常已脱敏");
    assert.equal(result.includes("SECRET"), false);
    assert.equal(D5B5_PROTECTION_REASONS.includes(result), true);
  });

  void it("异常及不受信任阶段与 Cookie、Token 必须经过固定诊断脱敏", () => {
    assert.equal(
      describeD5b5MultiTabFailure(new Error("Cookie=SECRET; Token=SECRET")),
      "D5b5b 同源双标签页只读专项失败，内部信息已脱敏",
    );
    const failure = new Error("D5b5b 浏览器阶段失败");
    failure.stage = "Vue：第二标签页真实发布读取";
    failure.safeReason = "D5b5b SVG、工程 JSON、IndexedDB 草稿或 CAS 基线变化";
    assert.match(describeD5b5MultiTabFailure(failure), /Vue：第二标签页真实发布读取失败/);
    failure.safeReason = "Token=SECRET";
    assert.doesNotMatch(describeD5b5MultiTabFailure(failure), /SECRET/);
    failure.stage = "伪造阶段 Cookie=SECRET";
    assert.doesNotMatch(describeD5b5MultiTabFailure(failure), /SECRET/);
  });
});
