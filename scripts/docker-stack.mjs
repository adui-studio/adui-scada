import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const COMPOSE_ARGS = Object.freeze([
  "compose", "-p", "adui-scada",
  "--env-file", ".env", "--env-file", ".local/oidc-lab/compose.env",
  "-f", "deploy/docker/compose.yaml",
]);
const OLD_PROJECTS = Object.freeze([
  { name: "adui-scada-v01-demo", services: ["web-react", "web-vue", "server", "demo"] },
  { name: "adui-scada-postgres-dev", services: ["postgres"] },
  { name: "adui-scada-oidc-lab", services: ["postgres", "redis", "keycloak"] },
]);
const DATA_VOLUMES = Object.freeze([
  "adui-scada-oidc-lab_lab-postgres-data",
  "adui-scada-oidc-lab_lab-redis-data",
]);
const MODES = new Set(["plan", "migrate", "up", "down", "ps", "logs"]);

function docker(args, showOutput = false) {
  const result = spawnSync("docker", args, {
    cwd: ROOT,
    shell: false,
    encoding: "utf8",
    windowsHide: true,
    stdio: showOutput ? "inherit" : "pipe",
    maxBuffer: 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

function checked(run, args, showOutput = false) {
  const result = run(args, showOutput);
  if (result.status !== 0) {
    throw new Error("Docker 命令执行失败，未删除任何持久化卷");
  }
  return result.stdout.trim();
}

/** 确认仍指向唯一的回环 PostgreSQL 实例，不接受旧 15432 开发库。 */
export function validateDockerEnv(text) {
  const env = new Map();
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const found = /^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/.exec(raw);
    if (!found || env.has(found[1])) throw new Error("Docker 环境变量格式无效或重复");
    env.set(found[1], found[2]);
  }
  if (
    env.get("SCADA_WEB_HOST") !== "127.0.0.1" ||
    env.get("SCADA_SERVER_HOST") !== "127.0.0.1" ||
    env.get("SCADA_OIDC_ALLOW_INSECURE_LOOPBACK") === "true" ||
    env.get("NODE_ENV") === "production" ||
    process.env.NODE_ENV === "production" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  ) {
    throw new Error("统一 Docker 仅允许可信本机开发环境");
  }
  const keys = [
    ["SCADA_REACT_PORT", "18080"],
    ["SCADA_VUE_PORT", "18081"],
    ["SCADA_LAB_POSTGRES_PORT", "15433"],
    ["SCADA_LAB_REDIS_PORT", "16379"],
    ["SCADA_LAB_KEYCLOAK_PORT", "18443"],
  ];
  const ports = new Set();
  for (const [key, fallback] of keys) {
    const raw = env.get(key) ?? fallback;
    if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535 || ports.has(Number(raw))) {
      throw new Error("统一 Docker 端口无效或冲突");
    }
    ports.add(Number(raw));
  }
  const dbPort = env.get("SCADA_LAB_POSTGRES_PORT") ?? "15433";
  if (
    env.has("SCADA_DB_PORT") && env.get("SCADA_DB_PORT") !== dbPort ||
    env.has("SCADA_DB_HOST") && env.get("SCADA_DB_HOST") !== "127.0.0.1" ||
    env.has("SCADA_DB_NAME") && env.get("SCADA_DB_NAME") !== "adui_scada_oidc_lab" ||
    env.has("SCADA_DB_USER") && env.get("SCADA_DB_USER") !== "adui_scada_oidc_lab"
  ) {
    throw new Error("SCADA 数据库配置必须指向唯一的本机 PostgreSQL 实例");
  }
  const configuredUrl = env.get("SCADA_DATABASE_URL");
  if (configuredUrl) {
    let url;
    try {
      url = new URL(configuredUrl);
    } catch {
      throw new Error("SCADA 数据库连接目标无效");
    }
    if (
      url.protocol !== "postgresql:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== dbPort ||
      url.pathname !== "/adui_scada_oidc_lab" ||
      url.username !== "adui_scada_oidc_lab" ||
      !url.password ||
      url.hash ||
      [...url.searchParams].length !== 1 ||
      url.searchParams.get("schema") !== "public"
    ) {
      throw new Error("SCADA 数据库连接目标无效");
    }
  }
  return true;
}

function verifiedContainers(run, project) {
  const ids = checked(run, [
    "ps", "-a", "--filter", `label=com.docker.compose.project=${project.name}`,
    "--format", "{{.ID}}",
  ]).split(/\r?\n/).filter(Boolean);
  for (const id of ids) {
    const output = checked(run, ["inspect", "--format", "{{json .Config.Labels}}", id]);
    let labels;
    try {
      labels = JSON.parse(output);
    } catch {
      throw new Error("旧 Docker 项目容器标签无法验证，已停止迁移");
    }
    if (
      labels["com.docker.compose.project"] !== project.name ||
      !project.services.includes(labels["com.docker.compose.service"])
    ) {
      throw new Error("旧 Docker 项目包含未知容器，已停止迁移");
    }
  }
  return ids;
}

function inspectOldVolumes(run) {
  for (const name of DATA_VOLUMES) {
    if (run(["volume", "inspect", name]).status !== 0) {
      throw new Error("已有 Keycloak/SCADA 数据卷缺失，拒绝创建空白数据库");
    }
  }
}

function plan(run, envText) {
  validateDockerEnv(envText);
  inspectOldVolumes(run);
  checked(run, [...COMPOSE_ARGS, "config", "--quiet"]);
  const old = OLD_PROJECTS.map((project) => ({
    name: project.name,
    ids: verifiedContainers(run, project),
  }));
  return old;
}

/**
 * 仅停止并移除三个历史 Compose 项目的已核验容器；没有 volume rm/down -v。
 * 此为明确的单次迁移动作，不在普通 docker:up 中自动执行。
 */
export function manageDockerStack(mode, envText, run = docker) {
  if (!MODES.has(mode)) throw new Error("不支持的 Docker 操作");
  if (mode === "plan" || mode === "migrate" || mode === "up") {
    const old = plan(run, envText);
    const legacy = old.filter((project) => project.ids.length > 0);
    if (mode === "plan") {
      return legacy.length > 0
        ? "统一项目预检通过；仍有历史容器，请备份数据库后执行 docker:migrate"
        : "统一项目预检通过；可以执行 docker:up";
    }
    if (mode === "up" && legacy.length > 0) {
      throw new Error("检测到历史 Docker 容器，请先执行一次 docker:migrate");
    }
    if (mode === "migrate") {
      for (const project of legacy) {
        for (const id of project.ids) {
          const running = checked(run, ["inspect", "--format", "{{.State.Running}}", id]);
          if (running === "true") {
            checked(run, ["stop", "--time", "20", id], true);
          } else if (running !== "false") {
            throw new Error("旧 Docker 容器运行状态无法验证，已停止迁移");
          }
          checked(run, ["rm", id], true);
        }
      }
    }
    checked(run, [...COMPOSE_ARGS, "up", "--build", "--remove-orphans", "-d"], true);
    return "ADui SCADA 单 Compose 项目已启动，原有数据库及 Redis 数据卷保留";
  }
  const action = {
    down: ["down"],
    ps: ["ps"],
    logs: ["logs", "-f"],
  }[mode];
  checked(run, [...COMPOSE_ARGS, ...action], true);
  return "ADui SCADA Docker 命令已执行";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const envText = readFileSync(resolve(ROOT, ".env"), "utf8");
    console.log(manageDockerStack(process.argv[2], envText));
  } catch (error) {
    const messages = new Set([
      "Docker 命令执行失败，未删除任何持久化卷",
      "Docker 环境变量格式无效或重复",
      "统一 Docker 仅允许可信本机开发环境",
      "统一 Docker 端口无效或冲突",
      "SCADA 数据库配置必须指向唯一的本机 PostgreSQL 实例",
      "SCADA 数据库连接目标无效",
      "旧 Docker 项目容器标签无法验证，已停止迁移",
      "旧 Docker 项目包含未知容器，已停止迁移",
      "已有 Keycloak/SCADA 数据卷缺失，拒绝创建空白数据库",
      "不支持的 Docker 操作",
      "检测到历史 Docker 容器，请先执行一次 docker:migrate",
    ]);
    console.error(error instanceof Error && messages.has(error.message)
      ? error.message
      : "统一 Docker 操作失败，已隐藏内部异常");
    process.exitCode = 1;
  }
}
