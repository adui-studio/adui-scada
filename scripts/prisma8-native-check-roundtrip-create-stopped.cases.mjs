import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { creationConfirmation, creationPasswordVariable } from "./prisma8-native-check-roundtrip-creation.mjs";
import { acceptedCreationFingerprint, createStoppedRoundTrip } from "./prisma8-native-check-roundtrip-create-stopped.mjs";
import { roundTripTarget as target } from "./prisma8-native-check-roundtrip-execution.mjs";

const endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine";
const args = [creationConfirmation, acceptedCreationFingerprint];
const password = "0123456789abcdef".repeat(4);
const source = { Path: "system", [creationPasswordVariable]: password, SCADA_DATABASE_URL: "unrelated-secret", POSTGRES_PASSWORD: "other-secret" };
const mainId = "a".repeat(64);
const reproId = "b".repeat(64);
const networkId = "c".repeat(64);
const containerId = "d".repeat(64);
const dataPath = "/var/lib/postgresql/data";
const mainNames = ["adui_scada_test", "adui_scada_fresh_prisma8_ref", "adui_scada_fresh_prisma8_native"];
const reproName = "adui_scada_fresh_prisma8_repro";

function catalog(database, role, systemIdentifier, names) {
  return JSON.stringify({
    database, role, version: 170011, readOnly: true, defaultReadOnly: true, isolation: "repeatable read", systemIdentifier,
    rows: names.map((name) => ({ database: name, encoding: "UTF8", provider: "c", collate: "en_US.utf8", ctype: "en_US.utf8", locale: null, version: null, actualVersion: null, customIcuRules: false })),
  });
}

function temporaryRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "scada-roundtrip-create-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixture(t, overrides = {}, root = temporaryRoot(t)) {
  const directory = join(root, ".artifacts", "prisma8-native-check-roundtrip-creation");
  const receipt = join(directory, "attempt.json");
  const resultPath = join(directory, "result.json");
  const calls = [];
  let attempt = "";
  const labels = () => ({ "org.adui.scope": "prisma8-check-roundtrip", "org.adui.attempt": attempt });
  const outputs = [
    "desktop-linux", endpoint, "linux", target.image, target.image,
    "adui-scada-prisma8-repro\nother", "other-data", "other-net", "[]", mainId,
    mainId + "|true|" + target.image + '|adui-scada|postgres|["/var/lib/postgresql"]',
    reproId + "|true|" + target.image + '|prisma8-native-repro|["/var/lib/postgresql/data"]',
    "", "", catalog(mainNames[0], "adui_scada", "1234567890123456789", mainNames),
    catalog(reproName, "adui_scada_native_repro", "2234567890123456789", [reproName]),
    JSON.stringify([target.image, { [dataPath]: {} }, ["docker-entrypoint.sh"], ["postgres"]]),
    target.volume,
    () => JSON.stringify([target.volume, "local", "local", labels(), null]),
    "",
    networkId,
    () => JSON.stringify([networkId, target.network, "bridge", "local", labels(), {}]),
    networkId + "|" + target.network,
    containerId,
    () => JSON.stringify([containerId, "/" + target.container, target.image, "created", false, labels(), [{ Type: "volume", Name: target.volume, Destination: dataPath, RW: true }], { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "15444" }] }, networkId, "no", false, false, false, ["docker-entrypoint.sh"], ["postgres"]]),
    () => JSON.stringify([target.volume, "local", "local", labels(), {}]),
    containerId,
    () => JSON.stringify([networkId, target.network, "bridge", "local", labels(), {}]),
    networkId + "|" + target.network,
  ];
  const run = (executable, argv, options) => {
    const index = calls.length;
    calls.push({ executable, argv, options });
    if (index === 17) {
      attempt = JSON.parse(readFileSync(receipt, "utf8")).attempt;
      assert.match(attempt, /^[a-f0-9]{32}$/u);
      assert.ok(argv.includes("org.adui.attempt=" + attempt));
    }
    const value = outputs[index];
    const result = { status: 0, signal: null, stdout: typeof value === "function" ? value() : value, stderr: "" };
    return { ...result, ...overrides[index] };
  };
  const execute = () => createStoppedRoundTrip("win32", args, source, root, run);
  return { root, directory, receipt, resultPath, calls, run, execute };
}

void test("停止态创建必须明确确认固定指纹、Windows 环境及专用凭据", (t) => {
  const f = fixture(t);
  for (const invalid of [[], [creationConfirmation], [...args, "--extra"], [creationConfirmation, "0".repeat(64)]]) {
    assert.throws(() => createStoppedRoundTrip("win32", invalid, source, f.root, f.run), /必须明确确认/u);
  }
  assert.throws(() => createStoppedRoundTrip("linux", args, source, f.root, f.run), /必须明确确认/u);
  assert.throws(() => createStoppedRoundTrip("win32", args, {}, f.root, f.run), /专用随机凭据格式无效/u);
  assert.throws(() => createStoppedRoundTrip("win32", args, { ...source, [creationPasswordVariable]: "bad" }, f.root, f.run), /专用随机凭据格式无效/u);
  assert.equal(f.calls.length, 0);
  assert.equal(existsSync(f.directory), false);
});

void test("创建前重新执行参考观察与镜像入口核验，失败不登记或创建资源", (t) => {
  for (const overrides of [{ 8: { stdout: "[15444]" } }, { 16: { stdout: JSON.stringify([target.image, {}, ["docker-entrypoint.sh"], ["postgres"]]) } }]) {
    const f = fixture(t, overrides);
    assert.throws(f.execute, /宿主机端口|固定镜像卷声明/u);
    assert.equal(existsSync(f.directory), false);
    assert.ok(f.calls.length <= 17);
  }
  const f = fixture(t);
  assert.throws(() => createStoppedRoundTrip("win32", args, { ...source, DOCKER_HOST: "tcp://remote" }, f.root, f.run), /Docker 环境覆盖/u);
  assert.equal(f.calls.length, 0);
});

void test("固定资源按顺序创建且只传递专用凭据，容器保持停止态", (t) => {
  const f = fixture(t);
  const report = f.execute();
  assert.equal(report.status, "NATIVE_CHECK_ROUNDTRIP_STOPPED_CREATION_REVIEW_REQUIRED");
  assert.equal(report.creationAttemptClaimed, true);
  assert.equal(report.stoppedContainerObserved, true);
  assert.equal(report.containerStarted, false);
  assert.equal(report.databaseInitialized, false);
  for (const key of ["portReserved", "resourceCreationAllowed", "observationSourceAuthenticated", "databaseExecutionAllowed", "roundTripVerified", "historicalAdoptionVerified", "signingAllowed", "deploymentAllowed", "collationRuntimeIdentityVerified"]) assert.equal(report[key], false);
  assert.equal(f.calls.length, 29);
  const receipt = JSON.parse(readFileSync(f.receipt, "utf8"));
  assert.equal(receipt.creationPlanFingerprint, acceptedCreationFingerprint);
  const labelArgs = ["--label", "org.adui.scope=prisma8-check-roundtrip", "--label", "org.adui.attempt=" + receipt.attempt];
  assert.deepEqual(f.calls[17].argv, ["--host", endpoint, "volume", "create", "--driver", "local", ...labelArgs, target.volume]);
  assert.deepEqual(f.calls[20].argv, ["--host", endpoint, "network", "create", "--driver", "bridge", ...labelArgs, target.network]);
  assert.deepEqual(f.calls[23].argv, ["--host", endpoint, "container", "create", "--name", target.container, ...labelArgs, "--pull", "never", "--restart", "no", "--network", networkId, "--publish", "127.0.0.1:15444:5432/tcp", "--mount", "type=volume,source=" + target.volume + ",target=" + dataPath + ",volume-nocopy", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_USER=" + target.role, "--env", "POSTGRES_DB=" + target.database, "--env", "PGDATA=" + dataPath, "--env", "POSTGRES_HOST_AUTH_METHOD=scram-sha-256", "--env", "POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale-provider=libc --locale=en_US.utf8 --auth-local=scram-sha-256 --auth-host=scram-sha-256", target.image]);
  for (const [index, call] of f.calls.entries()) {
    assert.equal(call.options.shell, false);
    assert.deepEqual(call.options.env, index === 23 ? { Path: "system", POSTGRES_PASSWORD: password } : { Path: "system" });
    assert.ok(!call.argv.includes(password));
    if (index >= 2 && index !== 8) assert.deepEqual(call.argv.slice(0, 2), ["--host", endpoint]);
    assert.ok(!["start", "run", "rm", "prune", "pull"].includes(call.argv[3]));
  }
  const saved = JSON.parse(readFileSync(f.resultPath, "utf8"));
  assert.deepEqual(saved, { ...report, attempt: receipt.attempt, containerId, networkId });
  assert.ok(!JSON.stringify({ receipt, saved, report }).includes(password));
  assert.doesNotMatch(JSON.stringify({ receipt, saved, report }), /unrelated-secret|other-secret/u);
});

void test("同一工作区的尝试记录禁止重复创建，不覆盖原记录", (t) => {
  const first = fixture(t);
  first.execute();
  const prior = readFileSync(first.receipt, "utf8");
  const again = fixture(t, {}, first.root);
  assert.throws(again.execute, /禁止执行/u);
  assert.equal(again.calls.length, 17);
  assert.equal(readFileSync(first.receipt, "utf8"), prior);
});

void test("记录目录链接或已经存在的空目录不得消费新的创建请求", (t) => {
  const f = fixture(t);
  const outside = temporaryRoot(t);
  symlinkSync(outside, join(f.root, ".artifacts"), "junction");
  assert.throws(f.execute, /禁止执行/u);
  assert.equal(f.calls.length, 17);
  assert.equal(existsSync(join(outside, "prisma8-native-check-roundtrip-creation")), false);
  const empty = fixture(t);
  mkdirSync(empty.directory, { recursive: true });
  assert.throws(empty.execute, /禁止执行/u);
  assert.equal(empty.calls.length, 17);
  assert.equal(existsSync(empty.receipt), false);
});

void test("同名卷复用、卷驱动或占用异常阻止后续网络及容器创建", (t) => {
  for (const overrides of [
    { 18: { stdout: JSON.stringify([target.volume, "local", "local", {}, null]) } },
    { 18: { stdout: "invalid" } },
    { 18: { stdout: JSON.stringify([target.volume, "other", "local", {}, null]) } },
    { 19: { stdout: mainId } },
  ]) {
    const f = fixture(t, overrides);
    assert.throws(f.execute, /第五座数据卷|身份结果格式异常/u);
    assert.ok(f.calls.length <= 20);
    assert.equal(existsSync(f.receipt), true);
    assert.equal(existsSync(f.resultPath), false);
  }
});

void test("网络标识、归属或同名竞争异常时保留已创建资源并停止", (t) => {
  for (const overrides of [
    { 20: { stdout: "invalid" } },
    { 21: { stdout: JSON.stringify([networkId, target.network, "bridge", "local", {}, { [mainId]: {} }]) } },
    { 22: { stdout: networkId + "|" + target.network + "\n" + mainId + "|" + target.network } },
  ]) {
    const f = fixture(t, overrides);
    assert.throws(f.execute, /第五座网络/u);
    assert.ok(f.calls.length <= 23);
    assert.equal(existsSync(f.receipt), true);
    assert.equal(existsSync(f.resultPath), false);
  }
});

void test("创建命令失败或容器不符合停止态边界时不启动、不清理并保留尝试记录", (t) => {
  for (const overrides of [
    { 23: { status: 1, stderr: password } },
    { 23: { stdout: "invalid" } },
    { 24: { stdout: JSON.stringify([containerId, "/" + target.container, target.image, "running", true, {}, [], {}, networkId, "no", false, false, false, ["docker-entrypoint.sh"], ["postgres"]]) } },
    { 26: { stdout: containerId + "\n" + mainId } },
  ]) {
    const f = fixture(t, overrides);
    assert.throws(f.execute, (error) => /第五座/u.test(error.message) && !error.message.includes(password));
    assert.ok(f.calls.length <= 27);
    assert.equal(existsSync(f.receipt), true);
    assert.equal(existsSync(f.resultPath), false);
    assert.ok(f.calls.every(({ argv }) => !["start", "run", "rm", "prune"].includes(argv[3])));
  }
});
