import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const themeRoot = new URL("../../theme/src/", import.meta.url);
const readTheme = (name: string) => readFileSync(new URL(name, themeRoot), "utf8");

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
});
