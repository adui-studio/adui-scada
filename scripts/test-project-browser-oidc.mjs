import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolveReadonlyProbeOrigins } from "./verify-oidc-https-readonly.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const LOOPBACK = "127.0.0.1";

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
]);

/** 仅输出固定的安全诊断，拒绝把异常中的 Cookie、URL 或页面数据写入终端。 */
export function describeProjectBrowserFailure(error) {
  const message = error instanceof Error ? error.message : "";
  if (SAFE_FAILURES.has(message)) return message;
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
  if (
    env.NODE_EXTRA_CA_CERTS !== undefined &&
    !existsSync(env.NODE_EXTRA_CA_CERTS)
  ) {
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
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("浏览器调试命令超时：" + method));
      }, method === "Runtime.evaluate" ? 45000 : 15000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(action, ...args) {
    const expression = "(" + action.toString() + ")(" + args.map((a) => JSON.stringify(a)).join(",") + ")";
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error("浏览器页面操作失败，请检查当前 Studio 状态");
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
    return payload.authenticated === true &&
      typeof payload.principal?.tenantId === "string" &&
      typeof payload.principal?.subjectId === "string";
  } catch {
    return false;
  }
}

async function enterStudioInPage() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const nav = document.querySelector(".scada-app-nav");
    const button = [...(nav?.querySelectorAll("button") || [])].find((item) =>
      item.textContent.trim() === "组态编辑"
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
  if (!response.ok) throw new Error("授权工程列表接口拒绝读取");
  const data = await response.json();
  if (!Array.isArray(data) || data.length > 10) throw new Error("服务端列表分页契约不正确");
  return data.map(({ projectId, headRevision }) => ({ projectId, headRevision }));
}

function pageStateInPage() {
  const panel = document.querySelector(".studio-project-browser-panel");
  if (!panel) return null;
  const buttons = [...panel.querySelectorAll(".studio-project-browser-pagination button")];
  const items = [...panel.querySelectorAll(".studio-project-browser-item")];
  return {
    ids: items.map((item) => item.querySelector("code")?.textContent?.trim()),
    revisions: items.map((item) => Number(item.querySelector("small")?.textContent?.match(/#(\d+)/)?.[1])),
    empty: Boolean(panel.querySelector(".studio-project-browser-empty")),
    error: Boolean(panel.querySelector('[role="alert"]')),
    busy: [...panel.querySelectorAll('button')].some((item) => item.disabled && item.textContent.trim() === "刷新"),
    prevEnabled: buttons[0] ? !buttons[0].disabled : false,
    nextEnabled: buttons[1] ? !buttons[1].disabled : false,
    pageNumber: Number(panel.querySelector(".studio-project-browser-pagination span")?.textContent?.match(/第\s*(\d+)\s*页/)?.[1]),
  };
}

async function waitForStudioActionIdleInPage() {
  for (let retry = 0; retry < 120; retry += 1) {
    const busy = [...document.querySelectorAll('[aria-label="服务端工程版本"] .studio-version-help')].some(
      (node) => node.textContent?.includes("正在处理工程版本")
    );
    const blocked = [...document.querySelectorAll(".studio-project-browser-item button")].some(
      (button) => button.disabled
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

async function stateInPage() {
  return {
    canvas: document.querySelector(".studio-svg")?.innerHTML ?? "",
    server: document.querySelector('[aria-label="服务端工程版本"]')?.textContent ?? "",
    autoSave: document.querySelector('.studio-file-menu button[aria-pressed="true"]') !== null,
    drafts: await readBrowserDraftsInPage(),
  };
}

async function saveDraftInPage() {
  const button = [...document.querySelectorAll("button")].find((item) =>
    item.textContent.trim() === "保存草稿"
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

async function enableAutoSaveInPage() {
  const menu = document.querySelector(".studio-file-menu");
  if (!menu) throw new Error("没有找到草稿操作菜单");
  menu.open = true;
  const button = [...menu.querySelectorAll("button")].find((item) =>
    item.textContent.trim() === "开启自动保存"
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

async function openProjectInPage(projectId, headRevision, mode) {
  const panel = document.querySelector(".studio-project-browser-panel");
  const item = [...(panel?.querySelectorAll(".studio-project-browser-item") || [])].find(
    (node) => node.querySelector("code")?.textContent?.trim() === projectId
  );
  const button = item?.querySelector("button");
  if (!button || button.disabled) throw new Error("工程打开按钮不可用");
  let confirmCount = 0;
  const fault = { projectId, calls: 0 };
  const originalConfirm = window.confirm;
  if (mode === "conflict") globalThis.__aduiTestProjectRevisionFault = fault;
  window.confirm = () => {
    confirmCount += 1;
    return mode === "confirm";
  };
  try {
    button.click();
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      const notice = document.querySelector(".studio-notice")?.textContent ?? "";
      const error = document.querySelector('[aria-label="服务端工程版本"] [role="alert"]')?.textContent ?? "";
      if (mode === "conflict" && fault.calls > 0 && error.includes("服务端工程版本已更新")) {
        return { confirmCount, intercepted: fault.calls, outcome: "conflict" };
      }
      if (mode === "cancel" && confirmCount > 0) {
        return { confirmCount, intercepted: fault.calls, outcome: "cancel" };
      }
      if (mode === "confirm" && confirmCount > 0 && notice.includes("CAS 基线已建立")) {
        return { confirmCount, intercepted: fault.calls, outcome: "confirm" };
      }
      if (error && mode !== "conflict") throw new Error("服务器工程载入阶段返回受控错误");
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error("工程安全载入流程超时");
  } finally {
    window.confirm = originalConfirm;
    delete globalThis.__aduiTestProjectRevisionFault;
  }
}

function clickBrowserControlInPage(kind) {
  const panel = document.querySelector(".studio-project-browser-panel");
  const buttons = [...(panel?.querySelectorAll(".studio-project-browser-pagination button") || [])];
  const button = kind === "next" ? buttons[1] : buttons[0];
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

async function verifyStudio(session, origin, name) {
  await session.send("Page.navigate", { url: origin + "/" });
  await waitFor(
    () => session.evaluate(async function (expected) {
      return location.origin === expected && document.readyState === "complete";
    }, origin),
    name + " 首页加载",
  );
  assert.equal(await session.evaluate(enterStudioInPage), true, name + " 无法进入 Studio");
  assert.equal(await session.evaluate(authenticatedInPage, origin), true, name + " 会话未通过验证");

  const initial = await session.evaluate(projectsInPage);
  if (initial.length === 0) {
    throw new Error(name + " 隔离 Lab 没有授权工程，请先由维护者按受控流程准备至少一份工程");
  }
  await session.evaluate(function () {
    const menu = document.querySelector(".studio-project-browser-menu");
    if (!menu) throw new Error("未找到工程管理入口");
    menu.open = true;
  });
  const first = await waitFor(
    async () => {
      const state = await session.evaluate(pageStateInPage);
      return state && (state.ids.length > 0 || state.empty || state.error) ? state : null;
    },
    name + " 工程管理列表",
  );
  assert.equal(first.error, false, name + " 工程管理返回错误");
  assert.deepEqual(first.ids, initial.map((p) => p.projectId));
  assert.deepEqual(first.revisions, initial.map((p) => p.headRevision));
  assert.equal(first.pageNumber, 1);
  assert.equal(first.prevEnabled, false);
  let paginated = false;
  if (first.nextEnabled) {
    const next = await session.evaluate(projectsInPage, initial.at(-1).projectId);
    assert.equal(await session.evaluate(clickBrowserControlInPage, "next"), true);
    const second = await waitFor(
      async () => {
        const state = await session.evaluate(pageStateInPage);
        if (next.length === 0) return state?.nextEnabled === false ? state : null;
        return state?.pageNumber === 2 ? state : null;
      },
      name + " 下一页",
    );
    assert.deepEqual(second.ids, next.length ? next.map((p) => p.projectId) : first.ids);
    if (next.length) {
      assert.equal(await session.evaluate(clickBrowserControlInPage, "previous"), true);
      const back = await waitFor(
        async () => {
          const state = await session.evaluate(pageStateInPage);
          return state?.pageNumber === 1 ? state : null;
        },
        name + " 上一页",
      );
      assert.deepEqual(back.ids, first.ids);
      paginated = true;
    }
  }

  assert.equal(await session.evaluate(saveDraftInPage), true);
  assert.equal(await session.evaluate(enableAutoSaveInPage), true);
  const baseline = await session.evaluate(stateInPage);
  assert.ok(baseline.drafts.count >= 1);
  assert.equal(baseline.autoSave, true);

  const selected = initial[0];
  const canceled = await session.evaluate(openProjectInPage, selected.projectId, selected.headRevision, "cancel");
  assert.deepEqual(canceled, { confirmCount: 1, intercepted: 0, outcome: "cancel" });
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const afterCancel = await session.evaluate(stateInPage);
  assert.equal(afterCancel.canvas, baseline.canvas, name + " 取消载入改变了画布");
  assert.deepEqual(afterCancel.drafts, baseline.drafts, name + " 取消载入修改了 IndexedDB 草稿");
  assert.equal(afterCancel.autoSave, true, name + " 取消载入停止了自动保存");

  const conflict = await session.evaluate(openProjectInPage, selected.projectId, selected.headRevision, "conflict");
  assert.deepEqual(conflict, { confirmCount: 0, intercepted: 1, outcome: "conflict" });
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const afterConflict = await session.evaluate(stateInPage);
  assert.equal(afterConflict.canvas, baseline.canvas, name + " 模拟远端水位冲突改变了画布");
  assert.deepEqual(afterConflict.drafts, baseline.drafts, name + " 模拟远端水位冲突修改了草稿");
  assert.equal(afterConflict.autoSave, true, name + " 模拟远端水位冲突停止了自动保存");

  const opened = await session.evaluate(openProjectInPage, selected.projectId, selected.headRevision, "confirm");
  assert.deepEqual(opened, { confirmCount: 1, intercepted: 0, outcome: "confirm" });
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const afterOpen = await session.evaluate(stateInPage);
  assert.equal(afterOpen.autoSave, false, name + " 载入后未暂停自动保存");
  assert.deepEqual(afterOpen.drafts, baseline.drafts, name + " 服务端载入覆盖了 IndexedDB 草稿");
  assert.ok(afterOpen.server.includes("CAS 基线：" + selected.headRevision));
  assert.ok(afterOpen.server.includes("当前工程：" + selected.projectId));
  process.stdout.write(name + " 已验证可信身份、工程列表、取消保护、模拟水位冲突与确认载入；" +
    (paginated ? "上一页/下一页通过" : "授权工程不足十一项，未覆盖有效的下一页") + "\n");
}

async function run() {
  if (existsSync(ROOT_ENV)) loadEnvFile(ROOT_ENV);
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
    process.stdout.write("请在新打开的隔离浏览器中使用已预绑定的普通 Keycloak 测试用户完成登录；不要在终端输入或粘贴密码。\n");
    await waitFor(
      () => session.evaluate(authenticatedInPage, origins[0]),
      "真实 OIDC 登录",
      180000,
    );
    // 必须在 React/Vue Studio 加载前安装，API Client 构造时会捕获 Fetch 函数。
    await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "(" + installRevisionConflictFaultInPage.toString() + ")()",
    });
    process.stdout.write("真实 OIDC 会话已在 React Origin 验证，开始双框架只读工程验收。\n");
    await verifyStudio(session, origins[0], "React");
    await verifyStudio(session, origins[1], "Vue");
    process.stdout.write("双框架 OIDC 工程管理专项通过；服务端工程未新增、未覆盖、未发布。\n");
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
