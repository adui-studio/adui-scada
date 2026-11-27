import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const MODES = new Set(["plan", "infra", "up", "down", "ps", "logs"]);

function docker(args, showOutput = false) {
  const result = spawnSync("docker", args, {
    cwd: ROOT,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    stdio: showOutput ? "inherit" : "pipe",
    maxBuffer: 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

function checked(run, args, showOutput = false) {
  const result = run(args, showOutput);
  if (result.status !== 0) throw new Error("Docker 执行失败，请检查配置与 Docker Desktop");
  return result.stdout.trim();
}

/** 全新栈只允许固定回环数据库，拒绝已废弃的旧项目和远程库。 */
export function validateDockerEnv(text) {
  const env = new Map();
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const parsed = /^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/.exec(raw);
    if (!parsed || env.has(parsed[1])) throw new Error("本机 Docker 环境变量格式无效或重复");
    env.set(parsed[1], parsed[2]);
  }
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

/** 已删除旧 Compose 项目并不代表旧卷消失；脚本绝不触碰旧容器和卷。 */
export function manageDockerStack(mode, envText, run = docker) {
  if (!MODES.has(mode)) throw new Error("不支持的 Docker 操作");
  if (mode === "plan" || mode === "up" || mode === "infra") {
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
    if (mode === "infra") {
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
      return "ADui SCADA 基础设施已启动，原生数据库初始化需显式确认";
    }
    checked(run, [...COMPOSE_ARGS, "up", "--build", "-d"], true);
    return "ADui SCADA 已启动：一个项目、一个 PostgreSQL，已有历史数据卷未被修改";
  }
  const action = { down: ["down"], ps: ["ps"], logs: ["logs", "-f"] }[mode];
  checked(run, [...COMPOSE_ARGS, ...action], true);
  return "ADui SCADA Docker 命令执行完成";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const text = readFileSync(resolve(ROOT, ".env"), "utf8");
    console.log(manageDockerStack(process.argv[2], text));
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
    ]);
    console.error(
      error instanceof Error && known.has(error.message)
        ? error.message
        : "Docker 操作失败，已隐藏内部错误及敏感配置",
    );
    process.exitCode = 1;
  }
}
