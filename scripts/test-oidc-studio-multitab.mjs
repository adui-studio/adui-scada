import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolveLabIdentityTarget } from "./oidc-lab-identity.mjs";
import {
  executablePath,
  identityInPage,
  startBrowser,
  waitForLogin,
} from "./test-oidc-dual-cas.mjs";
import {
  clickBrowserControlInPage,
  confirmPreviewedServerVersionInPage,
  conflictPreviewStateInPage,
  describeBrowserPageException,
  enableAutoSaveInPage,
  enterStudioInPage,
  inspectStudioState,
  openProjectInPage,
  pageStateInPage,
  resolveProjectBrowserLab,
  saveDraftInPage,
  triggerConflictPreviewInPage,
  waitForStudioActionIdleInPage,
} from "./test-project-browser-oidc.mjs";
import { readStudioContentCanvasInPage } from "./test-oidc-studio-real-late.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const LOOPBACK = "127.0.0.1";
const PROJECT_PATTERN =
  /^b34-oidc-multitab-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_ERRORS = new Set([
  "同源多标签页专项必须显式确认本机隔离 Lab",
  "未找到本机 Chrome/Edge 浏览器",
  "本机可信 HTTPS Web 服务未就绪",
  "同源多标签页第二个标签页创建失败",
  "同源多标签页浏览器调试连接失败",
  "同源多标签页页面操作失败",
  "同源多标签页标签页可见性切换失败",
  "同源多标签页工程创建失败",
  "同源多标签页写入保护配置不合法",
  "同源多标签页工程列表未找到专用工程",
  "同源多标签页服务端保存状态未达到预期",
  "同源多标签页本地草稿未按预期变化",
  "同源多标签页 CAS 状态未正确失效",
  "同源多标签页数据库版本与审计不一致",
  "同源多标签页两标签身份不一致",
]);

export function parseStudioMultiTabMode(args) {
  if (
    args.length === 3 &&
    args[0] === "--run-studio-multitab" &&
    args[1] === "--confirm-lab" &&
    args[2] === "adui_scada"
  ) {
    return true;
  }
  throw new Error("同源多标签页专项必须显式确认本机隔离 Lab");
}

export function describeStudioMultiTabFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  if (error?.pageDiagnostic) return "同源多标签页浏览器页面执行失败（已脱敏）";
  if (error?.code === "ECONNREFUSED") return "本机 Web 或浏览器调试端口未监听";
  return "同源多标签页 CAS 专项未通过，内部错误详情已脱敏";
}

/** 只为本轮随机测试工程创建首版，不接触任何既有工程。 */
export async function createMultitabProjectInPage(origin, projectId, runtime = globalThis) {
  if (
    runtime.location.origin !== origin ||
    !/^b34-oidc-multitab-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      projectId,
    )
  ) {
    throw new Error("同源多标签页工程创建失败");
  }
  const cookies = runtime.document.cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("__Host-adui-scada-csrf="));
  const csrf = cookies.length === 1 ? cookies[0].slice("__Host-adui-scada-csrf=".length) : "";
  if (!/^scada_csrf_[A-Za-z0-9_-]{43}$/.test(csrf)) {
    throw new Error("同源多标签页工程创建失败");
  }
  const document = {
    schemaVersion: "0.3.0",
    projectId,
    tags: [],
    pages: [
      {
        id: "page-main",
        name: "同源多标签页 CAS 验收",
        size: { width: 1920, height: 1080 },
        nodes: [],
      },
    ],
  };
  const response = await runtime.fetch("/api/v1/projects", {
    method: "POST",
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-SCADA-CSRF": csrf,
    },
    body: JSON.stringify({ document }),
  });
  if (response.status !== 201) throw new Error("同源多标签页工程创建失败");
  const created = await response.json();
  if (created.projectId !== projectId || created.headRevision !== 1) {
    throw new Error("同源多标签页工程创建失败");
  }
  return { created: true, headRevision: 1 };
}

/**
 * 每个 Studio 文档加载前安装。工程 GET/HEAD 正常透传，其余工程写请求默认拒绝；
 * 仅允许本轮明确 arm 的单个工程、单个 CAS 修订号追加一次真实 POST。
 */
export function installStudioMultiTabWriteGuardInPage(expectedOrigin, runtime = globalThis) {
  if (
    runtime.location.origin !== expectedOrigin ||
    runtime.__aduiTestStudioMultiTab !== undefined
  ) {
    throw new Error("同源多标签页写入保护配置不合法");
  }
  const actualFetch = runtime.fetch.bind(runtime);
  const state = {
    writeAttempts: 0,
    acceptedWrites: 0,
    rejectedWrites: 0,
    allowed: null,
  };
  runtime.__aduiTestStudioMultiTab = state;
  runtime.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw, runtime.location.href);
    const method = (
      init?.method ?? (typeof input === "string" ? "GET" : input.method)
    ).toUpperCase();
    const projectPath =
      url.pathname === "/api/v1/projects" || url.pathname.startsWith("/api/v1/projects/");
    if (!projectPath || method === "GET" || method === "HEAD") {
      return actualFetch(input, init);
    }

    state.writeAttempts += 1;
    const reject = () => {
      state.rejectedWrites += 1;
      return new Response("{}", {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    };
    const allowed = state.allowed;
    if (
      !allowed ||
      allowed.used ||
      method !== "POST" ||
      url.origin !== expectedOrigin ||
      url.pathname !== "/api/v1/projects/" + encodeURIComponent(allowed.projectId) + "/versions" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return reject();
    }

    let request;
    let csrf;
    try {
      request = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const cookies = runtime.document.cookie
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.startsWith("__Host-adui-scada-csrf="));
      csrf = cookies.length === 1 ? cookies[0].slice("__Host-adui-scada-csrf=".length) : "";
      const header = new Headers(init?.headers).get("X-SCADA-CSRF");
      if (
        request?.expectedRevision !== allowed.expectedRevision ||
        request?.document?.projectId !== allowed.projectId ||
        request?.document?.schemaVersion !== "0.3.0" ||
        !/^scada_csrf_[A-Za-z0-9_-]{43}$/.test(csrf) ||
        header !== csrf ||
        init?.credentials !== "same-origin" ||
        init?.mode !== "same-origin"
      ) {
        return reject();
      }
    } catch {
      return reject();
    }

    allowed.used = true;
    allowed.phase = "sent";
    try {
      const response = await actualFetch(input, init);
      if (response.status !== 201) {
        allowed.phase = "failed";
        return response;
      }
      const saved = await response.clone().json();
      if (
        saved?.revision !== allowed.expectedRevision + 1 ||
        !/^[0-9a-f]{64}$/.test(saved.contentHash ?? "")
      ) {
        allowed.phase = "failed";
        return response;
      }
      allowed.phase = "committed";
      allowed.resultRevision = saved.revision;
      allowed.resultHash = saved.contentHash;
      state.acceptedWrites += 1;
      return response;
    } catch {
      allowed.phase = "failed";
      throw new Error("同源多标签页工程写入失败");
    }
  };
  return true;
}

export function armStudioMultiTabWriteInPage(
  origin,
  projectId,
  expectedRevision,
  runtime = globalThis,
) {
  const state = runtime.__aduiTestStudioMultiTab;
  if (
    runtime.location.origin !== origin ||
    !/^b34-oidc-multitab-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      projectId,
    ) ||
    ![1, 2].includes(expectedRevision) ||
    !state ||
    state.allowed !== null
  ) {
    throw new Error("同源多标签页写入保护配置不合法");
  }
  state.allowed = {
    projectId,
    expectedRevision,
    used: false,
    phase: "armed",
    resultRevision: null,
    resultHash: null,
  };
  return true;
}

/** 只返回请求计数、阶段和摘要有效性，不返回工程内容或认证凭据。 */
export function studioMultiTabWriteStateInPage(runtime = globalThis) {
  const state = runtime.__aduiTestStudioMultiTab;
  const allowed = state?.allowed;
  return {
    writeAttempts: state?.writeAttempts ?? -1,
    acceptedWrites: state?.acceptedWrites ?? -1,
    rejectedWrites: state?.rejectedWrites ?? -1,
    phase: allowed?.phase ?? "idle",
    resultRevision: allowed?.resultRevision ?? null,
    resultHash: allowed?.resultHash ?? null,
    hashValid: /^[0-9a-f]{64}$/.test(allowed?.resultHash ?? ""),
    allowedUsed: allowed?.used ?? false,
  };
}

export function addStudioSymbolInPage(label) {
  const button = [...document.querySelectorAll(".studio-add button")].find(
    (item) => item.textContent.trim() === label,
  );
  if (!button) throw new Error("同源多标签页页面操作失败");
  button.click();
  return true;
}

export function clickStudioServerSaveInPage() {
  const panel = document.querySelector('[aria-label="服务端工程版本"]');
  const button = [...(panel?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "保存至服务端",
  );
  if (!button) throw new Error("同源多标签页页面操作失败");
  if (button.disabled) return { clicked: false, disabled: true };
  button.click();
  return { clicked: true, disabled: false };
}

/** 通过现有导出按钮读取工程 JSON 摘要，避免把 SVG 辅助层当成工程数据。 */
export async function readStudioDocumentHashInPage() {
  const menu = document.querySelector(".studio-file-menu");
  const trigger = menu?.querySelector("button.t-button");
  if (trigger?.tagName !== "BUTTON") throw new Error("同源多标签页页面操作失败");
  if (!menu.querySelector(".studio-file-popover")?.getClientRects().length) trigger.click();
  const opened = Date.now();
  while (Date.now() - opened < 5000) {
    if (menu.querySelector(".studio-file-popover")?.getClientRects().length) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const button = [...menu.querySelectorAll("button")].find(
    (item) => item.textContent.trim() === "导出 JSON",
  );
  if (!button) throw new Error("同源多标签页页面操作失败");
  const originalCreate = Reflect.get(URL, "createObjectURL");
  const originalClick = Reflect.get(HTMLAnchorElement.prototype, "click");
  if (typeof originalCreate !== "function" || typeof originalClick !== "function") {
    throw new Error("同源多标签页页面操作失败");
  }
  let exportedBlob = null;
  try {
    URL.createObjectURL = function (value) {
      exportedBlob = value;
      return originalCreate.call(URL, value);
    };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href.startsWith("blob:")) return;
      return originalClick.call(this);
    };
    button.click();
    if (!(exportedBlob instanceof Blob)) throw new Error("同源多标签页页面操作失败");
    const json = await exportedBlob.text();
    const snapshot = JSON.parse(json);
    if (
      typeof snapshot.projectId !== "string" ||
      snapshot.schemaVersion !== "0.3.0" ||
      !Array.isArray(snapshot.pages)
    ) {
      throw new Error("同源多标签页页面操作失败");
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
    return {
      projectId: snapshot.projectId,
      schemaVersion: snapshot.schemaVersion,
      hash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      ),
    };
  } finally {
    URL.createObjectURL = originalCreate;
    HTMLAnchorElement.prototype.click = originalClick;
    if (menu.querySelector(".studio-file-popover")?.getClientRects().length) trigger.click();
  }
}

/** 页面状态只返回 CAS 修订号、按钮状态与固定布尔量。 */
export function studioMultiTabUiStateInPage() {
  const panel = document.querySelector('[aria-label="服务端工程版本"]');
  const text = panel?.textContent ?? "";
  const baseline = text.match(/CAS 基线：\s*(未建立|\d+)/)?.[1];
  const head = text.match(/服务端最新修订号：\s*(未查询|\d+)/)?.[1];
  const preview = [...(panel?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "只读预览最新版本",
  );
  const notice = document.querySelector(".studio-notice")?.textContent ?? "";
  return {
    baselineRevision: baseline && baseline !== "未建立" ? Number(baseline) : null,
    headRevision: head && head !== "未查询" ? Number(head) : null,
    busy: [...(panel?.querySelectorAll(".studio-version-help") ?? [])].some((item) =>
      item.textContent?.includes("正在处理工程版本"),
    ),
    hasAlert: Boolean(panel?.querySelector('[role="alert"]')),
    previewEnabled: Boolean(preview && !preview.disabled),
    autoSaveEnabled:
      document.querySelector('.studio-file-menu button[aria-pressed="true"]') !== null,
    savedRevision2: notice.includes("已追加服务端版本 #2"),
    savedRevision3: notice.includes("已追加服务端版本 #3"),
  };
}

export async function openProjectBrowserMenuInPage() {
  const menu = document.querySelector(".studio-project-browser-menu");
  const trigger = menu?.querySelector("button.t-button");
  if (trigger?.tagName !== "BUTTON") throw new Error("同源多标签页页面操作失败");
  if (!menu.querySelector(".studio-project-browser-panel")?.getClientRects().length)
    trigger.click();
  const opened = Date.now();
  while (Date.now() - opened < 5000) {
    if (menu.querySelector(".studio-project-browser-panel")?.getClientRects().length) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("同源多标签页工程管理弹层展开超时");
}

export function refreshProjectBrowserInPage() {
  const panel = document.querySelector(".studio-project-browser-panel");
  if (!panel) throw new Error("同源多标签页页面操作失败");
  const button = [...panel.querySelectorAll("button")].find(
    (item) => item.textContent.trim() === "刷新",
  );
  if (button && !button.disabled) button.click();
  return true;
}

export async function activateStudioTab(session) {
  await session.send("Page.bringToFront");
  const visible = await waitFor(
    () => session.evaluate(() => document.visibilityState === "visible"),
    "同源多标签页切换到可见状态",
    12000,
  );
  if (!visible) throw new Error("同源多标签页标签页可见性切换失败");
  return true;
}

async function requireStudioTabHidden(session) {
  const hidden = await waitFor(
    () => session.evaluate(() => document.visibilityState === "hidden"),
    "同源多标签页切换后旧标签页隐藏",
    12000,
  );
  if (!hidden) throw new Error("同源多标签页标签页可见性切换失败");
  return true;
}

async function waitFor(task, label, milliseconds = 20000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    try {
      const value = await task();
      if (value) return value;
    } catch {
      // 页面导航和 React/Vue 异步渲染期间，暂时不可读的状态继续等待。
    }
    await pause(150);
  }
  throw new Error(label + "未达到预期状态");
}

class CompanionChromeSession {
  constructor(socket) {
    this.socket = socket;
    this.index = 0;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const received = JSON.parse(String(data));
      const item = this.pending.get(received.id);
      if (!item) return;
      clearTimeout(item.timeout);
      this.pending.delete(received.id);
      if (received.error) item.reject(new Error("同源多标签页浏览器调试连接失败"));
      else item.resolve(received.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.index;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error("同源多标签页浏览器调试连接失败"));
        },
        method === "Runtime.evaluate" ? 45000 : 15000,
      );
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(action, ...args) {
    const expression =
      "(" + action.toString() + ")(" + args.map((value) => JSON.stringify(value)).join(",") + ")";
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      const error = new Error("同源多标签页页面操作失败");
      error.pageDiagnostic = describeBrowserPageException(response.exceptionDetails);
      throw error;
    }
    return response.result.value;
  }
}

export async function openCompanionChromeTab(browser) {
  const port = Number(
    readFileSync(join(browser.folder, "DevToolsActivePort"), "utf8").split("\n")[0],
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("同源多标签页第二个标签页创建失败");
  }
  const response = await fetch("http://" + LOOPBACK + ":" + port + "/json/new?about:blank", {
    method: "PUT",
  });
  if (!response.ok) throw new Error("同源多标签页第二个标签页创建失败");
  const tab = await response.json();
  const socketUrl = new URL(tab.webSocketDebuggerUrl);
  if (![LOOPBACK, "localhost"].includes(socketUrl.hostname)) {
    throw new Error("同源多标签页浏览器调试连接失败");
  }
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("同源多标签页浏览器调试连接失败")), 10000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("同源多标签页浏览器调试连接失败"));
        },
        { once: true },
      );
    });
    const session = new CompanionChromeSession(socket);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    return session;
  } catch {
    socket.close();
    throw new Error("同源多标签页浏览器调试连接失败");
  }
}

async function navigateToOrigin(session, origin, label) {
  await session.send("Page.navigate", { url: origin + "/" });
  await waitFor(
    () =>
      session.evaluate(function (expected) {
        return location.origin === expected && document.readyState === "complete";
      }, origin),
    label + "首页加载",
  );
  const identity = await session.evaluate(identityInPage, origin);
  if (!identity) throw new Error("同源多标签页两标签身份不一致");
  return identity;
}

async function inspectProtectedState(session) {
  const [state, canvas] = await Promise.all([
    inspectStudioState(session),
    session.evaluate(readStudioContentCanvasInPage),
  ]);
  return { ...state, canvas };
}

async function openDedicatedProject(session, projectId) {
  assert.equal(await session.evaluate(openProjectBrowserMenuInPage), true);
  await session.evaluate(refreshProjectBrowserInPage);
  let state = await waitFor(async () => {
    const current = await session.evaluate(pageStateInPage);
    return current && !current.busy ? current : null;
  }, "同源多标签页工程列表加载");
  let found = state.ids.includes(projectId);
  for (let index = 0; !found && index < 100 && state.nextEnabled; index += 1) {
    const previousPage = state.pageNumber;
    assert.equal(await session.evaluate(clickBrowserControlInPage, "next"), true);
    state = await waitFor(async () => {
      const current = await session.evaluate(pageStateInPage);
      return current && !current.busy && current.pageNumber > previousPage ? current : null;
    }, "同源多标签页工程列表翻页");
    found = state.ids.includes(projectId);
  }
  if (!found) throw new Error("同源多标签页工程列表未找到专用工程");
  const opened = await session.evaluate(openProjectInPage, projectId, 1, "confirm");
  assert.deepEqual(opened, { confirmCount: 1, intercepted: 0, outcome: "confirm" });
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const ui = await session.evaluate(studioMultiTabUiStateInPage);
  if (ui.baselineRevision !== 1 || ui.headRevision !== 1) {
    throw new Error("同源多标签页 CAS 状态未正确失效");
  }
}

async function saveServerVersion(session, expectedRevision) {
  const clicked = await session.evaluate(clickStudioServerSaveInPage);
  if (!clicked.clicked || clicked.disabled) {
    throw new Error("同源多标签页服务端保存状态未达到预期");
  }
  const result = await waitFor(async () => {
    const ui = await session.evaluate(studioMultiTabUiStateInPage);
    const write = await session.evaluate(studioMultiTabWriteStateInPage);
    if (!ui.busy && (write.phase === "committed" || ui.hasAlert)) return { ui, write };
    return null;
  }, "同源多标签页服务端保存");
  if (
    result.ui.hasAlert ||
    result.ui.baselineRevision !== expectedRevision + 1 ||
    result.ui.headRevision !== expectedRevision + 1 ||
    result.write.phase !== "committed" ||
    result.write.resultRevision !== expectedRevision + 1 ||
    result.write.writeAttempts !== 1 ||
    result.write.acceptedWrites !== 1 ||
    result.write.rejectedWrites !== 0 ||
    !result.write.hashValid
  ) {
    throw new Error("同源多标签页服务端保存状态未达到预期");
  }
  return result.write;
}

async function verifyStaleSaveBlocked(session, name, expectedAttempts, expectedAccepted) {
  const clicked = await session.evaluate(clickStudioServerSaveInPage);
  if (clicked.clicked) {
    await waitFor(async () => {
      const ui = await session.evaluate(studioMultiTabUiStateInPage);
      return !ui.busy && ui.hasAlert ? ui : null;
    }, name + " 过期 CAS 保存拒绝");
  } else if (!clicked.disabled) {
    throw new Error("同源多标签页 CAS 状态未正确失效");
  }
  const [ui, write] = await Promise.all([
    session.evaluate(studioMultiTabUiStateInPage),
    session.evaluate(studioMultiTabWriteStateInPage),
  ]);
  if (
    ui.baselineRevision !== null ||
    !ui.previewEnabled ||
    write.writeAttempts !== expectedAttempts ||
    write.acceptedWrites !== expectedAccepted ||
    write.rejectedWrites !== 0
  ) {
    throw new Error("同源多标签页 CAS 状态未正确失效");
  }
  return { ui, write };
}

async function waitForDraftChange(session, previousHash) {
  const changed = await waitFor(async () => {
    const state = await inspectStudioState(session);
    return state.drafts.count > 0 && state.drafts.hash !== previousHash ? state : null;
  }, "同源多标签页本地自动保存");
  let stableHash = changed.drafts.hash;
  let stableCount = 0;
  const stableUntil = Date.now() + 5000;
  let stable = changed;
  while (Date.now() < stableUntil && stableCount < 4) {
    await pause(300);
    stable = await inspectStudioState(session);
    if (stable.drafts.hash === stableHash) stableCount += 1;
    else {
      stableHash = stable.drafts.hash;
      stableCount = 0;
    }
  }
  if (stableCount < 4) throw new Error("同源多标签页本地草稿未按预期变化");
  return stable.drafts;
}

export async function verifySameSubjectMultitabAudit(
  client,
  projectId,
  principal,
  revision2Hash,
  revision3Hash,
) {
  if (
    !PROJECT_PATTERN.test(projectId) ||
    typeof principal?.tenantId !== "string" ||
    typeof principal?.subjectId !== "string" ||
    !/^[0-9a-f]{64}$/.test(revision2Hash ?? "") ||
    !/^[0-9a-f]{64}$/.test(revision3Hash ?? "")
  ) {
    throw new Error("同源多标签页数据库版本与审计不一致");
  }
  const versions = await client.query(
    "SELECT revision, created_by, content_hash FROM public.scada_project_versions " +
      "WHERE tenant_id = $1 AND project_id = $2 ORDER BY revision",
    [principal.tenantId, projectId],
  );
  const audits = await client.query(
    "SELECT revision, actor_id FROM public.scada_project_audit " +
      "WHERE tenant_id = $1 AND project_id = $2 ORDER BY revision",
    [principal.tenantId, projectId],
  );
  const head = await client.query(
    "SELECT head_revision FROM public.scada_projects WHERE tenant_id = $1 AND project_id = $2",
    [principal.tenantId, projectId],
  );
  const revisions = [1, 2, 3];
  if (
    versions.rows.length !== 3 ||
    audits.rows.length !== 3 ||
    head.rows.length !== 1 ||
    String(head.rows[0].head_revision) !== "3" ||
    revisions.some(
      (revision, index) =>
        String(versions.rows[index].revision) !== String(revision) ||
        String(audits.rows[index].revision) !== String(revision) ||
        versions.rows[index].created_by !== principal.subjectId ||
        audits.rows[index].actor_id !== principal.subjectId ||
        !/^[0-9a-f]{64}$/.test(versions.rows[index].content_hash ?? ""),
    ) ||
    versions.rows[1].content_hash !== revision2Hash ||
    versions.rows[2].content_hash !== revision3Hash
  ) {
    throw new Error("同源多标签页数据库版本与审计不一致");
  }
  return { versionCount: 3, auditCount: 3, headRevision: 3 };
}

async function verifyFramework(first, second, origin, name, client, principal) {
  process.stdout.write(name + "：准备同源双标签页专用工程\n");
  const projectId = "b34-oidc-multitab-" + randomUUID();
  assert.match(projectId, PROJECT_PATTERN);
  assert.deepEqual(await first.evaluate(createMultitabProjectInPage, origin, projectId), {
    created: true,
    headRevision: 1,
  });

  const install =
    "(" + installStudioMultiTabWriteGuardInPage.toString() + ")(" + JSON.stringify(origin) + ");";
  await Promise.all([
    first.send("Page.addScriptToEvaluateOnNewDocument", { source: install }),
    second.send("Page.addScriptToEvaluateOnNewDocument", { source: install }),
  ]);
  const [firstIdentity, secondIdentity] = await Promise.all([
    navigateToOrigin(first, origin, name + " 第一标签页"),
    navigateToOrigin(second, origin, name + " 第二标签页"),
  ]);
  if (
    firstIdentity.tenantId !== secondIdentity.tenantId ||
    firstIdentity.subjectId !== secondIdentity.subjectId ||
    firstIdentity.tenantId !== principal.tenantId ||
    firstIdentity.subjectId !== principal.subjectId
  ) {
    throw new Error("同源多标签页两标签身份不一致");
  }

  await activateStudioTab(first);
  await requireStudioTabHidden(second);
  assert.equal(await first.evaluate(enterStudioInPage), true);
  await openDedicatedProject(first, projectId);
  await activateStudioTab(second);
  await requireStudioTabHidden(first);
  assert.equal(await second.evaluate(enterStudioInPage), true);
  await openDedicatedProject(second, projectId);

  assert.equal(await second.evaluate(saveDraftInPage), true);
  assert.equal(await second.evaluate(enableAutoSaveInPage), true);
  const initialDraft = await inspectStudioState(second);
  assert.equal(initialDraft.autoSave, true);
  await second.evaluate(addStudioSymbolInPage, "+ 水箱");
  const localDraft = await waitForDraftChange(second, initialDraft.drafts.hash);
  const beforeConflict = await inspectProtectedState(second);
  assert.equal(beforeConflict.autoSave, true);

  await activateStudioTab(first);
  await requireStudioTabHidden(second);
  await first.evaluate(addStudioSymbolInPage, "+ 水箱");
  assert.equal(await first.evaluate(armStudioMultiTabWriteInPage, origin, projectId, 1), true);
  const revision2 = await saveServerVersion(first, 1);
  const firstAfterSave = await inspectProtectedState(first);
  const firstDocument = await first.evaluate(readStudioDocumentHashInPage);
  assert.equal(firstAfterSave.autoSave, false);
  assert.deepEqual(firstAfterSave.drafts, localDraft);

  await activateStudioTab(second);
  await requireStudioTabHidden(first);
  const resumed = await waitFor(async () => {
    const ui = await second.evaluate(studioMultiTabUiStateInPage);
    return ui.baselineRevision === null && ui.previewEnabled && !ui.busy ? ui : null;
  }, name + " 第二标签页恢复后的 CAS 复核");
  assert.equal(resumed.autoSaveEnabled, true);
  const afterResume = await inspectProtectedState(second);
  assert.equal(afterResume.canvas, beforeConflict.canvas);
  assert.deepEqual(afterResume.drafts, localDraft);
  assert.equal(afterResume.autoSave, true);

  const staleSave = await verifyStaleSaveBlocked(second, name + " 第二标签页", 0, 0);
  assert.equal(staleSave.write.writeAttempts, 0);
  const afterStaleSave = await inspectProtectedState(second);
  assert.equal(afterStaleSave.canvas, beforeConflict.canvas);
  assert.deepEqual(afterStaleSave.drafts, localDraft);
  assert.equal(afterStaleSave.autoSave, true);

  await second.evaluate(triggerConflictPreviewInPage);
  const preview = await waitFor(async () => {
    const state = await second.evaluate(conflictPreviewStateInPage);
    return state.comparisonVisible && state.previewRevision === 2 ? state : null;
  }, name + " 第二标签页只读预览最新版本");
  assert.equal(preview.baselineCleared, true);
  const previewWrite = await second.evaluate(studioMultiTabWriteStateInPage);
  assert.equal(previewWrite.writeAttempts, 0);
  assert.equal(previewWrite.acceptedWrites, 0);
  assert.equal(previewWrite.rejectedWrites, 0);
  const afterPreview = await inspectProtectedState(second);
  assert.equal(afterPreview.canvas, beforeConflict.canvas);
  assert.deepEqual(afterPreview.drafts, localDraft);
  assert.equal(afterPreview.autoSave, true);

  assert.deepEqual(await second.evaluate(confirmPreviewedServerVersionInPage, 2), {
    confirmed: true,
    confirmCount: 1,
  });
  assert.equal(await second.evaluate(waitForStudioActionIdleInPage), true);
  const afterLoad = await inspectProtectedState(second);
  const loadedUi = await second.evaluate(studioMultiTabUiStateInPage);
  const loadedDocument = await second.evaluate(readStudioDocumentHashInPage);
  assert.equal(loadedUi.baselineRevision, 2);
  assert.equal(loadedUi.headRevision, 2);
  assert.equal(afterLoad.autoSave, false);
  assert.deepEqual(afterLoad.drafts, localDraft);
  assert.deepEqual(loadedDocument, firstDocument);

  await second.evaluate(addStudioSymbolInPage, "+ 水箱");
  assert.equal(await second.evaluate(armStudioMultiTabWriteInPage, origin, projectId, 2), true);
  const revision3 = await saveServerVersion(second, 2);
  const secondAfterSave = await inspectProtectedState(second);
  assert.equal(secondAfterSave.autoSave, false);
  assert.deepEqual(secondAfterSave.drafts, localDraft);

  await activateStudioTab(first);
  await requireStudioTabHidden(second);
  const firstResumed = await waitFor(async () => {
    const ui = await first.evaluate(studioMultiTabUiStateInPage);
    return ui.baselineRevision === null && ui.previewEnabled && !ui.busy ? ui : null;
  }, name + " 第一标签页恢复后的 CAS 复核");
  assert.equal(firstResumed.autoSaveEnabled, false);
  const firstAfterResume = await inspectProtectedState(first);
  assert.equal(firstAfterResume.canvas, firstAfterSave.canvas);
  assert.deepEqual(firstAfterResume.drafts, localDraft);

  const firstStaleSave = await verifyStaleSaveBlocked(first, name + " 第一标签页", 1, 1);
  assert.equal(firstStaleSave.write.writeAttempts, 1);

  const audit = await verifySameSubjectMultitabAudit(
    client,
    projectId,
    principal,
    revision2.resultHash,
    revision3.resultHash,
  );
  assert.deepEqual(audit, { versionCount: 3, auditCount: 3, headRevision: 3 });
  process.stdout.write(name + " 同源双标签页 CAS 恢复、草稿保护和 PostgreSQL 三版审计通过\n");
}

async function run() {
  if (!existsSync(ROOT_ENV)) throw new Error("同源多标签页专项必须显式确认本机隔离 Lab");
  loadEnvFile(ROOT_ENV);
  parseStudioMultiTabMode(process.argv.slice(2));
  const origins = resolveProjectBrowserLab(process.env);
  const target = resolveLabIdentityTarget(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("未找到本机 Chrome/Edge 浏览器");
  for (const origin of origins) {
    const response = await fetch(origin + "/", {
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok || response.url !== origin + "/") {
      throw new Error("本机可信 HTTPS Web 服务未就绪");
    }
  }

  const serverRequire = createRequire(SERVER_PACKAGE);
  const { Client } = serverRequire("pg");
  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  let browser;
  let companion;
  try {
    await client.connect();
    browser = await startBrowser(executable);
    const principal = await waitForLogin(browser, origins[0], "同源多标签页测试用户");
    companion = await openCompanionChromeTab(browser);
    const [firstIdentity, secondIdentity] = await Promise.all([
      navigateToOrigin(browser, origins[0], "React 第一标签页"),
      navigateToOrigin(companion, origins[0], "React 第二标签页"),
    ]);
    if (
      firstIdentity.tenantId !== secondIdentity.tenantId ||
      firstIdentity.subjectId !== secondIdentity.subjectId ||
      firstIdentity.tenantId !== principal.tenantId ||
      firstIdentity.subjectId !== principal.subjectId
    ) {
      throw new Error("同源多标签页两标签身份不一致");
    }
    for (const [index, origin] of origins.entries()) {
      const name = index === 0 ? "React" : "Vue";
      const first = await navigateToOrigin(browser, origin, name + " 第一标签页");
      const second = await navigateToOrigin(companion, origin, name + " 第二标签页");
      if (
        first.tenantId !== second.tenantId ||
        first.subjectId !== second.subjectId ||
        first.tenantId !== principal.tenantId ||
        first.subjectId !== principal.subjectId
      ) {
        throw new Error("同源多标签页两标签身份不一致");
      }
      await verifyFramework(browser, companion, origin, name, client, principal);
    }
    process.stdout.write(
      "同一 Keycloak 主体的 React/Vue 同源双标签页真实 CAS 专项通过；每端仅创建一份随机测试工程。\n",
    );
  } finally {
    try {
      await client.end();
    } finally {
      companion?.socket.close();
      if (browser) await browser.close();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeStudioMultiTabFailure(error) + "\n");
    process.exitCode = 1;
  });
}
