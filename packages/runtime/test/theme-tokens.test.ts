/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const themeRoot = new URL("../../theme/src/", import.meta.url);
const readTheme = (name: string) => readFileSync(new URL(name, themeRoot), "utf8");

const findRules = (css: string, selector: string): string[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1]?.trim().endsWith(selector))
    .map((match) => match[2] ?? "");

describe("双框架工业主题设计 Token", () => {
  it("主题颜色、字号和间距必须由 @adui/theme 统一定义且名称不重复", () => {
    const tokens = readTheme("tokens.css");
    const names = [...tokens.matchAll(/^\s*(--[a-z][a-z\d-]+):/gm)].map((item) => item[1]);
    expect(names.length).toBeGreaterThan(65);
    expect(new Set(names).size).toBe(names.length);
    for (const name of [
      "--adui-color-brand",
      "--adui-color-success",
      "--adui-color-warning",
      "--adui-color-danger",
      "--adui-font-family",
      "--adui-font-size-md",
      "--adui-space-6",
      "--adui-radius-panel",
      "--scada-primary",
      "--scada-live",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("原有 V7 品牌与工业状态颜色必须保持兼容且不能混用警告语义", () => {
    const tokens = readTheme("tokens.css");
    expect(tokens).toContain("--adui-scada-blue: #0d63f3;");
    expect(tokens).toContain("--adui-scada-cyan: #00c8ff;");
    expect(tokens).toContain("--adui-scada-teal: #00d9a6;");
    expect(tokens).toContain("--scada-live: var(--adui-color-success);");
    expect(tokens).toContain("--scada-danger: var(--adui-color-danger);");
    expect(tokens).toContain("--scada-primary: var(--adui-color-brand);");
  });

  it("TDesign 必须采用同一深色根主题并映射颜色字号间距", () => {
    const css = readTheme("tdesign.css");
    expect(css).toContain('html:root[theme-mode="dark"]');
    expect(css).toContain("--td-brand-color: var(--adui-color-brand);");
    expect(css).toContain("--td-text-color-disabled: var(--adui-color-text-disabled);");
    expect(css).toContain("--td-bg-color-container: var(--adui-color-surface);");
    expect(css).toContain("--td-font-size-body-medium: var(--adui-font-size-md);");
    expect(css).toContain("--td-size-6: var(--adui-space-6);");
    expect(css).toContain("--td-radius-medium: var(--adui-radius-md);");
  });

  it("原主题入口和两个 HTML 必须接入统一主题且不影响 Studio 固定尺寸", () => {
    const runtimeTheme = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");
    const runtimeStyles = readFileSync(new URL("../src/runtime.css", import.meta.url), "utf8");
    const studioStyles = readFileSync(
      new URL("../../tailwind/src/studio.css", import.meta.url),
      "utf8",
    );
    const webRoot = new URL("../../../apps/", import.meta.url);
    const reactHtml = readFileSync(new URL("web-react/index.html", webRoot), "utf8");
    const vueHtml = readFileSync(new URL("web-vue/index.html", webRoot), "utf8");
    expect(runtimeTheme).toContain('@import "@adui/theme/styles.css";');
    expect(runtimeStyles).toContain("font-family: var(--adui-font-family);");
    expect(reactHtml).toContain('theme-mode="dark"');
    expect(vueHtml).toContain('theme-mode="dark"');
    expect(studioStyles).toContain("--studio-left-width: 252px;");
    expect(studioStyles).toContain("--studio-right-width: 320px;");
  });
  it("运行页导航、诊断与发布空态必须使用保持原尺寸的统一 Token", () => {
    const css = readFileSync(new URL("../src/runtime.css", import.meta.url), "utf8");
    for (const [selector, declaration] of [
      [".scada-app-nav", "gap: var(--adui-space-3);"],
      [".scada-app-nav > button", "font-size: var(--adui-font-size-sm);"],
      [".scada-app-version", "font-size: var(--adui-font-size-xs);"],
      [".scada-message", "line-height: var(--adui-line-height-normal);"],
      [".scada-panel-subtitle", "font-size: var(--adui-font-size-xs);"],
      [".scada-diagnostics-grid dd", "font-size: var(--adui-font-size-xl);"],
      [".scada-tag strong", "font-size: var(--adui-font-size-xs);"],
      [
        ".scada-published-preview-panel > .scada-diagnostics-empty",
        "padding: var(--adui-space-8);",
      ],
    ] as const) {
      expect(findRules(css, selector).some((rule) => rule.includes(declaration))).toBe(true);
    }
    const tokens = readTheme("tokens.css");
    expect(tokens).toContain("--adui-space-3: 6px;");
    expect(tokens).toContain("--adui-space-8: 24px;");
    expect(tokens).toContain("--adui-font-size-xs: 12px;");
    expect(tokens).toContain("--adui-font-size-sm: 13px;");
    expect(tokens).toContain("--adui-font-size-xl: 18px;");
    expect(tokens).toContain("--adui-line-height-normal: 1.5;");
  });

  it("Studio 工作台与工程列表复用主题字号，保留固定侧栏与缩放结构", () => {
    const css = readFileSync(new URL("../../tailwind/src/studio.css", import.meta.url), "utf8");
    for (const [selector, declaration] of [
      [".studio-toolbar .scada-eyebrow", "font-size: var(--adui-font-size-2xs);"],
      [".studio-actions button", "font-size: var(--adui-font-size-xs);"],
      [".studio-page-tabs", "gap: var(--adui-space-2);"],
      [".studio-project-browser-heading strong", "font-size: var(--adui-font-size-md);"],
      [".studio-project-browser-info code", "font-size: var(--adui-font-size-xs);"],
      [".studio-project-browser-pagination span", "font-size: var(--adui-font-size-2xs);"],
    ] as const) {
      expect(findRules(css, selector).some((rule) => rule.includes(declaration))).toBe(true);
    }
    expect(css).toContain("--studio-left-width: 252px;");
    expect(css).toContain("--studio-right-width: 320px;");
    expect(css).toContain(
      "grid-template-columns: var(--studio-left-width) minmax(0, 1fr) var(--studio-right-width);",
    );
  });

  it("Studio 属性面板密度必须使用等值 Token，且不改变固定画布布局", () => {
    const css = readFileSync(new URL("../../tailwind/src/studio.css", import.meta.url), "utf8");
    for (const [selector, declaration] of [
      [".studio-pane-heading", "gap: var(--adui-space-4);"],
      [".studio-panel-properties > h2", "margin: 0 -14px var(--adui-space-5);"],
      [".studio-panel-properties > p", "font-size: var(--adui-font-size-xs);"],
      [".studio-geometry", "padding: var(--adui-space-5);"],
      [".studio-geometry", "margin: var(--adui-space-5) 0;"],
      [".studio-advanced", "border-radius: var(--adui-radius-md);"],
      [".studio-advanced .studio-tool-group", "gap: var(--adui-space-3);"],
      [".studio-tree-controls .studio-field", "gap: var(--adui-space-3);"],
    ] as const) {
      expect(findRules(css, selector).some((rule) => rule.includes(declaration))).toBe(true);
    }
    const tokens = readTheme("tokens.css");
    expect(tokens).toContain("--adui-space-3: 6px;");
    expect(tokens).toContain("--adui-space-4: 8px;");
    expect(tokens).toContain("--adui-space-5: 12px;");
    expect(tokens).toContain("--adui-font-size-xs: 12px;");
    expect(tokens).toContain("--adui-radius-md: 6px;");
    expect(css).toContain("--studio-left-width: 252px;");
    expect(css).toContain("--studio-right-width: 320px;");
    expect(css).toContain(
      "grid-template-columns: var(--studio-left-width) minmax(0, 1fr) var(--studio-right-width);",
    );
  });

  it("禁用按钮不得响应本地悬停强调，TDesign 焦点与禁用态沿用官方变量", () => {
    const css = readFileSync(new URL("../../tailwind/src/studio.css", import.meta.url), "utf8");
    for (const selector of [
      ".studio-save-actions button:first-child:not(:disabled)",
      ".studio-save-actions button:first-child:not(:disabled):hover",
      ".studio-add button:not(:disabled):hover",
      ".studio-page-tabs button:not(:disabled):hover",
    ]) {
      expect(findRules(css, selector).length).toBeGreaterThan(0);
    }
    expect(css).toContain(".studio-project-browser-panel button:disabled {");
    expect(css).toContain(
      ".studio-shell :is(button, input, select, textarea, summary):focus-visible {",
    );
    const tdesign = readTheme("tdesign.css");
    expect(tdesign).toContain("--td-brand-color-focus: var(--adui-color-brand-focus);");
    expect(tdesign).toContain("--td-brand-color-disabled: var(--adui-color-brand-disabled);");
    expect(tdesign).toContain("--td-text-color-disabled: var(--adui-color-text-disabled);");
    expect(tdesign).toContain("--td-bg-color-component-disabled: var(--adui-color-surface);");
  });

  it("Studio 历史版本弹层复用主题字号与间距且不修改布局几何", () => {
    const css = readFileSync(new URL("../../tailwind/src/studio.css", import.meta.url), "utf8");
    for (const [selector, declaration] of [
      [".studio-version-panel", "top: calc(100% + var(--adui-space-3));"],
      [".studio-version-panel", "padding: var(--adui-space-5);"],
      [".studio-version-error", "font-size: var(--adui-font-size-xs);"],
      [".studio-version-error", "line-height: var(--adui-line-height-normal);"],
      [".studio-version-item-actions", "gap: var(--adui-space-3);"],
      [".studio-version-more", "font-size: var(--adui-font-size-xs);"],
      [".studio-version-list", "gap: var(--adui-space-4);"],
      [".studio-version-heading", "gap: var(--adui-space-3);"],
      [".studio-version-heading", "font-size: var(--adui-font-size-xs);"],
      [".studio-version-item code", "font-size: var(--adui-font-size-2xs);"],
      [".studio-version-comparison strong", "font-size: var(--adui-font-size-xs);"],
      [".studio-version-comparison p", "font-size: var(--adui-font-size-2xs);"],
    ] as const) {
      expect(findRules(css, selector).some((rule) => rule.includes(declaration))).toBe(true);
    }
    const tokens = readTheme("tokens.css");
    expect(tokens).toContain("--adui-space-3: 6px;");
    expect(tokens).toContain("--adui-space-4: 8px;");
    expect(tokens).toContain("--adui-space-5: 12px;");
    expect(tokens).toContain("--adui-font-size-xs: 12px;");
    expect(tokens).toContain("--adui-font-size-2xs: 11px;");
    expect(tokens).toContain("--adui-line-height-normal: 1.5;");
    expect(css).toContain("width: min(378px, calc(100vw - 24px));");
    expect(css).toContain("max-height: min(70vh, 610px);");
    expect(css).toContain("--studio-left-width: 252px;");
    expect(css).toContain("--studio-right-width: 320px;");
  });
});
