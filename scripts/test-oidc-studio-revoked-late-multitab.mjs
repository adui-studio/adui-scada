import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executablePath, startBrowser, waitForLogin } from "./test-oidc-dual-cas.mjs";
import {
  resolveProjectBrowserLab,
  saveDraftInPage,
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
  inspectD5b5StudioState,
  openD5b5Project,
  requireD5b5Prepared,
  requireD5b5Preserved,
} from "./test-oidc-studio-revoked-draft.mjs";
import {
  parseD5b5MultiTabArgs,
  requireD5b5NoBlockedWrites,
  requireD5b5SharedDraft,
  requireD5b5TabUnchanged,
  switchToTab,
  waitForStudioReady,
} from "./test-oidc-studio-revoked-multitab.mjs";
import {
  d5b5cLateReadStateInPage,
  installD5b5cLateGateInPage,
  releaseD5b5cLateReadInPage,
  requireD5b5cLateReadState,
  startD5b5cLateReadInPage,
} from "./test-oidc-studio-revoked-late-gate.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SAFE_ERRORS = new Set([
  "D5b5c 可信本机 OIDC HTTPS Lab 不可用",
  "D5b5c 本机 Chrome/Edge 不可用",
  "D5b5c 双标签页真实同源主体不一致",
  "D5b5c 双标签真实 404 响应未同时挂起",
  "D5b5c 真实 404 响应未按第二标签优先交付",
  "D5b5c 双标签本地状态或只读请求发生漂移",
]);
const STAGES = new Set([
  "可信 OIDC 登录",
  ...["React", "Vue"].flatMap((name) =>
    [
      "两标签页准备",
      "第一标签页挂起真实 404",
      "第二标签页挂起真实 404",
      "两个读取挂起期间的状态核对",
      "先交付第二标签页真实 404",
      "后交付第一标签页真实 404",
      "最终两标签页保护复核",
    ].map((step) => name + "：" + step),
  ),
]);

/** 只映射白名单阶段与失败类别，不泄露真实工程 ID、Cookie、Token 或响应正文。 */
export function describeD5b5cBrowserFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  if (
    error instanceof Error &&
    error.message === "D5b5c 浏览器阶段失败" &&
    STAGES.has(error.stage)
  ) {
    const reason = SAFE_ERRORS.has(error.safeReason) ? error.safeReason : "内部异常已脱敏";
    return "D5b5c " + error.stage + "失败：" + reason;
  }
  return "D5b5c 双标签页只读逆序响应专项失败，内部信息已脱敏";
}

async function waitForGate(session) {
  const state = await waitForState(
    async () => {
      const current = await session.evaluate(d5b5cLateReadStateInPage);
      return current?.pending ? current : null;
    },
    "D5b5c 双标签真实 404 响应未同时挂起",
  );
  requireD5b5cLateReadState(state, "pending");
  return state;
}

async function waitForRelease(session) {
  const state = await waitForState(
    async () => {
      const current = await session.evaluate(d5b5cLateReadStateInPage);
      return current?.settled ? current : null;
    },
    "D5b5c 真实 404 响应未按第二标签优先交付",
  );
  requireD5b5cLateReadState(state, "settled");
  return state;
}

/** 在浏览器自身的两个标签页分别保留真实响应，只控制交付次序。 */
async function verifyOrigin(browser, second, origin, principal, projectId, name, report) {
  report(name + "：两标签页准备");
  await browser.send("Page.navigate", { url: origin + "/" });
  await activateStudioTab(browser);
  await waitForStudioReady(browser, origin, principal);
  await openD5b5Project(browser, projectId);
  assert.equal(await browser.evaluate(saveDraftInPage), true);
  const firstSaved = await inspectD5b5StudioState(browser);
  assert.equal(await browser.evaluate(addStudioSymbolInPage, "+ 文本"), true);
  const firstEdited = await inspectD5b5StudioState(browser);
  requireD5b5Prepared(firstSaved, firstEdited, projectId);

  await second.send("Page.navigate", { url: origin + "/" });
  await switchToTab(second, browser);
  await waitForStudioReady(second, origin, principal);
  await openD5b5Project(second, projectId);
  const secondSaved = await inspectD5b5StudioState(second);
  requireD5b5SharedDraft(firstEdited, secondSaved, projectId);
  assert.equal(await second.evaluate(addStudioSymbolInPage, "+ 文本"), true);
  const secondEdited = await inspectD5b5StudioState(second);
  requireD5b5Prepared(secondSaved, secondEdited, projectId);

  report(name + "：第一标签页挂起真实 404");
  await switchToTab(browser, second);
  const firstBefore = await inspectD5b5StudioState(browser);
  const secondBefore = await inspectD5b5StudioState(second);
  requireD5b5TabUnchanged(projectId, firstEdited, firstBefore);
  requireD5b5TabUnchanged(projectId, secondEdited, secondBefore);
  const firstGuardBefore = await browser.evaluate(publishedReadGuardStateInPage);
  assert.equal(await browser.evaluate(installD5b5cLateGateInPage, origin, projectId), true);
  assert.equal(await browser.evaluate(startD5b5cLateReadInPage), true);
  await waitForGate(browser);

  report(name + "：第二标签页挂起真实 404");
  await switchToTab(second, browser);
  const secondGuardBefore = await second.evaluate(publishedReadGuardStateInPage);
  assert.equal(await second.evaluate(installD5b5cLateGateInPage, origin, projectId), true);
  assert.equal(await second.evaluate(startD5b5cLateReadInPage), true);
  await waitForGate(second);

  report(name + "：两个读取挂起期间的状态核对");
  requireD5b5cLateReadState(await browser.evaluate(d5b5cLateReadStateInPage), "pending");
  requireD5b5cLateReadState(await second.evaluate(d5b5cLateReadStateInPage), "pending");
  requireD5b5TabUnchanged(projectId, firstBefore, await inspectD5b5StudioState(browser));
  requireD5b5TabUnchanged(projectId, secondBefore, await inspectD5b5StudioState(second));

  report(name + "：先交付第二标签页真实 404");
  assert.equal(await second.evaluate(releaseD5b5cLateReadInPage), true);
  const secondResult = await waitForRelease(second);
  const secondGuardAfter = await second.evaluate(publishedReadGuardStateInPage);
  const secondAfter = await inspectD5b5StudioState(second);
  requireD5b5Preserved(
    projectId,
    secondBefore,
    secondAfter,
    secondResult,
    secondGuardBefore,
    secondGuardAfter,
  );
  requireD5b5cLateReadState(await browser.evaluate(d5b5cLateReadStateInPage), "pending");

  report(name + "：后交付第一标签页真实 404");
  await switchToTab(browser, second);
  assert.equal(await browser.evaluate(releaseD5b5cLateReadInPage), true);
  const firstResult = await waitForRelease(browser);
  const firstGuardAfter = await browser.evaluate(publishedReadGuardStateInPage);
  const firstAfter = await inspectD5b5StudioState(browser);
  requireD5b5Preserved(
    projectId,
    firstBefore,
    firstAfter,
    firstResult,
    firstGuardBefore,
    firstGuardAfter,
  );

  report(name + "：最终两标签页保护复核");
  requireD5b5TabUnchanged(projectId, firstBefore, await inspectD5b5StudioState(browser));
  requireD5b5TabUnchanged(projectId, secondBefore, await inspectD5b5StudioState(second));
  requireD5b5NoBlockedWrites(
    await browser.evaluate(publishedReadGuardStateInPage),
    await second.evaluate(publishedReadGuardStateInPage),
  );
  process.stdout.write(name + "：两个真实 404 已逆序交付，SVG、工程 JSON、草稿与 CAS 保持不变。\n");
}

async function run() {
  const { projectId } = parseD5b5MultiTabArgs(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b5c 可信本机 OIDC HTTPS Lab 不可用");
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("D5b5c 本机 Chrome/Edge 不可用");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (response.status !== 200 || response.url !== origin + "/") {
      throw new Error("D5b5c 可信本机 OIDC HTTPS Lab 不可用");
    }
  }

  const browser = await startBrowser(executable);
  let second = null;
  let stage = "可信 OIDC 登录";
  const report = (value) => {
    stage = value;
    process.stdout.write("D5b5c：" + value + "，正在验证\n");
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
    const principal = await waitForLogin(browser, origins[0], "D5b5c 双标签页只读逆序响应");
    if (!principal) throw new Error("D5b5c 双标签页真实同源主体不一致");
    second = await openCompanionChromeTab(browser);
    await second.send("Page.addScriptToEvaluateOnNewDocument", { source });
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
      "D5b5c React/Vue 双标签只读响应逆序交付完成；未修改 ACL、服务端工程或设备。\n",
    );
  } catch (error) {
    const failure = new Error("D5b5c 浏览器阶段失败");
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
    process.stderr.write("错误：" + describeD5b5cBrowserFailure(error) + "\n");
    process.exitCode = 1;
  });
}
