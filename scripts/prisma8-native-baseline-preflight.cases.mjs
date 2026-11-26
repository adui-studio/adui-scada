import assert from "node:assert/strict";
import { test } from "node:test";
import evidence from "./prisma8-native-baseline-accepted-evidence.json" with { type: "json" };
import {
  inspectNativeEmptyDatabase,
  inspectReproEmptyDatabase,
  nativeEmptyClientOptions,
  nativeEmptyConfirmation,
  nativeEmptyDatabaseName,
  requireAcceptedCandidateEvidence,
} from "./prisma8-native-baseline-preflight.mjs";

const url = "postgresql://lab_owner:p%40ss%2Fword@127.0.0.1:15432/" + nativeEmptyDatabaseName;
const confirmation = [nativeEmptyConfirmation];
const user = "lab_owner";
const boundary = {
  database_name: nativeEmptyDatabaseName,
  schema_name: "public",
  role_name: user,
  session_role: user,
  read_only: "on",
  default_read_only: "on",
  isolation: "repeatable read",
  timezone: "UTC",
  server_encoding: "UTF8",
  standard_strings: "on",
  search_path: "public",
  server_version: "180000",
  in_recovery: false,
  database_owner: true,
  database_create: true,
  public_usage: true,
  public_create: true,
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
  subscriptions: false,
  foreign_servers: false,
  foreign_wrappers: false,
  large_objects: false,
  default_acls: false,
  prepared_transactions: false,
  other_sessions: false,
};

/** @param {{ boundaryRows?: object[], emptyRows?: object[], failAt?: string, failureCode?: string, identityRows?: object[] }} [options] 模拟客户端配置。 */
function mock({
  boundaryRows = [boundary],
  emptyRows = [empty],
  failAt = "",
  failureCode,
  identityRows = [],
} = {}) {
  const failure = Object.assign(new Error("敏感内部异常"), { code: failureCode });
  const calls = [];
  const client = {
    async connect() {
      calls.push("连接");
      if (failAt === "连接") throw failure;
    },
    async query(sql) {
      calls.push(sql);
      if (failAt && sql.includes(failAt)) throw failure;
      if (sql.includes("pg_is_in_recovery")) return { rows: boundaryRows };
      if (sql.includes("pg_stat_activity")) return { rows: emptyRows };
      if (sql.includes("pg_control_system")) return { rows: identityRows };
      return { rows: [] };
    },
    async end() {
      calls.push("关闭");
      if (failAt === "关闭") throw failure;
    },
  };
  return { calls, client };
}

void test("维护者十四文件证据原文与真实指纹一致", () => {
  assert.equal(requireAcceptedCandidateEvidence(evidence), evidence.fingerprint);
  assert.equal(evidence.files.length, 14);
});

void test("拒绝证据文件长度、哈希、路径、顺序和声明指纹变化", () => {
  for (const changed of [
    { ...evidence, fingerprint: "0".repeat(64) },
    { ...evidence, files: evidence.files.slice(1) },
    { ...evidence, files: [...evidence.files].reverse() },
    ...["bytes", "sha256", "path"].map((key) => ({
      ...evidence,
      files: [{ ...evidence.files[0], [key]: "错误" }, ...evidence.files.slice(1)],
    })),
  ]) {
    assert.throws(() => requireAcceptedCandidateEvidence(changed), /证据指纹不一致/u);
  }
});

void test("仅接受确认的本机专用库并显式配置只读连接", () => {
  const config = nativeEmptyClientOptions(url + "?schema=public", confirmation);
  assert.equal(config.database, nativeEmptyDatabaseName);
  assert.equal(config.user, user);
  assert.equal(config.password, "p@ss/word");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 15432);
  assert.equal(config.ssl, false);
  assert.match(config.options, /default_transaction_read_only=on/u);
  assert.match(config.options, /statement_timeout=5000/u);
  assert.deepEqual(nativeEmptyClientOptions(url, confirmation), config);
});

void test("拒绝旧库、外部地址、额外连接参数、无凭据及任意确认参数", () => {
  for (const args of [[], ["--yes"], [...confirmation, "--extra"]]) {
    assert.throws(() => nativeEmptyClientOptions(url, args), /明确确认/u);
  }
  for (const invalid of [
    undefined,
    "",
    url.replace(nativeEmptyDatabaseName, "adui_scada"),
    url.replace(nativeEmptyDatabaseName, "adui_scada_test"),
    url.replace(nativeEmptyDatabaseName, "adui_scada_fresh_prisma8_ref"),
    url.replace("127.0.0.1", "localhost"),
    url.replace("127.0.0.1", "example.invalid"),
    url.replace("15432", "5432"),
    url + "?options=-c",
    url + "?schema=public&schema=public",
    url + "?schema=private",
    url + "#fragment",
    url.replace(":p%40ss%2Fword", ""),
    url.replace("p%40ss%2Fword", "%00"),
    url.replace("p%40ss%2Fword", "%GG"),
    url.replace("lab_owner", "bad%2Fuser"),
    url + "\n",
  ]) {
    assert.throws(() => nativeEmptyClientOptions(invalid, confirmation), /仅允许/u);
  }
});

void test("空库检查严格只读并在返回前回滚关闭", async () => {
  const { client, calls } = mock();
  const result = await inspectNativeEmptyDatabase(client, user);
  assert.equal(result.database, nativeEmptyDatabaseName);
  assert.equal(result.checkedEmptyCategories, 23);
  assert.equal(result.status, "NATIVE_EMPTY_PREFLIGHT_REVIEW_REQUIRED");
  assert.equal(result.signingAllowed, false);
  assert.equal(result.deploymentAllowed, false);
  assert.deepEqual(calls.slice(0, 2), ["连接", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"]);
  assert.equal(calls.length, 6);
  assert.equal(
    calls.slice(2, -2).every((sql) => sql.startsWith("SELECT")),
    true,
  );
  assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
});

void test("实际目标、事务、角色、权限或连接设置不符时停止后续目录查询", async () => {
  for (const [key, value] of Object.entries(boundary)) {
    const changed = { ...boundary, [key]: typeof value === "boolean" ? !value : "错误" };
    const { client, calls } = mock({ boundaryRows: [changed] });
    await assert.rejects(() => inspectNativeEmptyDatabase(client, user), /实际连接、只读事务/u);
    assert.equal(calls.length, 5);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
  }
});

void test("任一受检对象、会话、缺失字段或异常目录行均拒绝", async () => {
  const changedRows = [
    [],
    [empty, empty],
    [{ ...empty, relations: undefined }],
    ...Object.keys(empty).map((key) => [{ ...empty, [key]: true }]),
  ];
  for (const emptyRows of changedRows) {
    const { client, calls } = mock({ emptyRows });
    await assert.rejects(() => inspectNativeEmptyDatabase(client, user), /受检用户对象/u);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
  }
});

void test("连接、查询、回滚和关闭失败不泄漏内部异常或返回成功", async () => {
  for (const failAt of [
    "连接",
    "BEGIN",
    "pg_is_in_recovery",
    "pg_stat_activity",
    "ROLLBACK",
    "关闭",
  ]) {
    const { client, calls } = mock({ failAt });
    await assert.rejects(() => inspectNativeEmptyDatabase(client, user), {
      message: /^第三座专用库.*失败/u,
    });
    assert.equal(calls.at(-1), "关闭");
    if (failAt === "连接") assert.deepEqual(calls, ["连接", "关闭"]);
    else if (failAt === "BEGIN")
      assert.deepEqual(calls, ["连接", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "关闭"]);
    else assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
  }
});

void test("原始 ASCII 控制字符及编码口令控制字符保持严格拒绝", () => {
  for (const code of [...Array.from({ length: 33 }, (_, index) => index), 127]) {
    const character = String.fromCharCode(code);
    assert.throws(() => nativeEmptyClientOptions(url + character, confirmation), /仅允许/u);
    if (code !== 32) {
      const encoded = "%" + code.toString(16).padStart(2, "0");
      assert.throws(
        () => nativeEmptyClientOptions(url.replace("p%40ss%2Fword", encoded), confirmation),
        /仅允许/u,
      );
    }
  }
  assert.equal(
    nativeEmptyClientOptions(url.replace("p%40ss%2Fword", "p%20word"), confirmation).password,
    "p word",
  );
  assert.throws(
    () => nativeEmptyClientOptions(url + String.fromCharCode(92), confirmation),
    /仅允许/u,
  );
});

void test("固定阶段与已知数据库错误码可定位且不泄漏内部详情", async () => {
  /** @type {[string, string, RegExp][]} 固定阶段、错误码及预期诊断。 */
  const cases = [
    ["连接", "3D000", /连接失败：3D000/u],
    ["连接", "28P01", /连接失败：28P01/u],
    ["连接", "ECONNREFUSED", /连接失败：ECONNREFUSED/u],
    ["BEGIN", "57014", /启动只读事务失败：57014/u],
    ["pg_is_in_recovery", "42501", /连接及权限边界查询失败：42501/u],
    ["pg_stat_activity", "42703", /空库目录查询失败：42703/u],
    ["ROLLBACK", "55P03", /只读事务回滚失败：55P03/u],
    ["关闭", "ECONNRESET", /连接关闭失败：ECONNRESET/u],
    ["pg_stat_activity", "敏感未知错误码", /空库目录查询失败：未知错误类别/u],
  ];
  for (const [failAt, failureCode, expected] of cases) {
    const { client } = mock({ failAt, failureCode });
    await assert.rejects(
      () => inspectNativeEmptyDatabase(client, user),
      (error) => {
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /敏感内部异常|敏感未知错误码/u);
        return true;
      },
    );
  }
});

const reproBoundary = {
  ...boundary,
  database_name: "adui_scada_fresh_prisma8_repro",
  role_name: "adui_scada_native_repro",
  session_role: "adui_scada_native_repro",
  server_version: "170011",
};
const systemIdentifier = "1234567890123456789";

void test("第四座在同一只读事务内核对实际集群身份和二十三类目录", async () => {
  const { client, calls } = mock({
    boundaryRows: [reproBoundary],
    identityRows: [{ system_identifier: systemIdentifier }],
  });
  const result = await inspectReproEmptyDatabase(client, systemIdentifier);
  assert.equal(result.database, reproBoundary.database_name);
  assert.equal(result.serverVersion, "170011");
  assert.equal(result.checkedEmptyCategories, 23);
  assert.equal(result.deploymentAllowed, false);
  assert.equal(calls.length, 7);
  assert.match(calls[3], /pg_control_system/u);
  assert.match(calls[4], /pg_stat_activity/u);
  assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
});

void test("第四座版本、集群和角色不一致时拒绝目录检查并回滚关闭", async () => {
  for (const config of [
    { boundaryRows: [{ ...reproBoundary, server_version: "180000" }] },
    { identityRows: [{ system_identifier: "987" }] },
    { boundaryRows: [boundary] },
  ]) {
    const { client, calls } = mock({
      boundaryRows: [reproBoundary],
      identityRows: [{ system_identifier: systemIdentifier }],
      ...config,
    });
    await assert.rejects(() => inspectReproEmptyDatabase(client, systemIdentifier), /第四座/u);
    assert.equal(calls.some((sql) => sql.includes("pg_stat_activity")), false);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
  }
});
