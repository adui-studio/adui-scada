import assert from "node:assert/strict";
import { test } from "node:test";
import { roundTripTarget } from "./prisma8-native-check-roundtrip-execution.mjs";
import { inspectRoundTripReference } from "./prisma8-native-check-roundtrip-host.mjs";
import { referenceConfirmation } from "./prisma8-native-check-roundtrip-reference.mjs";

const endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine";
const mainId = "a".repeat(64);
const reproId = "b".repeat(64);
const mainNames = ["adui_scada_test", "adui_scada_fresh_prisma8_ref", "adui_scada_fresh_prisma8_native"];
const reproName = "adui_scada_fresh_prisma8_repro";
const collation = { encoding: "UTF8", provider: "c", collate: "en_US.utf8", ctype: "en_US.utf8", locale: null, version: null };

function catalog(database, role, systemIdentifier, names) {
  return {
    database, role, version: 170011, readOnly: true, defaultReadOnly: true,
    isolation: "repeatable read", systemIdentifier,
    rows: names.map((name) => ({ database: name, ...collation, actualVersion: null, customIcuRules: false })),
  };
}

function fixture() {
  const main = catalog(mainNames[0], "adui_scada", "1234567890123456789", mainNames);
  const repro = catalog(reproName, "adui_scada_native_repro", "2234567890123456789", [reproName]);
  const outputs = ["desktop-linux", endpoint, "linux", roundTripTarget.image, roundTripTarget.image,
    "adui-scada-prisma8-repro\nother", "other-data", "other-net", "[]", mainId,
    mainId + "|true|adui-scada|postgres", reproId + "|true|" + roundTripTarget.image + "|prisma8-native-repro",
    () => JSON.stringify(main), () => JSON.stringify(repro)];
  const calls = [];
  const run = (executable, args, options) => {
    const output = outputs[calls.length];
    calls.push({ executable, args, options });
    return { status: 0, signal: null, stdout: typeof output === "function" ? output() : output, stderr: "" };
  };
  const inspect = () => inspectRoundTripReference("win32", [referenceConfirmation], { Path: "system", SCADA_DATABASE_URL: "secret" }, run);
  return { main, repro, outputs, calls, run, inspect };
}

void test("冻结库目录采集必须单独确认且不接受额外参数", () => {
  const { calls, run } = fixture();
  for (const args of [[], ["--create"], [referenceConfirmation, "--extra"]]) {
    assert.throws(() => inspectRoundTripReference("win32", args, {}, run), /必须单独确认/u);
  }
  assert.equal(calls.length, 0);
});

void test("四库两集群目录匹配只输出受控元数据且不授予任何执行许可", () => {
  const f = fixture();
  const report = f.inspect();
  assert.equal(report.status, "NATIVE_CHECK_ROUNDTRIP_REFERENCE_REVIEW_REQUIRED");
  assert.equal(report.observedDatabaseCount, 4);
  assert.equal(report.observedClusterCount, 2);
  assert.deepEqual(report.referenceCollation, collation);
  assert.equal(report.recordedCollationVersionMatches, true);
  assert.equal(report.allFrozenCollationsMatch, true);
  for (const value of [report.portReserved, report.resourceCreationAllowed, report.observationSourceAuthenticated, report.databaseExecutionAllowed, report.roundTripVerified, report.historicalAdoptionVerified, report.signingAllowed, report.deploymentAllowed]) assert.equal(value, false);
  assert.doesNotMatch(JSON.stringify(report), /1234567890123456789|2234567890123456789|secret/u);
  assert.equal(f.calls.length, 14);
  assert.deepEqual(f.calls.slice(9, 12).map(({args}) => args.slice(2, 4)), [["container", "ls"], ["container", "inspect"], ["container", "inspect"]]);
  for (const { i, id, database, role } of [
    { i: 12, id: mainId, database: mainNames[0], role: "adui_scada" },
    { i: 13, id: reproId, database: reproName, role: "adui_scada_native_repro" },
  ]) {
    const { executable, args, options } = f.calls[i];
    assert.equal(executable, "docker");
    assert.deepEqual(args.slice(0, 8), ["--host", endpoint, "exec", "--user", "postgres", id, "env", "-i"]);
    assert.match(args[9], /default_transaction_read_only=on/u);
    assert.deepEqual(args.slice(11, 25), ["psql", "-X", "-w", "-q", "-A", "-t", "-h", "/var/run/postgresql", "-p", "5432", "-U", role, "-d", database]);
    assert.deepEqual(args.slice(25, 28), ["-v", "ON_ERROR_STOP=1", "-c"]);
    assert.match(args[28], /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;[\s\S]*ROLLBACK;$/u);
    assert.match(args[28], /pg_catalog\.pg_database_collation_actual_version\(oid\)/u);
    assert.doesNotMatch(args[28], /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|COMMIT)\b/u);
    assert.deepEqual(options.env, { Path: "system" });
    assert.equal(options.shell, false);
  }
  assert.match(f.calls[12].args[28], /adui_scada_fresh_prisma8_ref/u);
  assert.match(f.calls[12].args[28], /adui_scada_fresh_prisma8_native/u);
  assert.doesNotMatch(f.calls[12].args[28], /adui_scada_fresh_prisma8_repro/u);
});

void test("宿主机预检或容器身份失败时不连接冻结库", () => {
  for (const { index, output } of [
    { index: 8, output: "[15434]" }, { index: 9, output: mainId + "\n" + reproId },
    { index: 10, output: mainId + "|true|other|postgres" },
    { index: 11, output: mainId + "|true|" + roundTripTarget.image + "|prisma8-native-repro" },
  ]) {
    const f = fixture(); f.outputs[index] = output;
    assert.throws(f.inspect, /端口存在|唯一运行中|容器身份不一致/u);
    assert.equal(f.calls.length, index + 1);
  }
});

void test("系统目录 JSON、身份、版本、只读状态及数量异常均拒绝", () => {
  const bad = fixture(); bad.outputs[12] = "secret";
  assert.throws(bad.inspect, { message: "冻结库系统目录不是唯一合法 JSON" });
  for (const changes of [{ database: "other" }, { role: "other" }, { version: 170010 }, { readOnly: false }, { defaultReadOnly: false }, { isolation: "read committed" }, { systemIdentifier: "bad" }, { rows: [] }]) {
    const f = fixture(); Object.assign(f.main, changes);
    assert.throws(f.inspect, /身份、版本、只读事务或目录数量/u);
    assert.equal(f.calls.length, 13);
  }
});

void test("目录名称重复或缺失以及无效排序规则元数据均拒绝", () => {
  const duplicate = fixture(); duplicate.main.rows[1].database = mainNames[0];
  assert.throws(duplicate.inspect, /名称缺失或重复/u);
  for (const changes of [{ database: "other" }, { encoding: "LATIN1" }, { provider: "unknown" }, { collate: "invalid locale" }, { locale: "unexpected" }, { version: "1", actualVersion: "2" }, { customIcuRules: true }]) {
    const f = fixture(); Object.assign(f.main.rows[0], changes);
    assert.throws(f.inspect, /名称缺失或重复|排序规则版本或自定义规则/u);
    assert.equal(f.calls.length, 13);
  }
});

void test("允许目录行顺序差异但拒绝不同集群标识缺失和排序规则漂移", () => {
  const ordered = fixture(); ordered.main.rows.reverse();
  assert.equal(ordered.inspect().allFrozenCollationsMatch, true);
  const same = fixture(); same.repro.systemIdentifier = same.main.systemIdentifier;
  assert.throws(same.inspect, /集群标识重复/u);
  const drift = fixture(); drift.repro.rows[0].collate = "C";
  assert.throws(drift.inspect, /排序规则不一致/u);
});

void test("冻结库子进程失败时保留固定脱敏诊断并立即停止", () => {
  const f = fixture();
  const run = (executable, args, options) => f.calls.length === 12
    ? { ...f.run(executable, args, options), status: 1, stderr: "secret" }
    : f.run(executable, args, options);
  assert.throws(() => inspectRoundTripReference("win32", [referenceConfirmation], {}, run), { message: "读取冻结库系统目录：未取得成功的只读结果" });
  assert.equal(f.calls.length, 13);
});
