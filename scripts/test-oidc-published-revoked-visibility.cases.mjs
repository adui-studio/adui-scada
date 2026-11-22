import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeD5b6VisibilityFailure,
  parseD5b6VisibilityArgs,
  requireD5b6VisibilityStage,
} from "./test-oidc-published-revoked-visibility.mjs";

const ID = "d5b4-revoke-12345678-1234-4234-8234-123456789abc";
const PATH = "/api/v1/projects/" + ID + "/releases/current";

function fixture(stage) {
  const count = stage === "initial" ? 0 : ["resumed", "stopped"].includes(stage) ? 2 : 1;
  const denied = stage === "denied" || stage === "resumed";
  return {
    page: {
      status: denied ? "denied" : "idle",
      sameProject: denied,
      snapshot: false,
      quality: true,
      releaseGeneration: null,
      releasedRevision: null,
    },
    guard: {
      blocked: 0,
      paths: Array.from({ length: count }, () => PATH),
      statuses: Array.from({ length: count }, () => 404),
    },
    observer: {
      requests: count,
      statuses: Array.from({ length: count }, () => 404),
      noStore: Array.from({ length: count }, () => true),
      direct: Array.from({ length: count }, () => true),
    },
  };
}

function check(stage, record) {
  return requireD5b6VisibilityStage(stage, ID, record.page, record.guard, record.observer);
}

void describe("D5b6 已撤权发布运行页面隐藏重显只读安全门禁", () => {
  void it("只接受已存在的真实 D5b4 UUIDv4 专用工程 ID", () => {
    assert.deepEqual(parseD5b6VisibilityArgs(["--project-id", ID]), { projectId: ID });
    for (const args of [
      [],
      ["--project-id"],
      ["--project-id", "../secret"],
      ["--project-id", "d5b4-revoke-example"],
      ["--project-id", "d5b-unreleased-12345678-1234-4234-8234-123456789abc"],
      ["--project-id", ID, "--restore"],
      ["--phase", "after", "--project-id", ID],
      ["--apply", "--confirm-lab", "adui_scada"],
    ]) {
      assert.throws(
        () => parseD5b6VisibilityArgs(args),
        /只允许已有撤权工程的明确只读回归参数/,
      );
    }
  });

  void it("初始运行页面不得触发任何工程读取", () => {
    assert.deepEqual(check("initial", fixture("initial")), { stage: "initial", readCount: 0 });
  });

  void it("第一次真实撤权后只能存在一个 404 且运行页为拒绝态", () => {
    assert.deepEqual(check("denied", fixture("denied")), { stage: "denied", readCount: 1 });
  });

  void it("隐藏页必须清空运行指针与画面且禁止额外工程请求", () => {
    assert.deepEqual(check("hidden", fixture("hidden")), { stage: "hidden", readCount: 1 });
  });

  void it("重新显示必须真实请求第二个 404 并再次保持拒绝态", () => {
    assert.deepEqual(check("resumed", fixture("resumed")), { stage: "resumed", readCount: 2 });
  });

  void it("停止读取后回到空状态且不得发起第三条 GET", () => {
    assert.deepEqual(check("stopped", fixture("stopped")), { stage: "stopped", readCount: 2 });
  });

  void it("额外 GET、非目标工程路径与相同工程重复读取均必须失败", () => {
    const baseline = fixture("resumed");
    for (const changed of [
      { ...baseline.guard, paths: [...baseline.guard.paths, PATH] },
      { ...baseline.guard, paths: [PATH, PATH + "?unexpected=1"] },
      { ...baseline.guard, statuses: [...baseline.guard.statuses, 404] },
      { ...baseline.guard, blocked: 1 },
    ]) {
      assert.throws(
        () => check("resumed", { ...baseline, guard: changed }),
        /HTTP 404、只读守卫或本地运行状态不符合预期/,
      );
    }
  });

  void it("真实 401、403、200 或未返回的请求均不能伪装为撤权后 404", () => {
    const baseline = fixture("resumed");
    for (const statuses of [[404, 401], [403, 404], [200, 200], [404]]) {
      assert.throws(
        () => check("resumed", {
          ...baseline,
          observer: { ...baseline.observer, statuses },
        }),
        /HTTP 404、只读守卫或本地运行状态不符合预期/,
      );
    }
  });

  void it("缺少 no-store、存在重定向或 HTTP 响应未同步记录均拒绝", () => {
    const baseline = fixture("resumed");
    for (const changed of [
      { ...baseline.observer, noStore: [true, false] },
      { ...baseline.observer, direct: [false, true] },
      { ...baseline.observer, requests: 3 },
      { ...baseline.observer, statuses: [404] },
    ]) {
      assert.throws(
        () => check("resumed", { ...baseline, observer: changed }),
        /HTTP 404、只读守卫或本地运行状态不符合预期/,
      );
    }
  });

  void it("隐藏或停止后残留画面、发布代次、修订号及可用 Tag 质量都拒绝", () => {
    for (const stage of ["hidden", "stopped"]) {
      const baseline = fixture(stage);
      for (const change of [
        { snapshot: true },
        { releaseGeneration: 1 },
        { releasedRevision: 1 },
        { quality: false },
        { status: "verified" },
        { sameProject: true },
      ]) {
        assert.throws(
          () => check(stage, { ...baseline, page: { ...baseline.page, ...change } }),
          /HTTP 404、只读守卫或本地运行状态不符合预期/,
        );
      }
    }
  });

  void it("真实拒绝阶段不得保留旧画面或原始工程快照", () => {
    const baseline = fixture("denied");
    for (const change of [
      { snapshot: true },
      { status: "verified" },
      { releaseGeneration: 0 },
      { releasedRevision: 2 },
      { sameProject: false },
      { quality: false },
    ]) {
      assert.throws(
        () => check("denied", { ...baseline, page: { ...baseline.page, ...change } }),
        /HTTP 404、只读守卫或本地运行状态不符合预期/,
      );
    }
  });

  void it("未安装守卫、缺失观察器或非法阶段必须安全失败", () => {
    const baseline = fixture("resumed");
    assert.throws(
      () => check("resumed", { ...baseline, guard: null }),
      /HTTP 404、只读守卫或本地运行状态不符合预期/,
    );
    assert.throws(
      () => check("resumed", { ...baseline, observer: null }),
      /HTTP 404、只读守卫或本地运行状态不符合预期/,
    );
    assert.throws(
      () => requireD5b6VisibilityStage("unknown", ID, ...Object.values(baseline)),
      /只允许已有撤权工程的明确只读回归参数/,
    );
  });

  void it("未知异常、伪造阶段及敏感内容都必须经白名单脱敏", () => {
    const sensitive = "Cookie=SECRET Token=SECRET 真实工程正文";
    assert.doesNotMatch(describeD5b6VisibilityFailure(new Error(sensitive)), /SECRET/);
    const failure = new Error("D5b6 真实浏览器阶段失败");
    failure.stage = "React：恢复运行页可见与再次真实 404";
    failure.safeReason = "D5b6 撤权发布 HTTP 404、只读守卫或本地运行状态不符合预期";
    assert.match(describeD5b6VisibilityFailure(failure), /React：恢复运行页可见/);
    failure.safeReason = sensitive;
    assert.doesNotMatch(describeD5b6VisibilityFailure(failure), /SECRET/);
    failure.stage = sensitive;
    assert.doesNotMatch(describeD5b6VisibilityFailure(failure), /SECRET/);
  });
});
