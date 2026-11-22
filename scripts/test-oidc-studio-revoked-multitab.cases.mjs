import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  describeD5b5MultiTabFailure,
  parseD5b5MultiTabArgs,
  requireD5b5NoBlockedWrites,
  requireD5b5SharedDraft,
  requireD5b5TabUnchanged,
  studioVisibilityInPage,
} from "./test-oidc-studio-revoked-multitab.mjs";

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
    for (const changed of [
      { blocked: 1 },
      { paths: first.paths.slice(0, 1) },
      { statuses: [200] },
      { paths: null },
      { statuses: null },
    ]) {
      assert.throws(
        () => requireD5b5NoBlockedWrites({ ...first, ...changed }, second),
        /工程 API 只读约束或发布 GET 404 不符合预期/,
      );
      assert.throws(
        () => requireD5b5NoBlockedWrites(first, { ...second, ...changed }),
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
