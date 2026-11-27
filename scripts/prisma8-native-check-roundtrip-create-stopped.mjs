import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  creationConfirmation,
  creationPasswordVariable,
  reviewRoundTripCreationRequest,
  RoundTripCreationError,
} from "./prisma8-native-check-roundtrip-creation.mjs";
import { roundTripTarget } from "./prisma8-native-check-roundtrip-execution.mjs";
import {
  hostChildEnvironment,
  HostPreflightError,
  inspectRoundTripReferenceContext,
} from "./prisma8-native-check-roundtrip-host.mjs";
import {
  referenceConfirmation,
  RoundTripReferenceError,
} from "./prisma8-native-check-roundtrip-reference.mjs";

export const acceptedCreationFingerprint =
  "69cd50940b9e3ff9752aa45eea3ff60bc34214ca7127908259a54897c6013dd7";
const scope = "prisma8-check-roundtrip";
const dataPath = "/var/lib/postgresql/data";
const attemptPath = "prisma8-native-check-roundtrip-creation";
const idPattern = /^[a-f0-9]{64}$/u;
const entrypoint = ["docker-entrypoint.sh"];
const command = ["postgres"];

export class StoppedCreationError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new StoppedCreationError(message);
}

function realDirectory(path) {
  return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() && realpathSync(path) === path;
}

/** 原子占用固定实验目录，任何后续失败都保留记录，不保存凭据。 */
function claimAttempt(root, plan, attempt) {
  try {
    requireMatch(realDirectory(root), "创建记录根目录无效");
    const artifacts = join(root, ".artifacts");
    if (!lstatSync(artifacts, { throwIfNoEntry: false })) mkdirSync(artifacts);
    requireMatch(realDirectory(artifacts), "创建记录目录不允许链接");
    const directory = join(artifacts, attemptPath);
    mkdirSync(directory);
    writeFileSync(
      join(directory, "attempt.json"),
      JSON.stringify({ scope, creationPlanFingerprint: plan.creationPlanFingerprint, attempt }) +
        "\n",
      { flag: "wx", flush: true },
    );
    return directory;
  } catch {
    throw new StoppedCreationError("第五座创建尝试记录已存在或无法独占登记，禁止执行");
  }
}

function emptyObject(value) {
  return value === null || isDeepStrictEqual(value, {});
}

function makeDocker(endpoint, env, run) {
  return (args, stage, secretEnv = {}) => {
    let result;
    try {
      result = run("docker", ["--host", endpoint, ...args], {
        env: { ...env, ...secretEnv },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
    } catch {
      throw new StoppedCreationError(stage + "：Docker 调用失败，保留现场");
    }
    requireMatch(
      result &&
        result.status === 0 &&
        !result.error &&
        result.signal === null &&
        typeof result.stdout === "string" &&
        typeof result.stderr === "string" &&
        result.stderr.trim() === "",
      stage + "：Docker 结果异常，保留现场",
    );
    return result.stdout.trim();
  };
}

function inspectFields(docker, kind, id, fields, stage) {
  const format = "[" + fields.map((field) => "{{json " + field + "}}").join(",") + "]";
  const text = docker([kind, "inspect", "--format", format, id], stage);
  let facts;
  try {
    facts = JSON.parse(text);
  } catch {
    throw new StoppedCreationError(stage + "：身份结果格式异常，保留现场");
  }
  requireMatch(Array.isArray(facts) && facts.length === fields.length, stage + "：身份字段异常");
  return facts;
}

function requireVolume(docker, labels, containerId) {
  const target = roundTripTarget;
  const [name, driver, volumeScope, actualLabels, options] = inspectFields(
    docker,
    "volume",
    target.volume,
    [".Name", ".Driver", ".Scope", ".Labels", ".Options"],
    "核对第五座数据卷",
  );
  requireMatch(
    name === target.volume &&
      driver === "local" &&
      volumeScope === "local" &&
      isDeepStrictEqual(actualLabels, labels) &&
      emptyObject(options),
    "第五座数据卷归属或驱动不符，保留现场",
  );
  const attached = docker(
    [
      "container",
      "ls",
      "--all",
      "--filter",
      "volume=" + target.volume,
      "--no-trunc",
      "--format",
      "{{.ID}}",
    ],
    "核对第五座数据卷占用",
  );
  requireMatch(attached === containerId, "第五座数据卷存在非预期容器，保留现场");
}

function requireNetwork(docker, networkId, labels, containerId) {
  const [id, name, driver, networkScope, actualLabels, attached] = inspectFields(
    docker,
    "network",
    networkId,
    [".Id", ".Name", ".Driver", ".Scope", ".Labels", ".Containers"],
    "核对第五座网络",
  );
  requireMatch(
    id === networkId &&
      name === roundTripTarget.network &&
      driver === "bridge" &&
      networkScope === "local" &&
      isDeepStrictEqual(actualLabels, labels) &&
      (emptyObject(attached) ||
        (containerId !== "" &&
          attached &&
          typeof attached === "object" &&
          !Array.isArray(attached) &&
          Object.keys(attached).every((key) => key === containerId))),
    "第五座网络归属或占用不符，保留现场",
  );
  const matches = docker(
    ["network", "ls", "--no-trunc", "--format", "{{.ID}}|{{.Name}}"],
    "核对第五座网络唯一性",
  )
    .split(/\r?\n/u)
    .filter((line) => line.endsWith("|" + roundTripTarget.network));
  requireMatch(
    isDeepStrictEqual(matches, [networkId + "|" + roundTripTarget.network]),
    "第五座网络名称不唯一，保留现场",
  );
}

/** 经专项确认后只创建停止态容器及独立资源，不启动 PostgreSQL。 */
export function createStoppedRoundTrip(platform, args, source, root, run = spawnSync) {
  requireMatch(
    platform === "win32" &&
      isDeepStrictEqual(args, [creationConfirmation, acceptedCreationFingerprint]),
    "必须明确确认第五座停止态创建及已验收指纹",
  );
  const password = source[creationPasswordVariable];
  requireMatch(
    typeof password === "string" && idPattern.test(password),
    "第五座专用随机凭据格式无效",
  );
  const { report: reference, endpoint } = inspectRoundTripReferenceContext(
    platform,
    [referenceConfirmation],
    source,
    run,
  );
  const plan = reviewRoundTripCreationRequest(args, reference);
  const target = plan.target;
  const docker = makeDocker(endpoint, hostChildEnvironment(source), run);
  const imageFacts = inspectFields(
    docker,
    "image",
    target.image,
    [".Id", ".Config.Volumes", ".Config.Entrypoint", ".Config.Cmd"],
    "核对固定镜像初始化契约",
  );
  requireMatch(
    isDeepStrictEqual(imageFacts, [target.image, { [dataPath]: {} }, entrypoint, command]),
    "固定镜像卷声明或入口不符合创建契约",
  );
  const attempt = randomBytes(16).toString("hex");
  const directory = claimAttempt(root, plan, attempt);
  const labels = { "org.adui.scope": scope, "org.adui.attempt": attempt };
  const labelArgs = [
    "--label",
    plan.resources.scopeLabel,
    "--label",
    "org.adui.attempt=" + attempt,
  ];
  requireMatch(
    docker(
      ["volume", "create", "--driver", "local", ...labelArgs, target.volume],
      "创建第五座数据卷",
    ) === target.volume,
    "第五座数据卷创建结果异常，保留现场",
  );
  requireVolume(docker, labels, "");
  const networkId = docker(
    ["network", "create", "--driver", "bridge", ...labelArgs, target.network],
    "创建第五座专用网络",
  );
  requireMatch(idPattern.test(networkId), "第五座网络创建标识异常，保留现场");
  requireNetwork(docker, networkId, labels, "");
  const containerId = docker(
    [
      "container",
      "create",
      "--name",
      target.container,
      ...labelArgs,
      "--pull",
      "never",
      "--restart",
      "no",
      "--network",
      networkId,
      "--publish",
      target.host + ":" + target.port + ":5432/tcp",
      "--mount",
      "type=volume,source=" + target.volume + ",target=" + dataPath + ",volume-nocopy",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_USER=" + target.role,
      "--env",
      "POSTGRES_DB=" + target.database,
      "--env",
      "PGDATA=" + dataPath,
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=" + plan.initialization.hostAuthMethod,
      "--env",
      "POSTGRES_INITDB_ARGS=" + plan.initialization.initdbArgs.join(" "),
      target.image,
    ],
    "创建第五座停止态容器",
    { POSTGRES_PASSWORD: password },
  );
  requireMatch(idPattern.test(containerId), "第五座容器创建标识异常，保留现场");
  const [
    id,
    name,
    image,
    state,
    running,
    actualLabels,
    mounts,
    ports,
    networkMode,
    restart,
    privileged,
    autoRemove,
    publishAll,
    actualEntrypoint,
    actualCommand,
  ] = inspectFields(
    docker,
    "container",
    containerId,
    [
      ".Id",
      ".Name",
      ".Image",
      ".State.Status",
      ".State.Running",
      ".Config.Labels",
      ".Mounts",
      ".HostConfig.PortBindings",
      ".HostConfig.NetworkMode",
      ".HostConfig.RestartPolicy.Name",
      ".HostConfig.Privileged",
      ".HostConfig.AutoRemove",
      ".HostConfig.PublishAllPorts",
      ".Config.Entrypoint",
      ".Config.Cmd",
    ],
    "核对第五座停止态容器",
  );
  requireMatch(
    id === containerId &&
      name === "/" + target.container &&
      image === target.image &&
      state === "created" &&
      running === false &&
      actualLabels?.["org.adui.scope"] === scope &&
      actualLabels?.["org.adui.attempt"] === attempt &&
      !actualLabels?.["com.docker.compose.project"] &&
      Array.isArray(mounts) &&
      mounts.length === 1 &&
      mounts[0]?.Type === "volume" &&
      mounts[0].Name === target.volume &&
      mounts[0].Destination === dataPath &&
      mounts[0].RW === true &&
      isDeepStrictEqual(ports, {
        "5432/tcp": [{ HostIp: target.host, HostPort: String(target.port) }],
      }) &&
      [networkId, target.network].includes(networkMode) &&
      restart === "no" &&
      privileged === false &&
      autoRemove === false &&
      publishAll === false &&
      isDeepStrictEqual(actualEntrypoint, entrypoint) &&
      isDeepStrictEqual(actualCommand, command),
    "第五座容器身份、挂载、端口或停止状态不符，保留现场",
  );
  requireVolume(docker, labels, containerId);
  requireNetwork(docker, networkId, labels, containerId);
  const result = {
    status: "NATIVE_CHECK_ROUNDTRIP_STOPPED_CREATION_REVIEW_REQUIRED",
    creationPlanFingerprint: plan.creationPlanFingerprint,
    target,
    creationRequestMatched: true,
    creationAttemptClaimed: true,
    stoppedContainerObserved: true,
    containerStarted: false,
    databaseInitialized: false,
    portReserved: false,
    resourceCreationAllowed: false,
    observationSourceAuthenticated: false,
    databaseExecutionAllowed: false,
    roundTripVerified: false,
    historicalAdoptionVerified: false,
    signingAllowed: false,
    deploymentAllowed: false,
    collationRuntimeIdentityVerified: false,
  };
  try {
    writeFileSync(
      join(directory, "result.json"),
      JSON.stringify({ ...result, attempt, containerId, networkId }) + "\n",
      { flag: "wx", flush: true },
    );
  } catch {
    throw new StoppedCreationError("第五座创建结果无法保留，禁止重试并保留现场");
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
    const result = createStoppedRoundTrip(
      process.platform,
      process.argv.slice(2),
      process.env,
      root,
    );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    console.error(
      error instanceof StoppedCreationError ||
        error instanceof HostPreflightError ||
        error instanceof RoundTripReferenceError ||
        error instanceof RoundTripCreationError
        ? error.message
        : "第五座创建失败，内部诊断已脱敏，保留现场",
    );
    process.exitCode = 1;
  }
}
