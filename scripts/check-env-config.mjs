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
  SCADA_DEMO_HOST: "127.0.0.1",
  SCADA_DEMO_PORT: "14178",
  SCADA_REACT_PORT: "8080",
  SCADA_VUE_PORT: "18081",
  SCADA_DB_HOST: "127.0.0.1",
  SCADA_DB_PORT: "15432",
  SCADA_DB_NAME: "adui_scada",
  SCADA_DB_USER: "adui_scada",
  SCADA_DB_PASSWORD: "adui_scada_dev_only_2026",
  SCADA_DATABASE_URL:
    "postgresql://adui_scada:adui_scada_dev_only_2026@127.0.0.1:15432/adui_scada?schema=public",
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
    } else if (key === "SCADA_API_DOCS_ENABLED") {
      assert.ok(["true", "false"].includes(value), "SCADA_API_DOCS_ENABLED：必须是 true 或 false");
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
  assert.ok(config.includes("envDir,"));
  assert.ok(!config.includes("SCADA_DEMO_PROXY_TARGET"));
}

const nest = read("apps/server/src/main.ts");
const serverConfig = read("apps/server/src/config/server-startup.config.ts");
const demo = read("examples/water-treatment/server.mjs");
assert.ok(nest.includes('new URL("../../../.env", import.meta.url)'));
assert.ok(demo.includes('new URL("../../.env", import.meta.url)'));
assert.ok(
  nest.includes('await import("./app.module.js")'),
  "NestJS 必须在加载根目录 .env 后动态导入 AppModule",
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

const dbScripts = JSON.parse(read("package.json")).scripts;
const postgresComposeCommand =
  "docker compose --env-file .env -f deploy/docker/compose.postgres.dev.yaml";
for (const name of ["db:dev:up", "db:dev:down"]) {
  assert.ok(
    dbScripts[name]?.includes(postgresComposeCommand),
    `${name}：必须显式从仓库根目录加载 .env`,
  );
}

const compose = read("deploy/docker/compose.demo.yaml");
for (const [key, fallback] of [
  ["SCADA_REACT_PORT", "8080"],
  ["SCADA_VUE_PORT", "8081"],
  ["SCADA_SERVER_PORT", "3001"],
  ["SCADA_DEMO_PORT", "4178"],
]) {
  const substitution = "${" + key + ":-" + fallback + "}";
  assert.ok(compose.includes(substitution), `Docker Compose 缺少变量：${key}`);
}
assert.ok(compose.includes("127.0.0.1:"));
const nginx = read("deploy/docker/nginx.conf");
assert.ok(nginx.includes("${SCADA_SERVER_PORT}"));
assert.ok(nginx.includes("${SCADA_DEMO_PORT}"));
assert.ok(
  read("deploy/docker/Dockerfile.web").includes("/etc/nginx/templates/default.conf.template"),
);

const ignore = read(".gitignore");
assert.match(ignore, /^\.env$/m);
assert.match(ignore, /^\.env\.\*$/m);
assert.match(ignore, /^!\.env\.example$/m);
assert.match(read(".dockerignore"), /^\.env$/m);
assert.match(read(".editorconfig"), /^end_of_line = lf$/m);
assert.ok(read("packages/tooling/src/format.ts").includes('endOfLine: "lf"'));
assert.match(read(".gitattributes"), /^\* text=auto eol=lf$/m);

console.log("环境配置检查通过：统一使用根目录 .env，Vue、React、NestJS、SSE 与 Docker 配置一致。");
console.log("换行符检查通过：Git 检出、EditorConfig 与 Vite+ 均统一使用 LF。");
