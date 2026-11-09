import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const text = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(text(path));
const expected = new Map([
  ["tsconfig.json", "@adui/tsconfig/node"],
  ["apps/web-react/tsconfig.app.json", "@adui/tsconfig/react"],
  ["apps/web-react/tsconfig.node.json", "@adui/tsconfig/node"],
  ["apps/web-vue/tsconfig.app.json", "@adui/tsconfig/vue"],
  ["apps/web-vue/tsconfig.node.json", "@adui/tsconfig/vue-node"],
  ["apps/server/tsconfig.json", "@adui/tsconfig/nest"],
  ["packages/core/tsconfig.json", "@adui/tsconfig/core"],
  ["packages/runtime/tsconfig.json", "@adui/tsconfig/browser"],
]);
const packages = [
  "apps/web-react",
  "apps/web-vue",
  "apps/server",
  "packages/core",
  "packages/runtime",
];

for (const [path, base] of expected) {
  assert.equal(json(path).extends, base, `${path} must inherit ${base}`);
}
for (const path of packages) {
  assert.equal(
    json(`${path}/package.json`).devDependencies?.["@adui/tsconfig"],
    "workspace:*",
    `${path} must depend on the shared tsconfig package`,
  );
}
const baseConfig = json("packages/tsconfig/package.json");
for (const name of ["react", "vue", "nest", "node", "vue-node", "core", "browser"]) {
  assert.ok(baseConfig.exports?.[`./${name}`], `Missing tsconfig subpath: ${name}`);
}

const editor = text(".editorconfig");
assert.match(editor, /^root = true$/m);
assert.match(editor, /^indent_size = 2$/m);
assert.match(editor, /^end_of_line = lf$/m);

const rootVite = text("vite.config.ts");
assert.match(rootVite, /@adui\/tooling\/format/);
assert.match(rootVite, /@adui\/tooling\/lint/);
assert.match(rootVite, /@adui\/tooling\/staged/);

for (const path of [
  "apps/web-react/vite.config.ts",
  "apps/web-vue/vite.config.ts",
  "apps/server/vitest.config.ts",
  "apps/server/vitest.config.e2e.ts",
]) {
  const content = text(path);
  assert.doesNotMatch(content, /\b(?:fmt|lint)\s*:/, `${path} must not override root format/lint`);
}

assert.ok(
  text("packages/tooling/src/format.ts").includes('".agents/skills/**"'),
  "Formatter must ignore third-party Skills",
);
assert.ok(
  text("packages/tooling/src/lint.ts").includes('".agents/skills/**"'),
  "Linter must ignore third-party Skills",
);

console.log(`Shared config OK: ${expected.size} TSConfig consumers + root format/lint`);
