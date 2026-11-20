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
  installPublishedReadGuardInPage,
  openPublishedRuntimeInPage,
  publishedNavigationReadyInPage,
  publishedReadGuardStateInPage,
  submitPublishedProjectInPage,
  waitForState,
} from "./test-oidc-published-runtime-readonly.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const FIXTURE_PATTERN =
  /^d5b-(unreleased|released)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PHASES = new Set([
  "OIDC 登录",
  ...["React", "Vue"].flatMap((name) =>
    [
      "BFF 会话",
      "导航就绪",
      "只读门禁安装",
      "打开运行页面",
      "输入工程 ID",
      "发布读取",
      "对照发布状态",
    ].map((step) => name + "：" + step),
  ),
]);
const PAGE_DIAGNOSTICS = new Set([
  "页面脚本引用异常",
  "页面脚本类型异常",
  "页面脚本语法异常",
  "浏览器存储或 DOM 异常",
  "页面脚本断言异常",
  "页面脚本异常（已脱敏）",
]);
const SAFE_FAILURES = new Set([
  "D5b1 只允许显式指定已预置的本机只读工程",
  "D5b1 预置工程名称与期望发布状态不一致",
  "D5b1 本机可信 HTTPS Lab 缺失",
  "D5b1 本机 Chrome/Edge 不可用",
  "D5b1 HTTPS 服务不可用",
  "D5b1 真实授权发布状态与预期不一致",
  "D5b1 当前发布读取请求不符合只读约束",
  "D5b1 双框架发布状态摘要不一致",
  "D5b1 HTTP 404：预置工程不存在或未授予 release:read",
  "D5b1 HTTP 401：可信会话已失效",
  "D5b1 HTTP 403：没有正式发布读取授权",
  "D5b1 正式发布读取没有返回 HTTP 200",
  "D5b1 正式发布页面状态与预期不一致",
  "D5b1 正式发布页面未完成读取",
]);

/** 只接受本机人为预置的 D5b1 专用工程；脚本绝不创建、授权或发布。 */
export function parsePublishedAuthorizedMode(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 4 ||
    args[0] !== "--status" ||
    !["UNRELEASED", "RELEASED"].includes(args[1]) ||
    args[2] !== "--project-id" ||
    typeof args[3] !== "string" ||
    !FIXTURE_PATTERN.test(args[3])
  ) {
    throw new Error("D5b1 只允许显式指定已预置的本机只读工程");
  }
  const expectedStatus = args[1];
  const projectId = args[3];
  if (
    (expectedStatus === "UNRELEASED" && !projectId.startsWith("d5b-unreleased-")) ||
    (expectedStatus === "RELEASED" && !projectId.startsWith("d5b-released-"))
  ) {
    throw new Error("D5b1 预置工程名称与期望发布状态不一致");
  }
  return { expectedStatus, projectId };
}

export function describePublishedAuthorizedFailure(error) {
  if (error instanceof Error && SAFE_FAILURES.has(error.message)) return error.message;
  if (
    error instanceof Error &&
    error.message === "D5b1 浏览器阶段验证失败" &&
    PHASES.has(error.phase)
  ) {
    const reason = SAFE_FAILURES.has(error.safeReason)
      ? error.safeReason
      : PAGE_DIAGNOSTICS.has(error.pageDiagnostic)
        ? error.pageDiagnostic
        : error.failureKind === "assertion"
          ? "安全断言不符"
          : "异常已脱敏";
    return "D5b1 " + error.phase + "失败：" + reason;
  }
  return "D5b1 真实授权只读验收失败，内部信息已脱敏";
}

/** 通过真实 DOM 输入；此函数被 CDP 独立序列化，不得引用 Node 作用域常量。 */
export function enterPublishedAuthorizedProjectInPage(projectId, runtime = globalThis) {
  if (
    !/^d5b-(unreleased|released)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      projectId,
    )
  ) {
    throw new Error("D5b1 工程输入标识不符合隔离规则");
  }
  const panel = runtime.document.querySelector('[data-testid="published-runtime-page"]');
  const input = panel?.querySelector('input[placeholder="输入已授权工程 ID"]');
  if (!input) throw new Error("D5b1 已发布运行工程输入框不可用");
  const prototype = runtime.HTMLInputElement.prototype;
  if (typeof Object.getOwnPropertyDescriptor(prototype, "value")?.set !== "function") {
    throw new Error("D5b1 受控输入接口不可用");
  }
  Reflect.set(prototype, "value", projectId, input);
  input.dispatchEvent(new runtime.Event("input", { bubbles: true }));
  return true;
}

/** 不读取响应正文、工程快照、SVG 源码、身份和 Cookie，仅回传页面状态摘要。 */
export function publishedAuthorizedUiStateInPage(projectId, runtime = globalThis) {
  const panel = runtime.document.querySelector('[data-testid="published-runtime-page"]');
  if (!panel) return null;
  const entries = [...panel.querySelectorAll("dt")];
  const findValue = (key) =>
    entries
      .find((item) => item.textContent?.trim() === key)
      ?.nextElementSibling?.textContent?.trim();
  const parseCount = (value) =>
    typeof value === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value) &&
    Number.isSafeInteger(Number(value))
      ? Number(value)
      : null;
  const rawRevision = findValue("发布修订");
  return {
    status: panel.querySelector(".scada-status")?.getAttribute("data-status") ?? "",
    sameProject: findValue("工程") === projectId,
    releaseGeneration: parseCount(findValue("发布代次")),
    releasedRevision: rawRevision === "--" ? null : parseCount(rawRevision),
    snapshot: Boolean(panel.querySelector('[data-testid="published-runtime-svg"]')),
    quality: [...panel.querySelectorAll("dd")].some((item) =>
      item.textContent?.includes("UNAVAILABLE"),
    ),
  };
}

/** 完全校验两种状态；RELEASED 的 SVG 仅由共享 Runtime 校验快照后渲染。 */
export function requirePublishedAuthorizedState(state, expectedStatus) {
  if (!state || typeof state !== "object" || state.sameProject !== true || state.quality !== true) {
    throw new Error("D5b1 真实授权发布状态与预期不一致");
  }
  if (expectedStatus === "UNRELEASED") {
    if (
      state.status !== "unreleased" ||
      state.releaseGeneration !== 0 ||
      state.releasedRevision !== null ||
      state.snapshot !== false
    ) {
      throw new Error("D5b1 真实授权发布状态与预期不一致");
    }
    return { status: "UNRELEASED", releaseGeneration: 0, releasedRevision: null };
  }
  if (
    expectedStatus !== "RELEASED" ||
    state.status !== "verified" ||
    !Number.isSafeInteger(state.releaseGeneration) ||
    state.releaseGeneration < 1 ||
    !Number.isSafeInteger(state.releasedRevision) ||
    state.releasedRevision < 1 ||
    state.snapshot !== true
  ) {
    throw new Error("D5b1 真实授权发布状态与预期不一致");
  }
  return {
    status: "RELEASED",
    releaseGeneration: state.releaseGeneration,
    releasedRevision: state.releasedRevision,
  };
}

/** 允许授权成功和受控失败作为终态，避免 HTTP 404 被误报为浏览器执行异常。 */
export function isPublishedAuthorizedTerminalState(state) {
  return (
    state !== null &&
    typeof state === "object" &&
    ["unreleased", "verified", "denied", "offline", "error"].includes(state.status)
  );
}

/**
 * 只核对受控同源 GET 路径和 HTTP 状态，不读取响应正文。
 * HTTP 404 对工程不存在和缺少独立 release:read 授权不可区分。
 */
export function requirePublishedAuthorizedRead(state, guard, expectedStatus, projectId) {
  if (
    typeof projectId !== "string" ||
    !FIXTURE_PATTERN.test(projectId) ||
    !guard ||
    guard.blocked !== 0 ||
    !Array.isArray(guard.paths) ||
    guard.paths.length !== 1 ||
    guard.paths[0] !== "/api/v1/projects/" + projectId + "/releases/current" ||
    !Array.isArray(guard.statuses) ||
    guard.statuses.length !== 1
  ) {
    throw new Error("D5b1 当前发布读取请求不符合只读约束");
  }
  const status = guard.statuses[0];
  if (status === 404) {
    throw new Error("D5b1 HTTP 404：预置工程不存在或未授予 release:read");
  }
  if (status === 401) throw new Error("D5b1 HTTP 401：可信会话已失效");
  if (status === 403) throw new Error("D5b1 HTTP 403：没有正式发布读取授权");
  if (status !== 200) throw new Error("D5b1 正式发布读取没有返回 HTTP 200");
  if (state?.status !== (expectedStatus === "RELEASED" ? "verified" : "unreleased")) {
    throw new Error("D5b1 正式发布页面状态与预期不一致");
  }
  return requirePublishedAuthorizedState(state, expectedStatus);
}

async function run() {
  const mode = parsePublishedAuthorizedMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b1 本机可信 HTTPS Lab 缺失");
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("D5b1 本机 Chrome/Edge 不可用");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (response.status !== 200 || response.url !== origin + "/") {
      throw new Error("D5b1 HTTPS 服务不可用");
    }
  }

  const browser = await startBrowser(executable);
  let phase = "OIDC 登录";
  const report = (value) => {
    phase = value;
    process.stdout.write("D5b1：" + value + "，正在验证\n");
  };
  try {
    report(phase);
    const principal = await waitForLogin(browser, origins[0], "D5b1 正式发布授权只读专项");
    if (!principal) throw new Error("D5b1 真实授权发布状态与预期不一致");
    let baseline = null;
    for (const [index, origin] of origins.entries()) {
      const name = index === 0 ? "React" : "Vue";
      report(name + "：BFF 会话");
      await browser.send("Page.navigate", { url: origin + "/" });
      const current = await waitForState(
        () => browser.evaluate(identityInPage, origin),
        "D5b1 真实授权发布状态与预期不一致",
        100,
      );
      assert.deepEqual(current, principal, "D5b1 真实授权发布状态与预期不一致");
      report(name + "：导航就绪");
      await waitForState(
        () => browser.evaluate(publishedNavigationReadyInPage),
        "D5b1 真实授权发布状态与预期不一致",
      );
      report(name + "：只读门禁安装");
      await browser.evaluate(installPublishedReadGuardInPage, origin);
      report(name + "：打开运行页面");
      await browser.evaluate(openPublishedRuntimeInPage);
      await waitForState(
        () =>
          browser
            .evaluate(publishedAuthorizedUiStateInPage, mode.projectId)
            .then((value) => value?.status === "idle"),
        "D5b1 真实授权发布状态与预期不一致",
      );
      const before = await browser.evaluate(publishedReadGuardStateInPage);
      assert.deepEqual(before.paths, [], "D5b1 当前发布读取请求不符合只读约束");
      report(name + "：输入工程 ID");
      await browser.evaluate(enterPublishedAuthorizedProjectInPage, mode.projectId);
      report(name + "：发布读取");
      await browser.evaluate(submitPublishedProjectInPage);
      const state = await waitForState(
        () =>
          browser
            .evaluate(publishedAuthorizedUiStateInPage, mode.projectId)
            .then((value) => (isPublishedAuthorizedTerminalState(value) ? value : null)),
        "D5b1 正式发布页面未完成读取",
      );
      report(name + "：对照发布状态");
      const guard = await browser.evaluate(publishedReadGuardStateInPage);
      const summary = requirePublishedAuthorizedRead(
        state,
        guard,
        mode.expectedStatus,
        mode.projectId,
      );
      if (baseline !== null) {
        assert.deepEqual(summary, baseline, "D5b1 双框架发布状态摘要不一致");
      } else {
        baseline = summary;
      }
      process.stdout.write(name + "：真实发布只读授权、状态及零写入通过。\n");
    }
    process.stdout.write(
      "D5b1 双框架真实授权只读验收通过；未修改 ACL、发布指针、版本或工业设备。\n",
    );
  } catch (error) {
    const failure = new Error("D5b1 浏览器阶段验证失败");
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
    process.stderr.write("错误：" + describePublishedAuthorizedFailure(error) + "\n");
    process.exitCode = 1;
  });
}
