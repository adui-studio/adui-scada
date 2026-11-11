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
  ["packages/draft-storage/tsconfig.json", "@adui/tsconfig/browser"],
  ["packages/runtime/tsconfig.json", "@adui/tsconfig/browser"],
]);
const packages = [
  "apps/web-react",
  "apps/web-vue",
  "apps/server",
  "packages/core",
  "packages/draft-storage",
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

// Tailwind 主题与 Vite 插件仅由共享包提供，避免双框架配置漂移。
const tailwindPackage = json("packages/tailwind/package.json");
assert.equal(tailwindPackage.name, "@adui/tailwind");
assert.equal(tailwindPackage.exports?.["./styles.css"], "./src/styles.css");
assert.equal(tailwindPackage.exports?.["./vite"], "./src/vite.ts");
assert.equal(tailwindPackage.exports?.["./studio.css"], "./src/studio.css");
assert.ok(
  text("packages/tailwind/src/studio.css").includes("studio-workspace"),
  "缺少共享工作台布局样式",
);
for (const name of ["react", "vue"]) {
  assert.ok(
    text(`apps/web-${name}/src/studio/StudioPage.${name === "react" ? "tsx" : "vue"}`).includes(
      'import "@adui/tailwind/studio.css";',
    ),
    `web-${name} 必须引用共享 Studio 工作台布局样式`,
  );
}
assert.equal(tailwindPackage.dependencies?.["@tailwindcss/vite"], "catalog:");
assert.equal(tailwindPackage.dependencies?.tailwindcss, "catalog:");

const tailwindCss = text("packages/tailwind/src/styles.css");
assert.match(
  tailwindCss,
  /^@import "tailwindcss\/utilities\.css" layer\(utilities\) source\(none\);$/m,
  "Tailwind utilities 必须先声明 CSS layer，再声明 source(none)",
);
assert.doesNotMatch(tailwindCss, /source\([^)]*\)\s+layer\(/, "禁止颠倒 Tailwind 导入顺序");
assert.doesNotMatch(tailwindCss, /@import "[^"]*preflight/i, "不得叠加 Tailwind Preflight");

for (const framework of ["react", "vue"]) {
  const webRoot = `apps/web-${framework}`;
  const entry = framework === "react" ? "main.tsx" : "main.ts";
  const manifest = json(`${webRoot}/package.json`);
  assert.equal(
    manifest.dependencies?.["@adui/tailwind"],
    "workspace:*",
    `${webRoot} 必须依赖共享 Tailwind 包`,
  );
  assert.equal(
    manifest.devDependencies?.["@tailwindcss/vite"],
    undefined,
    `${webRoot} 不应重复维护 Tailwind 插件`,
  );
  assert.equal(
    manifest.devDependencies?.tailwindcss,
    undefined,
    `${webRoot} 不应重复维护 Tailwind 版本`,
  );
  assert.ok(
    text(`${webRoot}/src/${entry}`).includes('import "@adui/tailwind/styles.css";'),
    `${webRoot} 必须使用共享 Tailwind 样式`,
  );
  assert.ok(
    text(`${webRoot}/vite.config.ts`).includes('from "@adui/tailwind/vite"'),
    `${webRoot} 必须使用共享 Tailwind 插件入口`,
  );
  assert.ok(
    tailwindCss.includes(`@source "../../../${webRoot}/src";`),
    `${webRoot} 的组件路径未纳入 Tailwind 工具类扫描`,
  );
}

// Studio 采用共享工作台布局，双框架各自维护交互逻辑。
const sharedStudio = text("packages/tailwind/src/studio.css");
for (const role of [
  "studio-toolbar",
  "studio-page-menu",
  "studio-pane-heading",
  "studio-layer-tree",
  "studio-canvas-scroll",
  "studio-panel-properties",
  "studio-advanced",
  "studio-statusbar",
]) {
  assert.ok(sharedStudio.includes(`.${role}`), `共享 Studio 缺少布局样式：${role}`);
}
assert.match(
  sharedStudio,
  /grid-template-columns: var\(--studio-left-width\) minmax\(0, 1fr\) var\(--studio-right-width\)/,
  "Studio 必须让画布优先使用剩余空间",
);
for (const framework of ["react", "vue"]) {
  const editorPath = `apps/web-${framework}/src/studio/StudioPage.${framework === "react" ? "tsx" : "vue"}`;
  const editorSource = text(editorPath);
  for (const role of [
    "studio-file-menu",
    "studio-page-menu",
    "studio-panel-layers",
    "studio-canvas-scroll",
    "studio-panel-properties",
    "studio-advanced",
    "studio-statusbar",
  ]) {
    assert.ok(editorSource.includes(role), `${editorPath} 缺少布局区域：${role}`);
  }
  assert.ok(
    editorSource.indexOf("studio-geometry") < editorSource.indexOf("studio-advanced"),
    `${editorPath} 几何属性应优先于高级操作显示`,
  );
  assert.ok(
    editorSource.includes("data-left-collapsed") && editorSource.includes("data-right-collapsed"),
    `${editorPath} 缺少左右面板显隐控制`,
  );
}

// 固定侧栏之外的中央编辑区必须铺满，不允许居中小画板造成四周空白。
const viewportCss = text("packages/tailwind/src/studio.css");
for (const selector of [".studio-canvas-scroll", ".studio-canvas-board"]) {
  const opening = viewportCss.indexOf(`${selector} {`);
  const closing = viewportCss.indexOf("}", opening);
  assert.ok(opening >= 0 && closing > opening, `缺少画布容器：${selector}`);
  const body = viewportCss.slice(opening, closing);
  assert.match(body, /width:\s*100%/, `${selector} 必须撑满宽度`);
  assert.match(body, /height:\s*100%/, `${selector} 必须撑满高度`);
  assert.match(body, /overflow:\s*hidden/, `${selector} 不允许出现滚动条`);
  assert.doesNotMatch(body, /aspect-ratio|cqh/, `${selector} 不得限制外框比例`);
}
assert.match(viewportCss, /\.studio-canvas-scroll\s*\{[^}]*padding:\s*0;/, "画布不应留内边距");
assert.match(
  viewportCss,
  /\.studio-canvas-board\s*>\s*\.studio-svg\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*border:\s*0;/,
  "SVG 必须满宽满高且无边框",
);
assert.match(viewportCss, /--studio-left-width:\s*252px/, "左侧栏必须固定宽度");
assert.match(viewportCss, /--studio-right-width:\s*320px/, "右侧栏必须固定宽度");
assert.ok(
  viewportCss.includes(".studio-page-boundary"),
  "共享 Studio 样式必须包含工程页面边界辅助线",
);

for (const framework of ["react", "vue"]) {
  const studioPath = `apps/web-${framework}/src/studio/StudioPage.${framework === "react" ? "tsx" : "vue"}`;
  const studioSource = text(studioPath);
  assert.match(
    studioSource,
    /studioViewportRect/,
    `${studioPath} 必须使用共享工作区视区计算`,
  );
  assert.ok(studioSource.includes("ResizeObserver"), `${studioPath} 必须响应实际画布尺寸变化`);
  assert.ok(studioSource.includes("visibleRect.x") && studioSource.includes("visibleRect.width"),
    `${studioPath} 必须让 SVG 网格覆盖全部可见视区`);
  assert.ok(studioSource.includes("studio-page-boundary"), `${studioPath} 必须标明实际工程页面边界`);
  assert.match(
    studioSource,
    /preserveAspectRatio="xMidYMid meet"/,
    `${studioPath} 不得拉伸原页面图元`,
  );
  assert.doesNotMatch(
    studioSource,
    /width:\s*`\$\{zoom\s*\*\s*100\}%`/,
    `${studioPath} 不得使用 DOM 宽度实现缩放`,
  );
  assert.ok(studioSource.includes("studio-view-menu"), `${studioPath} 缺少合并后的视图设置入口`);
  assert.ok(studioSource.includes("resetCanvasView"), `${studioPath} 缺少适应视图功能`);
  assert.ok(studioSource.includes("beginCanvasPan"), `${studioPath} 缺少画布平移入口`);
}

console.log(`共享配置检查通过：${expected.size} 个 TSConfig 消费端，根目录统一管理格式化与 Lint`);
