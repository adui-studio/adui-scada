import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { acceptedPlanFingerprint, roundTripTarget } from "./prisma8-native-check-roundtrip-execution.mjs";

const endpoints = ["npipe:////./pipe/dockerDesktopLinuxEngine", "npipe:////./pipe/docker_engine"];
const blockedEnvironment = new Set([
  "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
]);
const allowedEnvironment = new Set([
  "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
]);
const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;

class HostPreflightError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new HostPreflightError(message);
}

/** 仅传递必要系统环境，不继承连接串和凭据。 */
export function hostChildEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowedEnvironment.has(key.toUpperCase())));
}

function readCommand(run, executable, args, env, stage) {
  let result;
  try {
    result = run(executable, args, {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      shell: false,
    });
  } catch {
    throw new HostPreflightError(stage + "：子进程调用失败");
  }
  requireMatch(
    result && result.status === 0 && !result.error && result.signal === null &&
      typeof result.stdout === "string" && typeof result.stderr === "string" && result.stderr.trim() === "",
    stage + "：未取得成功的只读结果",
  );
  return result.stdout.trim();
}

function requireAbsent(output, expected, stage) {
  const names = output === "" ? [] : output.split(/\r?\n/u);
  requireMatch(names.every((name) => namePattern.test(name)), stage + "：资源清单格式异常");
  requireMatch(!names.some((name) => name.toLowerCase() === expected.toLowerCase()), stage + "：目标资源已存在，保留原状");
}

/** 仅检查创建前宿主机状态，不连接数据库或授予创建许可。 */
export function inspectRoundTripHost(platform, args, source, run = spawnSync) {
  requireMatch(platform === "win32" && args.length === 0, "仅允许 Windows 本机无参数宿主机预检");
  requireMatch(!Object.entries(source).some(([key, value]) => blockedEnvironment.has(key.toUpperCase()) && value), "存在 Docker 环境覆盖，禁止宿主机预检");
  const env = hostChildEnvironment(source);
  const docker = (command, stage) => readCommand(run, "docker", command, env, stage);
  const context = docker(["context", "show"], "读取 Docker 上下文");
  requireMatch(namePattern.test(context), "Docker 上下文名称无效");
  const endpoint = docker(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"], "读取 Docker 端点");
  requireMatch(endpoints.includes(endpoint), "Docker 端点不是本机 Windows 命名管道");
  const local = (command, stage) => docker(["--host", endpoint, ...command], stage);
  requireMatch(local(["info", "--format", "{{.OSType}}"], "读取 Docker 引擎") === "linux", "Docker 引擎不是 Linux 容器环境");
  requireMatch(local(["container", "inspect", "--format", "{{.Image}}", "adui-scada-prisma8-repro"], "核对第四座保留镜像") === roundTripTarget.image, "第四座保留容器镜像不一致");
  requireMatch(local(["image", "inspect", "--format", "{{.Id}}", roundTripTarget.image], "核对本机固定镜像") === roundTripTarget.image, "本机固定镜像不一致");
  requireAbsent(local(["container", "ls", "--all", "--format", "{{.Names}}"], "核对容器"), roundTripTarget.container, "核对容器");
  requireAbsent(local(["volume", "ls", "--format", "{{.Name}}"], "核对数据卷"), roundTripTarget.volume, "核对数据卷");
  requireAbsent(local(["network", "ls", "--format", "{{.Name}}"], "核对网络"), roundTripTarget.network, "核对网络");
  const port = readCommand(run, "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; ConvertTo-Json -InputObject @(Get-NetTCPConnection -ErrorAction Stop | Where-Object LocalPort -eq " + roundTripTarget.port + " | Select-Object -ExpandProperty LocalPort) -Compress"], env, "核对宿主机端口");
  requireMatch(port === "[]", "宿主机端口存在 TCP 记录或检查结果异常，禁止继续");
  return {
    status: "NATIVE_CHECK_ROUNDTRIP_HOST_REVIEW_REQUIRED",
    planFingerprint: acceptedPlanFingerprint,
    target: roundTripTarget,
    hostPreflightPassed: true,
    portObservedUnused: true,
    portReserved: false,
    resourceCreationAllowed: false,
    observationSourceAuthenticated: false,
    databaseExecutionAllowed: false,
    roundTripVerified: false,
    historicalAdoptionVerified: false,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = inspectRoundTripHost(process.platform, process.argv.slice(2), process.env);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (error) {
    console.error(error instanceof HostPreflightError ? error.message : "宿主机预检失败，内部诊断已脱敏");
    process.exitCode = 1;
  }
}
