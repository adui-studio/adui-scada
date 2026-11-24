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

/** 参考 TDesign 官网主题切换：原生整页 View Transition，旧浏览器和减少动效设置直接切换。 */
export async function transitionWorkspaceTheme(
  mode: WorkspaceThemeMode,
  commit: () => void | Promise<void>,
): Promise<void> {
  const root = document.documentElement;
  if (root.getAttribute("theme-mode") === mode || root.hasAttribute("data-theme-transition")) return;

  const update = async () => {
    applyWorkspaceTheme(mode);
    await commit();
  };
  if (
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    await update();
    return;
  }

  root.setAttribute("data-theme-transition", "");
  try {
    const transition = document.startViewTransition(update);
    // 跳过动画时 ready 可能拒绝，避免产生未处理的 Promise。
    void transition.ready.catch(() => {});
    await transition.updateCallbackDone;
    // 浏览器可因窗口不可见等原因跳过动画，主题状态仍已提交。
    await transition.finished.catch(() => {});
  } finally {
    root.removeAttribute("data-theme-transition");
  }
}
