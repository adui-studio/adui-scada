import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptedPlanFingerprint, roundTripTarget } from "./prisma8-native-check-roundtrip-execution.mjs";
import { hostChildEnvironment, inspectRoundTripHost } from "./prisma8-native-check-roundtrip-host.mjs";

const endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine";
const outputs = ["desktop-linux", endpoint, "linux", roundTripTarget.image, roundTripTarget.image,
  "adui-scada-prisma8-repro\r\nother", "other-data", "bridge\nother-net", "[]"];

function fixture(overrides = {}) {
  const calls = [];
  const run = (executable, args, options) => {
    const index = calls.length;
    calls.push({ executable, args, options });
    return { status: 0, signal: null, stdout: outputs[index], stderr: "", ...overrides[index] };
  };
  return { calls, run };
}

void test("只读成功报告不得授予创建、执行、签名或部署许可", () => {
  const { calls, run } = fixture();
  const report = inspectRoundTripHost("win32", [], { Path: "system", SCADA_DATABASE_URL: "secret" }, run);
  assert.equal(report.status, "NATIVE_CHECK_ROUNDTRIP_HOST_REVIEW_REQUIRED");
  assert.equal(report.planFingerprint, acceptedPlanFingerprint);
  assert.deepEqual(report.target, roundTripTarget);
  assert.equal(report.hostPreflightPassed, true);
  assert.equal(report.portObservedUnused, true);
  assert.deepEqual(Object.values(report).filter((value) => value === false), Array(8).fill(false));
  assert.equal(calls.length, 9);
  assert.deepEqual(calls.map(({ executable }) => executable), [...Array(8).fill("docker"), "powershell.exe"]);
  assert.deepEqual(calls.slice(0, 2).map(({ args }) => args), [["context", "show"], ["context", "inspect", "desktop-linux", "--format", "{{.Endpoints.docker.Host}}"]]);
  assert.deepEqual(calls.slice(2, 8).map(({ args }) => args), [
    ["--host", endpoint, "info", "--format", "{{.OSType}}"],
    ["--host", endpoint, "container", "inspect", "--format", "{{.Image}}", "adui-scada-prisma8-repro"],
    ["--host", endpoint, "image", "inspect", "--format", "{{.Id}}", roundTripTarget.image],
    ["--host", endpoint, "container", "ls", "--all", "--format", "{{.Names}}"],
    ["--host", endpoint, "volume", "ls", "--format", "{{.Name}}"],
    ["--host", endpoint, "network", "ls", "--format", "{{.Name}}"],
  ]);
  assert.deepEqual(calls[8].args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  assert.match(calls[8].args[3], /LocalPort -eq 15434/u);
  for (const { options } of calls) {
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 15000);
    assert.equal(options.maxBuffer, 1024 * 1024);
    assert.deepEqual(options.env, { Path: "system" });
  }
});

void test("非 Windows、额外参数和 Docker 覆盖在调用前拒绝", () => {
  const { calls, run } = fixture();
  assert.throws(() => inspectRoundTripHost("linux", [], {}, run), /仅允许 Windows/u);
  assert.throws(() => inspectRoundTripHost("win32", ["--create"], {}, run), /仅允许 Windows/u);
  for (const key of ["docker_host", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) {
    assert.throws(() => inspectRoundTripHost("win32", [], { [key]: "override" }, run), /Docker 环境覆盖/u);
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(hostChildEnvironment({ Path: "path", SystemRoot: "root", NODE_OPTIONS: "inject", PGPASSWORD: "secret" }), { Path: "path", SystemRoot: "root" });
});

void test("远程端点、异常上下文和非 Linux 引擎均提前停止", () => {
  for (const { index, stdout, expected } of [
    { index: 0, stdout: "--remote", expected: /上下文名称无效/u },
    { index: 1, stdout: "tcp://remote:2375", expected: /本机 Windows 命名管道/u },
    { index: 2, stdout: "windows", expected: /不是 Linux/u },
  ]) {
    const { calls, run } = fixture({ [index]: { stdout } });
    assert.throws(() => inspectRoundTripHost("win32", [], {}, run), expected);
    assert.equal(calls.length, index + 1);
  }
});

void test("第四座保留镜像或本机固定镜像不一致时停止", () => {
  for (const index of [3, 4]) {
    const { calls, run } = fixture({ [index]: { stdout: "sha256:other" } });
    assert.throws(() => inspectRoundTripHost("win32", [], {}, run), /镜像不一致/u);
    assert.equal(calls.length, index + 1);
  }
});

void test("第五座容器、卷和网络重名均保留原状并停止", () => {
  for (const { index, name } of [{ index: 5, name: roundTripTarget.container }, { index: 6, name: roundTripTarget.volume }, { index: 7, name: roundTripTarget.network }]) {
    const { calls, run } = fixture({ [index]: { stdout: "other\n" + name.toUpperCase() } });
    assert.throws(() => inspectRoundTripHost("win32", [], {}, run), /目标资源已存在，保留原状/u);
    assert.equal(calls.length, index + 1);
  }
});

void test("相似名称不误判，异常资源清单拒绝", () => {
  const good = fixture({ 5: { stdout: roundTripTarget.container + "-old" } });
  assert.equal(inspectRoundTripHost("win32", [], {}, good.run).hostPreflightPassed, true);
  const bad = fixture({ 5: { stdout: "name\ninvalid name" } });
  assert.throws(() => inspectRoundTripHost("win32", [], {}, bad.run), /资源清单格式异常/u);
  assert.equal(bad.calls.length, 6);
});

void test("任何 TCP 记录或非空数组之外的端口输出均拒绝", () => {
  for (const stdout of ["[15434]", "15434", "null", "", "unexpected"]) {
    const { run } = fixture({ 8: { stdout } });
    assert.throws(() => inspectRoundTripHost("win32", [], {}, run), /端口存在 TCP 记录或检查结果异常/u);
  }
});

void test("子进程失败、信号、标准错误及抛出异常均脱敏并短路", () => {
  for (const override of [{ status: 1 }, { signal: "SIGTERM" }, { error: new Error("secret") }, { stderr: "secret" }]) {
    const { calls, run } = fixture({ 3: override });
    assert.throws(() => inspectRoundTripHost("win32", [], {}, run), { message: "核对第四座保留镜像：未取得成功的只读结果" });
    assert.equal(calls.length, 4);
  }
  assert.throws(() => inspectRoundTripHost("win32", [], {}, () => { throw new Error("secret"); }), { message: "读取 Docker 上下文：子进程调用失败" });
});
