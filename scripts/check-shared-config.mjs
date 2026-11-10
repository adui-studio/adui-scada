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
  assert.equal(json(path).extends, base, `${path} 必须继承 ${base}`);
}
for (const path of packages) {
  assert.equal(
    json(`${path}/package.json`).devDependencies?.["@adui/tsconfig"],
    "workspace:*",
    `${path} 必须依赖共享 tsconfig 包`,
  );
}
const baseConfig = json("packages/tsconfig/package.json");
for (const name of ["react", "vue", "nest", "node", "vue-node", "core", "browser"]) {
  assert.ok(baseConfig.exports?.[`./${name}`], `缺少 tsconfig 子路径：${name}`);
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
  assert.doesNotMatch(content, /\b(?:fmt|lint)\s*:/, `${path} 不得覆盖根目录的格式化或 Lint 配置`);
}

assert.ok(
  text("packages/tooling/src/format.ts").includes('".agents/skills/**"'),
  "格式化工具必须忽略第三方 Skill 文档",
);
assert.ok(
  text("packages/tooling/src/lint.ts").includes('".agents/skills/**"'),
  "Lint 工具必须忽略第三方 Skill 文档",
);

console.log(`共享配置检查通过：${expected.size} 个 TSConfig 消费端，根目录统一管理格式化与 Lint`);
