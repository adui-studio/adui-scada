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
  SCADA_REACT_DEV_PORT: "5173",
  SCADA_VUE_DEV_PORT: "5174",
  SCADA_SERVER_HOST: "127.0.0.1",
  SCADA_SERVER_PORT: "3001",
  SCADA_DEMO_HOST: "127.0.0.1",
  SCADA_DEMO_PORT: "4178",
  SCADA_REACT_PORT: "8080",
  SCADA_VUE_PORT: "8081",
};
const template = parseEnv(".env.example");
assert.deepEqual({ ...template }, defaults, "根目录 .env.example 的默认值必须与配置契约一致");

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
    } else if (key === "SCADA_WEB_HOST") {
      assert.ok(["127.0.0.1", "localhost"].includes(value), `${key}：必须使用本机回环地址`);
    } else {
      assert.ok(["127.0.0.1", "0.0.0.0"].includes(value), `${key}：监听地址无效`);
    }
  }
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
const demo = read("examples/water-treatment/server.mjs");
assert.ok(nest.includes('new URL("../../../.env", import.meta.url)'));
assert.ok(demo.includes('new URL("../../.env", import.meta.url)'));
for (const [source, key] of [
  [nest, "SCADA_SERVER_HOST"],
  [nest, "SCADA_SERVER_PORT"],
  [demo, "SCADA_DEMO_HOST"],
  [demo, "SCADA_DEMO_PORT"],
])
  assert.ok(source.includes(key), `运行时配置缺少变量：${key}`);

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
