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
  publishedAuthorizedUiStateInPage,
} from "./test-oidc-published-runtime-authorized.mjs";
import {
  clickPublishedReadControlInPage,
} from "./test-oidc-published-runtime-denied.mjs";
import {
  d5b4ResponseStateInPage,
  enterD5b4ProjectInPage,
  installD5b4ResponseObserverInPage,
} from "./test-oidc-published-revocation-readonly.mjs";
import {
  installPublishedReadGuardInPage,
  openPublishedRuntimeInPage,
  publishedNavigationReadyInPage,
  publishedReadGuardStateInPage,
  submitPublishedProjectInPage,
  waitForState,
} from "./test-oidc-published-runtime-readonly.mjs";
import {
  activateStudioTab,
  openCompanionChromeTab,
} from "./test-oidc-studio-multitab.mjs";
import {
  studioVisibilityInPage,
  waitForD5b5ReadGuardSettled,
} from "./test-oidc-studio-revoked-multitab.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const PROJECT_PATTERN =
  /^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STAGES = ["initial", "denied", "hidden", "resumed", "stopped"];
const SAFE_ERRORS = new Set([
  "D5b6 只允许已有撤权工程的明确只读回归参数",
  "D5b6 可信 OIDC HTTPS 本机隔离 Lab 不可用",
  "D5b6 本机 Chrome/Edge 不可用",
  "D5b6 同一隔离浏览器可信身份不一致",
  "D5b6 真实发布运行入口或标签页可见性异常",
  "D5b6 撤权发布 HTTP 404、只读守卫或本地运行状态不符合预期",
  "D5b6 运行页面隐藏与重显阶段等待超时",
]);
const PHASES = new Set([
  "可信 OIDC 登录",
  ...["React", "Vue"].flatMap((name) =>
    [
      "可信会话及发布导航",
      "页面默认零 GET",
      "正式运行首次真实 404",
      "第二标签页使运行页隐藏",
      "恢复运行页可见与再次真实 404",
      "停止读取后零新增 GET",
    ].map((step) => name + "：" + step),
  ),
]);

/** 仅接受已撤权的随机 D5b4 专用工程，不包含创建、撤权或恢复参数。 */
export function parseD5b6VisibilityArgs(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 2 ||
    args[0] !== "--project-id" ||
    !PROJECT_PATTERN.test(args[1] ?? "")
  ) {
    throw new Error("D5b6 只允许已有撤权工程的明确只读回归参数");
  }
  return { projectId: args[1] };
}

/**
 * 核对真实首次读取、隐藏、重显与停止的全序列。
 * 只接收浏览器已脱敏页面状态、路径和 HTTP 状态码，不读取任何响应正文。
 */
export function requireD5b6VisibilityStage(stage, projectId, page, guard, observer) {
  if (!STAGES.includes(stage) || !PROJECT_PATTERN.test(projectId)) {
    throw new Error("D5b6 只允许已有撤权工程的明确只读回归参数");
  }
  const expectedCount =
    stage === "initial" ? 0 : stage === "resumed" || stage === "stopped" ? 2 : 1;
  const denied = stage === "denied" || stage === "resumed";
  const path = "/api/v1/projects/" + projectId + "/releases/current";
  if (
    !guard ||
    guard.blocked !== 0 ||
    !Array.isArray(guard.paths) ||
    guard.paths.length !== expectedCount ||
    guard.paths.some((item) => item !== path) ||
    !Array.isArray(guard.statuses) ||
    guard.statuses.length !== expectedCount ||
    guard.statuses.some((status) => status !== 404) ||
    !observer ||
    observer.requests !== expectedCount ||
    !Array.isArray(observer.statuses) ||
    observer.statuses.length !== expectedCount ||
    observer.statuses.some((status) => status !== 404) ||
    !Array.isArray(observer.noStore) ||
    observer.noStore.length !== expectedCount ||
    observer.noStore.some((value) => value !== true) ||
    !Array.isArray(observer.direct) ||
    observer.direct.length !== expectedCount ||
    observer.direct.some((value) => value !== true) ||
    !page ||
    page.status !== (denied ? "denied" : "idle") ||
    page.sameProject !== denied ||
    page.snapshot !== false ||
    page.quality !== true ||
    page.releaseGeneration !== null ||
    page.releasedRevision !== null
  ) {
    throw new Error("D5b6 撤权发布 HTTP 404、只读守卫或本地运行状态不符合预期");
  }
  return { stage, readCount: expectedCount };
}

/** 白名单阶段和错误类别以外的异常一律脱敏，拒绝回显任何工程或身份数据。 */
export function describeD5b6VisibilityFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  if (
    error instanceof Error &&
    error.message === "D5b6 真实浏览器阶段失败" &&
    PHASES.has(error.stage)
  ) {
    const reason = SAFE_ERRORS.has(error.safeReason) ? error.safeReason : "内部异常已脱敏";
    return "D5b6 " + error.stage + "失败：" + reason;
  }
  return "D5b6 已撤权正式运行生命周期只读专项失败，内部信息已脱敏";
}

async function captureStage(session, projectId, stage) {
  const guard = await waitForD5b5ReadGuardSettled(session);
  const page = await session.evaluate(publishedAuthorizedUiStateInPage, projectId);
  const observer = await session.evaluate(d5b4ResponseStateInPage);
  return requireD5b6VisibilityStage(stage, projectId, page, guard, observer);
}

async function verifyOrigin(browser, second, origin, principal, projectId, name, report) {
  report(name + "：可信会话及发布导航");
  await browser.send("Page.navigate", { url: origin + "/" });
  await activateStudioTab(browser);
  const current = await waitForState(
    () => browser.evaluate(identityInPage, origin),
    "D5b6 同一隔离浏览器可信身份不一致",
  );
  assert.deepEqual(current, principal, "D5b6 同一隔离浏览器可信身份不一致");
  await waitForState(
    () => browser.evaluate(publishedNavigationReadyInPage),
    "D5b6 真实发布运行入口或标签页可见性异常",
  );
  await browser.evaluate(installPublishedReadGuardInPage, origin);
  await browser.evaluate(installD5b4ResponseObserverInPage, origin, projectId);
  assert.equal(await browser.evaluate(openPublishedRuntimeInPage), true);
  await waitForState(
    () =>
      browser
        .evaluate(publishedAuthorizedUiStateInPage, projectId)
        .then((state) => (state?.status === "idle" ? state : null)),
    "D5b6 真实发布运行入口或标签页可见性异常",
  );

  report(name + "：页面默认零 GET");
  await captureStage(browser, projectId, "initial");

  report(name + "：正式运行首次真实 404");
  assert.equal(await browser.evaluate(enterD5b4ProjectInPage, projectId), true);
  assert.equal(await browser.evaluate(submitPublishedProjectInPage), true);
  await waitForState(
    async () => {
      const observer = await browser.evaluate(d5b4ResponseStateInPage);
      if (observer?.statuses?.length !== 1) return null;
      const state = await browser.evaluate(publishedAuthorizedUiStateInPage, projectId);
      return state?.status === "denied" ? state : null;
    },
    "D5b6 运行页面隐藏与重显阶段等待超时",
  );
  await captureStage(browser, projectId, "denied");

  report(name + "：第二标签页使运行页隐藏");
  await second.send("Page.navigate", { url: origin + "/" });
  await activateStudioTab(second);
  await waitForState(
    () => browser.evaluate(studioVisibilityInPage).then((state) => state === "hidden"),
    "D5b6 真实发布运行入口或标签页可见性异常",
  );
  const secondIdentity = await waitForState(
    () => second.evaluate(identityInPage, origin),
    "D5b6 同一隔离浏览器可信身份不一致",
  );
  assert.deepEqual(secondIdentity, principal, "D5b6 同一隔离浏览器可信身份不一致");
  await waitForState(
    () =>
      browser
        .evaluate(publishedAuthorizedUiStateInPage, projectId)
        .then((state) => (state?.status === "idle" ? state : null)),
    "D5b6 运行页面隐藏与重显阶段等待超时",
  );
  await captureStage(browser, projectId, "hidden");

  report(name + "：恢复运行页可见与再次真实 404");
  await activateStudioTab(browser);
  await waitForState(
    () => second.evaluate(studioVisibilityInPage).then((state) => state === "hidden"),
    "D5b6 真实发布运行入口或标签页可见性异常",
  );
  await waitForState(
    async () => {
      const observer = await browser.evaluate(d5b4ResponseStateInPage);
      if (observer?.statuses?.length !== 2) return null;
      const state = await browser.evaluate(publishedAuthorizedUiStateInPage, projectId);
      return state?.status === "denied" ? state : null;
    },
    "D5b6 运行页面隐藏与重显阶段等待超时",
  );
  await captureStage(browser, projectId, "resumed");

  report(name + "：停止读取后零新增 GET");
  assert.equal(await browser.evaluate(clickPublishedReadControlInPage, "停止读取"), true);
  await waitForState(
    () =>
      browser
        .evaluate(publishedAuthorizedUiStateInPage, projectId)
        .then((state) => (state?.status === "idle" ? state : null)),
    "D5b6 运行页面隐藏与重显阶段等待超时",
  );
  await captureStage(browser, projectId, "stopped");
  process.stdout.write(
    name + "：两次真实 404、隐藏清空、重显重新拒绝及停止后零新增 GET 通过。\n",
  );
}

async function run() {
  const { projectId } = parseD5b6VisibilityArgs(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b6 可信 OIDC HTTPS 本机隔离 Lab 不可用");
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("D5b6 本机 Chrome/Edge 不可用");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (response.status !== 200 || response.url !== origin + "/") {
      throw new Error("D5b6 可信 OIDC HTTPS 本机隔离 Lab 不可用");
    }
  }

  const browser = await startBrowser(executable);
  let second = null;
  let stage = "可信 OIDC 登录";
  const report = (next) => {
    stage = next;
    process.stdout.write("D5b6：" + next + "，正在验证\n");
  };
  try {
    report(stage);
    const principal = await waitForLogin(browser, origins[0], "D5b6 正式发布只读重显");
    if (!principal) throw new Error("D5b6 同一隔离浏览器可信身份不一致");
    second = await openCompanionChromeTab(browser);
    for (const [index, origin] of origins.entries()) {
      await verifyOrigin(
        browser,
        second,
        origin,
        principal,
        projectId,
        index === 0 ? "React" : "Vue",
        report,
      );
    }
    process.stdout.write(
      "D5b6 React/Vue 已撤权运行页隐藏重显真实 404 专项通过；未变更 ACL 或工程。\n",
    );
  } catch (error) {
    const failure = new Error("D5b6 真实浏览器阶段失败");
    failure.stage = stage;
    failure.safeReason =
      error instanceof Error && SAFE_ERRORS.has(error.message) ? error.message : null;
    throw failure;
  } finally {
    second?.socket.close();
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeD5b6VisibilityFailure(error) + "\n");
    process.exitCode = 1;
  });
}
