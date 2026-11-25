import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  inspectEmptyReferenceDatabase,
  requireReferenceReplayTarget,
  runReferenceReplay,
} from "./replay-prisma8-migration-reference.mjs";

const referenceUrl = "postgresql://test_user@127.0.0.1:15432/adui_scada_fresh_prisma8_ref";
const confirmation = "--confirm-adui-scada-fresh-prisma8-ref";
const fingerprint = "73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52";
const contractHash = "054113c40b1e6f3b7609641e09868e45c0e969d8035e6e1376d10ac3e5148424";
const boundary = {
  database_name: "adui_scada_fresh_prisma8_ref",
  schema_name: "public",
  read_only: "on",
  isolation: "repeatable read",
  in_recovery: false,
};
const empty = {
  extra_schema: false,
  relations: false,
  routines: false,
  types: false,
  operators: false,
  collations: false,
  conversions: false,
  operator_classes: false,
  operator_families: false,
  text_search_configs: false,
  text_search_dictionaries: false,
  text_search_parsers: false,
  text_search_templates: false,
  extensions: false,
  event_triggers: false,
  publications: false,
  foreign_servers: false,
  other_sessions: false,
};
const initial = {
  status: "REVIEW_REQUIRED",
  signingAllowed: false,
  marker: "ABSENT",
  timezoneUtc: true,
  contractHash,
  catalogFingerprint: fingerprint,
};
const comparison = {
  status: "MATCHED_REVIEW_REQUIRED",
  signingAllowed: false,
  contractHash,
  catalogFingerprint: fingerprint,
  referenceFingerprint: fingerprint,
};

function mockReference({ boundaryRow = boundary, emptyRow = empty, failAt = "", closeFails = false } = {}) {
  const calls = [];
  const client = {
    connect: () => {
      calls.push("连接");
      return Promise.resolve();
    },
    query: (query) => {
      calls.push(query);
      if (failAt !== "" && query.includes(failAt)) {
        return Promise.reject(new Error("测试内部连接信息不得回显"));
      }
      if (query.includes("pg_is_in_recovery")) return Promise.resolve({ rows: [boundaryRow] });
      if (query.includes("pg_stat_activity")) return Promise.resolve({ rows: [emptyRow] });
      return Promise.resolve({ rows: [] });
    },
    end: () => {
      calls.push("关闭");
      if (closeFails) return Promise.reject(new Error("测试内部关闭信息不得回显"));
      return Promise.resolve();
    },
  };
  return { calls, client };
}

function mockSteps({
  initialReport = initial,
  emptyResult = true,
  comparisons = [comparison, comparison],
  ledgers = [[{ id: "first" }], [{ id: "first" }]],
  failCommandAt = 0,
} = {}) {
  const calls = [];
  let commandCount = 0;
  let comparisonCount = 0;
  let ledgerCount = 0;
  const steps = {
    inspectTest: () => {
      calls.push("验收库");
      return Promise.resolve(initialReport);
    },
    inspectEmpty: () => {
      calls.push("空库");
      return Promise.resolve(emptyResult);
    },
    runPrisma: (action) => {
      calls.push(action);
      commandCount++;
      if (commandCount === failCommandAt) throw new Error("测试迁移命令失败");
    },
    compare: () => {
      calls.push("对照");
      return Promise.resolve(comparisons[comparisonCount++]);
    },
    inspectLedger: () => {
      calls.push("登记");
      return Promise.resolve(ledgers[ledgerCount++]);
    },
  };
  return { calls, steps };
}

void describe("独立参考库历史重放安全门禁", () => {
  void it("仅接受固定参考库与唯一显式确认参数", () => {
    assert.equal(requireReferenceReplayTarget(referenceUrl + "?schema=public", [confirmation]), referenceUrl);
    for (const args of [[], ["--yes"], [confirmation, "--extra"]]) {
      assert.throws(() => requireReferenceReplayTarget(referenceUrl, args), /显式确认/);
    }
    for (const invalid of [
      undefined,
      referenceUrl.replace("adui_scada_fresh_prisma8_ref", "adui_scada_test"),
      referenceUrl.replace("adui_scada_fresh_prisma8_ref", "adui_scada"),
      referenceUrl.replace("127.0.0.1", "localhost"),
      referenceUrl.replace("127.0.0.1", "example.invalid"),
      referenceUrl.replace("15432", "5432"),
      referenceUrl + "?schema=private",
      referenceUrl + "?options=unsafe",
      referenceUrl + "?schema=public&schema=public",
    ]) {
      assert.throws(() => requireReferenceReplayTarget(invalid, [confirmation]), /仅允许/);
    }
  });

  void it("空库检查使用只读快照且正常回滚关闭", async () => {
    const { client, calls } = mockReference();
    assert.equal(await inspectEmptyReferenceDatabase(client), true);
    assert.equal(calls.length, 6);
    assert.deepEqual(calls.slice(0, 2), ["连接", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"]);
    assert.equal(calls.slice(2, -2).every((query) => query.startsWith("SELECT")), true);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
  });

  void it("实际库名、事务边界或恢复状态不符时停止空库检查", async () => {
    for (const changes of [
      { database_name: "adui_scada_test" },
      { schema_name: "private" },
      { read_only: "off" },
      { isolation: "read committed" },
      { in_recovery: true },
    ]) {
      const { client, calls } = mockReference({ boundaryRow: { ...boundary, ...changes } });
      await assert.rejects(() => inspectEmptyReferenceDatabase(client), /实际参考库或只读事务边界/);
      assert.equal(calls.length, 5);
      assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
    }
  });

  void it("存在用户对象或其他连接即拒绝重放", async () => {
    for (const key of Object.keys(empty)) {
      const { client, calls } = mockReference({ emptyRow: { ...empty, [key]: true } });
      await assert.rejects(() => inspectEmptyReferenceDatabase(client), /不是独立空库或存在其他连接/);
      assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
    }
  });

  void it("只读查询、回滚及关闭失败不会返回成功或泄漏内部错误", async () => {
    for (const options of [{ failAt: "pg_stat_activity" }, { failAt: "ROLLBACK" }, { closeFails: true }]) {
      const { client, calls } = mockReference(options);
      await assert.rejects(() => inspectEmptyReferenceDatabase(client), { message: /^参考库.*失败/ });
      assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
    }
  });

  void it("先验收再重放并验证两次目录及登记一致仍禁止签名", async () => {
    const { steps, calls } = mockSteps();
    const result = await runReferenceReplay(steps);
    assert.deepEqual(calls, [
      "验收库", "空库", "deploy", "status", "对照", "登记", "deploy", "status", "对照", "登记",
    ]);
    assert.equal(result.status, "MATCHED_REVIEW_REQUIRED");
    assert.equal(result.signingAllowed, false);
  });

  void it("验收指纹漂移或参考库非空时不调用迁移命令", async () => {
    const drift = mockSteps({ initialReport: { ...initial, catalogFingerprint: "0".repeat(64) } });
    await assert.rejects(() => runReferenceReplay(drift.steps), /验收库与已审查指纹不一致/);
    assert.deepEqual(drift.calls, ["验收库"]);
    const nonempty = mockSteps({ emptyResult: false });
    await assert.rejects(() => runReferenceReplay(nonempty.steps), /空库检查未通过/);
    assert.deepEqual(nonempty.calls, ["验收库", "空库"]);
  });

  void it("首次迁移或目录对照失败立即停止且不自动重试", async () => {
    const failure = mockSteps({ failCommandAt: 1 });
    await assert.rejects(() => runReferenceReplay(failure.steps), /测试迁移命令失败/);
    assert.deepEqual(failure.calls, ["验收库", "空库", "deploy"]);
    const drift = mockSteps({ comparisons: [{ ...comparison, referenceFingerprint: "0".repeat(64) }] });
    await assert.rejects(() => runReferenceReplay(drift.steps), /双库目录与已验收指纹不一致/);
    assert.deepEqual(drift.calls, ["验收库", "空库", "deploy", "status", "对照"]);
  });

  void it("二次部署后目录漂移或历史登记变化均拒绝成功", async () => {
    const changedCatalog = mockSteps({ comparisons: [comparison, { ...comparison, signingAllowed: true }] });
    await assert.rejects(() => runReferenceReplay(changedCatalog.steps), /双库目录与已验收指纹不一致/);
    assert.equal(changedCatalog.calls.at(-1), "对照");
    const changedLedger = mockSteps({ ledgers: [[{ id: "first" }], [{ id: "changed" }]] });
    await assert.rejects(() => runReferenceReplay(changedLedger.steps), /二次部署改变了迁移登记/);
    assert.equal(changedLedger.calls.at(-1), "登记");
  });
});
