import assert from "node:assert/strict";
import { test } from "node:test";
import evidence from "./prisma8-native-baseline-accepted-evidence.json" with { type: "json" };
import {
  inspectNativeEmptyDatabase,
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

function mock({ boundaryRows = [boundary], emptyRows = [empty], failAt = "" } = {}) {
  const calls = [];
  const client = {
    async connect() {
      calls.push("连接");
      if (failAt === "连接") throw new Error("敏感内部异常");
    },
    async query(sql) {
      calls.push(sql);
      if (failAt && sql.includes(failAt)) throw new Error("敏感内部异常");
      if (sql.includes("pg_is_in_recovery")) return { rows: boundaryRows };
      if (sql.includes("pg_stat_activity")) return { rows: emptyRows };
      return { rows: [] };
    },
    async end() {
      calls.push("关闭");
      if (failAt === "关闭") throw new Error("敏感内部异常");
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
