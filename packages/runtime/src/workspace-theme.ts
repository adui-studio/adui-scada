/** 应用外壳主题属于本机界面偏好，不进入工程 Schema 或草稿。 */
export type WorkspaceThemeMode = "light" | "dark";

const THEME_KEY = "adui-scada:theme-mode";

export function normalizeWorkspaceTheme(value: unknown): WorkspaceThemeMode {
  return value === "dark" ? "dark" : "light";
}

export function readWorkspaceTheme(): WorkspaceThemeMode {
  try {
    return normalizeWorkspaceTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    return "light";
  }
}

/** 根元素统一驱动 TDesign 弹层及全应用 CSS，存储失败不影响本次切换。 */
export function applyWorkspaceTheme(mode: WorkspaceThemeMode): void {
  document.documentElement.setAttribute("theme-mode", mode);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", mode === "dark" ? "#111827" : "#EDF1F5");
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {
    // 浏览器可能禁用本地存储，本次界面仍正常使用。
  }
}
