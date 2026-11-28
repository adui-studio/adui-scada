import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const originalVolume = "adui-scada_postgres-data";
const dataTarget = "/var/lib/postgresql";
const hexId = /^[a-f0-9]{64}$/u;
const endpoints = [
  "npipe:////./pipe/dockerDesktopLinuxEngine",
  "npipe:////./pipe/docker_engine",
];

// 只读取固定目录字段，不读取完整容器配置、环境变量或凭据。
const containerFormat = [
  '{"name":{{json .Name}},"id":{{json .Id}},"image":{{json .Image}},',
  '"status":{{json .State.Status}},"running":{{json .State.Running}},',
  '"paused":{{json .State.Paused}},"restarting":{{json .State.Restarting}},',
  '"purpose":{{json (index .Config.Labels "adui.purpose")}},',
  '"project":{{json (index .Config.Labels "com.docker.compose.project")}},',
  '"service":{{json (index .Config.Labels "com.docker.compose.service")}},',
  '"networkMode":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}},',
  '"bindings":{{json .HostConfig.PortBindings}},"ports":{{json .NetworkSettings.Ports}},',
  '"publishAll":{{json .HostConfig.PublishAllPorts}},"privileged":{{json .HostConfig.Privileged}},',
  '"pidMode":{{json .HostConfig.PidMode}},"ipcMode":{{json .HostConfig.IpcMode}},',
  '"restart":{{json .HostConfig.RestartPolicy.Name}},',
  '"mounts":{{json .Mounts}}}',
].join("");
const volumeFormat =
  '{"name":{{json .Name}},"driver":{{json .Driver}},"scope":{{json .Scope}},"options":{{json .Options}},"mountpoint":{{json .Mountpoint}}}';

class RestoreHostError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new RestoreHostError(message);
}

export function parseRestoreHostArgs(args) {
  const token = args[1]?.match(/^--restore-token=([a-f0-9]{16})$/u)?.[1];
  const restoreId = args[2]?.match(/^--restore-id=([a-f0-9]{64})$/u)?.[1];
  requireMatch(
    args.length === 3 && args[0] === "--confirm-readonly-restore-host" && token && restoreId,
    "必须明确确认只读宿主核验并提供恢复标识及完整容器 ID",
  );
  return { token, restoreId };
}

function checked(run, args) {
  try {
    const result = run(args);
    if (typeof result === "string" && result.trim()) return result.trim();
  } catch {
    // 子进程原始异常可能含连接信息，仅返回固定诊断。
  }
  throw new RestoreHostError("Docker 只读目录读取失败，内部诊断已脱敏");
}

function emptyMap(value) {
  return value === null || (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}

function noPublishedPorts(value) {
  return emptyMap(value) || (value && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every((entry) => entry === null));
}

function inspect(run, kind, name, format) {
  try {
    return JSON.parse(checked(run, [kind, "inspect", "--format", format, name]));
  } catch {
    throw new RestoreHostError("Docker 只读目录解析失败，内部诊断已脱敏");
  }
}

function requireState(value, status, running) {
  requireMatch(
    value?.status === status && value.running === running && value.paused === false && value.restarting === false,
    "原服务或恢复容器维护状态不一致",
  );
}

function requireOriginal(value, service) {
  requireMatch(
    value?.name === "/adui-scada-" + service + "-1" &&
      value.project === "adui-scada" && value.service === service &&
      typeof value.id === "string" && hexId.test(value.id),
    "原 Docker Compose 容器身份不一致",
  );
}

function requireVolume(value, name) {
  requireMatch(
    value?.name === name && value.driver === "local" && value.scope === "local" &&
      emptyMap(value.options) && typeof value.mountpoint === "string" && value.mountpoint.startsWith("/"),
    "数据库卷不是预期的独立本地卷",
  );
}

function requireDataMount(mount, volume) {
  requireMatch(
    mount?.Type === "volume" && mount.Name === volume.name && mount.Destination === dataTarget &&
      mount.Driver === "local" && mount.RW === true && mount.Source === volume.mountpoint,
    "数据库数据卷挂载不一致",
  );
}

/** 仅生成停机宿主目录证据；不得用于授权数据库连接或写入。 */
export function readRestoreHost({ token, restoreId }, run) {
  requireMatch(
    typeof token === "string" && /^[a-f0-9]{16}$/u.test(token) &&
      typeof restoreId === "string" && hexId.test(restoreId),
    "恢复标识或完整容器 ID 无效",
  );
  const restoreName = "adui-b4-restore-" + token;
  const restoreVolume = "adui-b4-restore-data-" + token;
  function snapshot() {
    const postgres = inspect(run, "container", "adui-scada-postgres-1", containerFormat);
    const server = inspect(run, "container", "adui-scada-server-1", containerFormat);
    const keycloak = inspect(run, "container", "adui-scada-keycloak-1", containerFormat);
    const restore = inspect(run, "container", restoreId, containerFormat);
    const originalData = inspect(run, "volume", originalVolume, volumeFormat);
    const restoreData = inspect(run, "volume", restoreVolume, volumeFormat);
    requireOriginal(postgres, "postgres");
    requireOriginal(server, "server");
    requireOriginal(keycloak, "keycloak");
    requireState(postgres, "running", true);
    requireState(server, "exited", false);
    requireState(keycloak, "exited", false);
    requireState(restore, "exited", false);
    requireMatch(
      restore?.name === "/" + restoreName && restore.id === restoreId &&
        ![postgres.id, server.id, keycloak.id].includes(restore.id) &&
        restore.purpose === "b4-backup-restore",
      "恢复容器身份与原恢复证据不一致",
    );
    requireMatch(
      typeof postgres.image === "string" && /^sha256:[a-f0-9]{64}$/u.test(postgres.image) &&
        restore.image === postgres.image,
      "恢复容器镜像与当前原 PostgreSQL 镜像不一致",
    );
    requireMatch(
      restore.networkMode === "none" &&
        (emptyMap(restore.networks) ||
          (restore.networks && isDeepStrictEqual(Object.keys(restore.networks), ["none"]))) &&
        emptyMap(restore.bindings) && noPublishedPorts(restore.ports) && restore.publishAll === false &&
        restore.privileged === false && restore.pidMode === "" &&
        ["", "private"].includes(restore.ipcMode) && restore.restart === "no",
      "恢复容器网络、端口或运行隔离配置不一致",
    );
    requireVolume(originalData, originalVolume);
    requireVolume(restoreData, restoreVolume);
    requireMatch(
      originalData.mountpoint !== restoreData.mountpoint &&
        Array.isArray(postgres.mounts) && Array.isArray(restore.mounts) && restore.mounts.length === 1,
      "恢复数据卷未证明独立",
    );
    const originalMounts = postgres.mounts.filter((mount) => mount.Destination === dataTarget);
    requireMatch(originalMounts.length === 1, "原数据库数据卷挂载不唯一");
    requireDataMount(originalMounts[0], originalData);
    requireDataMount(restore.mounts[0], restoreData);
    requireMatch(
      !postgres.mounts.some((mount) => mount.Name === restoreVolume || mount.Source === restoreData.mountpoint),
      "原数据库引用了恢复数据卷",
    );
    return { postgres, server, keycloak, restore, originalData, restoreData };
  }
  const before = snapshot();
  requireMatch(isDeepStrictEqual(snapshot(), before), "两次宿主目录证据不一致，禁止继续");
  return {
    status: "B4_RESTORE_HOST_PREFLIGHT_VERIFIED",
    restoreContainer: restoreName,
    restoreContainerId: restoreId,
    imageId: before.restore.image,
    hostFingerprint: createHash("sha256").update(JSON.stringify(before)).digest("hex"),
    originalServicesStopped: true,
    restoreStopped: true,
    networkIsolated: true,
    distinctDataVolume: true,
    databaseAccessed: false,
    databaseWritten: false,
    restoreCatalogVerified: false,
    rowAuthorizationVerified: false,
    admissionPassed: false,
    serviceSwitched: false,
  };
}

export function runRestoreHostCli(args, platform, env, run) {
  const target = parseRestoreHostArgs(args);
  requireMatch(
    platform === "win32" && !Object.entries(env).some(([key, value]) =>
      /^(DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_TLS|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH)$/iu.test(key) && value),
    "仅允许 Windows 本机 Docker Desktop，禁止连接环境覆盖",
  );
  const context = checked(run, ["context", "show"]);
  requireMatch(/^[a-zA-Z0-9_.-]+$/u.test(context), "Docker 上下文名称无效");
  const endpoint = checked(run, ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]);
  requireMatch(endpoints.includes(endpoint), "仅允许 Windows 本机 Docker Desktop");
  const localRun = (command) => run(["--host", endpoint, ...command]);
  requireMatch(checked(localRun, ["info", "--format", "{{.OSType}}"]) === "linux", "Docker 必须使用 Linux 容器引擎");
  return readRestoreHost(target, localRun);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const report = runRestoreHostCli(process.argv.slice(2), process.platform, process.env, (args) => {
      const result = spawnSync("docker", args, {
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      return result.status === 0 ? result.stdout : "";
    });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (error) {
    // 公开入口不输出第三方错误正文、原始目录、凭据或路径。
    const message = error instanceof RestoreHostError
      ? error.message
      : "恢复宿主核验失败，内部诊断已脱敏";
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  }
}
