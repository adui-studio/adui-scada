import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRestoreHostArgs, readRestoreHost, runRestoreHostCli } from "./docker-db-role-b4-restore-host.mjs";

const token = "1234567890abcdef";
const restoreId = "d".repeat(64);
const restoreName = "adui-b4-restore-" + token;
const restoreVolume = "adui-b4-restore-data-" + token;
const originalVolume = "adui-scada_postgres-data";
const endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine";
const args = ["--confirm-readonly-restore-host", "--restore-token=" + token, "--restore-id=" + restoreId];

function volume(name) {
  return { name, driver: "local", scope: "local", options: null, mountpoint: "/private/" + name };
}

function mount(name) {
  return { Type: "volume", Name: name, Driver: "local", Destination: "/var/lib/postgresql", RW: true, Source: volume(name).mountpoint };
}

function container(service, id, running) {
  return {
    name: "/adui-scada-" + service + "-1",
    id: id.repeat(64),
    image: "sha256:" + "e".repeat(64),
    project: "adui-scada",
    service,
    status: running ? "running" : "exited",
    running,
    paused: false,
    restarting: false,
    purpose: "",
    networkMode: "adui-scada_default",
    networks: {},
    bindings: {},
    ports: {},
    publishAll: false,
    privileged: false,
    pidMode: "",
    ipcMode: "private",
    restart: "unless-stopped",
    mounts: [],
  };
}

function fixture() {
  const postgres = container("postgres", "a", true);
  postgres.mounts = [mount(originalVolume)];
  const server = container("server", "b", false);
  const keycloak = container("keycloak", "c", false);
  const restore = {
    ...container("restore", "d", false),
    name: "/" + restoreName,
    purpose: "b4-backup-restore",
    networkMode: "none",
    networks: { none: {} },
    bindings: null,
    ports: { "5432/tcp": null },
    restart: "no",
    mounts: [mount(restoreVolume)],
  };
  const originalData = volume(originalVolume);
  const restoreData = volume(restoreVolume);
  const entries = new Map([
    ["adui-scada-postgres-1", postgres],
    ["adui-scada-server-1", server],
    ["adui-scada-keycloak-1", keycloak],
    [restoreId, restore],
    [originalVolume, originalData],
    [restoreVolume, restoreData],
  ]);
  const calls = [];
  const run = (command) => {
    calls.push(command);
    assert.equal(command[1], "inspect");
    assert.equal(command[2], "--format");
    assert.equal(command.length, 5);
    assert.ok(["container", "volume"].includes(command[0]));
    assert.equal(command[3].includes(".Config.Env"), false);
    assert.equal(command[3].includes("{{json .}}"), false);
    assert.ok(entries.has(command[4]));
    return JSON.stringify(entries.get(command[4]));
  };
  return { postgres, server, keycloak, restore, originalData, restoreData, calls, run };
}

test("固定确认、令牌与完整容器 ID 缺一不可", () => {
  assert.deepEqual(parseRestoreHostArgs(args), { token, restoreId });
  for (const invalid of [[], args.slice(0, 2), [...args, "--start"], [args[0], "--restore-token=../unsafe", args[2]], [args[0], args[1], "--restore-id=abcd"]]) {
    assert.throws(() => parseRestoreHostArgs(invalid), { message: "必须明确确认只读宿主核验并提供恢复标识及完整容器 ID" });
  }
});

test("两次只读目录匹配并输出有限证据，不输出挂载源路径", () => {
  const f = fixture();
  const report = readRestoreHost({ token, restoreId }, f.run);
  assert.equal(report.status, "B4_RESTORE_HOST_PREFLIGHT_VERIFIED");
  assert.equal(report.originalServicesStopped, true);
  assert.equal(report.restoreStopped, true);
  assert.equal(report.distinctDataVolume, true);
  assert.match(report.hostFingerprint, /^[a-f0-9]{64}$/u);
  for (const flag of ["databaseAccessed", "databaseWritten", "restoreCatalogVerified", "rowAuthorizationVerified", "admissionPassed", "serviceSwitched"]) {
    assert.equal(report[flag], false);
  }
  assert.equal(f.calls.length, 12);
  assert.deepEqual(f.calls.slice(0, 6), f.calls.slice(6));
  assert.doesNotMatch(JSON.stringify(report), /\/private\//u);
});

test("拒绝原服务运行、恢复容器启动、容器身份替换和镜像漂移", () => {
  for (const mutate of [
    (f) => { f.server.running = true; },
    (f) => { f.keycloak.status = "running"; },
    (f) => { f.restore.running = true; },
    (f) => { f.restore.id = "f".repeat(64); },
    (f) => { f.postgres.project = "other"; },
    (f) => { f.restore.image = "sha256:" + "f".repeat(64); },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => readRestoreHost({ token, restoreId }, f.run), /不一致/u);
  }
});

test("拒绝联网、发布端口、特权或共享命名空间", () => {
  for (const changes of [
    { networkMode: "bridge" },
    { networks: { none: {}, bridge: {} } },
    { bindings: { "5432/tcp": [] } },
    { ports: { "5432/tcp": [{ HostPort: "5432" }] } },
    { publishAll: true },
    { privileged: true },
    { pidMode: "host" },
    { ipcMode: "host" },
    { restart: "always" },
  ]) {
    const f = fixture();
    Object.assign(f.restore, changes);
    assert.throws(() => readRestoreHost({ token, restoreId }, f.run), { message: "恢复容器网络、端口或运行隔离配置不一致" });
  }
});

test("拒绝原卷复用、额外挂载、别名卷及外部卷选项", () => {
  for (const mutate of [
    (f) => { f.restore.mounts = [mount(originalVolume)]; },
    (f) => { f.restore.mounts.push(mount(originalVolume)); },
    (f) => { f.restoreData.mountpoint = f.originalData.mountpoint; },
    (f) => { f.restoreData.options = { device: "/private" }; },
    (f) => { f.restore.mounts[0].RW = false; },
    (f) => { f.postgres.mounts.push(mount(restoreVolume)); },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => readRestoreHost({ token, restoreId }, f.run), /数据卷|数据库卷/u);
  }
});

test("拒绝两次目录间容器替换，错误不包含原始证据", () => {
  const f = fixture();
  let count = 0;
  assert.throws(() => readRestoreHost({ token, restoreId }, (command) => {
    if (++count === 7) f.postgres.id = "f".repeat(64);
    return f.run(command);
  }), { message: "两次宿主目录证据不一致，禁止继续" });
  assert.throws(() => readRestoreHost({ token, restoreId }, () => {
    throw new Error("模拟敏感凭据");
  }), { message: "Docker 只读目录解析失败，内部诊断已脱敏" });
});

test("只允许 Windows 本机 Linux 引擎，实际 inspect 全部锁定同一端点", () => {
  const f = fixture();
  const calls = [];
  const run = (command) => {
    calls.push(command);
    if (command[0] === "context") return command[1] === "show" ? "desktop-linux" : endpoint;
    assert.deepEqual(command.slice(0, 2), ["--host", endpoint]);
    if (command[2] === "info") return "linux";
    return f.run(command.slice(2));
  };
  assert.equal(runRestoreHostCli(args, "win32", {}, run).databaseAccessed, false);
  assert.equal(calls.length, 15);
  for (const input of [{ platform: "linux", env: {} }, { platform: "win32", env: { docker_host: "tcp://remote" } }]) {
    assert.throws(() => runRestoreHostCli(args, input.platform, input.env, () => {
      assert.fail("不允许调用 Docker");
    }), { message: "仅允许 Windows 本机 Docker Desktop，禁止连接环境覆盖" });
  }
  assert.throws(() => runRestoreHostCli(args, "win32", {}, (command) => command[1] === "show" ? "remote" : "tcp://remote"), { message: "仅允许 Windows 本机 Docker Desktop" });
});
