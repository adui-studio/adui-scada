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
    assert.ok(match, `Invalid env line in ${path}`);
    const [, key, value] = match;
    assert.ok(!(key in values), `Duplicate env key in ${path}: ${key}`);
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
assert.deepEqual({ ...template }, defaults, "Root .env.example defaults must match the contract");

for (const legacy of [
  "apps/web-react/.env.example",
  "apps/web-vue/.env.example",
  "apps/server/.env.example",
  "examples/water-treatment/.env.example",
]) {
  assert.ok(!existsSync(resolve(root, legacy)), `Remove legacy template: ${legacy}`);
}

if (existsSync(resolve(root, ".env"))) {
  const configured = parseEnv(".env");
  for (const key of Object.keys(defaults)) {
    if (!(key in configured)) continue;
    const value = configured[key];
    if (key.endsWith("_PORT")) {
      const port = Number(value);
      assert.ok(Number.isInteger(port) && port >= 1 && port <= 65535, `${key}: invalid port`);
    } else if (key === "SCADA_WEB_HOST") {
      assert.ok(["127.0.0.1", "localhost"].includes(value), `${key}: not loopback`);
    } else {
      assert.ok(["127.0.0.1", "0.0.0.0"].includes(value), `${key}: invalid host`);
    }
  }
}

for (const [framework, key] of [
  ["react", "SCADA_REACT_DEV_PORT"],
  ["vue", "SCADA_VUE_DEV_PORT"],
]) {
  const config = read(`apps/web-${framework}/vite.config.ts`);
  assert.ok(config.includes('new URL("../../", import.meta.url)'), "Vite envDir must be root");
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
]) assert.ok(source.includes(key), `Missing runtime key: ${key}`);

const compose = read("deploy/docker/compose.demo.yaml");
for (const [key, fallback] of [
  ["SCADA_REACT_PORT", "8080"],
  ["SCADA_VUE_PORT", "8081"],
  ["SCADA_SERVER_PORT", "3001"],
  ["SCADA_DEMO_PORT", "4178"],
]) {
  const substitution = "${" + key + ":-" + fallback + "}";
  assert.ok(compose.includes(substitution), `Compose missing ${key}`);
}
assert.ok(compose.includes("127.0.0.1:"));
const nginx = read("deploy/docker/nginx.conf");
assert.ok(nginx.includes("${SCADA_SERVER_PORT}"));
assert.ok(nginx.includes("${SCADA_DEMO_PORT}"));
assert.ok(read("deploy/docker/Dockerfile.web").includes("/etc/nginx/templates/default.conf.template"));

const ignore = read(".gitignore");
assert.match(ignore, /^\.env$/m);
assert.match(ignore, /^\.env\.\*$/m);
assert.match(ignore, /^!\.env\.example$/m);
assert.match(read(".dockerignore"), /^\.env$/m);
assert.match(read(".editorconfig"), /^end_of_line = lf$/m);
assert.ok(read("packages/tooling/src/format.ts").includes('endOfLine: "lf"'));
assert.match(read(".gitattributes"), /^\* text=auto eol=lf$/m);

console.log("Environment OK: one root .env; Vue/React, NestJS, SSE and Docker paths aligned.");
console.log("Line endings OK: Git checkout, EditorConfig and Vite+ all use LF.");
