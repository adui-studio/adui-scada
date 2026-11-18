import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  clickBrowserControlInPage,
  enableAutoSaveInPage,
  enterStudioInPage,
  inspectStudioState,
  installAccessDenialFaultInPage,
  openProjectInPage,
  pageStateInPage,
  resolveProjectBrowserLab,
  saveDraftInPage,
  triggerSaveTimingInPage,
  waitForStudioActionIdleInPage,
} from "./test-project-browser-oidc.mjs";
import {
  appendCasVersionInPage,
  createCasProjectInPage,
  identityInPage,
  readCasProjectInPage,
  waitForLogin,
} from "./test-oidc-dual-cas.mjs";
import { readStudioContentCanvasInPage } from "./test-oidc-studio-real-late.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const LOOPBACK = "127.0.0.1";
const PROJECT_PREFIX = "b34-oidc-cas-";
const SAFE_PHASES = new Set([
  "本机环境核验",
  "隔离浏览器启动",
  "真实 OIDC 登录",
  "专用工程创建",
  "双框架标签页认证",
  "React 跟随标签页载入",
  "Vue 跟随标签页载入",
  "React 标签页版本水位复核",
  "React 会话基线恢复",
  "Vue 标签页版本水位复核",
  "React 标签页二次水位复核",
  "最终版本只读核验",
  "共享会话注销",
  "React 标签页身份失效复核",
  "Vue 标签页身份失效复核",
]);

const SAFE_ERRORS = new Set([
  "真实多标签页测试必须显式确认本机隔离数据库",
  "真实多标签页测试只允许本机隔离数据库",
  "真实多标签页测试参数不合法",
  "本机 Web 服务未就绪",
  "未找到本机 Chrome 或 Edge 浏览器",
  "浏览器调试端口未就绪",
  "浏览器调试标签页无法创建",
  "浏览器调试命令执行失败",
  "浏览器页面操作失败",
  "真实 OIDC 登录未完成",
  "专用工程创建失败",
  "四个标签页未共享同一 BFF 身份",
  "工程列表未显示本轮专用工程",
  "工程列表刷新失败",
  "工程列表翻页失败",
  "Studio 入口不可用",
  "Studio 工程载入失败",
  "Studio CAS 基线与预期不一致",
  "真实标签页没有发生可见性切换",
  "标签页恢复未触发 CAS 水位复核",
  "标签页恢复改变了本地画布",
  "标签页恢复改变了 IndexedDB 草稿",
  "标签页恢复改变了自动保存状态",
  "标签页恢复尝试了工程写入",
  "真实工程版本或摘要核验失败",
  "本地会话注销未返回 HTTP 204",
  "注销后隐藏标签页状态提前变化",
  "注销后标签页身份未失效",
  "注销后服务端 CAS 基线未失效",
  "注销后标签页尝试工程写入",
]);

export function resolveMultiTabMode(args, env) {
  if (
    !Array.isArray(args) ||
    args.length !== 3 ||
    args[0] !== "--run-multitab" ||
    args[1] !== "--confirm-lab"
  ) {
    throw new Error("真实多标签页测试必须显式确认本机隔离数据库");
  }

  let databaseName = "";
  try {
    const databaseUrl = new URL(env.SCADA_DATABASE_URL);
    if (
      databaseUrl.protocol === "postgresql:" &&
      databaseUrl.hostname === LOOPBACK &&
      databaseUrl.port === String(env.SCADA_LAB_POSTGRES_PORT)
    ) {
      databaseName = databaseUrl.pathname.replace(/^\//, "");
    }
  } catch {
    throw new Error("真实多标签页测试只允许本机隔离数据库");
  }

  if (!["adui_scada", "adui_scada_oidc_lab"].includes(databaseName) || args[2] !== databaseName) {
    throw new Error("真实多标签页测试只允许本机隔离数据库");
  }
  return { databaseName };
}

export function installMultiTabVisibilityProbeInPage(runtime = globalThis) {
  if (runtime.__aduiMultiTabVisibilityProbe) return true;
  const state = { visibleEvents: 0, hiddenEvents: 0 };
  runtime.__aduiMultiTabVisibilityProbe = state;
  runtime.document.addEventListener("visibilitychange", () => {
    if (runtime.document.visibilityState === "visible") state.visibleEvents += 1;
    else if (runtime.document.visibilityState === "hidden") state.hiddenEvents += 1;
  });
  return true;
}

export function visibilityProbeStateInPage(runtime = globalThis) {
  const state = runtime.__aduiMultiTabVisibilityProbe;
  return {
    visibility: runtime.document.visibilityState,
    visibleEvents: state?.visibleEvents ?? 0,
    hiddenEvents: state?.hiddenEvents ?? 0,
  };
}

export function requireVisibleTransition(before, after) {
  if (
    !before ||
    !after ||
    after.visibility !== "visible" ||
    (before.visibility !== "visible" && after.visibleEvents <= before.visibleEvents)
  ) {
    throw new Error("真实标签页没有发生可见性切换");
  }
  return true;
}

export function requireSamePrincipal(expected, actual) {
  if (
    !expected ||
    !actual ||
    typeof expected.tenantId !== "string" ||
    typeof expected.subjectId !== "string" ||
    expected.tenantId !== actual.tenantId ||
    expected.subjectId !== actual.subjectId
  ) {
    throw new Error("四个标签页未共享同一 BFF 身份");
  }
  return true;
}

export async function readAuthStatusInPage(expectedOrigin, runtime = globalThis) {
  if (runtime.location.origin !== expectedOrigin) return 0;
  try {
    const response = await runtime.fetch("/api/v1/auth/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    return response.status;
  } catch {
    return 0;
  }
}

export function readMultiTabSessionStateInPage(runtime = globalThis) {
  const panel = runtime.document.querySelector('[aria-label="服务端工程版本"]');
  const text = panel?.textContent ?? "";
  const bodyText = runtime.document.body?.textContent ?? "";
  const noticeText = runtime.document.querySelector(".studio-notice")?.textContent ?? "";
  const alertText = panel?.querySelector('[role="alert"]')?.textContent ?? "";
  const buttons = [...(panel?.querySelectorAll("button") ?? [])];
  const revision = text.match(/CAS 基线：\s*(\d+)/);
  let errorCategory = "none";
  if (alertText) {
    errorCategory = alertText.includes("访问已失效")
      ? "access"
      : alertText.includes("登录") || alertText.includes("身份")
        ? "identity"
        : alertText.includes("版本") || alertText.includes("冲突") || alertText.includes("CAS")
          ? "conflict"
          : alertText.includes("网络")
            ? "network"
            : "other";
  }
  return {
    baselineRevision: revision ? Number(revision[1]) : null,
    baselineCleared: /CAS 基线：\s*未建立/.test(text),
    headCleared: /服务端最新修订号：\s*未查询/.test(text),
    recoveryAvailable: buttons.some((button) => button.textContent.trim() === "只读预览最新版本"),
    resumeConflictVisible:
      noticeText.includes("标签页恢复校验发现变更") || bodyText.includes("标签页恢复校验发现变更"),
    identityVerified: text.includes("服务端身份已验证"),
    identityRejected:
      text.includes("未登录或服务端尚未启用身份接口") ||
      text.includes("服务端身份或工程授权已变化"),
    hasError: Boolean(alertText),
    errorCategory,
    busy: [...(panel?.querySelectorAll(".studio-version-help") ?? [])].some((node) =>
      node.textContent?.includes("正在处理工程版本"),
    ),
    writeAttempts: runtime.__aduiTestAccessDenial?.writeAttempts ?? -1,
  };
}

export function triggerIdentityCheckInPage(runtime = globalThis) {
  const panel = runtime.document.querySelector('[aria-label="服务端工程版本"]');
  const button = [...(panel?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "检查登录",
  );
  if (!button || button.disabled) throw new Error("Studio 工程载入失败");
  button.click();
  return true;
}

export async function logoutCurrentSessionInPage(expectedOrigin, runtime = globalThis) {
  if (runtime.location.origin !== expectedOrigin) {
    throw new Error("本地会话注销未返回 HTTP 204");
  }
  const matches = runtime.document.cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("__Host-adui-scada-csrf="));
  const csrf = matches.length === 1 ? matches[0].slice("__Host-adui-scada-csrf=".length) : "";
  if (!/^scada_csrf_[A-Za-z0-9_-]{43}$/.test(csrf)) {
    throw new Error("本地会话注销未返回 HTTP 204");
  }
  const response = await runtime.fetch("/api/v1/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: { "X-SCADA-CSRF": csrf },
  });
  if (response.status !== 204) throw new Error("本地会话注销未返回 HTTP 204");
  return { status: 204 };
}

export function openProjectBrowserMenuInPage(runtime = globalThis) {
  const panel = runtime.document.querySelector(".studio-project-browser-panel");
  const menu = panel?.closest("details");
  if (!panel || !menu) throw new Error("工程列表刷新失败");
  menu.open = true;
  return true;
}

export function refreshProjectListInPage(runtime = globalThis) {
  const panel = runtime.document.querySelector(".studio-project-browser-panel");
  const button = [...(panel?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "刷新",
  );
  if (!button || button.disabled) throw new Error("工程列表刷新失败");
  button.click();
  return true;
}

export function requireSameCanvasAndDrafts(before, after) {
  if (!before || !after || before.canvas !== after.canvas) {
    throw new Error("标签页恢复改变了本地画布");
  }
  if (before.drafts?.count !== after.drafts?.count || before.drafts?.hash !== after.drafts?.hash) {
    throw new Error("标签页恢复改变了 IndexedDB 草稿");
  }
  return true;
}

export function requireUnchangedStudioState(before, after) {
  requireSameCanvasAndDrafts(before, after);
  if (before.autoSave !== after.autoSave) {
    throw new Error("标签页恢复改变了自动保存状态");
  }
  return true;
}

export function describeMultiTabFailure(error) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("真实多标签页专项失败阶段：")) {
    const phase = message.slice("真实多标签页专项失败阶段：".length);
    if (SAFE_PHASES.has(phase)) return message;
  }
  return SAFE_ERRORS.has(message) ? message : "真实多标签页 OIDC 安全专项失败（已脱敏）";
}

function browserExecutable() {
  const root = process.env.PROGRAMFILES || "C:\\Program Files";
  const x86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  return [
    process.env.SCADA_BROWSER_PATH,
    join(root, "Google", "Chrome", "Application", "chrome.exe"),
    join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(x86, "Google", "Chrome", "Application", "chrome.exe"),
    join(x86, "Microsoft", "Edge", "Application", "msedge.exe"),
  ].find((path) => path && existsSync(path));
}

async function waitForDebugPort(profile, child) {
  const file = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("浏览器调试端口未就绪");
    if (existsSync(file)) {
      const port = Number(readFileSync(file, "utf8").trim().split(/\r?\n/)[0]);
      if (Number.isSafeInteger(port) && port > 0 && port <= 65535) return port;
    }
    await pause(100);
  }
  throw new Error("浏览器调试端口未就绪");
}

class ChromeSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error("浏览器调试命令执行失败"));
      else pending.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("浏览器调试命令执行失败"));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error("浏览器调试命令执行失败"));
      }, 15000);
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(action, ...args) {
    const expression =
      "(" +
      action.toString() +
      ")(" +
      args.map((argument) => JSON.stringify(argument)).join(",") +
      ")";
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error("浏览器页面操作失败");
    return result.result?.value;
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // 清理阶段不覆盖原始测试结果。
    }
  }
}

async function createBrowserTab(port) {
  const response = await fetch("http://" + LOOPBACK + ":" + port + "/json/new?about:blank", {
    method: "PUT",
  });
  if (!response.ok) throw new Error("浏览器调试标签页无法创建");
  const target = await response.json();
  if (typeof target.webSocketDebuggerUrl !== "string") {
    throw new Error("浏览器调试标签页无法创建");
  }
  const socketUrl = new URL(target.webSocketDebuggerUrl);
  if (
    socketUrl.protocol !== "ws:" ||
    ![LOOPBACK, "localhost"].includes(socketUrl.hostname) ||
    Number(socketUrl.port) !== port
  ) {
    throw new Error("浏览器调试标签页无法创建");
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => rejectOpen(new Error("浏览器调试标签页无法创建")), {
      once: true,
    });
  });
  const session = new ChromeSession(socket);
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  return session;
}

export async function installPageProbes(session, blockProjectWrites) {
  const source = [
    "(" + installMultiTabVisibilityProbeInPage.toString() + ")();",
    blockProjectWrites ? "(" + installAccessDenialFaultInPage.toString() + ")();" : "",
  ]
    .filter(Boolean)
    .join("\n");
  await session.send("Page.addScriptToEvaluateOnNewDocument", { source });
  // 新文档注入不会执行于现有 about:blank，首次切换前需要立即安装探针。
  await session.evaluate(installMultiTabVisibilityProbeInPage);
}

async function waitFor(task, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await task();
      if (result) return result;
    } catch {
      // 页面导航或响应式渲染期间的瞬时 CDP 状态由下一轮读取处理。
    }
    await pause(100);
  }
  throw new Error(label);
}

async function activateTab(session, label) {
  const before = await session.evaluate(visibilityProbeStateInPage);
  await session.send("Page.bringToFront");
  const after = await waitFor(async () => {
    const current = await session.evaluate(visibilityProbeStateInPage);
    if (current.visibility !== "visible") return null;
    if (before.visibility !== "visible" && current.visibleEvents <= before.visibleEvents) {
      return null;
    }
    return current;
  }, label);
  requireVisibleTransition(before, after);
  return after;
}

async function requireHiddenTab(session, label) {
  return waitFor(async () => {
    const state = await session.evaluate(visibilityProbeStateInPage);
    return state.visibility === "hidden" ? state : null;
  }, label);
}

async function activateHiddenTab(session, label) {
  await requireHiddenTab(session, label);
  return activateTab(session, label);
}

async function waitForAuthenticated(session, origin) {
  return waitFor(() => session.evaluate(identityInPage, origin), "真实 OIDC 登录未完成", 30000);
}

async function findProjectInList(session, projectId, expectedRevision) {
  await session.evaluate(openProjectBrowserMenuInPage);
  await waitFor(async () => {
    const state = await session.evaluate(pageStateInPage);
    return state && !state.busy ? state : null;
  }, "工程列表刷新失败");
  await session.evaluate(refreshProjectListInPage);
  let page = await waitFor(async () => {
    const state = await session.evaluate(pageStateInPage);
    return state && !state.busy ? state : null;
  }, "工程列表刷新失败");
  if (page.error) throw new Error("工程列表刷新失败");

  for (let index = 0; index < 100; index += 1) {
    const projectIndex = page.ids.indexOf(projectId);
    if (projectIndex >= 0) {
      if (page.revisions[projectIndex] !== expectedRevision) {
        throw new Error("真实工程版本或摘要核验失败");
      }
      return true;
    }
    if (!page.nextEnabled) break;
    const previousPage = page.pageNumber;
    if (!(await session.evaluate(clickBrowserControlInPage, "next"))) break;
    page = await waitFor(async () => {
      const state = await session.evaluate(pageStateInPage);
      return state && !state.busy && state.pageNumber > previousPage ? state : null;
    }, "工程列表翻页失败");
    if (page.error) throw new Error("工程列表刷新失败");
  }
  throw new Error("工程列表未显示本轮专用工程");
}

async function openStudioProject(session, projectId, revision) {
  if (!(await session.evaluate(enterStudioInPage))) throw new Error("Studio 入口不可用");
  await findProjectInList(session, projectId, revision);
  const opened = await session.evaluate(openProjectInPage, projectId, revision, "confirm");
  if (
    opened?.outcome !== "confirm" ||
    opened.confirmCount !== 1 ||
    opened.intercepted !== 0 ||
    !(await session.evaluate(waitForStudioActionIdleInPage))
  ) {
    throw new Error("Studio 工程载入失败");
  }
  const state = await session.evaluate(readMultiTabSessionStateInPage);
  if (state.baselineRevision !== revision) throw new Error("Studio CAS 基线与预期不一致");
  return state;
}

async function inspectProtectedState(session) {
  const [state, canvas] = await Promise.all([
    inspectStudioState(session),
    session.evaluate(readStudioContentCanvasInPage),
  ]);
  return { ...state, canvas };
}

export async function prepareFollowerDraft(session) {
  if (!(await session.evaluate(saveDraftInPage))) throw new Error("Studio 工程载入失败");
  if (!(await session.evaluate(enableAutoSaveInPage))) throw new Error("Studio 工程载入失败");
  const state = await inspectProtectedState(session);
  if (!state.drafts || state.drafts.count < 1 || state.autoSave !== true) {
    throw new Error("Studio 工程载入失败");
  }
  return state;
}

async function restoreLatestBaseline(session, projectId, revision, previousState) {
  await findProjectInList(session, projectId, revision);
  const opened = await session.evaluate(openProjectInPage, projectId, revision, "confirm");
  if (
    opened?.outcome !== "confirm" ||
    opened.confirmCount !== 1 ||
    opened.intercepted !== 0 ||
    !(await session.evaluate(waitForStudioActionIdleInPage))
  ) {
    throw new Error("Studio 工程载入失败");
  }
  const loaded = await inspectProtectedState(session);
  requireSameCanvasAndDrafts(previousState, loaded);
  if (loaded.autoSave !== false) throw new Error("标签页恢复改变了自动保存状态");
  if (!(await session.evaluate(enableAutoSaveInPage))) throw new Error("Studio 工程载入失败");
  const resumed = await inspectProtectedState(session);
  requireSameCanvasAndDrafts(previousState, resumed);
  if (resumed.autoSave !== true) throw new Error("标签页恢复改变了自动保存状态");
  const state = await session.evaluate(readMultiTabSessionStateInPage);
  if (state.baselineRevision !== revision || state.writeAttempts !== 0) {
    throw new Error("Studio CAS 基线与预期不一致");
  }
  return resumed;
}

async function waitForVersionDrift(session) {
  const state = await waitFor(async () => {
    const current = await session.evaluate(readMultiTabSessionStateInPage);
    return !current.busy &&
      current.baselineCleared &&
      current.headCleared &&
      current.recoveryAvailable &&
      current.resumeConflictVisible
      ? current
      : null;
  }, "标签页恢复未触发 CAS 水位复核");
  if (state.writeAttempts !== 0) throw new Error("标签页恢复尝试了工程写入");
  return state;
}

async function verifyIdentityCheck(session, expectedAuthenticated) {
  if (!(await session.evaluate(triggerIdentityCheckInPage))) {
    throw new Error("标签页恢复未触发 CAS 水位复核");
  }
  const state = await waitFor(async () => {
    const current = await session.evaluate(readMultiTabSessionStateInPage);
    if (expectedAuthenticated) {
      return current.identityVerified && !current.hasError && !current.busy ? current : null;
    }
    return current.identityRejected && current.hasError && !current.busy ? current : null;
  }, "标签页恢复未触发 CAS 水位复核");
  if (state.writeAttempts !== 0) throw new Error("标签页恢复尝试了工程写入");
  return state;
}

async function requireSaveRefusedWithoutProjectWrite(session) {
  const before = await session.evaluate(readMultiTabSessionStateInPage);
  if (before.busy) throw new Error("标签页恢复尝试了工程写入");
  if (!(await session.evaluate(triggerSaveTimingInPage))) {
    throw new Error("标签页恢复尝试了工程写入");
  }
  const after = await waitFor(async () => {
    const current = await session.evaluate(readMultiTabSessionStateInPage);
    if (current.writeAttempts > 0) return current;
    const started =
      current.busy || !current.hasError || current.errorCategory !== before.errorCategory;
    if (!started || current.busy || !current.hasError) return null;
    return current;
  }, "标签页恢复未触发 CAS 水位复核");
  if (
    after.writeAttempts !== 0 ||
    !after.baselineCleared ||
    after.errorCategory === before.errorCategory
  ) {
    throw new Error("标签页恢复尝试了工程写入");
  }
  return after;
}

async function verifyVersionDrift(session, beforeState) {
  await waitForVersionDrift(session);
  const afterResume = await inspectProtectedState(session);
  requireUnchangedStudioState(beforeState, afterResume);
  await verifyIdentityCheck(session, true);
  await requireSaveRefusedWithoutProjectWrite(session);
  const afterSave = await inspectProtectedState(session);
  requireUnchangedStudioState(beforeState, afterSave);
}

async function verifyLogoutRevalidation(session, origin, beforeState) {
  const state = await waitFor(async () => {
    const current = await session.evaluate(readMultiTabSessionStateInPage);
    return !current.busy &&
      current.baselineCleared &&
      current.headCleared &&
      current.identityRejected
      ? current
      : null;
  }, "注销后服务端 CAS 基线未失效");
  if (state.writeAttempts !== 0) throw new Error("注销后标签页尝试工程写入");
  const authStatus = await session.evaluate(readAuthStatusInPage, origin);
  if (authStatus !== 401) throw new Error("注销后标签页身份未失效");
  const afterResume = await inspectProtectedState(session);
  requireUnchangedStudioState(beforeState, afterResume);
  await requireSaveRefusedWithoutProjectWrite(session);
  const afterSave = await inspectProtectedState(session);
  requireUnchangedStudioState(beforeState, afterSave);
}

async function run() {
  if (existsSync(ROOT_ENV)) loadEnvFile(ROOT_ENV);
  resolveMultiTabMode(process.argv.slice(2), process.env);
  if (process.env.NODE_ENV === "production") {
    throw new Error("真实多标签页测试参数不合法");
  }

  const origins = resolveProjectBrowserLab(process.env);
  if (!origins || origins.length !== 2) throw new Error("真实多标签页测试参数不合法");
  const reactOrigin = origins[0];
  const vueOrigin = origins[1];
  const reactUrl = new URL(reactOrigin);
  const vueUrl = new URL(vueOrigin);
  if (
    reactUrl.hostname !== LOOPBACK ||
    vueUrl.hostname !== LOOPBACK ||
    reactUrl.hostname !== vueUrl.hostname ||
    reactUrl.port === vueUrl.port
  ) {
    throw new Error("真实多标签页测试参数不合法");
  }

  let phase = "本机环境核验";
  let profile;
  let child;
  const sessions = [];
  try {
    for (const origin of origins) {
      const response = await fetch(origin + "/", { redirect: "error" });
      if (!response.ok || response.url !== origin + "/") {
        throw new Error("本机 Web 服务未就绪");
      }
    }

    phase = "隔离浏览器启动";
    const executable = browserExecutable();
    if (!executable) throw new Error("未找到本机 Chrome 或 Edge 浏览器");
    profile = mkdtempSync(join(tmpdir(), "adui-scada-oidc-multitab-"));
    child = spawn(
      executable,
      [
        "--no-first-run",
        "--no-default-browser-check",
        "--no-proxy-server",
        "--remote-debugging-port=0",
        "--user-data-dir=" + profile,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const port = await waitForDebugPort(profile, child);
    const tabs = {};
    const definitions = [
      ["reactWriter", false],
      ["reactFollower", true],
      ["vueWriter", false],
      ["vueFollower", true],
    ];
    for (const [name, blockWrites] of definitions) {
      const session = await createBrowserTab(port);
      sessions.push(session);
      tabs[name] = session;
      await installPageProbes(session, blockWrites);
    }

    phase = "真实 OIDC 登录";
    await activateTab(tabs.reactWriter, "真实标签页没有发生可见性切换");
    const principal = await waitForLogin(tabs.reactWriter, reactOrigin, "本次测试");

    phase = "专用工程创建";
    const projectId = PROJECT_PREFIX + randomUUID();
    if (!(await tabs.reactWriter.evaluate(createCasProjectInPage, reactOrigin, projectId))) {
      throw new Error("专用工程创建失败");
    }

    phase = "双框架标签页认证";
    const followerDefinitions = [
      [tabs.reactFollower, reactOrigin],
      [tabs.vueWriter, vueOrigin],
      [tabs.vueFollower, vueOrigin],
    ];
    for (const [session, origin] of followerDefinitions) {
      await session.send("Page.navigate", { url: origin + "/" });
      await activateTab(session, "真实标签页没有发生可见性切换");
      const currentPrincipal = await waitForAuthenticated(session, origin);
      requireSamePrincipal(principal, currentPrincipal);
    }
    process.stdout.write("四个标签页已验证为同一 BFF 主体，开始 React/Vue Studio 工程复核。\n");

    phase = "React 跟随标签页载入";
    await openStudioProject(tabs.reactFollower, projectId, 1);
    // CAS 状态摘要不是本地画布快照；草稿初始化完成后才建立保护基准。
    const reactDraft = await prepareFollowerDraft(tabs.reactFollower);

    phase = "Vue 跟随标签页载入";
    await openStudioProject(tabs.vueFollower, projectId, 1);
    const vueDraft = await prepareFollowerDraft(tabs.vueFollower);

    phase = "React 标签页版本水位复核";
    await activateTab(tabs.reactWriter, "真实标签页没有发生可见性切换");
    const revisionTwo = await tabs.reactWriter.evaluate(
      appendCasVersionInPage,
      reactOrigin,
      projectId,
      1,
    );
    if (revisionTwo.status !== 201 || revisionTwo.revision !== 2) {
      throw new Error("真实工程版本或摘要核验失败");
    }
    const revisionTwoRead = await tabs.reactWriter.evaluate(
      readCasProjectInPage,
      reactOrigin,
      projectId,
      2,
    );
    if (revisionTwoRead.revision !== 2) throw new Error("真实工程版本或摘要核验失败");
    await activateHiddenTab(tabs.reactFollower, "真实标签页没有发生可见性切换");
    await verifyVersionDrift(tabs.reactFollower, reactDraft);

    phase = "React 会话基线恢复";
    const reactRevisionTwo = await restoreLatestBaseline(
      tabs.reactFollower,
      projectId,
      2,
      reactDraft,
    );

    phase = "Vue 标签页版本水位复核";
    await activateTab(tabs.vueWriter, "真实标签页没有发生可见性切换");
    const revisionThree = await tabs.vueWriter.evaluate(
      appendCasVersionInPage,
      vueOrigin,
      projectId,
      2,
    );
    if (revisionThree.status !== 201 || revisionThree.revision !== 3) {
      throw new Error("真实工程版本或摘要核验失败");
    }
    const revisionThreeRead = await tabs.vueWriter.evaluate(
      readCasProjectInPage,
      vueOrigin,
      projectId,
      3,
    );
    if (revisionThreeRead.revision !== 3) throw new Error("真实工程版本或摘要核验失败");
    await activateHiddenTab(tabs.vueFollower, "真实标签页没有发生可见性切换");
    await verifyVersionDrift(tabs.vueFollower, vueDraft);
    const vueRevisionThree = await restoreLatestBaseline(tabs.vueFollower, projectId, 3, vueDraft);

    phase = "React 标签页二次水位复核";
    await activateHiddenTab(tabs.reactFollower, "真实标签页没有发生可见性切换");
    await verifyVersionDrift(tabs.reactFollower, reactRevisionTwo);
    const reactRevisionThree = await restoreLatestBaseline(
      tabs.reactFollower,
      projectId,
      3,
      reactRevisionTwo,
    );

    phase = "最终版本只读核验";
    const latest = await tabs.vueWriter.evaluate(readCasProjectInPage, vueOrigin, projectId, 3);
    if (latest.revision !== 3) throw new Error("真实工程版本或摘要核验失败");

    phase = "共享会话注销";
    await activateTab(tabs.reactWriter, "真实标签页没有发生可见性切换");
    await requireHiddenTab(tabs.reactFollower, "真实标签页没有发生可见性切换");
    await requireHiddenTab(tabs.vueFollower, "真实标签页没有发生可见性切换");
    const logout = await tabs.reactWriter.evaluate(logoutCurrentSessionInPage, reactOrigin);
    if (logout.status !== 204) throw new Error("本地会话注销未返回 HTTP 204");

    const hiddenReact = await tabs.reactFollower.evaluate(readMultiTabSessionStateInPage);
    const hiddenVue = await tabs.vueFollower.evaluate(readMultiTabSessionStateInPage);
    if (
      hiddenReact.baselineRevision !== 3 ||
      hiddenVue.baselineRevision !== 3 ||
      hiddenReact.identityRejected ||
      hiddenVue.identityRejected
    ) {
      throw new Error("注销后隐藏标签页状态提前变化");
    }

    phase = "React 标签页身份失效复核";
    await activateHiddenTab(tabs.reactFollower, "真实标签页没有发生可见性切换");
    await verifyLogoutRevalidation(tabs.reactFollower, reactOrigin, reactRevisionThree);

    phase = "Vue 标签页身份失效复核";
    await activateHiddenTab(tabs.vueFollower, "真实标签页没有发生可见性切换");
    await verifyLogoutRevalidation(tabs.vueFollower, vueOrigin, vueRevisionThree);

    process.stdout.write(
      "真实多标签页专项通过：React/Vue 跟随标签页均通过真实可见性切换发现远端版本推进与共享会话注销；本地画布、IndexedDB 草稿和自动保存保持不变，旧 CAS 保存未产生工程写入。专用工程保留供维护者复核。\n",
    );
  } catch (error) {
    if (error instanceof Error && SAFE_ERRORS.has(error.message)) throw error;
    throw new Error("真实多标签页专项失败阶段：" + phase);
  } finally {
    for (const session of sessions.reverse()) session.close();
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise((resolveExit) => child.once("exit", resolveExit)),
        pause(2000),
      ]);
    }
    if (profile) {
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      } catch {
        // 清理失败不回显隔离 Profile 路径。
      }
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeMultiTabFailure(error) + "\n");
    process.exitCode = 1;
  });
}
