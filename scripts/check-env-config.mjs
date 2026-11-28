import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

function parseEnv(path) {
  const values = Object.create(null);
  for (const line of read(path).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    assert.ok(match, `${path} 中存在无效的环境变量配置行`);
    const [, key, value] = match;
    assert.ok(!(key in values), `${path} 中环境变量键名重复：${key}`);
    values[key] = value;
  }
  return values;
}

const defaults = {
  SCADA_WEB_HOST: "127.0.0.1",
  SCADA_REACT_DEV_PORT: "15173",
  SCADA_VUE_DEV_PORT: "15174",
  SCADA_SERVER_HOST: "127.0.0.1",
  SCADA_SERVER_PORT: "13001",
  SCADA_LOG_LEVEL: "info",
  SCADA_API_DOCS_ENABLED: "false",
  SCADA_LOCAL_DEMO_API_ENABLED: "false",
  SCADA_DEMO_HOST: "127.0.0.1",
  SCADA_DEMO_PORT: "14178",
  SCADA_REACT_PORT: "18080",
  SCADA_VUE_PORT: "18081",
  SCADA_REACT_HTTPS_PORT: "18480",
  SCADA_VUE_HTTPS_PORT: "18481",
  SCADA_DB_HOST: "127.0.0.1",
  SCADA_DB_PORT: "15432",
  SCADA_DB_NAME: "adui_scada",
  SCADA_DB_USER: "adui_scada",
  SCADA_DB_PASSWORD: "",
  SCADA_DATABASE_URL: "",
  SCADA_OIDC_ENABLED: "false",
  SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "false",
  SCADA_OIDC_ISSUER: "",
  SCADA_OIDC_CLIENT_ID: "",
  SCADA_OIDC_CLIENT_SECRET: "",
  SCADA_OIDC_REDIRECT_URI: "",
  SCADA_OIDC_WEB_ORIGINS: "",
  SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: "",
  SCADA_OIDC_DEV_HTTPS_ENABLED: "false",
  SCADA_OIDC_DEV_HTTPS_CERT_FILE: "",
  SCADA_OIDC_DEV_HTTPS_KEY_FILE: "",
  SCADA_LAB_KEYCLOAK_PORT: "18443",
  SCADA_LAB_POSTGRES_PORT: "15432",
  SCADA_LAB_REDIS_PORT: "16379",
};
const template = parseEnv(".env.example");
assert.deepEqual({ ...template }, defaults, "根目录 .env.example 的默认值必须与配置契约一致");

/** 校验本机开发数据库变量与 Prisma 连接字符串的目标一致，不回显账号密码。 */
function checkDatabaseConnection(values, location) {
  if (!values.SCADA_DATABASE_URL) return;
  let connection;
  try {
    connection = new URL(values.SCADA_DATABASE_URL);
  } catch {
    assert.fail(`${location}：PostgreSQL 连接字符串格式无效`);
  }
  assert.ok(
    ["postgresql:", "postgres:"].includes(connection.protocol),
    `${location}：数据库连接字符串必须使用 PostgreSQL 协议`,
  );
  const expected = [
    ["SCADA_DB_HOST", connection.hostname],
    ["SCADA_DB_PORT", connection.port || "5432"],
    ["SCADA_DB_NAME", decodeURIComponent(connection.pathname.slice(1))],
    ["SCADA_DB_USER", decodeURIComponent(connection.username)],
    ["SCADA_DB_PASSWORD", decodeURIComponent(connection.password)],
  ];
  for (const [key, actual] of expected) {
    if (!(key in values)) continue;
    assert.ok(
      key === "SCADA_DB_PORT" ? Number(values[key]) === Number(actual) : values[key] === actual,
      `${location}：${key} 与 SCADA_DATABASE_URL 不一致`,
    );
  }
}
checkDatabaseConnection(template, ".env.example");

for (const legacy of [
  "apps/web-react/.env.example",
  "apps/web-vue/.env.example",
  "apps/server/.env.example",
  "examples/water-treatment/.env.example",
]) {
  assert.ok(!existsSync(resolve(root, legacy)), `请删除旧版子目录环境变量模板：${legacy}`);
}

if (existsSync(resolve(root, ".env"))) {
  const configured = parseEnv(".env");
  for (const key of Object.keys(defaults)) {
    if (!(key in configured)) continue;
    const value = configured[key];
    if (key.endsWith("_PORT")) {
      const port = Number(value);
      assert.ok(
        Number.isInteger(port) && port >= 1 && port <= 65535,
        `${key}：端口必须是 1～65535 之间的整数`,
      );
    } else if (key === "SCADA_WEB_HOST" || key === "SCADA_DB_HOST") {
      assert.ok(["127.0.0.1", "localhost"].includes(value), `${key}：必须使用本机回环地址`);
    } else if (key === "SCADA_DB_NAME" || key === "SCADA_DB_USER") {
      assert.match(value, /^[A-Za-z][A-Za-z0-9_]{0,62}$/, `${key}：必须是有效的开发数据库标识符`);
    } else if (key === "SCADA_LOG_LEVEL") {
      assert.ok(
        ["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(value),
        "SCADA_LOG_LEVEL：必须是已支持的日志级别",
      );
    } else if (
      key === "SCADA_API_DOCS_ENABLED" ||
      key === "SCADA_LOCAL_DEMO_API_ENABLED" ||
      key === "SCADA_OIDC_ENABLED" ||
      key === "SCADA_OIDC_ALLOW_INSECURE_LOOPBACK" ||
      key === "SCADA_OIDC_DEV_HTTPS_ENABLED"
    ) {
      assert.ok(["true", "false"].includes(value), `${key}：必须是 true 或 false`);
    } else if (key.startsWith("SCADA_OIDC_")) {
      // OIDC 地址和凭据仅在显式启用时由 NestJS Zod 启动配置严格校验；
      // 不能在本机环境检查中输出任何敏感值。
    } else if (key === "SCADA_DB_PASSWORD" || key === "SCADA_DATABASE_URL") {
      // 数据库密码和 URL 由后续配套检查比较，不在报错时泄漏原值。
    } else {
      assert.ok(["127.0.0.1", "0.0.0.0"].includes(value), `${key}：监听地址无效`);
    }
  }
  checkDatabaseConnection(configured, ".env");
}

for (const [framework, key] of [
  ["react", "SCADA_REACT_DEV_PORT"],
  ["vue", "SCADA_VUE_DEV_PORT"],
]) {
  const config = read(`apps/web-${framework}/vite.config.ts`);
  assert.ok(
    config.includes('new URL("../../", import.meta.url)'),
    "Vite 的 envDir 必须指向仓库根目录",
  );
  assert.ok(config.includes('loadEnv(mode, envDir, "SCADA_")'));
  assert.match(config, /import\s*\{[^}]*\bloadEnv\b[^}]*\}\s*from\s*"vite-plus"/);
  assert.ok(config.includes(key));
  assert.ok(config.includes("SCADA_DEMO_PORT"));
  assert.ok(config.includes("resolveLoopbackOidcHttpsProxy"), "双框架必须复用 HTTPS 本机代理策略");
  assert.ok(config.includes("envDir,"));
  assert.ok(!config.includes("SCADA_DEMO_PROXY_TARGET"));
}

const nest = read("apps/server/src/main.ts");
const serverConfig = read("apps/server/src/config/server-startup.config.ts");
const localDemoPolicy = read("apps/server/src/demo/local-demo-access.ts");
const demo = read("examples/water-treatment/server.mjs");
assert.ok(nest.includes('new URL("../../../.env", import.meta.url)'));
assert.ok(demo.includes('new URL("../../.env", import.meta.url)'));
assert.ok(
  nest.includes('await import("./app.module.js")'),
  "NestJS 必须在加载根目录 .env 后动态导入 AppModule",
);
assert.ok(nest.includes("loadEnvFile(envPath)"), "NestJS 必须加载根目录 .env");
assert.ok(
  nest.includes("allowLocalDemoTelemetry") &&
    localDemoPolicy.includes('nodeEnv !== "production"') &&
    localDemoPolicy.includes('host === "127.0.0.1"'),
  "NestJS 本机模拟接口必须使用非生产与回环监听约束",
);
assert.ok(
  nest.includes("SCADA_LOCAL_DEMO_API_ENABLED") && nest.includes("LocalDemoAppModule"),
  "本机模拟接口必须由启动入口显式启用",
);
assert.ok(
  nest.indexOf("loadEnvFile(envPath)") < nest.indexOf('await import("./app.module.js")'),
  "NestJS 环境变量加载必须发生在 AppModule 初始化之前",
);
assert.doesNotMatch(nest, /import\s+\{\s*AppModule\s*\}\s+from/, "禁止提前静态导入 AppModule");
for (const [source, key] of [
  [serverConfig, "SCADA_SERVER_HOST"],
  [serverConfig, "SCADA_SERVER_PORT"],
  [serverConfig, "SCADA_API_DOCS_ENABLED"],
  [demo, "SCADA_DEMO_HOST"],
  [demo, "SCADA_DEMO_PORT"],
])
  assert.ok(source.includes(key), `运行时配置缺少变量：${key}`);

const packageScripts = JSON.parse(read("package.json")).scripts;
const compose = read("deploy/docker/compose.yaml");
assert.ok(compose.includes("name: adui-scada\n"), "唯一 Docker Compose 项目名称必须为 adui-scada");
for (const [key, fallback] of [
  ["SCADA_REACT_PORT", defaults.SCADA_REACT_PORT],
  ["SCADA_VUE_PORT", defaults.SCADA_VUE_PORT],
  ["SCADA_REACT_HTTPS_PORT", defaults.SCADA_REACT_HTTPS_PORT],
  ["SCADA_VUE_HTTPS_PORT", defaults.SCADA_VUE_HTTPS_PORT],
  ["SCADA_SERVER_PORT", defaults.SCADA_SERVER_PORT],
  ["SCADA_DEMO_PORT", defaults.SCADA_DEMO_PORT],
  ["SCADA_LAB_POSTGRES_PORT", defaults.SCADA_LAB_POSTGRES_PORT],
  ["SCADA_LAB_KEYCLOAK_PORT", defaults.SCADA_LAB_KEYCLOAK_PORT],
  ["SCADA_LAB_REDIS_PORT", defaults.SCADA_LAB_REDIS_PORT],
]) {
  assert.ok(compose.includes("${" + key + ":-" + fallback + "}"), "统一 Compose 缺少端口：" + key);
}
for (const service of ["web-react", "web-vue", "server", "demo", "postgres", "redis", "keycloak"]) {
  assert.ok(compose.includes("  " + service + ":"), "统一 Compose 缺少服务：" + service);
}
assert.ok(!compose.includes("  postgres-dev:"), "不得保留第二个 PostgreSQL 服务");
assert.ok(!compose.includes("legacy-db"), "不得保留旧开发数据库 Profile");
assert.ok(compose.includes("127.0.0.1:"), "统一 Docker 只能发布本机回环端口");
for (const oldVolume of [
  "adui-scada-oidc-lab_lab-postgres-data",
  "adui-scada-oidc-lab_lab-redis-data",
  "adui-scada-postgres-dev_scada-postgres-data",
]) {
  assert.ok(!compose.includes(oldVolume), "新 Docker Compose 不得挂载历史数据卷");
}
assert.ok(!compose.includes("external: true"), "全新安装必须自行创建独立数据卷");
assert.ok(compose.includes("  postgres-data:"), "缺少 PostgreSQL 持久化卷");
assert.ok(compose.includes("  redis-data:"), "缺少 Redis 持久化卷");
assert.ok(compose.includes("POSTGRES_DB: adui_scada"), "业务数据库必须为 adui_scada");
assert.ok(compose.includes("POSTGRES_USER: adui_scada"), "业务数据库用户必须为 adui_scada");
assert.ok(
  compose.includes("jdbc:postgresql://postgres:5432/adui_scada_keycloak"),
  "Keycloak 必须使用同一 PostgreSQL 的独立逻辑库",
);

for (const old of [
  "deploy/docker/compose.demo.yaml",
  "deploy/docker/compose.postgres.dev.yaml",
  "deploy/docker/compose.oidc.lab.yaml",
  "deploy/docker/compose.all.dev.yaml",
  "scripts/docker-all-dev.mjs",
  "scripts/docker-all-dev.cases.mjs",
]) {
  assert.ok(!existsSync(resolve(root, old)), "请移除旧版 Docker 入口：" + old);
}
for (const action of ["plan", "down", "ps", "logs"]) {
  assert.ok(
    packageScripts["docker:" + action]?.includes("docker-stack.mjs " + action),
    "缺少最新 Docker 命令：" + action,
  );
}
assert.ok(!packageScripts["docker:migrate"], "全新安装不得保留旧容器迁移入口");
assert.ok(
  packageScripts["docker:up"]?.endsWith("node scripts/docker-stack.mjs up") &&
    packageScripts["docker:infra"]?.endsWith("node scripts/docker-stack.mjs infra"),
  "Docker 全应用与基础设施入口必须分别使用受控启动命令",
);
assert.ok(
  packageScripts["docker:db:init"] === "node apps/server/prisma8-fresh-install.mjs",
  "缺少受控的全新数据库初始化入口",
);
assert.equal(
  packageScripts["docker:db:status"],
  "node apps/server/prisma8-fresh-install.mjs --status",
  "Docker 数据库状态查询必须复用本机随机凭据及只读 Prisma 命令",
);
assert.ok(
  packageScripts["test:docker:db"]?.includes("init-docker-db.cases.mjs"),
  "缺少首次数据库初始化安全测试",
);
assert.ok(
  packageScripts.ready.includes("pnpm run test:docker:db"),
  "首次数据库初始化安全测试必须加入 ready",
);
assert.ok(packageScripts.ready.includes("pnpm run test:docker"), "Docker 安全测试必须进入 ready");
assert.ok(packageScripts["test:docker"].includes("scripts/docker-stack.cases.mjs"));
assert.ok(packageScripts["test:docker"].includes("scripts/docker-oidc-discovery.cases.mjs"));
assert.ok(packageScripts["test:docker"].includes("scripts/docker-oidc-transport.cases.mjs"));
assert.ok(packageScripts["test:docker"].includes("scripts/docker-runtime-binding.cases.mjs"));
assert.ok(
  packageScripts["test:docker"].includes("scripts/docker-native-transaction-probe.cases.mjs"),
);
assert.equal(
  packageScripts["docker:db:transaction:probe"],
  "node scripts/docker-stack.mjs transaction-probe",
);
assert.ok(
  !packageScripts.ready.includes("docker:db:transaction:probe"),
  "真实临时事务探针必须单独确认",
);
assert.ok(
  !packageScripts["docker:up"].includes("transaction-probe"),
  "常驻启动不得自动执行临时事务",
);
assert.ok(packageScripts["test:docker"].includes("scripts/docker-db-role-review.cases.mjs"));
assert.equal(
  packageScripts["docker:db:role:review"],
  "node apps/server/prisma8-fresh-install.mjs --role-review",
);
assert.ok(
  !packageScripts.ready.includes("docker:db:role:review") &&
    !packageScripts["docker:up"].includes("role-review"),
  "真实数据库角色核查必须独立执行",
);
assert.ok(
  packageScripts["test:docker"].includes("scripts/docker-db-role-bootstrap-plan.cases.mjs"),
);
assert.equal(
  packageScripts["docker:db:role:plan"],
  "node apps/server/prisma8-fresh-install.mjs --role-plan",
);
assert.ok(
  !packageScripts.ready.includes("docker:db:role:plan") &&
    !packageScripts["docker:up"].includes("role-plan"),
  "真实角色准备预览必须独立执行",
);
assert.ok(packageScripts["test:docker"].includes("scripts/docker-db-role-bootstrap.cases.mjs"));
assert.equal(
  packageScripts["docker:db:role:bootstrap"],
  "node apps/server/prisma8-fresh-install.mjs --role-bootstrap",
);
assert.equal(
  packageScripts["docker:db:role:bootstrap:status"],
  "node apps/server/prisma8-fresh-install.mjs --role-bootstrap-status",
);
assert.ok(
  !packageScripts.ready.includes("docker:db:role:bootstrap") &&
    !packageScripts["docker:up"].includes("role-bootstrap"),
  "真实角色准备事务及状态核查必须独立执行",
);
assert.ok(packageScripts["test:docker"].includes("scripts/docker-db-role-isolation.cases.mjs"));
assert.equal(
  packageScripts["docker:db:role:isolation:inspect"],
  "node apps/server/prisma8-fresh-install.mjs --role-isolation-inspect",
);
assert.ok(
  !packageScripts.ready.includes("docker:db:role:isolation:inspect") &&
    !packageScripts["docker:up"].includes("role-isolation-inspect"),
  "真实全集群权限核查必须独立执行",
);
assert.ok(
  packageScripts["test:docker"].includes("scripts/docker-db-role-isolation-plan.cases.mjs"),
);
assert.equal(
  packageScripts["docker:db:role:isolation:plan"],
  "node apps/server/prisma8-fresh-install.mjs --role-isolation-plan",
);
assert.ok(
  !packageScripts.ready.includes("docker:db:role:isolation:plan") &&
    !packageScripts["docker:up"].includes("role-isolation-plan"),
  "真实隔离变更预览必须独立执行",
);
assert.equal(
  packageScripts["docker:db:role:isolation:status"],
  "node apps/server/prisma8-fresh-install.mjs --role-isolation-status",
);
assert.equal(
  packageScripts["docker:db:role:isolation:execute"],
  "node apps/server/prisma8-fresh-install.mjs --role-isolation-execute",
);
assert.equal(
  packageScripts["docker:db:role:object-review"],
  "node apps/server/prisma8-fresh-install.mjs --role-object-review",
);
assert.ok(packageScripts["test:docker"].includes("scripts/docker-db-role-object-review.cases.mjs"));
assert.ok(
  !packageScripts.ready.includes("docker:db:role:object-review") &&
    !packageScripts["docker:up"].includes("role-object-review"),
  "真实对象评审必须独立执行",
);
for (const name of ["ready", "docker:up", "mvp:verify:baseline"]) {
  assert.ok(!packageScripts[name].includes("role:isolation:execute"), "隔离写入事务必须独立确认");
}
assert.ok(compose.includes('SCADA_DOCKER_DB_READONLY: "true"'));
assert.ok(compose.includes("source: ../../.local/docker-runtime/server-database.json"));
assert.ok(nest.includes("DockerReadOnlyDatabaseAppModule"));
assert.equal(
  packageScripts["docker:oidc:probe"],
  "node scripts/docker-stack.mjs oidc",
  "Keycloak 真实只读探针必须使用受控本机 Docker 入口",
);
assert.ok(
  !packageScripts.ready.includes("docker:oidc:probe"),
  "真实 Keycloak 探针不得进入离线质量链",
);
for (const key of Object.keys(packageScripts)) {
  assert.ok(
    !/^docker:(demo|lab|all):/.test(key) && !key.startsWith("db:dev:"),
    "旧版 Docker 命令必须删除：" + key,
  );
}
assert.ok(read("deploy/docker/oidc-lab/adui-scada-realm.json").includes("adui-scada-bff"));
assert.ok(read("scripts/prepare-oidc-lab.mjs").includes("randomBytes(32)"));
assert.ok(read("scripts/prepare-oidc-lab.mjs").includes('resolve(root, ".local", "docker")'));
const nginx = read("deploy/docker/nginx.conf");
assert.ok(nginx.includes("${SCADA_SERVER_PORT}"));
assert.ok(nginx.includes("${SCADA_DEMO_PORT}"));
assert.ok(
  read("deploy/docker/Dockerfile.web").includes("/etc/nginx/templates/default.conf.template"),
);

const ignore = read(".gitignore");
assert.match(ignore, /^\.env$/m);
assert.match(ignore, /^\.env\.\*$/m);
assert.ok(ignore.includes(".local/docker/"), "本机随机凭据必须被 Git 忽略");
assert.ok(ignore.includes(".local/docker-runtime/"), "常驻数据库绑定必须被 Git 忽略");
assert.ok(read(".dockerignore").includes(".local/docker-runtime/"), "常驻数据库绑定不得进入镜像");
assert.match(ignore, /^!\.env\.example$/m);
assert.match(read(".dockerignore"), /^\.env$/m);
assert.ok(
  read(".dockerignore").includes(".local/docker/"),
  "本机随机凭据不能进入 Docker 构建上下文",
);
assert.match(read(".editorconfig"), /^end_of_line = lf$/m);
assert.ok(read("packages/tooling/src/format.ts").includes('endOfLine: "lf"'));
assert.match(read(".gitattributes"), /^\* text=auto eol=lf$/m);

console.log("环境配置检查通过：统一使用根目录 .env，Vue、React、NestJS、SSE 与 Docker 配置一致。");
console.log("换行符检查通过：Git 检出、EditorConfig 与 Vite+ 均统一使用 LF。");
