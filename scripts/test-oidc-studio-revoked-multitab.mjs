import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  executablePath,
  identityInPage,
  startBrowser,
  waitForLogin,
} from "./test-oidc-dual-cas.mjs";
import {
  enterStudioInPage,
  saveDraftInPage,
  waitForStudioActionIdleInPage,
  resolveProjectBrowserLab,
} from "./test-project-browser-oidc.mjs";
import {
  activateStudioTab,
  addStudioSymbolInPage,
  openCompanionChromeTab,
} from "./test-oidc-studio-multitab.mjs";
import {
  installPublishedReadGuardInPage,
  publishedReadGuardStateInPage,
  waitForState,
} from "./test-oidc-published-runtime-readonly.mjs";
import {
  classifyD5b5LocalChanges,
  describeD5b5StudioFailure,
  inspectD5b5StudioState,
  openD5b5Project,
  readRevokedReleaseInStudioPage,
  requireD5b5Prepared,
  requireD5b5Preserved,
} from "./test-oidc-studio-revoked-draft.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const PROJECT_PATTERN =
  /^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ERRORS = new Set([
  "D5b5b 只允许现有已撤权工程 ID，不允许写入参数",
  "D5b5b 可信本机 OIDC HTTPS Lab 不可用",
  "D5b5b 本机 Chrome/Edge 不可用",
  "D5b5b 两个标签页必须使用同一可信主体",
  "D5b5b Studio 首版只读载入失败",
  "D5b5b 两个标签页未建立真实未保存编辑",
  "D5b5b 同源双标签页可见性切换失败",
  "D5b5b SVG、工程 JSON、IndexedDB 草稿或 CAS 基线变化",
  "D5b5b 工程 API 只读约束或发布 GET 404 不符合预期",
]);
const STAGES = new Set([
  "可信 OIDC 登录",
  ...["React", "Vue"].flatMap((name) =>
    [
      "第一标签页只读载入",
      "第一标签页本地草稿与编辑",
      "第二标签页只读载入与编辑",
      "第一标签页真实发布读取",
      "第二标签页真实发布读取",
      "切回第一标签页并复核",
    ].map((step) => name + "：" + step),
  ),
]);

/** 严格限制已撤权的独立专用工程，不允许自动创建、授权恢复及服务端写入。 */
export function parseD5b5MultiTabArgs(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 2 ||
    args[0] !== "--project-id" ||
    !PROJECT_PATTERN.test(args[1] ?? "")
  ) {
    throw new Error("D5b5b 只允许现有已撤权工程 ID，不允许写入参数");
  }
  return { projectId: args[1] };
}

/** 所有外部异常仅映射为固定中文阶段与类别，不输出真实工程 ID 或身份信息。 */
export function describeD5b5MultiTabFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  if (error instanceof Error && error.message === "D5b5b 浏览器阶段失败" && STAGES.has(error.stage)) {
    const reason = SAFE_ERRORS.has(error.safeReason) ? error.safeReason : "内部异常已脱敏";
    return "D5b5b " + error.stage + "失败：" + reason;
  }
  return "D5b5b 同源双标签页只读专项失败，内部信息已脱敏";
}

/** 页面函数必须独立序列化到 CDP；仅读取浏览器真实可见性，不伪造事件。 */
export function studioVisibilityInPage() {
  return document.visibilityState;
}

/** 两标签页共享的 IndexedDB 只能在准备阶段由第一标签页保存一次。 */
export function requireD5b5SharedDraft(first, second, projectId) {
  if (
    !PROJECT_PATTERN.test(projectId) ||
    first?.projectId !== projectId ||
    second?.projectId !== projectId ||
    first.draftCount < 1 ||
    !Number.isInteger(first.draftCount) ||
    second.draftCount !== first.draftCount ||
    !/^[0-9a-f]{64}$/.test(first.draftHash ?? "") ||
    second.draftHash !== first.draftHash ||
    first.baselineRevision !== 1 ||
    second.baselineRevision !== 1 ||
    first.autoSave !== false ||
    second.autoSave !== false
  ) {
    throw new Error("D5b5b 两个标签页未建立真实未保存编辑");
  }
  return true;
}

/** 严格比较两个标签各自的本地快照，允许不同标签拥有不同的未保存图元。 */
export function requireD5b5TabUnchanged(projectId, before, after) {
  if (
    !PROJECT_PATTERN.test(projectId) ||
    !before ||
    !after ||
    before.projectId !== projectId ||
    after.projectId !== projectId ||
    before.baselineRevision !== 1 ||
    after.baselineRevision !== 1 ||
    before.autoSave !== false ||
    after.autoSave !== false ||
    !Number.isInteger(before.draftCount) ||
    before.draftCount < 1 ||
    !/^[0-9a-f]{64}$/.test(before.draftHash ?? "") ||
    !/^[0-9a-f]{64}$/.test(before.documentHash ?? "") ||
    !/^[0-9a-f]{64}$/.test(after.draftHash ?? "") ||
    !/^[0-9a-f]{64}$/.test(after.documentHash ?? "") ||
    Object.values(classifyD5b5LocalChanges(before, after)).some(Boolean)
  ) {
    throw new Error("D5b5b SVG、工程 JSON、IndexedDB 草稿或 CAS 基线变化");
  }
  return true;
}

/** 任意标签页的页面工程写入守卫一旦触发必须立刻拒绝。 */
export function requireD5b5NoBlockedWrites(first, second) {
  if (
    !first ||
    !second ||
    first.blocked !== 0 ||
    second.blocked !== 0 ||
    !Array.isArray(first.paths) ||
    !Array.isArray(second.paths) ||
    !Array.isArray(first.statuses) ||
    !Array.isArray(second.statuses) ||
    first.paths.length !== first.statuses.length ||
    second.paths.length !== second.statuses.length
  ) {
    throw new Error("D5b5b 工程 API 只读约束或发布 GET 404 不符合预期");
  }
  return true;
}

async function waitForStudioReady(session, origin, principal) {
  const identity = await waitForState(
    () => session.evaluate(identityInPage, origin),
    "D5b5b 两个标签页必须使用同一可信主体",
  );
  if (
    !identity ||
    identity.tenantId !== principal.tenantId ||
    identity.subjectId !== principal.subjectId
  ) {
    throw new Error("D5b5b 两个标签页必须使用同一可信主体");
  }
  if (!(await session.evaluate(enterStudioInPage))) {
    throw new Error("D5b5b Studio 首版只读载入失败");
  }
}

async function waitForTabHidden(session) {
  await waitForState(
    async () => (await session.evaluate(studioVisibilityInPage)) === "hidden",
    "D5b5b 同源双标签页可见性切换失败",
  );
}

async function switchToTab(visible, hidden) {
  await activateStudioTab(visible);
  await waitForTabHidden(hidden);
  if (!(await visible.evaluate(waitForStudioActionIdleInPage))) {
    throw new Error("D5b5b Studio 首版只读载入失败");
  }
}

async function verifySingleRevokedGet(session, origin, projectId, baseline) {
  const beforeGuard = await session.evaluate(publishedReadGuardStateInPage);
  const response = await session.evaluate(readRevokedReleaseInStudioPage, origin, projectId);
  const afterGuard = await session.evaluate(publishedReadGuardStateInPage);
  const after = await inspectD5b5StudioState(session);
  try {
    requireD5b5Preserved(projectId, baseline, after, response, beforeGuard, afterGuard);
  } catch {
    throw new Error("D5b5b 工程 API 只读约束或发布 GET 404 不符合预期");
  }
  return after;
}

async function run() {
  const { projectId } = parseD5b5MultiTabArgs(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b5b 可信本机 OIDC HTTPS Lab 不可用");
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("D5b5b 本机 Chrome/Edge 不可用");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (response.status !== 200 || response.url !== origin + "/") {
      throw new Error("D5b5b 可信本机 OIDC HTTPS Lab 不可用");
    }
  }

  const browser = await startBrowser(executable);
  let second = null;
  let stage = "可信 OIDC 登录";
  const report = (step) => {
    stage = step;
    process.stdout.write("D5b5b：" + step + "，正在验证\n");
  };
  const source =
    "if (" +
    JSON.stringify(origins) +
    ".includes(location.origin)) {(" +
    installPublishedReadGuardInPage.toString() +
    ")(location.origin);}";
  try {
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source });
    report(stage);
    const principal = await waitForLogin(browser, origins[0], "D5b5b 双标签页只读保护");
    if (!principal) throw new Error("D5b5b 两个标签页必须使用同一可信主体");
    second = await openCompanionChromeTab(browser);
    await second.send("Page.addScriptToEvaluateOnNewDocument", { source });

    for (const [index, origin] of origins.entries()) {
      const name = index === 0 ? "React" : "Vue";
      report(name + "：第一标签页只读载入");
      await browser.send("Page.navigate", { url: origin + "/" });
      await activateStudioTab(browser);
      await waitForStudioReady(browser, origin, principal);
      await openD5b5Project(browser, projectId);

      report(name + "：第一标签页本地草稿与编辑");
      assert.equal(await browser.evaluate(saveDraftInPage), true);
      const firstSaved = await inspectD5b5StudioState(browser);
      assert.equal(await browser.evaluate(addStudioSymbolInPage, "+ 文本"), true);
      const firstEdited = await inspectD5b5StudioState(browser);
      requireD5b5Prepared(firstSaved, firstEdited, projectId);

      report(name + "：第二标签页只读载入与编辑");
      await second.send("Page.navigate", { url: origin + "/" });
      await switchToTab(second, browser);
      await waitForStudioReady(second, origin, principal);
      await openD5b5Project(second, projectId);
      const secondSaved = await inspectD5b5StudioState(second);
      requireD5b5SharedDraft(firstEdited, secondSaved, projectId);
      assert.equal(await second.evaluate(addStudioSymbolInPage, "+ 文本"), true);
      const secondEdited = await inspectD5b5StudioState(second);
      requireD5b5Prepared(secondSaved, secondEdited, projectId);

      report(name + "：第一标签页真实发布读取");
      await switchToTab(browser, second);
      const firstBefore = await inspectD5b5StudioState(browser);
      const secondBefore = await inspectD5b5StudioState(second);
      requireD5b5TabUnchanged(projectId, firstEdited, firstBefore);
      requireD5b5TabUnchanged(projectId, secondEdited, secondBefore);
      await verifySingleRevokedGet(browser, origin, projectId, firstBefore);

      report(name + "：第二标签页真实发布读取");
      await switchToTab(second, browser);
      const secondVisible = await inspectD5b5StudioState(second);
      requireD5b5TabUnchanged(projectId, secondBefore, secondVisible);
      await verifySingleRevokedGet(second, origin, projectId, secondVisible);

      report(name + "：切回第一标签页并复核");
      await switchToTab(browser, second);
      const firstFinal = await inspectD5b5StudioState(browser);
      const secondFinal = await inspectD5b5StudioState(second);
      requireD5b5TabUnchanged(projectId, firstBefore, firstFinal);
      requireD5b5TabUnchanged(projectId, secondBefore, secondFinal);
      const [firstGuard, secondGuard] = await Promise.all([
        browser.evaluate(publishedReadGuardStateInPage),
        second.evaluate(publishedReadGuardStateInPage),
      ]);
      requireD5b5NoBlockedWrites(firstGuard, secondGuard);
      process.stdout.write(
        name + "：同源双标签页真实 404、可见性切换及两边画布、草稿与 CAS 保护通过。\n",
      );
    }
    process.stdout.write(
      "D5b5b React/Vue 同源双标签页只读回归通过；未创建工程、恢复 ACL 或执行服务端写入。\n",
    );
  } catch (error) {
    const failure = new Error("D5b5b 浏览器阶段失败");
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
    process.stderr.write("错误：" + describeD5b5MultiTabFailure(error) + "\n");
    process.exitCode = 1;
  });
}
