import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLabSecrets } from "./prepare-oidc-lab.mjs";
import { freshStorageHash } from "./prisma8-fresh-install.mjs";
import { DockerOidcProbeError, verifyDockerOidc } from "./docker-oidc-probe.mjs";
import { ensureDockerDatabaseBinding } from "./docker-runtime-binding.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const COMPOSE_ARGS = Object.freeze([
  "compose",
  "-p",
  "adui-scada",
  "--env-file",
  ".env",
  "--env-file",
  ".local/docker/compose.env",
  "-f",
  "deploy/docker/compose.yaml",
]);
const OLD_PROJECTS = Object.freeze([
  "adui-scada-v01-demo",
  "adui-scada-postgres-dev",
  "adui-scada-oidc-lab",
]);
const MODES = new Set(["plan", "infra", "up", "down", "ps", "logs", "oidc"]);

function docker(args, showOutput = false, input, timeout) {
  const result = spawnSync("docker", args, {
    cwd: ROOT,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout,
    // Compose 只使用已验证的两个环境文件，终端残留同名变量不得覆盖端口和凭据。
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(SCADA_|COMPOSE_)/iu.test(key)),
    ),
    input,
    stdio: [
      input === undefined ? "ignore" : "pipe",
      showOutput ? "inherit" : "pipe",
      showOutput ? "inherit" : "pipe",
    ],
    maxBuffer: 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

function checked(run, args, showOutput = false, input) {
  const result = run(args, showOutput, input);
  if (result.status !== 0) throw new Error("Docker 执行失败，请检查配置与 Docker Desktop");
  return result.stdout.trim();
}

/** 与原生安装入口一致，只操作 Windows 本机 Linux Docker 引擎。 */
function localDocker() {
  if (
    process.platform !== "win32" ||
    Object.entries(process.env).some(
      ([key, value]) =>
        /^(DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_TLS|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH)$/iu.test(
          key,
        ) && value,
    )
  ) {
    throw new Error("仅允许 Windows 本机 Docker Desktop，禁止连接环境覆盖");
  }
  const context = checked(docker, ["context", "show"]);
  if (!/^[a-zA-Z0-9_.-]+$/u.test(context)) throw new Error("Docker 上下文名称无效");
  const endpoint = checked(docker, [
    "context",
    "inspect",
    context,
    "--format",
    "{{.Endpoints.docker.Host}}",
  ]);
  if (
    !["npipe:////./pipe/dockerDesktopLinuxEngine", "npipe:////./pipe/docker_engine"].includes(
      endpoint,
    )
  ) {
    throw new Error("仅允许 Windows 本机 Docker Desktop，禁止连接环境覆盖");
  }
  const run = (args, showOutput, input, timeout) =>
    docker(["--host", endpoint, ...args], showOutput, input, timeout);
  if (checked(run, ["info", "--format", "{{.OSType}}"]) !== "linux") {
    throw new Error("Docker 必须使用 Linux 容器引擎");
  }
  return run;
}

/** 严格复核既有数据库，不执行初始化、迁移或其他数据库写入。 */
function verifyDockerDatabase() {
  const result = spawnSync(
    process.execPath,
    ["apps/server/prisma8-fresh-install.mjs", "--status"],
    {
      cwd: ROOT,
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    },
  );
  try {
    if (result.status !== 0) throw new Error("原生数据库严格验证失败");
    const report = JSON.parse(result.stdout);
    const secrets = validateLabSecrets(
      readFileSync(resolve(ROOT, ".local/docker/secrets.env"), "utf8"),
    );
    if (
      report.status !== "FRESH_DATABASE_VERIFIED" ||
      report.databaseInitialized !== true ||
      report.storageHash !== freshStorageHash ||
      typeof report.systemIdentifier !== "string" ||
      !/^[1-9][0-9]{0,19}$/u.test(report.systemIdentifier) ||
      !/^19[0-9]{4}$/u.test(report.serverVersion) ||
      report.tables !== 12 ||
      report.columns !== 85 ||
      report.checks !== 36 ||
      report.indexes !== 20 ||
      report.foreignKeys !== 13 ||
      report.comments !== 119
    )
      throw new Error("原生数据库严格验证失败");
    return {
      password: secrets.SCADA_LAB_DB_PASSWORD,
      systemIdentifier: report.systemIdentifier,
      storageHash: report.storageHash,
    };
  } catch {
    throw new Error("原生数据库严格验证失败，未执行本次应用启动；请单独核对数据库状态");
  }
}

/** 解析唯一根环境文件，不读取终端覆盖变量。 */
function parseDockerEnv(text) {
  const env = new Map();
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const parsed = /^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/.exec(raw);
    if (!parsed || env.has(parsed[1])) throw new Error("本机 Docker 环境变量格式无效或重复");
    env.set(parsed[1], parsed[2]);
  }
  return env;
}

/** 全新栈只允许固定回环数据库，拒绝已废弃的旧项目和远程库。 */
export function validateDockerEnv(text) {
  const env = parseDockerEnv(text);
  if (
    env.get("SCADA_WEB_HOST") !== "127.0.0.1" ||
    env.get("SCADA_SERVER_HOST") !== "127.0.0.1" ||
    env.get("SCADA_OIDC_ALLOW_INSECURE_LOOPBACK") !== "false" ||
    env.get("NODE_ENV") === "production" ||
    process.env.NODE_ENV === "production" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  ) {
    throw new Error("Docker 仅允许安全的本机回环开发配置");
  }
  const ports = new Set();
  for (const [key, fallback] of [
    ["SCADA_REACT_PORT", "18080"],
    ["SCADA_VUE_PORT", "18081"],
    ["SCADA_REACT_HTTPS_PORT", "18480"],
    ["SCADA_VUE_HTTPS_PORT", "18481"],
    ["SCADA_LAB_POSTGRES_PORT", "15432"],
    ["SCADA_LAB_REDIS_PORT", "16379"],
    ["SCADA_LAB_KEYCLOAK_PORT", "18443"],
  ]) {
    const raw = env.get(key) ?? fallback;
    if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535 || ports.has(Number(raw))) {
      throw new Error("本机 Docker 端口无效或冲突");
    }
    ports.add(Number(raw));
  }
  const dbPort = env.get("SCADA_LAB_POSTGRES_PORT") ?? "15432";
  for (const [key, expected] of [
    ["SCADA_DB_HOST", "127.0.0.1"],
    ["SCADA_DB_PORT", dbPort],
    ["SCADA_DB_NAME", "adui_scada"],
    ["SCADA_DB_USER", "adui_scada"],
  ]) {
    if (env.has(key) && env.get(key) !== expected) {
      throw new Error("请先备份旧 .env 并复制最新 .env.example，禁止连接历史数据库");
    }
  }
  const configuredUrl = env.get("SCADA_DATABASE_URL");
  if (configuredUrl) {
    let url;
    try {
      url = new URL(configuredUrl);
    } catch {
      throw new Error("数据库连接字符串无效");
    }
    if (
      url.protocol !== "postgresql:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== dbPort ||
      url.pathname !== "/adui_scada" ||
      url.username !== "adui_scada" ||
      !url.password ||
      url.hash ||
      [...url.searchParams].length !== 1 ||
      url.searchParams.get("schema") !== "public"
    ) {
      throw new Error("数据库连接字符串必须指向全新的本机 adui_scada");
    }
  }
  return true;
}

/** 通过独立宿主进程校验真实发布端口和本机可信根证书。 */
function verifyDockerHttps(ports) {
  const result = spawnSync(process.execPath, ["scripts/docker-web-https-smoke.mjs", ...ports], {
    cwd: ROOT,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: 80_000,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.stdout.trim() !== "DOCKER_WEB_HTTPS_READY") {
    throw new Error("双端 Docker HTTPS 验证失败，请检查本机端口和 mkcert 可信证书，保留现场");
  }
}

/** 已删除旧 Compose 项目并不代表旧卷消失；脚本绝不触碰旧容器和卷。 */
export function manageDockerStack(
  mode,
  envText,
  run = docker,
  verifyDatabase = verifyDockerDatabase,
  verifyHttps = verifyDockerHttps,
  verifyOidc = verifyDockerOidc,
  prepareBinding = (input) => ensureDockerDatabaseBinding(ROOT, input, freshStorageHash),
) {
  if (!MODES.has(mode)) throw new Error("不支持的 Docker 操作");
  if (mode === "plan" || mode === "up" || mode === "infra" || mode === "oidc") {
    validateDockerEnv(envText);
    checked(run, [...COMPOSE_ARGS, "config", "--quiet"]);
    for (const name of OLD_PROJECTS) {
      const ids = checked(run, [
        "ps",
        "-a",
        "--filter",
        `label=com.docker.compose.project=${name}`,
        "--format",
        "{{.ID}}",
      ]);
      if (ids) throw new Error("仍检测到旧项目容器；请人工确认后处理，禁止自动清理");
    }
    if (mode === "plan") {
      return "全新安装预检通过：旧持久化卷不参与挂载，新的 adui-scada 卷将由 Docker 创建";
    }
    if (mode === "oidc") {
      const port = parseDockerEnv(envText).get("SCADA_LAB_KEYCLOAK_PORT") ?? "18443";
      return verifyOidc(port, run, COMPOSE_ARGS);
    }
    if (mode === "infra" || mode === "up") {
      checked(
        run,
        [
          ...COMPOSE_ARGS,
          "up",
          "-d",
          "--pull",
          "never",
          "--wait",
          "--wait-timeout",
          "180",
          "postgres",
          "redis",
          "keycloak",
        ],
        true,
      );
      if (mode === "infra") {
        return "ADui SCADA 基础设施已启动，原生数据库初始化需显式确认";
      }
    }
    const probeInput = verifyDatabase();
    prepareBinding(probeInput);
    checked(
      run,
      [
        ...COMPOSE_ARGS,
        "up",
        "--build",
        "--pull",
        "never",
        "-d",
        "--no-deps",
        "--wait",
        "--wait-timeout",
        "180",
        "server",
        "demo",
        "web-react",
        "web-vue",
      ],
      true,
    );
    // 独立烟测仍只经标准输入接收凭据；常驻服务只读取独立只读文件挂载。
    const output = checked(
      run,
      [...COMPOSE_ARGS, "exec", "-T", "server", "node", "apps/server/container-prisma8-smoke.mjs"],
      false,
      JSON.stringify(probeInput),
    );
    try {
      const result = JSON.parse(output);
      if (
        result.status !== "DOCKER_NATIVE_PROVIDER_READY" ||
        result.providerReady !== true ||
        result.providerClosed !== true ||
        result.readOnlyBoundaryVerified !== true ||
        result.authorizationReadVerified !== true ||
        result.sessionReadVerified !== true ||
        result.identityWriteDenied !== true ||
        result.oidcDiscoverySkipped !== true ||
        result.projectListReadVerified !== true ||
        result.projectLockedReadDenied !== true ||
        result.projectWriteDenied !== true ||
        result.releaseLockedReadDenied !== true ||
        result.releaseWriteDenied !== true ||
        result.rollbackWriteDenied !== true ||
        result.missingProjectDenied !== true ||
        result.nativeRootAssemblyVerified !== true ||
        result.singleNativeProviderVerified !== true ||
        result.legacyProviderAbsent !== true ||
        result.providerSwitched !== true ||
        result.runningDatabaseReadOnlyVerified !== true ||
        result.reactHttpVerified !== true ||
        result.vueHttpVerified !== true
      )
        throw new Error("容器验证结果不完整");
    } catch {
      throw new Error("容器原生数据库或双端 HTTP 验证失败，保留现场");
    }
    const env = parseDockerEnv(envText);
    verifyHttps([
      env.get("SCADA_REACT_HTTPS_PORT") ?? "18480",
      env.get("SCADA_VUE_HTTPS_PORT") ?? "18481",
    ]);
    return "ADui SCADA 七服务启动完成：一个 PostgreSQL，容器原生只读及双端 HTTP 验证通过，常驻服务原生只读连接验证通过，宿主 HTTPS 验证通过；OIDC 登录尚未启用";
  }
  const action = { down: ["down"], ps: ["ps"], logs: ["logs", "-f"] }[mode];
  checked(run, [...COMPOSE_ARGS, ...action], true);
  return "ADui SCADA Docker 命令执行完成";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const text = readFileSync(resolve(ROOT, ".env"), "utf8");
    if (!MODES.has(process.argv[2])) throw new Error("不支持的 Docker 操作");
    console.log(manageDockerStack(process.argv[2], text, localDocker()));
  } catch (error) {
    const known = new Set([
      "Docker 执行失败，请检查配置与 Docker Desktop",
      "本机 Docker 环境变量格式无效或重复",
      "Docker 仅允许安全的本机回环开发配置",
      "本机 Docker 端口无效或冲突",
      "请先备份旧 .env 并复制最新 .env.example，禁止连接历史数据库",
      "数据库连接字符串无效",
      "数据库连接字符串必须指向全新的本机 adui_scada",
      "仍检测到旧项目容器；请人工确认后处理，禁止自动清理",
      "不支持的 Docker 操作",
      "仅允许 Windows 本机 Docker Desktop，禁止连接环境覆盖",
      "Docker 上下文名称无效",
      "Docker 必须使用 Linux 容器引擎",
      "原生数据库严格验证失败，未执行本次应用启动；请单独核对数据库状态",
      "容器原生数据库或双端 HTTP 验证失败，保留现场",
      "Docker 正式只读数据库绑定无效",
      "Docker 正式只读数据库绑定文件不一致或无法读取，保留现场",
      "双端 Docker HTTPS 验证失败，请检查本机端口和 mkcert 可信证书，保留现场",
    ]);
    console.error(
      error instanceof DockerOidcProbeError || (error instanceof Error && known.has(error.message))
        ? error.message
        : "Docker 操作失败，已隐藏内部错误及敏感配置",
    );
    process.exitCode = 1;
  }
}
