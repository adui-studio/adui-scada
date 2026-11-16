import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OLD_PROJECTS = Object.freeze([
  { name: "adui-scada-v01-demo", file: "deploy/docker/compose.demo.yaml", lab: false },
  { name: "adui-scada-postgres-dev", file: "deploy/docker/compose.postgres.dev.yaml", lab: false },
  { name: "adui-scada-oidc-lab", file: "deploy/docker/compose.oidc.lab.yaml", lab: true },
]);
const REQUIRED_VOLUMES = Object.freeze([
  "adui-scada-postgres-dev_scada-postgres-data",
  "adui-scada-oidc-lab_lab-postgres-data",
  "adui-scada-oidc-lab_lab-redis-data",
]);
const ALL_ARGS = Object.freeze([
  "compose", "-p", "adui-scada", "--env-file", ".env",
  "--env-file", ".local/oidc-lab/compose.env",
  "-f", "deploy/docker/compose.all.dev.yaml", "--profile", "legacy-db",
]);
const SAFE_MODES = new Set(["plan", "migrate", "up", "down", "ps", "logs"]);

function runDocker(args, showOutput = false) {
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

export function parseUnifiedEnv(content) {
  const entries = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const found = /^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/.exec(line.trim());
    if (!found || entries.has(found[1])) {
      throw new Error("统一 Docker 环境文件无效或包含重复变量");
    }
    entries.set(found[1], found[2]);
  }
  const expectedPorts = [
    "SCADA_REACT_PORT", "SCADA_VUE_PORT", "SCADA_LAB_POSTGRES_PORT",
    "SCADA_LAB_REDIS_PORT", "SCADA_LAB_KEYCLOAK_PORT", "SCADA_LEGACY_DB_PORT",
  ];
  const defaults = ["18080", "18081", "15433", "16379", "18443", "15432"];
  const seen = new Set();
  for (let i = 0; i < expectedPorts.length; i += 1) {
    const raw = entries.get(expectedPorts[i]) ?? defaults[i];
    if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535 || seen.has(Number(raw))) {
      throw new Error("统一 Docker 端口无效或存在冲突，拒绝启动");
    }
    seen.add(Number(raw));
  }
  if (
    entries.get("SCADA_WEB_HOST") !== "127.0.0.1" ||
    entries.get("SCADA_SERVER_HOST") !== "127.0.0.1" ||
    entries.get("SCADA_OIDC_ALLOW_INSECURE_LOOPBACK") === "true"
  ) {
    throw new Error("统一 Docker 仅允许本机回环开发环境");
  }
}

function invoke(run, args, showOutput = false) {
  const result = run(args, showOutput);
  if (result.status !== 0) {
    throw new Error("Docker 操作失败：请检查 Docker Desktop 和本机端口，不会删除现有数据卷");
  }
  return result.stdout;
}

function oldContainers(run) {
  return OLD_PROJECTS.filter((project) =>
    invoke(run, ["ps", "-a", "--filter", `label=com.docker.compose.project=${project.name}`, "--format", "{{.ID}}"])
      .trim().length > 0,
  );
}

/** 切换前核验三份持久化卷都存在，否则拒绝创建空白身份数据库。 */
function inspectVolumes(run) {
  for (const volume of REQUIRED_VOLUMES) {
    try {
      invoke(run, ["volume", "inspect", volume]);
    } catch {
      throw new Error("原 Docker 数据卷不存在，拒绝初始化空白数据库；请先核对备份与旧项目");
    }
  }
}

/** 不通过 shell 执行 Docker，也不使用 down -v / volume rm 等破坏性命令。 */
export function manageUnifiedDocker(mode, envContent, run = runDocker) {
  if (!SAFE_MODES.has(mode)) {
    throw new Error("不支持的统一 Docker 操作");
  }
  if (["plan", "migrate", "up"].includes(mode)) {
    parseUnifiedEnv(envContent);
    inspectVolumes(run);
    invoke(run, [...ALL_ARGS, "config", "--quiet"]);
    const legacy = oldContainers(run);
    if (mode === "plan") {
      return legacy.length > 0
        ? "迁移预检通过：已发现旧 Compose 项目，可显式执行 docker:all:migrate（不会删除数据卷）"
        : "统一开发栈预检通过，可执行 docker:all:up";
    }
    if (mode === "up" && legacy.length > 0) {
      throw new Error("仍存在旧 Docker 项目，请先执行 docker:all:migrate，避免端口冲突");
    }
    if (mode === "migrate") {
      for (const project of OLD_PROJECTS) {
        const prefix = ["compose", "-p", project.name, "--env-file", ".env"];
        if (project.lab) {
          prefix.push("--env-file", ".local/oidc-lab/compose.env");
        }
        invoke(run, [...prefix, "-f", project.file, "down"], true);
      }
    }
    invoke(run, [...ALL_ARGS, "up", "--build", "-d"], true);
    return mode === "migrate"
      ? "统一 Docker 项目已启动，原数据卷继续复用；请验收 Keycloak 身份、数据库与两个 Web"
      : "统一 Docker 项目已启动";
  }
  const actions = {
    down: ["down"],
    ps: ["ps"],
    logs: ["logs", "-f"],
  };
  invoke(run, [...ALL_ARGS, ...actions[mode]], true);
  return "统一 Docker 命令已执行";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const raw = readFileSync(resolve(ROOT, ".env"), "utf8");
    console.log(manageUnifiedDocker(process.argv[2], raw));
  } catch (error) {
    const known = new Set([
      "统一 Docker 环境文件无效或包含重复变量",
      "统一 Docker 端口无效或存在冲突，拒绝启动",
      "统一 Docker 仅允许本机回环开发环境",
      "原 Docker 数据卷不存在，拒绝初始化空白数据库；请先核对备份与旧项目",
      "Docker 操作失败：请检查 Docker Desktop 和本机端口，不会删除现有数据卷",
      "仍存在旧 Docker 项目，请先执行 docker:all:migrate，避免端口冲突",
      "不支持的统一 Docker 操作",
    ]);
    console.error(error instanceof Error && known.has(error.message) ? error.message : "统一 Docker 执行失败，未输出内部环境信息");
    process.exitCode = 1;
  }
}
