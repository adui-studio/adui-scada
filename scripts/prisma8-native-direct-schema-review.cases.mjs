import assert from "node:assert/strict";
import { test } from "node:test";
import {
  directSchemaConnection,
  runDirectSchemaReview,
  runLockedDirectSchemaReview,
  summarizeDirectSchemaResult,
} from "./prisma8-native-direct-schema-review.mjs";

const url =
  "postgresql://adui_scada:sample%20password@127.0.0.1:15432/adui_scada_test?schema=public";
const contract = {
  storage: {
    storageHash: "fixed",
    namespaces: {
      public: {
        entries: {
          table: {
            scada_projects: {
              columns: { id: {} },
              primaryKey: { name: "scada_projects_pkey" },
              indexes: [],
              foreignKeys: [],
              checks: [],
              uniques: [],
            },
          },
        },
      },
    },
  },
};

function result(strict, issues = []) {
  return {
    ok: issues.length === 0,
    contract: { storageHash: "fixed" },
    meta: { strict },
    schema: { issues, warnings: { issues: [] } },
    summary: "不允许输出的内部详情",
  };
}

void test("固定历史库连接及只读超时设置，拒绝第三座库和额外参数", () => {
  const value = directSchemaConnection(url);
  assert.equal(new URL(value.connection).pathname, "/adui_scada_test");
  assert.equal(value.options.sessionSettings.default_transaction_read_only, "on");
  assert.equal(value.options.connectTimeoutMs, 5000);
  assert.match(
    new URL(value.connection).searchParams.get("options"),
    /default_transaction_read_only=on/u,
  );
  for (const invalid of [
    url.replace("adui_scada_test", "adui_scada_fresh_prisma8_native"),
    url.replace("127.0.0.1", "localhost"),
    url.replace("127.0.0.1", "example.com"),
    url.replace("15432", "5432"),
    url.replace("sample%20password", "%00"),
    url.replace("sample%20password", ""),
    url + "&options=unsafe",
    url + "#fragment",
    undefined,
  ])
    assert.throws(() => directSchemaConnection(invalid), /历史验收库/u);
});

void test("只输出契约范围内差异路径和计数，拒绝矛盾或错误目标结果", () => {
  const issue = {
    path: ["database", "public", "scada_projects", "id", "secret-value"],
    expected: "secret",
    actual: "secret",
  };
  const report = summarizeDirectSchemaResult(result(false, [issue]), contract, false);
  assert.deepEqual(report.issuePaths, [["database", "public", "scada_projects", "id", "[已脱敏]"]]);
  assert.equal(report.issueCount, 1);
  assert.doesNotMatch(JSON.stringify(report), /secret|内部详情/u);
  for (const bad of [
    { ...result(false), ok: false },
    { ...result(false), contract: { storageHash: "other" } },
    result(true),
    { ...result(false), schema: {} },
  ])
    assert.throws(() => summarizeDirectSchemaResult(bad, contract, false), /目标不一致/u);
});

void test("直接校验按宽容和严格顺序执行且关闭同一客户端", async () => {
  const calls = [];
  const report = await runDirectSchemaReview(
    () => ({
      async connect(connection, options) {
        assert.equal(new URL(connection).hostname, "127.0.0.1");
        assert.equal(options.sessionSettings.default_transaction_read_only, "on");
        calls.push("connect");
      },
      async schemaVerify(options) {
        assert.equal(options.contract, contract);
        calls.push(options.strict);
        return result(options.strict, options.strict ? [{ path: ["public"] }] : []);
      },
      async close() {
        calls.push("close");
      },
    }),
    url,
    contract,
  );
  assert.deepEqual(calls, ["connect", false, true, "close"]);
  assert.deepEqual(
    report.results.map((item) => item.ok),
    [true, false],
  );
  assert.equal(report.signingAllowed, false);
  assert.equal(report.deploymentAllowed, false);
});

void test("失败仍关闭客户端，拒绝异常回显和非法连接初始化", async () => {
  let closed = 0;
  let created = 0;
  const factory = () => {
    created += 1;
    return {
      async connect() {
        throw new Error("禁止回显的内部连接详情");
      },
      async close() {
        closed += 1;
      },
    };
  };
  await assert.rejects(
    runDirectSchemaReview(factory, url.replace("adui_scada_test", "other"), contract),
    /历史验收库/u,
  );
  assert.equal(created, 0);
  await assert.rejects(
    runDirectSchemaReview(factory, url, contract),
    /连接历史验收库失败，内部详情已脱敏/u,
  );
  assert.equal(closed, 1);
  await assert.rejects(
    runDirectSchemaReview(
      () => ({
        async connect() {},
        async schemaVerify(options) {
          return result(options.strict);
        },
        async close() {
          throw new Error("禁止回显的关闭详情");
        },
      }),
      url,
      contract,
    ),
    /关闭失败，内部详情已脱敏/u,
  );
});

void test("直接验证完成并关闭连接后复核证据，保留结构不匹配结果", async () => {
  const calls = [];
  const report = await runLockedDirectSchemaReview(
    () => ({
      async connect() {
        calls.push("connect");
      },
      async schemaVerify(options) {
        calls.push(options.strict);
        return result(options.strict, options.strict ? [{ path: ["public"] }] : []);
      },
      async close() {
        calls.push("close");
      },
    }),
    url,
    contract,
    "fixed",
    () => {
      calls.push("evidence");
      return "fixed";
    },
  );
  assert.deepEqual(calls, ["connect", false, true, "close", "evidence"]);
  assert.deepEqual(
    report.results.map((item) => item.ok),
    [true, false],
  );
});

void test("证据变化或读取异常均阻止已通过的结构报告返回", async () => {
  const factory = () => ({
    async connect() {},
    async schemaVerify(options) {
      return result(options.strict);
    },
    async close() {},
  });
  await assert.rejects(
    runLockedDirectSchemaReview(factory, url, contract, "fixed", () => "other"),
    { message: "固定证据变化" },
  );
  await assert.rejects(
    runLockedDirectSchemaReview(factory, url, contract, "fixed", () => {
      throw new Error("禁止回显的证据读取详情");
    }),
    { message: "固定证据复核失败，内部详情已脱敏" },
  );
});

void test("验证和关闭失败后仍复核证据，保留全部脱敏阶段诊断", async () => {
  const calls = [];
  const factory = () => ({
    async connect() {
      calls.push("connect");
    },
    async schemaVerify() {
      calls.push("verify");
      throw new Error("禁止回显的验证详情");
    },
    async close() {
      calls.push("close");
      throw new Error("禁止回显的关闭详情");
    },
  });
  const original = "直接宽容结构验证失败，内部详情已脱敏；官方控制客户端关闭失败，内部详情已脱敏";
  await assert.rejects(
    runLockedDirectSchemaReview(factory, url, contract, "fixed", () => {
      calls.push("evidence");
      return "fixed";
    }),
    { message: original },
  );
  assert.deepEqual(calls, ["connect", "verify", "close", "evidence"]);
  await assert.rejects(
    runLockedDirectSchemaReview(factory, url, contract, "fixed", () => "other"),
    { message: original + "；固定证据变化" },
  );
  await assert.rejects(
    runLockedDirectSchemaReview(factory, url, contract, "fixed", () => {
      throw new Error("禁止回显的证据详情");
    }),
    { message: original + "；固定证据复核失败，内部详情已脱敏" },
  );
});
