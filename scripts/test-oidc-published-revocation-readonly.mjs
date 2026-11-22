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
  isPublishedAuthorizedTerminalState,
  publishedAuthorizedUiStateInPage,
} from "./test-oidc-published-runtime-authorized.mjs";
import { clickPublishedReadControlInPage } from "./test-oidc-published-runtime-denied.mjs";
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
  /^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_FAILURES = new Set([
  "D5b4d 只接受明确阶段与已存在的独立工程 ID，禁止写入模式",
  "D5b4d 可信本机 OIDC HTTPS Lab 不可用",
  "D5b4d 本机浏览器不可用",
  "D5b4d 两端可信登录主体不一致",
  "D5b4d 独立工程输入不可用",
  "D5b4d 响应只读观察器未就绪",
  "D5b4d 发布读取请求不符合只读约束",
  "D5b4d 撤权前必须真实返回 HTTP 200",
  "D5b4d 撤权后必须真实返回 HTTP 404",
  "D5b4d 发布运行页面状态不符合预期",
  "D5b4d 停止读取后仍保留发布状态或产生额外请求",
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
      "只读门禁安装",
      "打开运行页面",
      "默认零请求",
      "真实发布读取",
      "核对响应和页面状态",
      "停止读取与资源清理",
    ].map((step) => name + "：" + step),
  ),
]);

/** 前后阶段必须分开手动运行；本命令从不创建工程或变更 ACL。 */
export function parseD5b4ReadonlyMode(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 4 ||
    args[0] !== "--phase" ||
    !["before", "after"].includes(args[1]) ||
    args[2] !== "--project-id" ||
    !PROJECT_PATTERN.test(args[3] ?? "")
  ) {
    throw new Error("D5b4d 只接受明确阶段与已存在的独立工程 ID，禁止写入模式");
  }
  return { phase: args[1], projectId: args[3] };
}

export function describeD5b4ReadonlyFailure(error) {
  if (error instanceof Error && SAFE_FAILURES.has(error.message)) return error.message;
  if (
    error instanceof Error &&
    error.message === "D5b4d 浏览器阶段失败" &&
    PHASES.has(error.phase)
  ) {
    const reason = SAFE_FAILURES.has(error.safeReason)
      ? error.safeReason
      : PAGE_DIAGNOSTICS.has(error.pageDiagnostic)
        ? error.pageDiagnostic
        : error.failureKind === "assertion"
          ? "安全断言不符"
          : "未知异常已脱敏";
    return "D5b4d " + error.phase + "失败：" + reason;
  }
  return "D5b4d 双框架真实只读专项失败，内部信息已脱敏";
}

/** 独立 CDP 页面函数，只允许 D5b4 随机工程 ID，沿用原生受控输入语义。 */
export function enterD5b4ProjectInPage(projectId, runtime = globalThis) {
  if (
    !/^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      projectId,
    )
  ) {
    throw new Error("D5b4d 独立工程输入不可用");
  }
  const panel = runtime.document.querySelector('[data-testid="published-runtime-page"]');
  const input = panel?.querySelector('input[placeholder="输入已授权工程 ID"]');
  const prototype = runtime.HTMLInputElement.prototype;
  if (!input || typeof Object.getOwnPropertyDescriptor(prototype, "value")?.set !== "function") {
    throw new Error("D5b4d 独立工程输入不可用");
  }
  Reflect.set(prototype, "value", projectId, input);
  input.dispatchEvent(new runtime.Event("input", { bubbles: true }));
  return true;
}

/**
 * 已有只读安全门禁内的 HTTP 响应观察器。
 * 不模拟 404、不修改响应、不读取正文；只保存状态码与 no-store 布尔值。
 */
export function installD5b4ResponseObserverInPage(origin, projectId, runtime = globalThis) {
  if (
    runtime.location?.origin !== origin ||
    !/^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      projectId,
    ) ||
    !runtime.__aduiPublishedReadGuard ||
    runtime.__aduiD5b4ReadObserver
  ) {
    throw new Error("D5b4d 响应只读观察器未就绪");
  }
  const previousFetch = runtime.fetch.bind(runtime);
  const targetPath = "/api/v1/projects/" + projectId + "/releases/current";
  const data = { requests: 0, statuses: [], noStore: [], direct: [] };
  runtime.__aduiD5b4ReadObserver = data;
  runtime.fetch = (input, init) => {
    const raw =
      typeof input === "string" ? input : typeof input?.url === "string" ? input.url : null;
    if (!raw) throw new Error("D5b4d 发布读取请求不符合只读约束");
    const url = new URL(raw, runtime.location.origin + "/");
    if (url.origin !== origin || url.pathname + url.search !== targetPath) {
      return previousFetch(input, init);
    }
    data.requests += 1;
    return Promise.resolve(previousFetch(input, init)).then((response) => {
      data.statuses.push(response.status);
      data.noStore.push(response.headers?.get("cache-control") === "no-store");
      data.direct.push(response.redirected === false && response.url === origin + targetPath);
      return response;
    });
  };
  return true;
}

export function d5b4ResponseStateInPage(runtime = globalThis) {
  const data = runtime.__aduiD5b4ReadObserver;
  if (!data) return null;
  return {
    requests: data.requests,
    statuses: data.statuses.slice(),
    noStore: data.noStore.slice(),
    direct: data.direct.slice(),
  };
}

/** 不接受任何第二次读取、非 GET、缓存响应或错误阶段的状态。 */
export function requireD5b4ReadonlyResult(phase, projectId, page, guard, observer) {
  if (!["before", "after"].includes(phase) || !PROJECT_PATTERN.test(projectId)) {
    throw new Error("D5b4d 只接受明确阶段与已存在的独立工程 ID，禁止写入模式");
  }
  const path = "/api/v1/projects/" + projectId + "/releases/current";
  if (
    !guard ||
    guard.blocked !== 0 ||
    !Array.isArray(guard.paths) ||
    guard.paths.length !== 1 ||
    guard.paths[0] !== path ||
    !Array.isArray(guard.statuses) ||
    guard.statuses.length !== 1 ||
    !observer ||
    observer.requests !== 1 ||
    !Array.isArray(observer.statuses) ||
    observer.statuses.length !== 1 ||
    !Array.isArray(observer.noStore) ||
    observer.noStore.length !== 1 ||
    observer.noStore[0] !== true ||
    !Array.isArray(observer.direct) ||
    observer.direct.length !== 1 ||
    observer.direct[0] !== true ||
    guard.statuses[0] !== observer.statuses[0]
  ) {
    throw new Error("D5b4d 发布读取请求不符合只读约束");
  }
  const status = observer.statuses[0];
  if (phase === "before" && status !== 200) {
    throw new Error("D5b4d 撤权前必须真实返回 HTTP 200");
  }
  if (phase === "after" && status !== 404) {
    throw new Error("D5b4d 撤权后必须真实返回 HTTP 404");
  }
  if (
    !page ||
    page.sameProject !== true ||
    page.quality !== true ||
    page.snapshot !== false ||
    page.releasedRevision !== null ||
    (phase === "before"
      ? page.status !== "unreleased" || page.releaseGeneration !== 0
      : page.status !== "denied" || page.releaseGeneration !== null)
  ) {
    throw new Error("D5b4d 发布运行页面状态不符合预期");
  }
  return { phase, status, releaseGeneration: page.releaseGeneration };
}

export function requireD5b4Stopped(page, guard, observer, projectId, expectedStatus) {
  if (
    !PROJECT_PATTERN.test(projectId) ||
    !page ||
    page.status !== "idle" ||
    page.snapshot !== false ||
    page.releaseGeneration !== null ||
    page.releasedRevision !== null ||
    page.quality !== true ||
    guard?.blocked !== 0 ||
    guard.paths?.length !== 1 ||
    guard.paths[0] !== "/api/v1/projects/" + projectId + "/releases/current" ||
    guard.statuses?.length !== 1 ||
    guard.statuses[0] !== expectedStatus ||
    observer?.requests !== 1 ||
    observer.statuses?.length !== 1 ||
    observer.statuses[0] !== expectedStatus ||
    observer.noStore?.length !== 1 ||
    observer.noStore[0] !== true ||
    observer.direct?.length !== 1 ||
    observer.direct[0] !== true
  ) {
    throw new Error("D5b4d 停止读取后仍保留发布状态或产生额外请求");
  }
  return true;
}

async function run() {
  const mode = parseD5b4ReadonlyMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b4d 可信本机 OIDC HTTPS Lab 不可用");
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("D5b4d 本机浏览器不可用");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (response.status !== 200 || response.url !== origin + "/") {
      throw new Error("D5b4d 可信本机 OIDC HTTPS Lab 不可用");
    }
  }

  const browser = await startBrowser(executable);
  let phase = "OIDC 登录";
  const report = (next) => {
    phase = next;
    process.stdout.write("D5b4d：" + next + "，正在验证\n");
  };
  try {
    report(phase);
    const principal = await waitForLogin(browser, origins[0], "D5b4d 独立工程只读验收");
    if (!principal) throw new Error("D5b4d 两端可信登录主体不一致");
    let baseline = null;
    for (const [index, origin] of origins.entries()) {
      const name = index === 0 ? "React" : "Vue";
      report(name + "：BFF 会话");
      await browser.send("Page.navigate", { url: origin + "/" });
      const current = await waitForState(
        () => browser.evaluate(identityInPage, origin),
        "D5b4d 两端可信登录主体不一致",
      );
      assert.deepEqual(current, principal, "D5b4d 两端可信登录主体不一致");
      report(name + "：导航就绪");
      await waitForState(
        () => browser.evaluate(publishedNavigationReadyInPage),
        "D5b4d 可信本机 OIDC HTTPS Lab 不可用",
      );
      report(name + "：只读门禁安装");
      await browser.evaluate(installPublishedReadGuardInPage, origin);
      await browser.evaluate(installD5b4ResponseObserverInPage, origin, mode.projectId);
      report(name + "：打开运行页面");
      await browser.evaluate(openPublishedRuntimeInPage);
      await waitForState(
        () =>
          browser
            .evaluate(publishedAuthorizedUiStateInPage, mode.projectId)
            .then((value) => value?.status === "idle"),
        "D5b4d 发布运行页面状态不符合预期",
      );
      report(name + "：默认零请求");
      const initial = await browser.evaluate(publishedReadGuardStateInPage);
      const initialObserver = await browser.evaluate(d5b4ResponseStateInPage);
      assert.deepEqual(initial.paths, [], "D5b4d 发布读取请求不符合只读约束");
      assert.equal(initialObserver.requests, 0, "D5b4d 发布读取请求不符合只读约束");

      report(name + "：真实发布读取");
      await browser.evaluate(enterD5b4ProjectInPage, mode.projectId);
      await browser.evaluate(submitPublishedProjectInPage);
      const state = await waitForState(
        () =>
          browser
            .evaluate(publishedAuthorizedUiStateInPage, mode.projectId)
            .then((value) => (isPublishedAuthorizedTerminalState(value) ? value : null)),
        "D5b4d 发布运行页面状态不符合预期",
      );
      report(name + "：核对响应和页面状态");
      const result = requireD5b4ReadonlyResult(
        mode.phase,
        mode.projectId,
        state,
        await browser.evaluate(publishedReadGuardStateInPage),
        await browser.evaluate(d5b4ResponseStateInPage),
      );
      if (baseline === null) baseline = result;
      else assert.deepEqual(result, baseline, "D5b4d 发布运行页面状态不符合预期");

      report(name + "：停止读取与资源清理");
      await browser.evaluate(clickPublishedReadControlInPage, "停止读取");
      const stopped = await waitForState(
        () =>
          browser
            .evaluate(publishedAuthorizedUiStateInPage, mode.projectId)
            .then((value) => (value?.status === "idle" ? value : null)),
        "D5b4d 停止读取后仍保留发布状态或产生额外请求",
      );
      requireD5b4Stopped(
        stopped,
        await browser.evaluate(publishedReadGuardStateInPage),
        await browser.evaluate(d5b4ResponseStateInPage),
        mode.projectId,
        result.status,
      );
      process.stdout.write(name + "：一次真实只读 GET、发布状态及停止清理通过。\n");
    }
    process.stdout.write(
      "D5b4d 双框架真实只读阶段通过；不代表已执行工程创建、ACL 撤销或数据库事后审计。\n",
    );
  } catch (error) {
    const failure = new Error("D5b4d 浏览器阶段失败");
    failure.phase = phase;
    failure.safeReason =
      error instanceof Error && SAFE_FAILURES.has(error.message) ? error.message : null;
    failure.pageDiagnostic = error?.pageDiagnostic;
    failure.failureKind = error instanceof assert.AssertionError ? "assertion" : "unknown";
    throw failure;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeD5b4ReadonlyFailure(error) + "\n");
    process.exitCode = 1;
  });
}
