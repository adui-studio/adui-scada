/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { WORKSPACE_HOME_ENTRIES, filterWorkspaceHomeEntries } from "../src/workspace-home.ts";

const themeRoot = new URL("../../theme/src/", import.meta.url);
const readTheme = (name: string) => readFileSync(new URL(name, themeRoot), "utf8");
const readRelative = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("精密工程工作台设计系统", () => {
  it("保留 V7 品牌色并以新的浅色语义 Token 构建编辑工作区", () => {
    const tokens = readTheme("tokens.css");
    const names = [...tokens.matchAll(/^\s*(--[a-z][a-z\d-]+):/gm)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(75);
    expect(new Set(names).size).toBe(names.length);
    expect(tokens).toContain("--adui-scada-blue: #0d63f3;");
    expect(tokens).toContain("--adui-scada-cyan: #00c8ff;");
    expect(tokens).toContain("--adui-scada-teal: #00d9a6;");
    expect(tokens).toContain("--adui-color-bg: #edf1f5;");
    expect(tokens).toContain("--adui-color-surface: #ffffff;");
    expect(tokens).toContain("--adui-color-stage: #101a29;");
    expect(tokens).toContain("--adui-color-editor-workspace: #e8ebf0;");
    expect(tokens).toContain("--adui-color-editor-artboard: #ffffff;");
    expect(tokens).toContain("--scada-live: var(--adui-color-success);");
    expect(tokens).toContain("--scada-danger: var(--adui-color-danger);");
    expect(tokens).toContain("--scada-primary: var(--adui-color-brand);");
    expect(tokens).toContain("color-scheme: light;");
  });

  it("TDesign React/Vue 在统一浅色根主题下复用字体、字号和禁用态", () => {
    const css = readTheme("tdesign.css");
    expect(css).toContain('html:root[theme-mode="light"]');
    for (const token of [
      "--td-brand-color: var(--adui-color-brand);",
      "--td-brand-color-focus: var(--adui-color-brand-focus);",
      "--td-brand-color-disabled: var(--adui-color-brand-disabled);",
      "--td-text-color-disabled: var(--adui-color-text-disabled);",
      "--td-bg-color-container: var(--adui-color-surface);",
      "--td-font-size-body-medium: var(--adui-font-size-md);",
      "--td-size-6: var(--adui-space-6);",
      "--td-radius-medium: var(--adui-radius-md);",
    ]) {
      expect(css).toContain(token);
    }
    for (const path of ["../../../apps/web-react/index.html", "../../../apps/web-vue/index.html"]) {
      expect(readRelative(path)).toContain('theme-mode="light"');
    }
  });

  it("双框架从运行、发布到组态共享垂直导航与清晰的安全模式标识", () => {
    const css = readRelative("../src/runtime.css");
    expect(css).toContain("grid-template-columns: 184px minmax(0, 1fr);");
    expect(css).toContain("grid-template-rows: 42px minmax(0, 1fr);");
    expect(css).toContain(".scada-home-card-grid {");
    expect(css).toContain('.scada-app-nav .t-button[aria-current="page"]');
    expect(css).toContain(".scada-app-nav .t-button:focus-visible");
    expect(css).toContain('.scada-app-frame[data-view="studio"]');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    for (const path of [
      "../../../apps/web-react/src/App.tsx",
      "../../../apps/web-vue/src/App.vue",
    ]) {
      const app = readRelative(path);
      expect(app).toContain("scada-app-frame");
      expect(app).toContain("scada-app-topbar");
      expect(app).toContain("scada-skip-link");
      expect(app).toContain("仅供开发验证");
      for (const label of ["工作台", "运行监控", "已发布运行", "组态编辑"]) {
        expect(app).toContain(label);
      }
    }
  });

  it("运行监控优先展示工艺画面，已发布运行保留独立只读预览", () => {
    const css = readRelative("../src/runtime.css");
    for (const selector of [
      ".scada-monitor-layout",
      ".scada-monitor-side",
      ".scada-published-layout",
      ".scada-published-sidebar",
      ".scada-published-preview-panel > .scada-diagnostics-empty",
      '.scada-quality-item[data-quality="GOOD"] strong',
      '.scada-quality-item[data-quality="BAD"] strong',
    ]) {
      expect(css).toContain(selector);
    }
    for (const page of [
      "../../../apps/web-react/src/runtime/RuntimePage.tsx",
      "../../../apps/web-vue/src/runtime/RuntimePage.vue",
    ]) {
      const source = readRelative(page);
      expect(source).toContain("scada-monitor-layout");
      expect(source).toContain("scada-monitor-side");
      expect(source).toContain("不连接 PLC/DCS");
    }
    for (const page of [
      "../../../apps/web-react/src/runtime/PublishedRuntimePage.tsx",
      "../../../apps/web-vue/src/runtime/PublishedRuntimePage.vue",
    ]) {
      const source = readRelative(page);
      expect(source).toContain("scada-published-layout");
      expect(source).toContain('data-testid="published-runtime-svg"');
      expect(source).toContain("不开放设备控制");
    }
  });

  it("Studio 共享左侧页面、白色画板和底部图元工具区布局", () => {
    const css = readRelative("../../tailwind/src/studio.css");
    expect(css).toContain("--studio-left-preferred");
    expect(css).toContain("--studio-right-preferred");
    expect(css).toContain(".studio-panel-size input");
    expect(css).toContain('.studio-hitbox[data-selected="true"]');
    expect(css).toContain(".studio-focus-selection");
    expect(css).toContain(
      "grid-template-columns: var(--studio-left-width) minmax(0, 1fr) var(--studio-right-width);",
    );
    expect(css).toContain(".studio-canvas-board > .studio-svg");
    expect(css).toContain(".studio-canvas-dock {");
    expect(css).toContain(".studio-artboard-surface {");
    expect(css).toContain("background: var(--adui-color-editor-workspace);");
    expect(css).toContain("fill: var(--adui-color-editor-artboard);");
    expect(css).toContain(".studio-page-bar::before {");
    expect(css).toContain(
      ".studio-shell :is(button, input, select, textarea, summary):focus-visible",
    );
    expect(css).toContain(".studio-inspector-tabs {");
    expect(css).toContain(".studio-inspector-content[hidden] {");
    expect(css).toContain(".studio-tag-toolbar {");
    expect(css).toContain(".studio-tag-search {");
    expect(css).toContain(".studio-tag-actions {");
    expect(css).toContain(".studio-tag-form-grid {");
    expect(css).toContain(".studio-tag-form-actions {");
    expect(css).not.toContain(".studio-tag-manager .studio-tag-form {");
  });

  it("双端 Tag 目录与独立 TDesign 编辑对话框分离，不再把完整表单塞进侧栏", () => {
    const css = readRelative("../../tailwind/src/studio.css");
    expect(css).toContain(".studio-tag-item {");
    expect(css).toContain(".studio-tag-form-grid {");
    expect(css).toContain(".studio-tag-form-error {");
    expect(css).toContain(".studio-tag-field-error {");
    expect(css).not.toContain(".studio-tag-manager .studio-tag-form {");

    for (const [path, dialogProp] of [
      ["../../../apps/web-react/src/studio/TagManager.tsx", 'dialogClassName="studio-tag-dialog"'],
      ["../../../apps/web-vue/src/studio/TagManager.vue", 'dialog-class-name="studio-tag-dialog"'],
    ]) {
      const source = readRelative(path);
      expect(source).toContain("studio-tag-search");
      expect(source).toContain("studio-tag-list");
      expect(source).toContain("studio-tag-form-grid");
      expect(source).toContain("studio-tag-field-error");
      expect(source).toContain(dialogProp);
      expect(source).toContain("confirmStudioAction");
    }
  });

  it("字号与间距保留统一刻度，长标识和数据可以折行且无强制外部字体", () => {
    const tokens = readTheme("tokens.css");
    for (const declaration of [
      "--adui-font-size-xs: 12px;",
      "--adui-font-size-sm: 13px;",
      "--adui-font-size-xl: 18px;",
      "--adui-space-3: 6px;",
      "--adui-space-4: 8px;",
      "--adui-space-5: 12px;",
      "--adui-space-8: 24px;",
      "--adui-line-height-normal: 1.5;",
    ]) {
      expect(tokens).toContain(declaration);
    }
    const css = readRelative("../src/runtime.css");
    expect(css).toContain("overflow-wrap: anywhere;");
    expect(css).toContain("font-variant-numeric: tabular-nums;");
    expect(css).not.toMatch(/@import\s+url\s*\(/);
  });
});

describe("Pixso 参考工作台", () => {
  it("只提供真实入口并根据名称与说明搜索", () => {
    expect(filterWorkspaceHomeEntries("  ")).toEqual(WORKSPACE_HOME_ENTRIES);
    expect(WORKSPACE_HOME_ENTRIES.map((entry) => entry.view)).toEqual([
      "studio",
      "runtime",
      "published",
    ]);
    expect(filterWorkspaceHomeEntries("TAG").map((entry) => entry.view)).toEqual(["studio"]);
    expect(filterWorkspaceHomeEntries("不存在的工程")).toEqual([]);
    expect(WORKSPACE_HOME_ENTRIES[0]?.preview).toContain("data:image/svg+xml");
    expect(WORKSPACE_HOME_ENTRIES[2]?.preview).toBeUndefined();
  });

  it("双端复用工作台数据和搜索并保留真实静态预览", () => {
    for (const path of [
      "../../../apps/web-react/src/App.tsx",
      "../../../apps/web-vue/src/App.vue",
    ]) {
      const source = readRelative(path);
      expect(source).toContain("WORKSPACE_HOME_ENTRIES");
      expect(source).toContain("filterWorkspaceHomeEntries");
      expect(source).toContain("scada-home-quick-grid");
      expect(source).toContain("scada-home-banner-grid");
      expect(source).toContain("createWorkspaceDraft");
      expect(source).toContain("readWorkspaceJson");
      expect(source).toContain("listWorkspaceDrafts");
      expect(source).toContain("readWorkspaceDraft");
      expect(source).toContain("内置水处理工程静态预览，无实时值");
    }
    const css = readRelative("../src/runtime.css");
    expect(css).toContain(".scada-home-thumbnail");
    expect(css).toContain("aspect-ratio: 16 / 9;");
    expect(readTheme("tokens.css")).toContain("--adui-color-brand: #5b2b82;");
  });
});
