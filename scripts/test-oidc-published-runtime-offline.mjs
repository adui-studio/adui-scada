import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import {
  executablePath,
  identityInPage,
  startBrowser,
  waitForLogin,
} from "./test-oidc-dual-cas.mjs";
import { resolveProjectBrowserLab } from "./test-project-browser-oidc.mjs";
import {
  enterPublishedAuthorizedProjectInPage,
  publishedAuthorizedUiStateInPage,
  requirePublishedAuthorizedRead,
} from "./test-oidc-published-runtime-authorized.mjs";
import {
  installPublishedReadGuardInPage,
  openPublishedRuntimeInPage,
  publishedNavigationReadyInPage,
  publishedReadGuardStateInPage,
  submitPublishedProjectInPage,
  waitForState,
} from "./test-oidc-published-runtime-readonly.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const PROJECT_PATTERN =
  /^d5b-unreleased-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_FAILURES = new Set([
  "D5b2 参数仅允许现有专用未发布工程 ID",
  "D5b2 可信本机 OIDC HTTPS Lab 不可用",
  "D5b2 本机浏览器不可用",
  "D5b2 真实登录会话不一致",
  "D5b2 只读发布读取前置条件不满足",
  "D5b2 本机故障模拟门禁未就绪",
  "D5b2 模拟网络故障未产生离线终态",
  "D5b2 模拟故障未严格限定为一次",
  "D5b2 服务恢复后未重新取得真实授权指针",
  "D5b2 停止读取后未清空页面状态",
  "D5b2 发布 API 发生额外请求或非只读写入",
]);
const PAGE_DIAGNOSTICS = new Set([
  "页面脚本引用异常",
  "页面脚本类型异常",
  "页面脚本语法异常",
  "浏览器存储或 DOM 异常",
  "页面脚本断言异常",
  "页面脚本异常（已脱敏）",
]);
const PHASES = new Set([
  "OIDC 登录",
  ...["React", "Vue"].flatMap((name) =>
    [
      "BFF 会话",
      "导航就绪",
      "打开发布运行",
      "真实首次读取",
      "注入单次网络故障",
      "验证离线清理",
      "真实重新读取",
      "验证恢复状态",
      "停止读取与资源清理",
    ].map((step) => name + "：" + step),
  ),
]);

/** 只允许现有前缀 UUIDv4，禁止数据库写入、ACL 撤销与真实发布模式。 */
export function parsePublishedOfflineMode(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 2 ||
    args[0] !== "--project-id" ||
    !PROJECT_PATTERN.test(args[1] ?? "")
  ) {
    throw new Error("D5b2 参数仅允许现有专用未发布工程 ID");
  }
  return { projectId: args[1] };
}

export function describePublishedOfflineFailure(error) {
  if (error instanceof Error && SAFE_FAILURES.has(error.message)) return error.message;
  if (
    error instanceof Error &&
    error.message === "D5b2 浏览器阶段失败" &&
    PHASES.has(error.phase)
  ) {
    const reason = SAFE_FAILURES.has(error.safeReason)
      ? error.safeReason
      : PAGE_DIAGNOSTICS.has(error.pageDiagnostic)
        ? error.pageDiagnostic
        : error.failureKind === "assertion"
          ? "安全断言不符"
          : "未知异常已脱敏";
    return "D5b2 " + error.phase + "失败：" + reason;
  }
  return "D5b2 真实只读离线恢复专项失败，内部诊断已脱敏";
}

/**
 * 在已安装的只读门禁外再包一层一次性故障模拟。
 * 仅本机当前工程精确 GET 返回一个网络拒绝，其他请求仍经过原只读门禁。
 * 不停止真实网络，不拦截身份接口，不修改 ACL 或实际 HTTP 响应。
 */
export function installPublishedOfflineFaultInPage(origin, projectId, runtime = globalThis) {
  if (
    runtime.location?.origin !== origin ||
    !/^d5b-unreleased-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      projectId,
    ) ||
    !runtime.__aduiPublishedReadGuard ||
    runtime.__aduiPublishedOfflineFault
  ) {
    throw new Error("D5b2 本机故障模拟门禁未就绪");
  }
  const guarded = runtime.fetch.bind(runtime);
  const path = "/api/v1/projects/" + projectId + "/releases/current";
  const state = { path, injected: 0, armed: false };
  runtime.__aduiPublishedOfflineFault = state;
  runtime.fetch = (input, init) => {
    const raw = typeof input === "string" ? input : typeof input?.url === "string" ? input.url : "";
    const method = (init?.method ?? input?.method ?? "GET").toUpperCase();
    const url = new URL(raw, runtime.location.origin + "/");
    const headers = init?.headers ?? {};
    if (
      state.armed &&
      state.injected === 0 &&
      url.origin === origin &&
      url.pathname + url.search === path &&
      method === "GET" &&
      init?.body === undefined &&
      headers.Authorization === undefined &&
      headers.authorization === undefined
    ) {
      state.armed = false;
      state.injected = 1;
      return Promise.reject(new TypeError("模拟单次正式发布指针网络中断"));
    }
    return guarded(input, init);
  };
  return true;
}

/** 只能安装一次、触发一次；故障期间不修改真实服务器或其他浏览器连接。 */
export function armPublishedOfflineFaultInPage(runtime = globalThis) {
  const state = runtime.__aduiPublishedOfflineFault;
  if (!state || state.armed || state.injected !== 0) {
    throw new Error("D5b2 模拟故障未严格限定为一次");
  }
  state.armed = true;
  return true;
}

/** 只回传受控故障计数，不读取项目正文、Cookie 或令牌。 */
export function publishedOfflineFaultStateInPage(runtime = globalThis) {
  const state = runtime.__aduiPublishedOfflineFault;
  if (!state) return null;
  return { injected: state.injected, armed: state.armed };
}

/** 严格模拟真实按钮操作，禁止调用应用内部刷新器方法。 */
export function clickPublishedReadControlInPage(label, runtime = globalThis) {
  if (!["立即刷新", "停止读取"].includes(label)) {
    throw new Error("D5b2 本机故障模拟门禁未就绪");
  }
  const panel = runtime.document.querySelector('[data-testid="published-runtime-page"]');
  const form = panel?.querySelector("form");
  const button = [...(form?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button || button.disabled) throw new Error("D5b2 本机故障模拟门禁未就绪");
  button.click();
  return true;
}

/** 网络故障必须清空发布代次和画面，不得伪装 GOOD 或沿用上次读取。 */
export function requirePublishedOfflineState(state) {
  if (
    !state ||
    state.status !== "offline" ||
    state.sameProject !== true ||
    state.releaseGeneration !== null ||
    state.releasedRevision !== null ||
    state.snapshot !== false ||
    state.quality !== true
  ) {
    throw new Error("D5b2 模拟网络故障未产生离线终态");
  }
  return true;
}

/** 只允许两次真实 HTTP 200 和一次受控模拟失败，不放行任何工程写入。 */
export function requirePublishedOfflineReadGuards(guard, fault, projectId, completed) {
  if (!PROJECT_PATTERN.test(projectId)) throw new Error("D5b2 发布 API 发生额外请求或非只读写入");
  const path = "/api/v1/projects/" + projectId + "/releases/current";
  const count = completed ? 2 : 1;
  if (
    !guard ||
    guard.blocked !== 0 ||
    !Array.isArray(guard.paths) ||
    !Array.isArray(guard.statuses) ||
    guard.paths.length !== count ||
    guard.statuses.length !== count ||
    guard.paths.some((item) => item !== path) ||
    guard.statuses.some((item) => item !== 200) ||
    !fault ||
    fault.injected !== 1 ||
    fault.armed !== false
  ) {
    throw new Error("D5b2 发布 API 发生额外请求或非只读写入");
  }
  return true;
}

async function run() {
  const mode = parsePublishedOfflineMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b2 可信本机 OIDC HTTPS Lab 不可用");
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("D5b2 本机浏览器不可用");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (!response.ok || response.url !== origin + "/") {
      throw new Error("D5b2 可信本机 OIDC HTTPS Lab 不可用");
    }
  }

  const browser = await startBrowser(executable);
  let phase = "OIDC 登录";
  const report = (next) => {
    phase = next;
    process.stdout.write("D5b2：" + next + "，正在验证\n");
  };
  try {
    report(phase);
    const principal = await waitForLogin(browser, origins[0], "D5b2 未发布离线恢复只读专项");
    if (!principal) throw new Error("D5b2 真实登录会话不一致");
    for (const [index, origin] of origins.entries()) {
      const name = index === 0 ? "React" : "Vue";
      report(name + "：BFF 会话");
      await browser.send("Page.navigate", { url: origin + "/" });
      const current = await waitForState(
        () => browser.evaluate(identityInPage, origin),
        "D5b2 真实登录会话不一致",
      );
      assert.deepEqual(current, principal, "D5b2 真实登录会话不一致");

      report(name + "：导航就绪");
      await waitForState(
        () => browser.evaluate(publishedNavigationReadyInPage),
        "D5b2 可信本机 OIDC HTTPS Lab 不可用",
      );
      await browser.evaluate(installPublishedReadGuardInPage, origin);
      // API Client 会在页面挂载时捕获当前 fetch；必须先安装故障层，后挂载页面。
      await browser.evaluate(installPublishedOfflineFaultInPage, origin, mode.projectId);
      report(name + "：打开发布运行");
      await browser.evaluate(openPublishedRuntimeInPage);
      await waitForState(
        () =>
          browser
            .evaluate(publishedAuthorizedUiStateInPage, mode.projectId)
            .then((state) => state?.status === "idle"),
        "D5b2 只读发布读取前置条件不满足",
      );
      const before = await browser.evaluate(publishedReadGuardStateInPage);
      assert.deepEqual(before.paths, [], "D5b2 发布 API 发生额外请求或非只读写入");

      report(name + "：真实首次读取");
      await browser.evaluate(enterPublishedAuthorizedProjectInPage, mode.projectId);
      await browser.evaluate(submitPublishedProjectInPage);
      const initial = await waitForState(
        () =>
          browser
            .evaluate(publishedAuthorizedUiStateInPage, mode.projectId)
            .then((state) => (state?.status === "unreleased" ? state : null)),
        "D5b2 只读发布读取前置条件不满足",
      );
      requirePublishedAuthorizedRead(
        initial,
        await browser.evaluate(publishedReadGuardStateInPage),
        "UNRELEASED",
        mode.projectId,
      );

      report(name + "：注入单次网络故障");
      await browser.evaluate(armPublishedOfflineFaultInPage);
      await browser.evaluate(clickPublishedReadControlInPage, "立即刷新");

      report(name + "：验证离线清理");
      const offline = await waitForState(
        () =>
          browser
            .evaluate(publishedAuthorizedUiStateInPage, mode.projectId)
            .then((state) => (state?.status === "offline" ? state : null)),
        "D5b2 模拟网络故障未产生离线终态",
      );
      requirePublishedOfflineState(offline);
      requirePublishedOfflineReadGuards(
        await browser.evaluate(publishedReadGuardStateInPage),
        await browser.evaluate(publishedOfflineFaultStateInPage),
        mode.projectId,
        false,
      );

      report(name + "：真实重新读取");
      await browser.evaluate(clickPublishedReadControlInPage, "立即刷新");
      const restored = await waitForState(
        () =>
          browser
            .evaluate(publishedAuthorizedUiStateInPage, mode.projectId)
            .then((state) => (state?.status === "unreleased" ? state : null)),
        "D5b2 服务恢复后未重新取得真实授权指针",
      );
      report(name + "：验证恢复状态");
      requirePublishedOfflineReadGuards(
        await browser.evaluate(publishedReadGuardStateInPage),
        await browser.evaluate(publishedOfflineFaultStateInPage),
        mode.projectId,
        true,
      );
      if (
        restored.sameProject !== true ||
        restored.releaseGeneration !== 0 ||
        restored.releasedRevision !== null ||
        restored.snapshot !== false ||
        restored.quality !== true
      ) {
        throw new Error("D5b2 服务恢复后未重新取得真实授权指针");
      }

      report(name + "：停止读取与资源清理");
      await browser.evaluate(clickPublishedReadControlInPage, "停止读取");
      const stopped = await waitForState(
        () =>
          browser
            .evaluate(publishedAuthorizedUiStateInPage, mode.projectId)
            .then((state) => (state?.status === "idle" ? state : null)),
        "D5b2 停止读取后未清空页面状态",
      );
      if (
        stopped.snapshot !== false ||
        stopped.releaseGeneration !== null ||
        stopped.quality !== true
      ) {
        throw new Error("D5b2 停止读取后未清空页面状态");
      }
      requirePublishedOfflineReadGuards(
        await browser.evaluate(publishedReadGuardStateInPage),
        await browser.evaluate(publishedOfflineFaultStateInPage),
        mode.projectId,
        true,
      );
      process.stdout.write(name + "：真实授权、单次故障、离线撤画面、恢复及停止均通过。\n");
    }
    process.stdout.write(
      "D5b2 双 HTTPS Origin 发布只读离线恢复专项通过；故障为浏览器模拟，无数据库写入。\n",
    );
  } catch (error) {
    const failure = new Error("D5b2 浏览器阶段失败");
    failure.phase = phase;
    failure.pageDiagnostic = error?.pageDiagnostic;
    failure.safeReason =
      error instanceof Error && SAFE_FAILURES.has(error.message) ? error.message : null;
    failure.failureKind = error instanceof assert.AssertionError ? "assertion" : "unknown";
    throw failure;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describePublishedOfflineFailure(error) + "\n");
    process.exitCode = 1;
  });
}
