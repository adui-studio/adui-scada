import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

function template(path, keys) {
  const values = Object.create(null);
  for (const line of read(path).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    assert.ok(match, `Invalid env template line in ${path}: ${trimmed}`);
    const [, key, value] = match;
    assert.ok(!(key in values), `Duplicate env key: ${path} -> ${key}`);
    values[key] = value;
  }
  assert.deepEqual(Object.keys(values).sort(), keys.slice().sort(), path);
  return values;
}

const docker = template(".env.example", ["SCADA_REACT_PORT", "SCADA_VUE_PORT"]);
const react = template("apps/web-react/.env.example", [
  "SCADA_WEB_HOST",
  "SCADA_WEB_PORT",
  "SCADA_DEMO_PROXY_TARGET",
]);
const vue = template("apps/web-vue/.env.example", [
  "SCADA_WEB_HOST",
  "SCADA_WEB_PORT",
  "SCADA_DEMO_PROXY_TARGET",
]);
const server = template("apps/server/.env.example", ["NODE_ENV", "HOST", "PORT"]);
const demo = template("examples/water-treatment/.env.example", ["DEMO_HOST", "DEMO_PORT"]);
assert.equal(react.SCADA_WEB_PORT, "5173");
assert.equal(vue.SCADA_WEB_PORT, "5174");
assert.equal(server.PORT, "3001");
assert.equal(demo.DEMO_PORT, "4178");
assert.equal(docker.SCADA_REACT_PORT, "8080");
assert.equal(docker.SCADA_VUE_PORT, "8081");

for (const framework of ["react", "vue"]) {
  const config = read(`apps/web-${framework}/vite.config.ts`);
  assert.match(config, /loadEnv\(mode, process\.cwd\(\), "SCADA_"\)/);
  assert.match(config, /SCADA_WEB_HOST/);
  assert.match(config, /SCADA_WEB_PORT/);
  assert.match(config, /SCADA_DEMO_PROXY_TARGET/);
  assert.match(config, /import \{ loadEnv \} from "vite"/);
}

const nest = read("apps/server/src/main.ts");
const simulator = read("examples/water-treatment/server.mjs");
assert.match(nest, /loadEnvFile\(envPath\)/);
assert.match(simulator, /loadEnvFile\(envPath\)/);
assert.match(simulator, /DEMO_PORT/);
const compose = read("deploy/docker/compose.demo.yaml");
assert.ok(compose.includes("${SCADA_REACT_PORT:-8080}"));
assert.ok(compose.includes("${SCADA_VUE_PORT:-8081}"));
assert.match(compose, /127\.0\.0\.1:/);

const ignore = read(".gitignore");
assert.match(ignore, /^\.env$/m);
assert.match(ignore, /^\.env\.\*$/m);
assert.match(ignore, /^!\.env\.example$/m);

console.log("Environment templates OK: root, React, Vue, NestJS, demo, and Docker.");
