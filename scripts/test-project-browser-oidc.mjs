import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolveReadonlyProbeOrigins } from "./verify-oidc-https-readonly.mjs";
import { resolveLabIdentityTarget } from "./oidc-lab-identity.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const LOOPBACK = "127.0.0.1";

const SAFE_PAGE_ERRORS = new Set([
  "未找到工程管理入口",
  "未找到本地草稿保存按钮",
  "没有找到草稿操作菜单",
  "自动保存不是关闭状态",
  "读取测试浏览器草稿数据库失败",
  "读取测试浏览器草稿记录失败",
  "隔离浏览器草稿保存失败",
  "服务端列表分页契约不正确",
  "工程打开按钮不可用",
  "工程安全载入流程模式不合法",
  "冲突恢复确认载入版本参数不合法",
  "冲突恢复确认载入按钮不可用",
  "冲突恢复确认载入未通过受控复核",
  "冲突恢复确认载入超时",
  "服务器工程载入阶段返回受控错误",
  "服务器工程载入阶段返回受控错误（确认前）",
  "服务器工程载入阶段返回受控错误（确认后）",
  "工程安全载入流程超时",
  "权限拒绝模拟参数不合法",
  "权限拒绝模拟操作按钮不可用",
  "标签页恢复测试要求浏览器页面处于可见状态",
  "保存时序模拟参数不合法",
  "保存时序模拟尚未命中唯一的版本追加请求",
  "保存时序模拟操作按钮不可用",
]);
/** 仅接受固定阶段与类别，禁止输出服务端异常正文。 */
const SAFE_OPEN_FAILURE =
  /^服务器工程载入阶段返回受控错误（确认(?:前|后)：(?:身份过期|权限拒绝|版本冲突|快照校验|网络故障|服务故障|协议响应)）$/;
const SAFE_SAVE_TIMING_TIMEOUT =
  /^(?:React|Vue) 延迟保存 (?:401|409|503)：(?:版本 POST 未命中|工程写入次数异常|操作忙碌状态未保持|保存按钮未禁用|保存操作未结束|页面未显示拒绝错误|无法读取浏览器状态)$/;
const SAFE_SAVE_BASELINE_TIMEOUT =
  /^(?:React|Vue) 权限模拟(?:首页加载|工程列表加载)未达到预期状态$/;
const SAFE_SAVE_BASELINE_MISMATCH =
  /^(?:React|Vue) 延迟保存 (?:401|409|503)：CAS 基线状态不符合预期$/;
const PAGE_ERROR_TYPES = new Map([
  ["ReferenceError", "页面脚本引用异常"],
  ["TypeError", "页面脚本类型异常"],
  ["SyntaxError", "页面脚本语法异常"],
  ["DOMException", "浏览器存储或 DOM 异常"],
  ["Error", "页面脚本断言异常"],
]);

const SAFE_FAILURES = new Set([
  "工程浏览器测试仅允许本机 Keycloak 隔离 Realm",
  "工程浏览器测试必须明确使用本机隔离数据库",
  "工程浏览器测试拒绝非本机隔离数据库目标",
  "配置的 Node.js 本机根证书无法读取",
  "请预先设置 NODE_EXTRA_CA_CERTS 或 NODE_USE_SYSTEM_CA=1，保持 TLS 校验",
  "未找到本机 Chrome/Edge 浏览器",
  "本机可信 HTTPS Web 服务未就绪",
  "隔离浏览器调试端口未就绪",
  "浏览器调试标签页无法创建",
  "浏览器调试命令执行失败",
  "浏览器页面操作失败，请检查当前 Studio 状态",
  "React BFF 会话未通过验证",
  "Vue BFF 会话未通过验证",
  "React 隔离 Lab 没有授权工程，请先由维护者按受控流程准备至少一份工程",
  "Vue 隔离 Lab 没有授权工程，请先由维护者按受控流程准备至少一份工程",
  "真实多页验收要求至少十一项已授权工程，当前未覆盖有效的第二页",
  "仅支持 --require-multipage、--simulate-access-denial、--simulate-resume-check、--simulate-save-timing 或显式确认的多页数据准备参数",
  "多页数据准备配置不符合本机可信 Lab 边界",
  "多页数据准备只允许本机 React Origin",
  "多页数据准备缺少可信登录会话",
  "多页数据准备 CSRF Cookie 无效",
  "多页数据准备服务端请求失败",
  "多页数据准备列表响应无效",
  "多页数据准备未能建立有效的第二页",
]);

/** CDP 异常只按确定的脚本错误文案或异常类别公开，禁止泄漏脚本堆栈与 Cookie。 */
export function describeBrowserPageException(details) {
  const description = details?.exception?.description;
  const firstLine = typeof description === "string" ? description.split("\n", 1)[0] : "";
  for (const known of SAFE_PAGE_ERRORS) {
    if (firstLine === "Error: " + known || firstLine === "TypeError: " + known) {
      return known;
    }
  }
  const openFailure = firstLine.startsWith("Error: ") ? firstLine.slice(7) : "";
  if (SAFE_OPEN_FAILURE.test(openFailure)) return openFailure;
  return PAGE_ERROR_TYPES.get(details?.exception?.className) ?? "页面脚本异常（已脱敏）";
}

/** 仅输出固定的安全诊断，拒绝把异常中的 Cookie、URL 或页面数据写入终端。 */
export function describeProjectBrowserFailure(error) {
  const message = error instanceof Error ? error.message : "";
  if (message === "浏览器页面操作失败，请检查当前 Studio 状态" && error?.pageDiagnostic) {
    const reason = error.pageDiagnostic;
    if (
      SAFE_PAGE_ERRORS.has(reason) ||
      SAFE_OPEN_FAILURE.test(reason) ||
      [...PAGE_ERROR_TYPES.values(), "页面脚本异常（已脱敏）"].includes(reason)
    ) {
      return "浏览器页面操作失败：" + reason;
    }
  }
  if (message === "服务端工程列表状态异常") {
    const status = error.httpStatus;
    return Number.isInteger(status) && status >= 100 && status <= 599
      ? "工程列表接口返回 HTTP " + status
      : "工程列表接口状态异常";
  }
  if (
    SAFE_FAILURES.has(message) ||
    SAFE_SAVE_TIMING_TIMEOUT.test(message) ||
    SAFE_SAVE_BASELINE_MISMATCH.test(message)
  ) {
    return message;
  }
  if (SAFE_SAVE_BASELINE_TIMEOUT.test(message)) return "浏览器阶段超时：" + message;
  if (
    [
      "只读 HTTPS 探针要求显式启用可信 OIDC 开发代理",
      "只读 HTTPS 探针只允许安全的本机非生产环境",
      "HTTPS 联调端口必须互不相同",
      "只读探针要求精确配置两个本机 HTTPS Origin",
      "OIDC 回调必须与已登记的 HTTPS Origin 一致",
    ].includes(message)
  ) {
    return message;
  }
  if (message.endsWith("未达到预期状态")) {
    return "浏览器登录或 Studio 页面未达到预期状态，请检查隔离 Lab、登录与服务端工程";
  }
  const code = error && typeof error === "object" ? error.code : undefined;
  if (code === "ECONNREFUSED") return "本机 Web 或浏览器调试端口未监听";
  if (code === "CERT_HAS_EXPIRED" || code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return "本机 HTTPS 证书不符合有效期或域名要求";
  }
  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "SELF_SIGNED_CERT_IN_CHAIN") {
    return "本机 HTTPS 根证书未被 Node.js 信任";
  }
  return "浏览器安全回归断言失败，检查终端测试条件及真实页面状态";
}

/** 限定真实 OIDC 试验在本机隔离 Lab，不允许把浏览器脚本指向远端服务。 */
export function resolveProjectBrowserLab(env) {
  const origins = resolveReadonlyProbeOrigins(env);
  const port = env.SCADA_LAB_KEYCLOAK_PORT;
  if (
    typeof port !== "string" ||
    !/^[1-9][0-9]{0,4}$/.test(port) ||
    Number(port) > 65535 ||
    env.SCADA_OIDC_ISSUER !== "https://" + LOOPBACK + ":" + port + "/realms/adui-scada"
  ) {
    throw new Error("工程浏览器测试仅允许本机 Keycloak 隔离 Realm");
  }
  let database;
  try {
    database = new URL(env.SCADA_DATABASE_URL);
  } catch {
    throw new Error("工程浏览器测试必须明确使用本机隔离数据库");
  }
  if (
    database.protocol !== "postgresql:" ||
    database.hostname !== LOOPBACK ||
    database.port !== String(env.SCADA_LAB_POSTGRES_PORT) ||
    !["/adui_scada", "/adui_scada_oidc_lab"].includes(database.pathname) ||
    database.hash !== ""
  ) {
    throw new Error("工程浏览器测试拒绝非本机隔离数据库目标");
  }
  if (env.NODE_EXTRA_CA_CERTS !== undefined && !existsSync(env.NODE_EXTRA_CA_CERTS)) {
    throw new Error("配置的 Node.js 本机根证书无法读取");
  }
  if (!env.NODE_EXTRA_CA_CERTS && env.NODE_USE_SYSTEM_CA !== "1") {
    throw new Error("请预先设置 NODE_EXTRA_CA_CERTS 或 NODE_USE_SYSTEM_CA=1，保持 TLS 校验");
  }
  return origins;
}

function browserExecutable() {
  const root = process.env.PROGRAMFILES || "C:\\Program Files";
  const x86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const paths = [
    process.env.SCADA_BROWSER_PATH,
    join(root, "Google", "Chrome", "Application", "chrome.exe"),
    join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(x86, "Google", "Chrome", "Application", "chrome.exe"),
    join(x86, "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  return paths.find((path) => path && existsSync(path));
}

async function waitForPort(directory, child) {
  const file = join(directory, "DevToolsActivePort");
  for (let index = 0; index < 150; index += 1) {
    if (existsSync(file)) return Number(readFileSync(file, "utf8").split("\n")[0]);
    if (child.exitCode !== null) break;
    await pause(100);
  }
  throw new Error("隔离浏览器调试端口未就绪");
}

class ChromeSession {
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
      if (received.error) item.reject(new Error("浏览器调试命令执行失败"));
      else item.resolve(received.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.index;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error("浏览器调试命令超时：" + method));
        },
        method === "Runtime.evaluate" ? 45000 : 15000,
      );
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(action, ...args) {
    const expression =
      "(" + action.toString() + ")(" + args.map((a) => JSON.stringify(a)).join(",") + ")";
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const error = new Error("浏览器页面操作失败，请检查当前 Studio 状态");
      error.pageDiagnostic = describeBrowserPageException(result.exceptionDetails);
      throw error;
    }
    return result.result.value;
  }
}

async function waitFor(task, label, milliseconds = 15000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    try {
      const value = await task();
      if (value) return value;
    } catch {
      // 导航期间浏览器 JavaScript 上下文可能临时销毁。
    }
    await pause(200);
  }
  throw new Error(label + "未达到预期状态");
}

/** 仅检测当前 Origin 是否拥有真实 BFF Cookie 会话，不读取或打印 Cookie。 */
async function authenticatedInPage(origin) {
  if (location.origin !== origin) return false;
  try {
    const response = await fetch("/api/v1/auth/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    if (response.status !== 200) return false;
    const payload = await response.json();
    return (
      payload.authenticated === true &&
      typeof payload.principal?.tenantId === "string" &&
      typeof payload.principal?.subjectId === "string"
    );
  } catch {
    return false;
  }
}

export async function enterStudioInPage() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const nav = document.querySelector(".scada-app-nav");
    const button = [...(nav?.querySelectorAll("button") || [])].find(
      (item) => item.textContent.trim() === "组态编辑",
    );
    if (button) {
      if (!document.querySelector(".studio-workspace")) button.click();
      for (let retry = 0; retry < 75; retry += 1) {
        if (document.querySelector(".studio-workspace .studio-svg")) return true;
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

/** 所有 HTTP 请求在浏览器可信 HTTPS Origin 内发出，不转发 Cookie/身份到 Node。 */
async function projectsInPage(afterProjectId) {
  const params = new URLSearchParams({ limit: "10" });
  if (afterProjectId) params.set("afterProjectId", afterProjectId);
  const response = await fetch("/api/v1/projects?" + params, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) return { status: response.status, projects: [] };
  const data = await response.json();
  if (!Array.isArray(data) || data.length > 10) throw new Error("服务端列表分页契约不正确");
  return {
    status: response.status,
    projects: data.map(({ projectId, headRevision }) => ({ projectId, headRevision })),
  };
}

export function pageStateInPage() {
  const panel = document.querySelector(".studio-project-browser-panel");
  if (!panel) return null;
  const buttons = [...panel.querySelectorAll(".studio-project-browser-pagination button")];
  const items = [...panel.querySelectorAll(".studio-project-browser-item")];
  return {
    ids: items.map((item) => item.querySelector("code")?.textContent?.trim()),
    revisions: items.map((item) =>
      Number(item.querySelector("small")?.textContent?.match(/#(\d+)/)?.[1]),
    ),
    empty: Boolean(panel.querySelector(".studio-project-browser-empty")),
    error: Boolean(panel.querySelector('[role="alert"]')),
    busy: [...panel.querySelectorAll("button")].some(
      (item) => item.disabled && item.textContent.trim() === "刷新",
    ),
    prevEnabled: buttons[0] ? !buttons[0].disabled : false,
    nextEnabled: buttons[1] ? !buttons[1].disabled : false,
    pageNumber: Number(
      panel
        .querySelector(".studio-project-browser-pagination span")
        ?.textContent?.match(/第\s*(\d+)\s*页/)?.[1],
    ),
  };
}

export async function waitForStudioActionIdleInPage() {
  for (let retry = 0; retry < 120; retry += 1) {
    const busy = [
      ...document.querySelectorAll('[aria-label="服务端工程版本"] .studio-version-help'),
    ].some((node) => node.textContent?.includes("正在处理工程版本"));
    const blocked = [...document.querySelectorAll(".studio-project-browser-item button")].some(
      (button) => button.disabled,
    );
    if (!busy && !blocked) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

async function readBrowserDraftsInPage() {
  const database = await new Promise((resolve, reject) => {
    const req = indexedDB.open("adui-scada-studio");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("读取测试浏览器草稿数据库失败"));
  });
  let rows;
  try {
    rows = await new Promise((resolve, reject) => {
      const tx = database.transaction("drafts", "readonly");
      const request = tx.objectStore("drafts").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("读取测试浏览器草稿记录失败"));
    });
  } finally {
    database.close();
  }
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    count: rows.length,
    hash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

/** 此函数在浏览器的独立执行上下文中运行，不得引用 Node 模块作用域的 helper。 */
function stateInPage() {
  return {
    canvas: document.querySelector(".studio-svg")?.innerHTML ?? "",
    server: document.querySelector('[aria-label="服务端工程版本"]')?.textContent ?? "",
    autoSave: document.querySelector('.studio-file-menu button[aria-pressed="true"]') !== null,
  };
}

/** 画布与 IndexedDB 各自在浏览器执行，Node 侧仅合并已脱敏的测试断言数据。 */
export async function inspectStudioState(session) {
  const [view, drafts] = await Promise.all([
    session.evaluate(stateInPage),
    session.evaluate(readBrowserDraftsInPage),
  ]);
  return { ...view, drafts };
}

export async function saveDraftInPage() {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent.trim() === "保存草稿",
  );
  if (!button) throw new Error("未找到本地草稿保存按钮");
  button.click();
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    const notice = document.querySelector(".studio-notice")?.textContent ?? "";
    if (notice.includes("已保存 IndexedDB 草稿")) return true;
    if (notice.includes("保存草稿失败")) throw new Error("隔离浏览器草稿保存失败");
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

export async function enableAutoSaveInPage() {
  const menu = document.querySelector(".studio-file-menu");
  if (!menu) throw new Error("没有找到草稿操作菜单");
  menu.open = true;
  const button = [...menu.querySelectorAll("button")].find(
    (item) => item.textContent.trim() === "开启自动保存",
  );
  if (!button) throw new Error("自动保存不是关闭状态");
  const originalConfirm = window.confirm;
  window.confirm = () => true;
  try {
    button.click();
    for (let retry = 0; retry < 120; retry += 1) {
      if (menu.querySelector('button[aria-pressed="true"]')) return true;
      await new Promise((done) => setTimeout(done, 100));
    }
    return false;
  } finally {
    window.confirm = originalConfirm;
    menu.open = false;
  }
}

/**
 * 只模拟一次服务端 HEAD 比摘要更新的响应；不伪造登录身份，也不触发数据库写入。
 * 此钩子在页面重载之前通过 CDP 预先安装，先于 API Client 捕获 Fetch。
 */
function installRevisionConflictFaultInPage() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const fault = globalThis.__aduiTestProjectRevisionFault;
    if (!fault || !response.ok) return response;
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const method = init?.method ?? (typeof input === "string" ? "GET" : input.method);
    if (
      url.origin !== location.origin ||
      url.pathname !== "/api/v1/projects/" + encodeURIComponent(fault.projectId) ||
      method !== "GET"
    ) {
      return response;
    }
    const summary = await response.clone().json();
    fault.calls += 1;
    return new Response(JSON.stringify({ ...summary, headRevision: summary.headRevision + 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

/**
 * 只在本次浏览器专项显式启用的 Profile 中安装。
 * 浏览器模拟 GET 拒绝，不修改服务端 ACL；任意工程写请求始终在浏览器本地拒绝。
 * 通过独立的 runtime 入参允许离线测试，CDP 序列化执行时默认使用 globalThis。
 */
export function installAccessDenialFaultInPage(runtime = globalThis) {
  const actualFetch = runtime.fetch.bind(runtime);
  const state = { active: null, hits: 0, writeAttempts: 0, save: null };
  runtime.__aduiTestAccessDenial = state;
  runtime.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw, runtime.location.href);
    const method = (
      init?.method ?? (typeof input === "string" ? "GET" : input.method)
    ).toUpperCase();
    const projectPath =
      url.pathname === "/api/v1/projects" || url.pathname.startsWith("/api/v1/projects/");

    // 故障模拟只能读取既有工程；即使 UI 意外调用保存，也绝不能送到真实 Lab。
    if (projectPath && method !== "GET" && method !== "HEAD") {
      state.writeAttempts += 1;
      const pending = state.save;
      if (
        pending &&
        !pending.resolve &&
        method === "POST" &&
        url.origin === runtime.location.origin &&
        url.pathname === "/api/v1/projects/" + encodeURIComponent(pending.projectId) + "/versions"
      ) {
        pending.hits += 1;
        return new Promise((resolve) => {
          pending.resolve = resolve;
        });
      }
      return new Response("{}", {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const fault = state.active;
    if (fault && method === "GET" && url.origin === runtime.location.origin) {
      const path = "/api/v1/projects/" + encodeURIComponent(fault.projectId);
      const matched =
        (fault.scope === "identity" && url.pathname === "/api/v1/auth/me") ||
        (fault.scope === "list" && url.pathname === "/api/v1/projects") ||
        (fault.scope === "history" &&
          (url.pathname === path || url.pathname === path + "/versions")) ||
        (fault.scope === "detail" && url.pathname === path);
      if (matched) {
        state.hits += 1;
        return new Response("{}", {
          status: fault.status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return actualFetch(input, init);
  };
}

/**
 * 延迟版本追加模拟：真实 BFF 只负责身份和工程 GET，POST 始终由隔离页面拦截。
 * 只允许固定拒绝状态，不伪造服务端提交成功或写入后已回滚。
 */
export function armSaveTimingInPage(projectId, status, runtime = globalThis) {
  const state = runtime.__aduiTestAccessDenial;
  if (
    !state ||
    typeof projectId !== "string" ||
    projectId.length === 0 ||
    projectId.length > 128 ||
    ![401, 409, 503].includes(status) ||
    state.save
  ) {
    throw new Error("保存时序模拟参数不合法");
  }
  state.save = { projectId, status, hits: 0, resolve: null };
  state.writeAttempts = 0;
  return true;
}

/** 只在命中恰好一个版本追加 POST 后释放模拟回包。 */
export function releaseSaveTimingInPage(runtime = globalThis) {
  const pending = runtime.__aduiTestAccessDenial?.save;
  if (!pending || pending.hits !== 1 || !pending.resolve) {
    throw new Error("保存时序模拟尚未命中唯一的版本追加请求");
  }
  const release = pending.resolve;
  pending.resolve = null;
  release(
    new Response("{}", {
      status: pending.status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  return true;
}

/** 使用真实 Studio UI 连续触发两次保存以检验互斥，不直接调用客户端接口。 */
export function triggerSaveTimingInPage() {
  const panel = document.querySelector('[aria-label="服务端工程版本"]');
  const menu = panel?.closest("details");
  if (menu) menu.open = true;
  const button = [...(panel?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "保存至服务端",
  );
  if (!button || button.disabled) throw new Error("保存时序模拟操作按钮不可用");
  button.click();
  button.click();
  return true;
}

/** 只返回固定状态与计数，不传递页面错误正文、Cookie 或工程文档。 */
export function saveTimingStateInPage() {
  const panel = document.querySelector('[aria-label="服务端工程版本"]');
  const text = panel?.textContent ?? "";
  const button = [...(panel?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "保存至服务端",
  );
  const state = globalThis.__aduiTestAccessDenial;
  return {
    hits: state?.save?.hits ?? 0,
    writeAttempts: state?.writeAttempts ?? -1,
    busy: [...(panel?.querySelectorAll(".studio-version-help") ?? [])].some((node) =>
      node.textContent?.includes("正在处理工程版本"),
    ),
    disabled: button?.disabled ?? false,
    hasError: Boolean(panel?.querySelector('[role="alert"]')),
    baselineCleared: /CAS 基线：\s*未建立/.test(text),
  };
}

/** 冲突发生后只触发双框架现有 UI 的只读最新版本预览。 */
export function triggerConflictPreviewInPage() {
  const panel = document.querySelector('[aria-label="服务端工程版本"]');
  const button = [...(panel?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "只读预览最新版本",
  );
  if (!button || button.disabled) {
    throw new Error("冲突恢复只读预览按钮不可用");
  }
  button.click();
  return true;
}

/** 只返回固定状态和修订号，不导出服务端工程、身份或响应正文。 */
export function conflictPreviewStateInPage() {
  const panel = document.querySelector('[aria-label="服务端工程版本"]');
  const text = panel?.textContent ?? "";
  const comparison = panel?.querySelector(".studio-version-comparison");
  const revision = comparison
    ?.querySelector("strong")
    ?.textContent?.match(/服务端版本 #(\d+)/)?.[1];
  return {
    writeAttempts: globalThis.__aduiTestAccessDenial?.writeAttempts ?? -1,
    busy: [...(panel?.querySelectorAll(".studio-version-help") ?? [])].some((node) =>
      node.textContent?.includes("正在处理工程版本"),
    ),
    baselineCleared: /CAS 基线：\s*未建立/.test(text),
    hasError: Boolean(panel?.querySelector('[role="alert"]')),
    comparisonVisible: Boolean(comparison),
    previewRevision: revision === undefined ? null : Number(revision),
  };
}

/** 被序列化到页面独立执行；只允许三类安全拒绝与固定的只读接口范围。 */
export function armAccessDenialInPage(projectId, scope, status, runtime = globalThis) {
  const state = runtime.__aduiTestAccessDenial;
  if (
    !state ||
    typeof projectId !== "string" ||
    projectId.length === 0 ||
    !["identity", "list", "history", "detail"].includes(scope) ||
    ![401, 403, 404].includes(status) ||
    (scope === "identity" && status !== 401)
  ) {
    throw new Error("权限拒绝模拟参数不合法");
  }
  state.active = { projectId, scope, status };
  state.hits = 0;
  return true;
}

/** 只点击已有 UI；禁止调用服务端写入 API 或修改浏览器的用户身份。 */
export function triggerAccessDenialInPage(scope) {
  const panel =
    scope === "list"
      ? document.querySelector(".studio-project-browser-panel")
      : document.querySelector('[aria-label="服务端工程版本"]');
  const label = scope === "list" ? "刷新" : scope === "history" ? "查询服务端历史" : "保存至服务端";
  const button = [...(panel?.querySelectorAll("button") || [])].find(
    (item) => item.textContent.trim() === label,
  );
  if (!button || button.disabled) throw new Error("权限拒绝模拟操作按钮不可用");
  button.click();
  return true;
}

export function accessDenialStateInPage() {
  const fault = globalThis.__aduiTestAccessDenial;
  const panel = document.querySelector('[aria-label="服务端工程版本"]');
  const text = panel?.textContent ?? "";
  return {
    hits: fault?.hits ?? 0,
    writeAttempts: fault?.writeAttempts ?? -1,
    baselineCleared: /CAS 基线：\s*未建立/.test(text),
    headCleared: /服务端最新修订号：\s*未查询/.test(text),
    serverRows: panel?.querySelectorAll(".studio-version-item").length ?? -1,
    browserRows: document.querySelectorAll(".studio-project-browser-item").length,
  };
}

async function prepareAccessDenialBaseline(session, origin, name, selected) {
  await session.send("Page.navigate", { url: origin + "/" });
  await waitFor(
    () =>
      session.evaluate(function (expected) {
        return location.origin === expected && document.readyState === "complete";
      }, origin),
    name + " 权限模拟首页加载",
  );
  assert.equal(await session.evaluate(enterStudioInPage), true);
  await session.evaluate(function () {
    const menu = document.querySelector(".studio-project-browser-menu");
    if (!menu) throw new Error("未找到工程管理入口");
    menu.open = true;
  });
  await waitFor(async () => {
    const state = await session.evaluate(pageStateInPage);
    return state?.ids.includes(selected.projectId) && !state.busy ? state : null;
  }, name + " 权限模拟工程列表加载");
  const opened = await session.evaluate(
    openProjectInPage,
    selected.projectId,
    selected.headRevision,
    "confirm",
  );
  assert.deepEqual(opened, { confirmCount: 1, intercepted: 0, outcome: "confirm" });
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const before = await inspectStudioState(session);
  assert.ok(before.server.includes("CAS 基线：" + selected.headRevision));
  return before;
}

/** 真实 Keycloak 只负责登录；401/403/404 与所有写请求在隔离浏览器本地模拟。 */
async function verifyAccessDenialScenarios(session, origin, name, selected) {
  const scenarios = [
    { status: 401, scope: "history", title: "401 身份拒绝后的服务端版本缓存" },
    { status: 403, scope: "list", title: "403 工程列表拒绝后的父级 CAS 失效" },
    { status: 404, scope: "detail", title: "404 工程撤权后的重复保存阻断" },
  ];
  for (const scenario of scenarios) {
    process.stdout.write(name + "：正在验证模拟 " + scenario.title + "\n");
    const before = await prepareAccessDenialBaseline(session, origin, name, selected);
    assert.equal(
      await session.evaluate(
        armAccessDenialInPage,
        selected.projectId,
        scenario.scope,
        scenario.status,
      ),
      true,
    );
    assert.equal(await session.evaluate(triggerAccessDenialInPage, scenario.scope), true);
    const result = await waitFor(async () => {
      const state = await session.evaluate(accessDenialStateInPage);
      if (
        state.hits > 0 &&
        state.baselineCleared &&
        state.headCleared &&
        state.serverRows === 0 &&
        state.browserRows === 0
      ) {
        return state;
      }
      return null;
    }, name + " 权限拒绝后旧服务端缓存清除");
    assert.equal(result.writeAttempts, 0, name + " 拒绝路径不应向服务端尝试写入");

    const after = await inspectStudioState(session);
    assert.equal(after.canvas, before.canvas, name + " 权限拒绝改变了本地画布");
    assert.deepEqual(after.drafts, before.drafts, name + " 权限拒绝改变了 IndexedDB 草稿");
    assert.equal(after.autoSave, before.autoSave, name + " 权限拒绝修改了本地自动保存状态");

    if (scenario.scope === "detail") {
      assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
      assert.equal(await session.evaluate(triggerAccessDenialInPage, "detail"), true);
      assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
      const again = await session.evaluate(accessDenialStateInPage);
      assert.equal(again.hits, result.hits, name + " 重复保存不应重新查询已拒绝的工程");
      assert.equal(again.writeAttempts, 0, name + " 重复保存不应发起工程创建或追加");
      const preserved = await inspectStudioState(session);
      assert.equal(preserved.canvas, before.canvas);
      assert.deepEqual(preserved.drafts, before.drafts);
    }
  }
}

/** 在可见的 Studio 页面模拟一次浏览器切回事件，不发起任何写请求。 */
export function triggerStudioResumeInPage() {
  if (document.visibilityState !== "visible") {
    throw new Error("标签页恢复测试要求浏览器页面处于可见状态");
  }
  document.dispatchEvent(new Event("visibilitychange"));
  return true;
}

/** 修订号变化仍通过真实 GET 摘要模拟，绝不修改服务端版本。 */
function armResumeRevisionDriftInPage(projectId) {
  globalThis.__aduiTestProjectRevisionFault = { projectId, calls: 0 };
  return true;
}

function resumeCheckStateInPage() {
  const panel = document.querySelector('[aria-label="服务端工程版本"]');
  const text = panel?.textContent ?? "";
  return {
    driftHits: globalThis.__aduiTestProjectRevisionFault?.calls ?? 0,
    notice: document.querySelector(".studio-notice")?.textContent ?? "",
    baselineCleared: /CAS 基线：\s*未建立/.test(text),
    headCleared: /服务端最新修订号：\s*未查询/.test(text),
    serverRows: panel?.querySelectorAll(".studio-version-item").length ?? -1,
    writeAttempts: globalThis.__aduiTestAccessDenial?.writeAttempts ?? -1,
  };
}

/** 双端只读验证标签页恢复时 401、404 和版本漂移不会污染本地草稿。 */
async function verifyResumeScenarios(session, origin, name, selected) {
  const scenarios = [
    { scope: "identity", status: 401, title: "认证会话过期" },
    { scope: "detail", status: 404, title: "工程授权撤销" },
    { scope: "revision", status: 200, title: "其他标签页推进远端版本" },
  ];
  for (const scenario of scenarios) {
    process.stdout.write(name + "：正在验证标签页恢复时" + scenario.title + "\n");
    await prepareAccessDenialBaseline(session, origin, name, selected);
    assert.equal(await session.evaluate(saveDraftInPage), true);
    const before = await inspectStudioState(session);
    assert.ok(before.drafts.count >= 1, name + " 恢复测试前需存在 IndexedDB 草稿");

    if (scenario.scope === "revision") {
      assert.equal(await session.evaluate(armResumeRevisionDriftInPage, selected.projectId), true);
    } else {
      assert.equal(
        await session.evaluate(
          armAccessDenialInPage,
          selected.projectId,
          scenario.scope,
          scenario.status,
        ),
        true,
      );
    }
    assert.equal(await session.evaluate(triggerStudioResumeInPage), true);
    if (scenario.scope === "revision") {
      const checked = await waitFor(async () => {
        const state = await session.evaluate(resumeCheckStateInPage);
        if (
          state.driftHits > 0 &&
          state.baselineCleared &&
          state.headCleared &&
          state.serverRows === 0
        ) {
          return state;
        }
        return null;
      }, name + " 标签页恢复时 CAS 版本变化");
      assert.ok(checked.notice.includes("服务端版本已变化"));
      assert.equal(checked.writeAttempts, 0);
    } else {
      const checked = await waitFor(async () => {
        const state = await session.evaluate(accessDenialStateInPage);
        if (
          state.hits > 0 &&
          state.baselineCleared &&
          state.headCleared &&
          state.serverRows === 0 &&
          state.browserRows === 0
        ) {
          return state;
        }
        return null;
      }, name + " 标签页恢复时访问失效");
      assert.equal(checked.writeAttempts, 0, name + " 恢复可见不能触发工程写入");
    }
    const after = await inspectStudioState(session);
    assert.equal(after.canvas, before.canvas, name + " 恢复校验修改了本地画布");
    assert.deepEqual(after.drafts, before.drafts, name + " 恢复校验修改了草稿");
    assert.equal(after.autoSave, before.autoSave, name + " 恢复校验修改了自动保存");
  }
}

/**
 * 仅从固定布尔状态生成可公开的延迟保存故障类别，不回显工程、身份或异常正文。
 * 此函数只在 Node 测试层调用，不注入浏览器页面。
 */
export function describeSaveTimingTimeout(name, status, phase, state) {
  if (
    !["React", "Vue"].includes(name) ||
    ![401, 409, 503].includes(status) ||
    !["pending", "completed"].includes(phase)
  ) {
    return "浏览器延迟保存状态异常（已脱敏）";
  }
  let reason;
  if (!state || typeof state !== "object") {
    reason = "无法读取浏览器状态";
  } else if (state.hits !== 1) {
    reason = "版本 POST 未命中";
  } else if (state.writeAttempts !== 1) {
    reason = "工程写入次数异常";
  } else if (phase === "pending") {
    reason = !state.busy
      ? "操作忙碌状态未保持"
      : !state.disabled
        ? "保存按钮未禁用"
        : "无法读取浏览器状态";
  } else {
    reason = state.busy
      ? "保存操作未结束"
      : !state.hasError
        ? "页面未显示拒绝错误"
        : "无法读取浏览器状态";
  }
  return name + " 延迟保存 " + status + "：" + reason;
}

/** 保存结果必须反映共享 CAS；只输出框架和固定状态，不暴露工程详情。 */
export function requireSaveTimingBaseline(name, status, cleared, expected) {
  if (cleared === expected) return true;
  if (
    !["React", "Vue"].includes(name) ||
    ![401, 409, 503].includes(status) ||
    typeof cleared !== "boolean" ||
    typeof expected !== "boolean"
  ) {
    throw new Error("浏览器延迟保存状态异常（已脱敏）");
  }
  throw new Error(name + " 延迟保存 " + status + "：CAS 基线状态不符合预期");
}

/** 保存请求的两段独立等待只检查受控状态，超时后返回固定类别。 */
async function waitForSaveTimingStage(session, name, status, phase) {
  const label =
    name + " " + status + (phase === "pending" ? " 版本追加请求挂起" : " 延迟保存拒绝后界面恢复");
  try {
    return await waitFor(async () => {
      const state = await session.evaluate(saveTimingStateInPage);
      const matched =
        phase === "pending"
          ? state.hits === 1 && state.busy && state.disabled
          : !state.busy && state.hasError;
      return matched ? state : null;
    }, label);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== label + "未达到预期状态") {
      throw error;
    }
    let state;
    try {
      state = await session.evaluate(saveTimingStateInPage);
    } catch {
      state = null;
    }
    throw new Error(describeSaveTimingTimeout(name, status, phase, state));
  }
}

/** 两端均由真实 UI 发起版本追加；隔离浏览器持有 POST 回包但从不向 Lab 转发写请求。 */
async function verifySaveTimingScenarios(session, origin, name, selected) {
  const scenarios = [
    { status: 409, title: "旧 CAS 水位冲突", baselineCleared: true },
    { status: 401, title: "服务端身份过期", baselineCleared: true },
    { status: 503, title: "服务端暂时不可用", baselineCleared: false },
  ];
  for (const scenario of scenarios) {
    process.stdout.write(name + "：正在验证延迟保存响应与" + scenario.title + "\n");
    const before = await prepareAccessDenialBaseline(session, origin, name, selected);
    assert.ok(before.server.includes("CAS 基线：" + selected.headRevision));
    assert.equal(
      await session.evaluate(armSaveTimingInPage, selected.projectId, scenario.status),
      true,
    );
    assert.equal(await session.evaluate(triggerSaveTimingInPage), true);
    process.stdout.write(name + "：" + scenario.status + " 保存已触发，等待唯一版本 POST\n");
    const pending = await waitForSaveTimingStage(session, name, scenario.status, "pending");
    assert.equal(pending.writeAttempts, 1, name + " 重复点击不得额外发起版本写入");
    const during = await inspectStudioState(session);
    assert.equal(during.canvas, before.canvas, name + " 保存等待期间改变了本地画布");
    assert.deepEqual(during.drafts, before.drafts, name + " 保存等待期间改变了草稿");
    assert.equal(during.autoSave, before.autoSave, name + " 保存等待期间改变了自动保存");

    assert.equal(await session.evaluate(releaseSaveTimingInPage), true);
    process.stdout.write(name + "：" + scenario.status + " 已释放合成拒绝，等待界面恢复\n");
    const completed = await waitForSaveTimingStage(session, name, scenario.status, "completed");
    assert.equal(completed.writeAttempts, 1, name + " 失败后不得自动重试写入");
    assert.equal(
      requireSaveTimingBaseline(
        name,
        scenario.status,
        completed.baselineCleared,
        scenario.baselineCleared,
      ),
      true,
    );
    const after = await inspectStudioState(session);
    assert.equal(after.canvas, before.canvas, name + " 保存失败改变了本地画布");
    assert.deepEqual(after.drafts, before.drafts, name + " 保存失败改变了草稿");
    assert.equal(after.autoSave, before.autoSave, name + " 保存失败改变了自动保存");

    if (scenario.status === 409) {
      process.stdout.write(name + "：正在通过真实 UI 只读预览冲突后的最新服务端版本\n");
      assert.equal(await session.evaluate(triggerConflictPreviewInPage), true);
      const preview = await waitFor(async () => {
        const state = await session.evaluate(conflictPreviewStateInPage);
        const previewReady =
          !state.busy && state.comparisonVisible && state.previewRevision === selected.headRevision;
        return previewReady ? state : null;
      }, name + " 冲突恢复只读预览最新服务端版本");
      assert.equal(preview.writeAttempts, 1, name + " 预览不允许额外写入工程");
      assert.equal(preview.baselineCleared, true, name + " 只读预览不应建立 CAS 基线");
      assert.equal(preview.hasError, false, name + " 只读预览必须核验真实快照");
      const preserved = await inspectStudioState(session);
      assert.equal(preserved.canvas, before.canvas, name + " 只读预览改变了本地画布");
      assert.deepEqual(preserved.drafts, before.drafts, name + " 只读预览改变了草稿");
      assert.equal(preserved.autoSave, before.autoSave, name + " 只读预览修改了自动保存");

      process.stdout.write(name + "：正在确认载入已核验的服务端最新版本\n");
      const loaded = await session.evaluate(
        confirmPreviewedServerVersionInPage,
        selected.headRevision,
      );
      assert.deepEqual(loaded, { confirmed: true, confirmCount: 1 });
      assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
      const afterLoad = await inspectStudioState(session);
      assert.deepEqual(afterLoad.drafts, before.drafts, name + " 确认载入修改了 IndexedDB 草稿");
      assert.equal(afterLoad.autoSave, false, name + " 确认载入后未暂停自动保存");
      assert.ok(
        afterLoad.server.includes("CAS 基线：" + selected.headRevision),
        name + " 确认载入未建立原服务器最新 CAS 基线",
      );
      const confirmedState = await session.evaluate(conflictPreviewStateInPage);
      assert.equal(confirmedState.writeAttempts, 1, name + " 确认载入不允许额外写入");
    }
  }
}

/** 只点击真实 Studio 服务端版本列表的载入按钮，模拟操作员明确确认。 */
export async function confirmPreviewedServerVersionInPage(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("冲突恢复确认载入版本参数不合法");
  }
  const panel = document.querySelector('[aria-label="服务端工程版本"]');
  const row = [...(panel?.querySelectorAll(".studio-version-item") ?? [])].find(
    (item) => item.querySelector("strong")?.textContent.trim() === "服务端版本 #" + revision,
  );
  const button = [...(row?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "载入",
  );
  if (!button || button.disabled) throw new Error("冲突恢复确认载入按钮不可用");
  const originalConfirm = window.confirm;
  let confirmCount = 0;
  window.confirm = () => {
    confirmCount += 1;
    return true;
  };
  try {
    button.click();
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      const notice = document.querySelector(".studio-notice")?.textContent ?? "";
      const busy = [...(panel?.querySelectorAll(".studio-version-help") ?? [])].some(
        (element) => element.textContent?.includes("正在处理工程版本"),
      );
      if (
        confirmCount === 1 &&
        !busy &&
        notice.includes("已载入服务端最新版本 #" + revision)
      ) {
        return { confirmed: true, confirmCount };
      }
      if (confirmCount > 0 && !busy && panel?.querySelector('[role="alert"]')) {
        throw new Error("冲突恢复确认载入未通过受控复核");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("冲突恢复确认载入超时");
  } finally {
    window.confirm = originalConfirm;
  }
}

export async function openProjectInPage(projectId, headRevision, mode) {
  const panel = document.querySelector(".studio-project-browser-panel");
  const item = [...(panel?.querySelectorAll(".studio-project-browser-item") || [])].find(
    (node) => node.querySelector("code")?.textContent?.trim() === projectId,
  );
  const button = item?.querySelector("button");
  if (!button || button.disabled) throw new Error("工程打开按钮不可用");
  let confirmCount = 0;
  const fault = { projectId, calls: 0 };
  const originalConfirm = window.confirm;
  const versionPanel = document.querySelector('[aria-label="服务端工程版本"]');
  const errorBeforeClick = versionPanel?.querySelector('[role="alert"]')?.textContent ?? "";
  let newActionObserved = false;
  let previousErrorCleared = false;
  if (!["cancel", "conflict", "confirm", "confirm-drift"].includes(mode)) {
    throw new Error("工程安全载入流程模式不合法");
  }
  if (mode === "conflict") globalThis.__aduiTestProjectRevisionFault = fault;
  window.confirm = () => {
    confirmCount += 1;
    if (mode === "confirm-drift") globalThis.__aduiTestProjectRevisionFault = fault;
    return mode === "confirm" || mode === "confirm-drift";
  };
  try {
    button.click();
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      const notice = document.querySelector(".studio-notice")?.textContent ?? "";
      const error = versionPanel?.querySelector('[role="alert"]')?.textContent ?? "";
      const busy = [...(versionPanel?.querySelectorAll(".studio-version-help") ?? [])].some(
        (node) => node.textContent?.includes("正在处理工程版本"),
      );
      // 只把本次出现的错误当成载入失败；旧错误跨过忙碌阶段也不能误报。
      if (errorBeforeClick && !error) previousErrorCleared = true;
      if (busy || error !== errorBeforeClick) newActionObserved = true;
      if (mode === "conflict" && fault.calls > 0 && error.includes("服务端工程版本已更新")) {
        return { confirmCount, intercepted: fault.calls, outcome: "conflict" };
      }
      if (
        mode === "confirm-drift" &&
        confirmCount === 1 &&
        fault.calls === 1 &&
        error.includes("确认载入时服务端版本已变化")
      ) {
        return { confirmCount, intercepted: fault.calls, outcome: "confirm-drift" };
      }
      if (mode === "cancel" && confirmCount > 0) {
        return { confirmCount, intercepted: fault.calls, outcome: "cancel" };
      }
      if (mode === "confirm" && confirmCount > 0 && notice.includes("CAS 基线已建立")) {
        return { confirmCount, intercepted: fault.calls, outcome: "confirm" };
      }
      if (
        error &&
        mode !== "conflict" &&
        newActionObserved &&
        !busy &&
        (error !== errorBeforeClick || previousErrorCleared)
      ) {
        // 只允许已审核的固定诊断类别，不能把页面错误正文带回 Node 进程。
        const category = error.includes("登录已失效")
          ? "身份过期"
          : error.includes("当前操作未获得授权") || error.includes("工程不存在或无权访问")
            ? "权限拒绝"
            : error.includes("服务端工程版本已更新") || error.includes("工程存在冲突")
              ? "版本冲突"
              : error.includes("快照完整性校验失败")
                ? "快照校验"
                : error.includes("网络请求失败") || error.includes("读取服务端响应失败")
                  ? "网络故障"
                  : error.includes("服务端暂时无法完成请求")
                    ? "服务故障"
                    : error.includes("服务端返回") || error.includes("服务端响应")
                      ? "协议响应"
                      : null;
        const phase = confirmCount === 0 ? "确认前" : "确认后";
        throw new Error(
          category
            ? "服务器工程载入阶段返回受控错误（" + phase + "：" + category + "）"
            : "服务器工程载入阶段返回受控错误（" + phase + "）",
        );
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error("工程安全载入流程超时");
  } finally {
    window.confirm = originalConfirm;
    delete globalThis.__aduiTestProjectRevisionFault;
  }
}

export function clickBrowserControlInPage(kind) {
  const panel = document.querySelector(".studio-project-browser-panel");
  const buttons = [...(panel?.querySelectorAll(".studio-project-browser-pagination button") || [])];
  const button = kind === "next" ? buttons[1] : buttons[0];
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

/** 对工程授权列表的 HTTP 状态进行受控归类，拒绝向终端带回响应正文。 */
export function requireAuthorizedProjectPage(result) {
  if (!result || result.status !== 200) {
    const error = new Error("服务端工程列表状态异常");
    error.httpStatus = result?.status;
    throw error;
  }
  return result.projects;
}

/**
 * 严格多页验收必须真正访问过包含授权工程的第二页。
 * 仅用于隔离浏览器测试，不修改服务端或权限表。
 */
export function requireRealMultiPageCoverage(covered, required) {
  if (required && !covered) {
    throw new Error("真实多页验收要求至少十一项已授权工程，当前未覆盖有效的第二页");
  }
}

/** 写入模式与只读验收严格分开，只有显式确认的本机 Lab 能创建测试工程。 */
export function resolveProjectBrowserMode(parameters, env) {
  if (parameters.length === 0) return { requireMultiPage: false, prepareMultiPage: false };
  if (parameters.length === 1 && parameters[0] === "--require-multipage") {
    return { requireMultiPage: true, prepareMultiPage: false };
  }
  if (parameters.length === 1 && parameters[0] === "--simulate-access-denial") {
    return { requireMultiPage: false, prepareMultiPage: false, simulateAccessDenial: true };
  }
  if (parameters.length === 1 && parameters[0] === "--simulate-resume-check") {
    return { requireMultiPage: false, prepareMultiPage: false, simulateResumeCheck: true };
  }
  if (parameters.length === 1 && parameters[0] === "--simulate-save-timing") {
    return { requireMultiPage: false, prepareMultiPage: false, simulateSaveTiming: true };
  }
  if (
    parameters.length === 3 &&
    parameters[0] === "--prepare-multipage" &&
    parameters[1] === "--confirm-lab" &&
    parameters[2] === "adui_scada"
  ) {
    try {
      resolveLabIdentityTarget(env);
    } catch {
      throw new Error("多页数据准备配置不符合本机可信 Lab 边界");
    }
    return { requireMultiPage: false, prepareMultiPage: true };
  }
  throw new Error(
    "仅支持 --require-multipage、--simulate-access-denial、--simulate-resume-check、--simulate-save-timing 或显式确认的多页数据准备参数",
  );
}

/**
 * 只从已验证的同源 BFF 会话创建最小空白工程。
 * 依靠正式创建接口生成首版、ACL 与审计；不直接写数据库、不复制现有工程数据。
 * 函数必须自包含，以便 CDP 通过 function.toString() 在页面执行。
 */
export async function prepareAuthorizedMultiPageInPage(expectedOrigin, runtime = globalThis) {
  if (runtime.location.origin !== expectedOrigin) {
    throw new Error("多页数据准备只允许本机 React Origin");
  }

  const request = async (method, path, body, csrfToken) => {
    try {
      const response = await runtime.fetch("/api/v1" + path, {
        method,
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/json",
          ...(method === "POST"
            ? { "Content-Type": "application/json", "X-SCADA-CSRF": csrfToken }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status !== (method === "POST" ? 201 : 200)) {
        throw new Error("多页数据准备服务端请求失败");
      }
      return await response.json();
    } catch {
      throw new Error("多页数据准备服务端请求失败");
    }
  };

  const identity = await request("GET", "/auth/me");
  if (
    identity?.authenticated !== true ||
    typeof identity.principal?.tenantId !== "string" ||
    typeof identity.principal?.subjectId !== "string"
  ) {
    throw new Error("多页数据准备缺少可信登录会话");
  }

  const original = await request("GET", "/projects?limit=100");
  if (!Array.isArray(original) || original.length > 100) {
    throw new Error("多页数据准备列表响应无效");
  }
  if (original.length >= 11) return { before: original.length, created: 0, after: original.length };

  const tokens = runtime.document.cookie
    .split(";")
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.startsWith("__Host-adui-scada-csrf="));
  const csrfToken = tokens.length === 1 ? tokens[0].slice("__Host-adui-scada-csrf=".length) : "";
  if (!/^scada_csrf_[A-Za-z0-9_-]{43}$/.test(csrfToken)) {
    throw new Error("多页数据准备 CSRF Cookie 无效");
  }

  const needed = 11 - original.length;
  for (let index = 0; index < needed; index += 1) {
    const projectId = "b34-pages-" + runtime.crypto.randomUUID();
    const document = {
      schemaVersion: "0.3.0",
      projectId,
      tags: [],
      pages: [
        {
          id: "page-main",
          name: "多页验收测试",
          size: { width: 1920, height: 1080 },
          nodes: [],
        },
      ],
    };
    const created = await request("POST", "/projects", { document }, csrfToken);
    if (created?.projectId !== projectId || created.headRevision !== 1) {
      throw new Error("多页数据准备服务端请求失败");
    }
  }

  const first = await request("GET", "/projects?limit=10");
  const cursor = Array.isArray(first) && first.length === 10 ? first[9]?.projectId : undefined;
  if (typeof cursor !== "string") throw new Error("多页数据准备列表响应无效");
  const second = await request(
    "GET",
    "/projects?limit=10&afterProjectId=" + encodeURIComponent(cursor),
  );
  if (!Array.isArray(second) || second.length === 0) {
    throw new Error("多页数据准备未能建立有效的第二页");
  }
  return { before: original.length, created: needed, after: original.length + needed };
}

async function verifyStudio(session, origin, name, requireMultiPage) {
  const report = (phase) => process.stdout.write(name + "：正在验证" + phase + "\n");
  report("首页加载与组态入口");
  await session.send("Page.navigate", { url: origin + "/" });
  await waitFor(
    () =>
      session.evaluate(async function (expected) {
        return location.origin === expected && document.readyState === "complete";
      }, origin),
    name + " 首页加载",
  );
  assert.equal(await session.evaluate(enterStudioInPage), true, name + " 无法进入 Studio");
  report("真实 BFF 会话与授权工程列表");
  const authenticated = await session.evaluate(authenticatedInPage, origin);
  if (authenticated !== true) {
    throw new Error(name === "React" ? "React BFF 会话未通过验证" : "Vue BFF 会话未通过验证");
  }

  const initial = requireAuthorizedProjectPage(await session.evaluate(projectsInPage));
  if (initial.length === 0) {
    throw new Error(name + " 隔离 Lab 没有授权工程，请先由维护者按受控流程准备至少一份工程");
  }
  report("工程管理菜单与首页摘要");
  await session.evaluate(function () {
    const menu = document.querySelector(".studio-project-browser-menu");
    if (!menu) throw new Error("未找到工程管理入口");
    menu.open = true;
  });
  const first = await waitFor(async () => {
    const state = await session.evaluate(pageStateInPage);
    return state && !state.busy && (state.ids.length > 0 || state.empty || state.error)
      ? state
      : null;
  }, name + " 工程管理列表");
  assert.equal(first.error, false, name + " 工程管理返回错误");
  assert.deepEqual(
    first.ids,
    initial.map((p) => p.projectId),
  );
  assert.deepEqual(
    first.revisions,
    initial.map((p) => p.headRevision),
  );
  assert.equal(first.pageNumber, 1);
  assert.equal(first.prevEnabled, false);
  report("授权工程分页");
  let paginated = false;
  if (first.nextEnabled) {
    const next = requireAuthorizedProjectPage(
      await session.evaluate(projectsInPage, initial.at(-1).projectId),
    );
    assert.equal(await session.evaluate(clickBrowserControlInPage, "next"), true);
    const second = await waitFor(async () => {
      const state = await session.evaluate(pageStateInPage);
      if (next.length === 0) return state && !state.busy && !state.nextEnabled ? state : null;
      return state?.pageNumber === 2 && !state.busy ? state : null;
    }, name + " 下一页");
    assert.deepEqual(second.ids, next.length ? next.map((p) => p.projectId) : first.ids);
    if (next.length) {
      assert.equal(await session.evaluate(clickBrowserControlInPage, "previous"), true);
      const back = await waitFor(async () => {
        const state = await session.evaluate(pageStateInPage);
        return state?.pageNumber === 1 && !state.busy ? state : null;
      }, name + " 上一页");
      assert.deepEqual(back.ids, first.ids);
      paginated = true;
    }
  }

  requireRealMultiPageCoverage(paginated, requireMultiPage);
  report("临时 IndexedDB 草稿保存与自动保存");
  assert.equal(await session.evaluate(saveDraftInPage), true);
  assert.equal(await session.evaluate(enableAutoSaveInPage), true);
  const baseline = await inspectStudioState(session);
  assert.ok(baseline.drafts.count >= 1);
  assert.equal(baseline.autoSave, true);

  report("取消载入与画布保护");
  const selected = initial[0];
  const canceled = await session.evaluate(
    openProjectInPage,
    selected.projectId,
    selected.headRevision,
    "cancel",
  );
  assert.deepEqual(canceled, { confirmCount: 1, intercepted: 0, outcome: "cancel" });
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const afterCancel = await inspectStudioState(session);
  assert.equal(afterCancel.canvas, baseline.canvas, name + " 取消载入改变了画布");
  assert.deepEqual(afterCancel.drafts, baseline.drafts, name + " 取消载入修改了 IndexedDB 草稿");
  assert.equal(afterCancel.autoSave, true, name + " 取消载入停止了自动保存");

  report("模拟远端修订水位冲突");
  const conflict = await session.evaluate(
    openProjectInPage,
    selected.projectId,
    selected.headRevision,
    "conflict",
  );
  assert.deepEqual(conflict, { confirmCount: 0, intercepted: 1, outcome: "conflict" });
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const afterConflict = await inspectStudioState(session);
  assert.equal(afterConflict.canvas, baseline.canvas, name + " 模拟远端水位冲突改变了画布");
  assert.deepEqual(afterConflict.drafts, baseline.drafts, name + " 模拟远端水位冲突修改了草稿");
  assert.equal(afterConflict.autoSave, true, name + " 模拟远端水位冲突停止了自动保存");

  report("模拟确认框之后远端追加版本并阻断载入");
  const confirmedDrift = await session.evaluate(
    openProjectInPage,
    selected.projectId,
    selected.headRevision,
    "confirm-drift",
  );
  assert.deepEqual(confirmedDrift, {
    confirmCount: 1,
    intercepted: 1,
    outcome: "confirm-drift",
  });
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const afterConfirmedDrift = await inspectStudioState(session);
  assert.equal(afterConfirmedDrift.canvas, baseline.canvas, name + " 确认后版本变化修改了画布");
  assert.deepEqual(afterConfirmedDrift.drafts, baseline.drafts, name + " 确认后版本变化修改了草稿");
  assert.equal(afterConfirmedDrift.autoSave, true, name + " 确认后版本变化暂停了自动保存");
  assert.ok(afterConfirmedDrift.server.includes("CAS 基线：未建立"));

  report("确认载入与 CAS 基线");
  const opened = await session.evaluate(
    openProjectInPage,
    selected.projectId,
    selected.headRevision,
    "confirm",
  );
  assert.deepEqual(opened, { confirmCount: 1, intercepted: 0, outcome: "confirm" });
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const afterOpen = await inspectStudioState(session);
  assert.equal(afterOpen.autoSave, false, name + " 载入后未暂停自动保存");
  assert.deepEqual(afterOpen.drafts, baseline.drafts, name + " 服务端载入覆盖了 IndexedDB 草稿");
  assert.ok(afterOpen.server.includes("CAS 基线：" + selected.headRevision));
  assert.ok(afterOpen.server.includes("当前工程：" + selected.projectId));
  process.stdout.write(
    name +
      " 已验证可信身份、工程列表、取消保护、模拟水位冲突与确认载入；" +
      (paginated ? "上一页/下一页通过" : "授权工程不足十一项，未覆盖有效的下一页") +
      "\n",
  );
}

async function run() {
  if (existsSync(ROOT_ENV)) loadEnvFile(ROOT_ENV);
  const mode = resolveProjectBrowserMode(process.argv.slice(2), process.env);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = browserExecutable();
  if (!executable) throw new Error("未找到本机 Chrome/Edge 浏览器");
  for (const origin of origins) {
    const response = await fetch(origin + "/");
    if (!response.ok || response.url !== origin + "/") {
      throw new Error("本机可信 HTTPS Web 服务未就绪");
    }
  }
  const temp = mkdtempSync(join(tmpdir(), "adui-scada-oidc-browser-"));
  const args = [
    "--no-first-run",
    "--no-default-browser-check",
    "--no-proxy-server",
    "--remote-debugging-port=0",
    "--user-data-dir=" + temp,
    "about:blank",
  ];
  const child = spawn(executable, args, { stdio: "ignore" });
  let session;
  try {
    const port = await waitForPort(temp, child);
    const response = await fetch("http://" + LOOPBACK + ":" + port + "/json/new?about:blank", {
      method: "PUT",
    });
    assert.ok(response.ok, "浏览器调试标签页无法创建");
    const tab = await response.json();
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    session = new ChromeSession(socket);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("Page.navigate", { url: origins[0] + "/api/v1/auth/oidc/start" });
    process.stdout.write(
      "请在新打开的隔离浏览器中使用已预绑定的普通 Keycloak 测试用户完成登录；不要在终端输入或粘贴密码。\n",
    );
    await waitFor(
      () => session.evaluate(authenticatedInPage, origins[0]),
      "真实 OIDC 登录",
      180000,
    );
    if (mode.prepareMultiPage) {
      const result = await session.evaluate(prepareAuthorizedMultiPageInPage, origins[0]);
      process.stdout.write(
        "本机 OIDC Lab 数据准备完成：原有 " +
          result.before +
          " 项，本次新建 " +
          result.created +
          " 项，当前至少 " +
          result.after +
          " 项授权工程。请独立运行严格双框架多页验收。\n",
      );
      return;
    }
    // 必须在 React/Vue Studio 加载前安装，API Client 构造时会捕获 Fetch 函数。
    await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source:
        "(" +
        installRevisionConflictFaultInPage.toString() +
        ")();" +
        (mode.simulateAccessDenial || mode.simulateResumeCheck || mode.simulateSaveTiming
          ? "(" + installAccessDenialFaultInPage.toString() + ")();"
          : ""),
    });
    process.stdout.write("真实 OIDC 会话已在 React Origin 验证，开始双框架只读工程验收。\n");
    await verifyStudio(session, origins[0], "React", mode.requireMultiPage);
    if (mode.simulateAccessDenial || mode.simulateResumeCheck || mode.simulateSaveTiming) {
      const projects = requireAuthorizedProjectPage(await session.evaluate(projectsInPage));
      if (mode.simulateAccessDenial) {
        await verifyAccessDenialScenarios(session, origins[0], "React", projects[0]);
      } else if (mode.simulateSaveTiming) {
        await verifySaveTimingScenarios(session, origins[0], "React", projects[0]);
      } else {
        await verifyResumeScenarios(session, origins[0], "React", projects[0]);
      }
    }
    await verifyStudio(session, origins[1], "Vue", mode.requireMultiPage);
    if (mode.simulateAccessDenial || mode.simulateResumeCheck || mode.simulateSaveTiming) {
      const projects = requireAuthorizedProjectPage(await session.evaluate(projectsInPage));
      if (mode.simulateAccessDenial) {
        await verifyAccessDenialScenarios(session, origins[1], "Vue", projects[0]);
      } else if (mode.simulateSaveTiming) {
        await verifySaveTimingScenarios(session, origins[1], "Vue", projects[0]);
      } else {
        await verifyResumeScenarios(session, origins[1], "Vue", projects[0]);
      }
    }
    process.stdout.write(
      mode.simulateAccessDenial
        ? "双框架模拟 401/403/404 授权拒绝专项通过；工程写入已在浏览器阻断，Lab ACL 未修改。\n"
        : mode.simulateResumeCheck
          ? "双框架标签页重新可见只读复核专项通过；工程写入已在浏览器阻断，Lab ACL 未修改。\n"
          : mode.simulateSaveTiming
            ? "双框架延迟保存拒绝与重复提交专项通过；版本 POST 已在浏览器阻断，Lab 工程与 ACL 未修改。\n"
            : "双框架 OIDC 工程管理专项通过；服务端工程未新增、未覆盖、未发布。\n",
    );
  } finally {
    session?.socket.close();
    child.kill();
    await pause(500);
    try {
      rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    } catch {
      // 浏览器进程可能尚未释放临时 Profile，交由系统回收。
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeProjectBrowserFailure(error) + "\n");
    process.exitCode = 1;
  });
}
