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
  clickBrowserControlInPage,
  enterStudioInPage,
  inspectStudioState,
  openProjectInPage,
  pageStateInPage,
  resolveProjectBrowserLab,
  saveDraftInPage,
  waitForStudioActionIdleInPage,
} from "./test-project-browser-oidc.mjs";
import {
  addStudioSymbolInPage,
  openProjectBrowserMenuInPage,
  readStudioDocumentHashInPage,
  studioMultiTabUiStateInPage,
} from "./test-oidc-studio-multitab.mjs";
import { readStudioContentCanvasInPage } from "./test-oidc-studio-real-late.mjs";
import {
  installPublishedReadGuardInPage,
  publishedReadGuardStateInPage,
  waitForState,
} from "./test-oidc-published-runtime-readonly.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const PROJECT_PATTERN =
  /^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ERRORS = new Set([
  "D5b5 仅允许现有已撤权专用工程的双框架只读回归",
  "D5b5 可信本机 OIDC HTTPS Lab 不可用",
  "D5b5 本机 Chrome/Edge 不可用",
  "D5b5 双框架可信登录主体不一致",
  "D5b5 Studio 工程管理入口或首版不可用",
  "D5b5 Studio 本地草稿与未保存编辑准备失败",
  "D5b5 已撤权发布接口未返回真实同源 HTTP 404",
  "D5b5 Studio 画布、IndexedDB 草稿或 CAS 基线发生变化",
  "D5b5 浏览器工程请求不符合零写入约束",
]);
const STAGES = new Set([
  "OIDC 登录",
  ...["React", "Vue"].flatMap((name) =>
    [
      "可信会话",
      "进入 Studio",
      "只读载入同一工程",
      "保存隔离浏览器草稿",
      "添加未保存图元",
      "真实发布 GET 404",
      "核验本地不变",
    ].map((step) => name + "：" + step),
  ),
]);

/** 只允许使用现存且已撤权的独立 D5b4 工程；绝不重新创建或授予 ACL。 */
export function parseD5b5StudioMode(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 2 ||
    args[0] !== "--project-id" ||
    !PROJECT_PATTERN.test(args[1] ?? "")
  ) {
    throw new Error("D5b5 仅允许现有已撤权专用工程的双框架只读回归");
  }
  return { projectId: args[1] };
}

/** 错误诊断只含固定阶段和固定中文类别，不返回工程正文、Cookie 或 Token。 */
export function describeD5b5StudioFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  if (
    error instanceof Error &&
    error.message === "D5b5 浏览器阶段失败" &&
    STAGES.has(error.stage)
  ) {
    const category = SAFE_ERRORS.has(error.safeReason) ? error.safeReason : "内部异常已脱敏";
    return "D5b5 " + error.stage + "失败：" + category;
  }
  return "D5b5 双框架 Studio 草稿保护专项失败，内部信息已脱敏";
}

/** CDP 页面函数：不读取响应正文，只查询真实已撤权发布指针的 HTTP 状态及缓存安全。 */
export async function readRevokedReleaseInStudioPage(origin, projectId, runtime = globalThis) {
  if (
    runtime.location?.origin !== origin ||
    !/^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      projectId,
    ) ||
    !runtime.__aduiPublishedReadGuard
  ) {
    throw new Error("D5b5 浏览器工程请求不符合零写入约束");
  }
  const path = "/api/v1/projects/" + projectId + "/releases/current";
  const response = await runtime.fetch(path, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  return {
    status: response.status,
    noStore: response.headers?.get("cache-control") === "no-store",
    direct: response.redirected === false && response.url === origin + path,
  };
}

/** 仅返回稳定字段是否发生变化，不向终端输出画布、JSON 或草稿摘要。 */
export function classifyD5b5LocalChanges(before, after) {
  return {
    canvasChanged: before?.canvas !== after?.canvas,
    documentChanged: before?.documentHash !== after?.documentHash,
    draftCountChanged: before?.draftCount !== after?.draftCount,
    draftHashChanged: before?.draftHash !== after?.draftHash,
    autoSaveChanged: before?.autoSave !== after?.autoSave,
    baselineChanged: before?.baselineRevision !== after?.baselineRevision,
    projectChanged: before?.projectId !== after?.projectId,
  };
}

/** 草稿必须先真实保存一次，再产生未保存图元变化，才能证明回归具有判别力。 */
export function requireD5b5Prepared(saved, edited, projectId) {
  if (
    !PROJECT_PATTERN.test(projectId) ||
    saved?.projectId !== projectId ||
    edited?.projectId !== projectId ||
    saved?.baselineRevision !== 1 ||
    edited?.baselineRevision !== 1 ||
    saved.autoSave !== false ||
    edited.autoSave !== false ||
    !Number.isInteger(saved.draftCount) ||
    saved.draftCount < 1 ||
    !/^[0-9a-f]{64}$/.test(saved.draftHash ?? "") ||
    saved.draftHash !== edited.draftHash ||
    saved.draftCount !== edited.draftCount ||
    saved.canvas === edited.canvas ||
    saved.documentHash === edited.documentHash ||
    !/^[0-9a-f]{64}$/.test(edited.documentHash ?? "")
  ) {
    throw new Error("D5b5 Studio 本地草稿与未保存编辑准备失败");
  }
  return true;
}

/** 404 必须真实且同源，编辑器/草稿/基线需完全不变，浏览器工程 API 零写入。 */
export function requireD5b5Preserved(projectId, edited, after, response, beforeGuard, afterGuard) {
  if (!PROJECT_PATTERN.test(projectId)) {
    throw new Error("D5b5 仅允许现有已撤权专用工程的双框架只读回归");
  }
  const path = "/api/v1/projects/" + projectId + "/releases/current";
  if (
    !beforeGuard ||
    !afterGuard ||
    beforeGuard.blocked !== 0 ||
    afterGuard.blocked !== 0 ||
    !Array.isArray(beforeGuard.paths) ||
    !Array.isArray(beforeGuard.statuses) ||
    !Array.isArray(afterGuard.paths) ||
    !Array.isArray(afterGuard.statuses) ||
    afterGuard.paths.length !== beforeGuard.paths.length + 1 ||
    afterGuard.statuses.length !== beforeGuard.statuses.length + 1 ||
    !beforeGuard.paths.every((value, index) => afterGuard.paths[index] === value) ||
    !beforeGuard.statuses.every((value, index) => afterGuard.statuses[index] === value) ||
    afterGuard.paths[beforeGuard.paths.length] !== path ||
    afterGuard.statuses[beforeGuard.statuses.length] !== 404
  ) {
    throw new Error("D5b5 浏览器工程请求不符合零写入约束");
  }
  if (response?.status !== 404 || response.noStore !== true || response.direct !== true) {
    throw new Error("D5b5 已撤权发布接口未返回真实同源 HTTP 404");
  }
  if (
    !edited ||
    !after ||
    edited.projectId !== projectId ||
    after.projectId !== projectId ||
    edited.baselineRevision !== 1 ||
    after.baselineRevision !== 1 ||
    edited.autoSave !== false ||
    after.autoSave !== false ||
    !Number.isInteger(edited.draftCount) ||
    edited.draftCount < 1 ||
    !/^[0-9a-f]{64}$/.test(edited.draftHash ?? "") ||
    !/^[0-9a-f]{64}$/.test(after.draftHash ?? "") ||
    !/^[0-9a-f]{64}$/.test(edited.documentHash ?? "") ||
    !/^[0-9a-f]{64}$/.test(after.documentHash ?? "") ||
    Object.values(classifyD5b5LocalChanges(edited, after)).some(Boolean)
  ) {
    throw new Error("D5b5 Studio 画布、IndexedDB 草稿或 CAS 基线发生变化");
  }
  return true;
}

/** 依照已有浏览器草稿摘要、去网格 SVG 和工程 JSON 导出检查真正本地状态。 */
async function inspectD5b5StudioState(session) {
  const view = await inspectStudioState(session);
  const canvas = await session.evaluate(readStudioContentCanvasInPage);
  const exported = await session.evaluate(readStudioDocumentHashInPage);
  const ui = await session.evaluate(studioMultiTabUiStateInPage);
  return {
    projectId: exported.projectId,
    canvas,
    documentHash: exported.hash,
    draftCount: view.drafts.count,
    draftHash: view.drafts.hash,
    autoSave: view.autoSave,
    baselineRevision: ui.baselineRevision,
  };
}

async function openD5b5Project(session, projectId) {
  assert.equal(await session.evaluate(openProjectBrowserMenuInPage), true);
  let state = await waitForState(async () => {
    const current = await session.evaluate(pageStateInPage);
    return current && !current.busy && current.ids.length > 0 && !current.error ? current : null;
  }, "D5b5 Studio 工程管理入口或首版不可用");
  let found = state.ids.includes(projectId);
  for (let index = 0; index < 100 && !found && state.nextEnabled; index += 1) {
    const currentPage = state.pageNumber;
    assert.equal(await session.evaluate(clickBrowserControlInPage, "next"), true);
    state = await waitForState(async () => {
      const next = await session.evaluate(pageStateInPage);
      return next && !next.busy && next.pageNumber === currentPage + 1 ? next : null;
    }, "D5b5 Studio 工程管理入口或首版不可用");
    found = state.ids.includes(projectId);
  }
  if (!found) throw new Error("D5b5 Studio 工程管理入口或首版不可用");
  const index = state.ids.indexOf(projectId);
  if (state.revisions[index] !== 1) {
    throw new Error("D5b5 Studio 工程管理入口或首版不可用");
  }
  const opened = await session.evaluate(openProjectInPage, projectId, 1, "confirm");
  if (
    opened?.outcome !== "confirm" ||
    opened.confirmCount !== 1 ||
    opened.intercepted !== 0 ||
    !(await session.evaluate(waitForStudioActionIdleInPage))
  ) {
    throw new Error("D5b5 Studio 工程管理入口或首版不可用");
  }
}

async function run() {
  const { projectId } = parseD5b5StudioMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b5 可信本机 OIDC HTTPS Lab 不可用");
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("D5b5 本机 Chrome/Edge 不可用");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (response.status !== 200 || response.url !== origin + "/") {
      throw new Error("D5b5 可信本机 OIDC HTTPS Lab 不可用");
    }
  }

  const browser = await startBrowser(executable);
  let stage = "OIDC 登录";
  const report = (next) => {
    stage = next;
    process.stdout.write("D5b5：" + next + "，正在验证\n");
  };
  try {
    await browser.send("Page.addScriptToEvaluateOnNewDocument", {
      source:
        "if (" +
        JSON.stringify(origins) +
        ".includes(location.origin)) {(" +
        installPublishedReadGuardInPage.toString() +
        ")(location.origin);}",
    });
    report(stage);
    const principal = await waitForLogin(browser, origins[0], "D5b5 Studio 草稿只读保护");
    if (!principal) throw new Error("D5b5 双框架可信登录主体不一致");

    for (const [index, origin] of origins.entries()) {
      const name = index === 0 ? "React" : "Vue";
      report(name + "：可信会话");
      await browser.send("Page.navigate", { url: origin + "/" });
      const identity = await waitForState(
        () => browser.evaluate(identityInPage, origin),
        "D5b5 双框架可信登录主体不一致",
      );
      assert.deepEqual(identity, principal, "D5b5 双框架可信登录主体不一致");

      report(name + "：进入 Studio");
      assert.equal(await browser.evaluate(enterStudioInPage), true);
      report(name + "：只读载入同一工程");
      await openD5b5Project(browser, projectId);

      report(name + "：保存隔离浏览器草稿");
      assert.equal(await browser.evaluate(saveDraftInPage), true);
      const saved = await inspectD5b5StudioState(browser);
      report(name + "：添加未保存图元");
      assert.equal(await browser.evaluate(addStudioSymbolInPage, "+ 文本"), true);
      const edited = await inspectD5b5StudioState(browser);
      requireD5b5Prepared(saved, edited, projectId);

      report(name + "：真实发布 GET 404");
      const beforeGuard = await browser.evaluate(publishedReadGuardStateInPage);
      const response = await browser.evaluate(readRevokedReleaseInStudioPage, origin, projectId);
      const afterGuard = await browser.evaluate(publishedReadGuardStateInPage);
      report(name + "：核验本地不变");
      const after = await inspectD5b5StudioState(browser);
      requireD5b5Preserved(projectId, edited, after, response, beforeGuard, afterGuard);
      process.stdout.write(name + "：真实 404 后 SVG、工程 JSON、草稿与 CAS 未变化。\n");
    }
    process.stdout.write(
      "D5b5 双框架 Studio 同工程跨界面只读回归通过；没有创建工程、恢复 ACL 或写入服务端。\n",
    );
  } catch (error) {
    const failure = new Error("D5b5 浏览器阶段失败");
    failure.stage = stage;
    failure.safeReason =
      error instanceof Error && SAFE_ERRORS.has(error.message) ? error.message : null;
    throw failure;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeD5b5StudioFailure(error) + "\n");
    process.exitCode = 1;
  });
}
