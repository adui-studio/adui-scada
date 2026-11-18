import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  executablePath,
  identityInPage,
  startBrowser,
  waitForLogin,
} from "./test-oidc-dual-cas.mjs";
import {
  clickBrowserControlInPage,
  enterStudioInPage,
  inspectStudioState,
  openProjectInPage,
  pageStateInPage,
  resolveProjectBrowserLab,
  waitForStudioActionIdleInPage,
} from "./test-project-browser-oidc.mjs";
import {
  openProjectBrowserMenuInPage,
  readMultiTabSessionStateInPage,
} from "./test-oidc-real-multitab.mjs";
import { readStudioContentCanvasInPage } from "./test-oidc-studio-real-late.mjs";
import {
  addStudioSymbolInPage,
  readStudioDocumentHashInPage,
} from "./test-oidc-studio-multitab.mjs";
import {
  readReleasePreflightInPage,
  requireReadonlyReleasePreflightMode,
} from "./test-oidc-release-preflight.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SAFE_FAILURES = new Set([
  "真实 Studio 发布预检仅允许无参数只读验收",
  "真实 Studio 发布预检要求本机可信 OIDC Lab",
  "真实 Studio 发布预检缺少本机 Chrome/Edge",
  "真实 Studio 发布预检 HTTPS Web 服务不可用",
  "真实 Studio 发布预检 React/Vue 可信身份不一致",
  "真实 Studio 发布预检授权工程不在管理列表",
  "真实 Studio 发布预检工程载入后 CAS 不一致",
  "真实 Studio 发布预检报告与服务端当前版本不一致",
  "真实 Studio 发布预检手动触发请求契约不一致",
  "真实 Studio 发布预检未保护当前画布和草稿",
  "真实 Studio 发布预检错误状态处理不符合预期",
]);

export function requireReadonlyStudioPreflightMode(args) {
  if (!Array.isArray(args) || args.length !== 0) {
    throw new Error("真实 Studio 发布预检仅允许无参数只读验收");
  }
  return true;
}

/** 只公开固定中文诊断，不输出浏览器异常堆栈、Token 或工程正文。 */
export function describeStudioPreflightFailure(error) {
  if (error instanceof Error && SAFE_FAILURES.has(error.message)) return error.message;
  if (error?.pageDiagnostic) return "真实 Studio 发布预检浏览器页面操作失败，内部诊断已脱敏";
  return "真实 Studio 发布预检专项未通过，内部信息已脱敏";
}

/**
 * 在真实 Web 脚本初始化前安装。任何工程 API 非 GET 均在页面内拒绝，
 * 只针对本次授权工程记录固定请求类别，模拟拒绝只覆盖预检 GET。
 * CDP 函数必须自包含，不能引用 Node 模块词法作用域。
 */
export function installStudioPreflightReadGuardInPage(origins, runtime = globalThis) {
  if (!Array.isArray(origins) || !origins.includes(runtime.location?.origin)) return false;
  if (runtime.__aduiScadaStudioPreflightGuard) {
    throw new Error("真实 Studio 发布预检安全门禁重复安装");
  }
  const originalFetch = runtime.fetch.bind(runtime);
  const state = {
    projectId: null,
    revision: null,
    simulatedStatus: null,
    requests: [],
    blockedWrites: 0,
    simulatedResponses: 0,
  };
  runtime.__aduiScadaStudioPreflightGuard = state;
  runtime.fetch = async (input, options) => {
    const raw = typeof input === "string" ? input : input?.url ?? String(input);
    const url = new URL(raw, runtime.location.origin + "/");
    if (!url.pathname.startsWith("/api/v1/projects")) {
      return originalFetch(input, options);
    }
    if (url.origin !== runtime.location.origin) {
      state.blockedWrites += 1;
      throw new Error("真实 Studio 发布预检拒绝跨 Origin 工程请求");
    }
    const method = String(options?.method ?? input?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      state.blockedWrites += 1;
      throw new Error("真实 Studio 发布预检禁止工程写入");
    }
    if (state.projectId !== null) {
      const base = "/api/v1/projects/" + encodeURIComponent(state.projectId);
      const version = base + "/versions/" + state.revision;
      const kind =
        url.pathname === base
          ? "head"
          : url.pathname === version
            ? "snapshot"
            : url.pathname === version + "/release-preflight"
              ? "preflight"
              : "unexpected";
      if (state.requests.length >= 20) throw new Error("真实 Studio 发布预检请求超过上限");
      state.requests.push(kind);
      if (kind === "preflight" && state.simulatedStatus !== null) {
        state.simulatedResponses += 1;
        return new runtime.Response(JSON.stringify({ message: "受控模拟拒绝" }), {
          status: state.simulatedStatus,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      }
    }
    return originalFetch(input, options);
  };
  return true;
}

/** 每次点击之前只设置受控当前工程、修订号和模拟 HTTP 类别。 */
export function armStudioPreflightReadGuardInPage(
  origin,
  projectId,
  revision,
  status = null,
  runtime = globalThis,
) {
  const state = runtime.__aduiScadaStudioPreflightGuard;
  if (
    runtime.location?.origin !== origin ||
    !state ||
    typeof projectId !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(projectId) ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    ![null, 401, 404, 409].includes(status)
  ) {
    throw new Error("真实 Studio 发布预检安全门禁参数无效");
  }
  state.projectId = projectId;
  state.revision = revision;
  state.simulatedStatus = status;
  state.requests = [];
  state.simulatedResponses = 0;
  return true;
}

export function studioPreflightGuardStateInPage(runtime = globalThis) {
  const state = runtime.__aduiScadaStudioPreflightGuard;
  if (!state) return null;
  return {
    requests: state.requests.slice(),
    blockedWrites: state.blockedWrites,
    simulatedResponses: state.simulatedResponses,
  };
}

/** 仅操作正式页面按钮；不调用 React/Vue 的内部函数或写入接口。 */
export function clickStudioPreflightInPage(runtime = globalThis) {
  const panel = runtime.document.querySelector('[aria-label="服务端已保存版本发布预检"]');
  const menu = panel?.closest("details");
  if (menu) menu.open = true;
  const button = [...(panel?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "检查服务端已保存版本",
  );
  if (!button || button.disabled) throw new Error("真实 Studio 发布预检按钮不可用");
  button.click();
  return true;
}

/** 只返回 UI 状态，不返回预检原始报告、工程正文或身份信息。 */
export function studioPreflightUiStateInPage(runtime = globalThis) {
  const panel = runtime.document.querySelector('[aria-label="服务端已保存版本发布预检"]');
  if (!panel) return null;
  const status = panel.querySelector('[role="status"]')?.textContent ?? "";
  const text = panel.textContent ?? "";
  const server = runtime.document.querySelector('[aria-label="服务端工程版本"]');
  const serverText = server?.textContent ?? "";
  const match = status.match(/服务端已保存版本 #(\d+)/);
  const button = [...panel.querySelectorAll("button")].find((item) =>
    item.textContent.includes("检查服务端已保存版本"),
  );
  return {
    buttonReady: Boolean(button && !button.disabled),
    revision: match ? Number(match[1]) : null,
    passed: status.includes("静态兼容性通过")
      ? true
      : status.includes("静态兼容性未通过")
        ? false
        : null,
    sameContent: status.includes("当前画布与所检查的快照一致"),
    unsaved: status.includes("当前画布与已保存快照不同"),
    stale: text.includes("之前的服务端预检结果已隐藏"),
    notPublished: status.includes("不是正式发布许可"),
    issueCount: panel.querySelectorAll('ol[aria-label="服务端发布预检问题"] > li').length,
    error: Boolean(panel.querySelector('[role="alert"]') || server?.querySelector('[role="alert"]')),
    baselineCleared: /CAS 基线：\s*未建立/.test(serverText),
  };
}

async function waitFor(task, failure, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await task();
      if (value) return value;
    } catch {
      // 页面导航或组件重新挂载过程中，继续等待真实 UI 稳定。
    }
    await pause(150);
  }
  throw new Error(failure);
}

async function getProtectedState(session) {
  const view = await inspectStudioState(session);
  const canvas = await session.evaluate(readStudioContentCanvasInPage);
  const exported = await session.evaluate(readStudioDocumentHashInPage);
  const cas = await session.evaluate(readMultiTabSessionStateInPage);
  return {
    canvas,
    drafts: view.drafts,
    autoSave: view.autoSave,
    hash: exported.hash,
    baselineRevision: cas.baselineRevision,
  };
}

function requireSameLocalState(before, after) {
  if (
    before.canvas !== after.canvas ||
    before.hash !== after.hash ||
    JSON.stringify(before.drafts) !== JSON.stringify(after.drafts) ||
    before.autoSave !== after.autoSave ||
    before.baselineRevision !== after.baselineRevision
  ) {
    throw new Error("真实 Studio 发布预检未保护当前画布和草稿");
  }
}

async function openAuthorizedProject(session, selected) {
  assert.equal(await session.evaluate(enterStudioInPage), true);
  await session.evaluate(openProjectBrowserMenuInPage);
  let page = await waitFor(async () => {
    const current = await session.evaluate(pageStateInPage);
    return current && !current.busy && current.ids.length > 0 ? current : null;
  }, "真实 Studio 发布预检授权工程不在管理列表");
  for (let index = 0; index < 11; index += 1) {
    const row = page.ids.indexOf(selected.projectId);
    if (row >= 0) {
      if (page.revisions[row] !== selected.revision) {
        throw new Error("真实 Studio 发布预检报告与服务端当前版本不一致");
      }
      const opened = await session.evaluate(
        openProjectInPage,
        selected.projectId,
        selected.revision,
        "confirm",
      );
      if (
        opened?.outcome !== "confirm" ||
        opened.confirmCount !== 1 ||
        opened.intercepted !== 0 ||
        !(await session.evaluate(waitForStudioActionIdleInPage))
      ) {
        throw new Error("真实 Studio 发布预检工程载入后 CAS 不一致");
      }
      const cas = await session.evaluate(readMultiTabSessionStateInPage);
      if (cas.baselineRevision !== selected.revision) {
        throw new Error("真实 Studio 发布预检工程载入后 CAS 不一致");
      }
      return;
    }
    if (!page.nextEnabled) break;
    const previous = page.pageNumber;
    assert.equal(await session.evaluate(clickBrowserControlInPage, "next"), true);
    page = await waitFor(async () => {
      const next = await session.evaluate(pageStateInPage);
      return next && !next.busy && next.pageNumber > previous ? next : null;
    }, "真实 Studio 发布预检授权工程不在管理列表");
  }
  throw new Error("真实 Studio 发布预检授权工程不在管理列表");
}

async function clickAndRead(session, origin, selected, status = null) {
  assert.equal(
    await session.evaluate(
      armStudioPreflightReadGuardInPage,
      origin,
      selected.projectId,
      selected.revision,
      status,
    ),
    true,
  );
  assert.equal(await session.evaluate(clickStudioPreflightInPage), true);
  const expected = ["head", "snapshot", "preflight"];
  const result = await waitFor(async () => {
    const [requests, ui] = await Promise.all([
      session.evaluate(studioPreflightGuardStateInPage),
      session.evaluate(studioPreflightUiStateInPage),
    ]);
    if (!ui || !requests || requests.requests.length < expected.length) return null;
    if (status === null) {
      return requests.requests.length === 4 && ui.revision === selected.revision && ui.notPublished
        ? { requests, ui }
        : null;
    }
    if (status === 409) {
      return requests.simulatedResponses === 1 && ui.error && ui.buttonReady
        ? { requests, ui }
        : null;
    }
    return requests.simulatedResponses === 1 && ui.baselineCleared && ui.buttonReady
      ? { requests, ui }
      : null;
  }, "真实 Studio 发布预检手动触发请求契约不一致");
  const requestSequence =
    status === null ? ["head", "snapshot", "preflight", "head"] : expected;
  if (
    JSON.stringify(result.requests.requests) !== JSON.stringify(requestSequence) ||
    result.requests.blockedWrites !== 0 ||
    result.requests.simulatedResponses !== (status === null ? 0 : 1)
  ) {
    throw new Error("真实 Studio 发布预检手动触发请求契约不一致");
  }
  if (
    status === null &&
    (result.ui.passed !== selected.passed || result.ui.issueCount !== selected.issueCount)
  ) {
    throw new Error("真实 Studio 发布预检报告与服务端当前版本不一致");
  }
  return result.ui;
}

async function verifyOrigin(session, origin, name, principal, selected) {
  await session.send("Page.navigate", { url: origin + "/" });
  const identity = await waitFor(
    () => session.evaluate(identityInPage, origin),
    "真实 Studio 发布预检 React/Vue 可信身份不一致",
  );
  if (
    identity.tenantId !== principal.tenantId ||
    identity.subjectId !== principal.subjectId
  ) {
    throw new Error("真实 Studio 发布预检 React/Vue 可信身份不一致");
  }
  process.stdout.write(name + "：正在使用真实 Studio 工程管理入口打开已授权版本。\n");
  await openAuthorizedProject(session, selected);
  const initial = await getProtectedState(session);
  const defaultUi = await session.evaluate(studioPreflightUiStateInPage);
  assert.equal(defaultUi?.revision, null, "未点击时不能显示旧服务端预检结果");
  process.stdout.write(name + "：正在点击服务端已保存版本只读预检按钮。\n");
  const checked = await clickAndRead(session, origin, selected);
  if (!checked.sameContent || !checked.notPublished) {
    throw new Error("真实 Studio 发布预检报告与服务端当前版本不一致");
  }
  requireSameLocalState(initial, await getProtectedState(session));

  process.stdout.write(name + "：正在验证未保存编辑内容不会继承服务端通过状态。\n");
  assert.equal(await session.evaluate(addStudioSymbolInPage, "+ 文本"), true);
  await waitFor(async () => {
    const ui = await session.evaluate(studioPreflightUiStateInPage);
    return ui?.stale && ui.revision === null ? true : null;
  }, "真实 Studio 发布预检未保护当前画布和草稿");
  const edited = await getProtectedState(session);
  if (
    edited.hash === initial.hash ||
    edited.baselineRevision !== initial.baselineRevision ||
    JSON.stringify(edited.drafts) !== JSON.stringify(initial.drafts) ||
    edited.autoSave !== initial.autoSave
  ) {
    throw new Error("真实 Studio 发布预检未保护当前画布和草稿");
  }
  const unsaved = await clickAndRead(session, origin, selected);
  if (!unsaved.unsaved || unsaved.sameContent) {
    throw new Error("真实 Studio 发布预检报告与服务端当前版本不一致");
  }
  requireSameLocalState(edited, await getProtectedState(session));

  process.stdout.write(name + "：正在验证模拟 409 与 401/404 拒绝不修改画布及草稿。\n");
  const conflict = await clickAndRead(session, origin, selected, 409);
  if (conflict.revision !== null || conflict.baselineCleared) {
    throw new Error("真实 Studio 发布预检错误状态处理不符合预期");
  }
  requireSameLocalState(edited, await getProtectedState(session));
  for (const status of [401, 404]) {
    const rejected = await clickAndRead(session, origin, selected, status);
    if (rejected.revision !== null || !rejected.baselineCleared) {
      throw new Error("真实 Studio 发布预检错误状态处理不符合预期");
    }
    const after = await getProtectedState(session);
    if (
      after.canvas !== edited.canvas ||
      after.hash !== edited.hash ||
      JSON.stringify(after.drafts) !== JSON.stringify(edited.drafts) ||
      after.autoSave !== edited.autoSave
    ) {
      throw new Error("真实 Studio 发布预检未保护当前画布和草稿");
    }
  }
  assert.equal(
    await session.evaluate(
      armStudioPreflightReadGuardInPage,
      origin,
      selected.projectId,
      selected.revision,
      null,
    ),
    true,
  );
  const current = await session.evaluate(readReleasePreflightInPage, origin);
  if (
    current.projectId !== selected.projectId ||
    current.revision !== selected.revision ||
    current.contentHash !== selected.contentHash
  ) {
    throw new Error("真实 Studio 发布预检报告与服务端当前版本不一致");
  }
  const guard = await session.evaluate(studioPreflightGuardStateInPage);
  assert.equal(guard.blockedWrites, 0);
  process.stdout.write(name + "：真实按钮、未保存画布提示、409/401/404 及本地保护均通过。\n");
}

async function run() {
  requireReadonlyStudioPreflightMode(process.argv.slice(2));
  requireReadonlyReleasePreflightMode([]);
  if (!existsSync(ROOT_ENV)) throw new Error("真实 Studio 发布预检要求本机可信 OIDC Lab");
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("真实 Studio 发布预检缺少本机 Chrome/Edge");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (response.status !== 200 || response.url !== origin + "/") {
      throw new Error("真实 Studio 发布预检 HTTPS Web 服务不可用");
    }
  }
  const browser = await startBrowser(executable);
  try {
    const principal = await waitForLogin(browser, origins[0], "Studio 发布预检");
    const selected = await browser.evaluate(readReleasePreflightInPage, origins[0]);
    await browser.send("Page.addScriptToEvaluateOnNewDocument", {
      source:
        "(" +
        installStudioPreflightReadGuardInPage.toString() +
        ")(" +
        JSON.stringify(origins) +
        ");",
    });
    for (const [index, origin] of origins.entries()) {
      await verifyOrigin(browser, origin, index === 0 ? "React" : "Vue", principal, selected);
    }
    process.stdout.write(
      "真实 Keycloak 双框架 Studio 服务端预检按钮专项通过；请求仅 GET，未写入工程、ACL、发布记录或工业设备。\n",
    );
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeStudioPreflightFailure(error) + "\n");
    process.exitCode = 1;
  });
}
