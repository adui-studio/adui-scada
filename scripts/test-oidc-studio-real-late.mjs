import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  appendCasVersionInPage,
  createCasProjectInPage,
  grantSecondSubject,
  executablePath,
  identityInPage,
  readCasProjectInPage,
  requireDifferentSubjects,
  startBrowser,
  verifyLateCasAudit,
  waitForLogin,
} from "./test-oidc-dual-cas.mjs";
import {
  clickBrowserControlInPage,
  enableAutoSaveInPage,
  enterStudioInPage,
  inspectStudioState,
  openProjectInPage,
  pageStateInPage,
  resolveProjectBrowserLab,
  saveDraftInPage,
  triggerSaveTimingInPage,
  triggerStudioResumeInPage,
  waitForStudioActionIdleInPage,
} from "./test-project-browser-oidc.mjs";
import { resolveLabIdentityTarget } from "./oidc-lab-identity.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const PROJECT_PREFIX = "b34-oidc-cas-";
const PROJECT_PATTERN =
  /^b34-oidc-cas-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_ERRORS = new Set([
  "真实 Studio 迟到响应专项必须显式确认本机 Lab",
  "真实 Studio 迟到响应专项仅允许可信本机 OIDC Lab",
  "未找到本机 Chrome/Edge 浏览器",
  "本机可信 HTTPS Web 服务未就绪",
  "真实 Studio 迟到响应测试准备失败",
  "真实 Studio 工程列表未找到本次专用工程",
  "真实 Studio 迟到保存未达到受控状态",
  "真实 Studio 迟到保存结果与数据库不一致",
  "真实 Studio 迟到保存未阻止重复写入",
  "真实 Studio 迟到保存的本地数据发生变化",
]);

export function parseStudioRealLateMode(args) {
  if (
    args.length === 3 &&
    args[0] === "--run-studio-late" &&
    args[1] === "--confirm-lab" &&
    args[2] === "adui_scada"
  ) {
    return true;
  }
  throw new Error("真实 Studio 迟到响应专项必须显式确认本机 Lab");
}

export function describeStudioRealLateFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return "真实 Studio 迟到响应专项未通过，内部错误详情已脱敏";
}

/**
 * 仅供隔离浏览器测试：拦截已有 Studio 版本 POST，真实 201 到达后延迟交给 API Client。
 * 函数经 CDP 单独序列化，不得引用 Node 模块作用域。
 */
export function installStudioRealLateHookInPage(runtime = globalThis) {
  if (runtime.__aduiTestStudioRealLate) {
    throw new Error("真实 Studio 迟到保存未达到受控状态");
  }
  const actualFetch = runtime.fetch.bind(runtime);
  const state = { active: null, writeAttempts: 0, rejectedWrites: 0 };
  runtime.__aduiTestStudioRealLate = state;
  runtime.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw, runtime.location.href);
    const method = (
      init?.method ?? (typeof input === "string" ? "GET" : input.method)
    ).toUpperCase();
    const isProjectRequest =
      url.pathname === "/api/v1/projects" || url.pathname.startsWith("/api/v1/projects/");
    if (!isProjectRequest || method === "GET" || method === "HEAD") {
      return actualFetch(input, init);
    }

    state.writeAttempts += 1;
    const active = state.active;
    const rejectWrite = () => {
      state.rejectedWrites += 1;
      return new Response("{}", {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    };
    if (
      !active ||
      active.phase !== "armed" ||
      method !== "POST" ||
      url.origin !== runtime.location.origin ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== "/api/v1/projects/" + encodeURIComponent(active.projectId) + "/versions"
    ) {
      return rejectWrite();
    }

    try {
      const request = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const cookieValues = runtime.document.cookie
        .split(";")
        .map((value) => value.trim())
        .filter((value) => value.startsWith("__Host-adui-scada-csrf="));
      const token =
        cookieValues.length === 1 ? cookieValues[0].slice("__Host-adui-scada-csrf=".length) : "";
      const header = new Headers(init?.headers).get("X-SCADA-CSRF");
      if (
        request?.expectedRevision !== 1 ||
        request?.document?.projectId !== active.projectId ||
        !/^scada_csrf_[A-Za-z0-9_-]{43}$/.test(token) ||
        header !== token ||
        init?.credentials !== "same-origin" ||
        init?.mode !== "same-origin"
      ) {
        return rejectWrite();
      }
    } catch {
      return rejectWrite();
    }

    active.hits += 1;
    active.phase = "sent";
    try {
      const response = await actualFetch(input, init);
      if (response.status !== 201) {
        active.phase = "failed";
        return response;
      }
      const saved = await response.clone().json();
      if (saved?.revision !== 2 || !/^[0-9a-f]{64}$/.test(saved.contentHash ?? "")) {
        active.phase = "failed";
        return response;
      }
      active.phase = "received";
      return await new Promise((finish) => {
        active.release = () => finish(response);
      });
    } catch {
      active.phase = "failed";
      throw new Error("真实 Studio 迟到保存未达到受控状态");
    }
  };
}

export function armStudioRealLateInPage(origin, projectId, runtime = globalThis) {
  const state = runtime.__aduiTestStudioRealLate;
  if (
    runtime.location.origin !== origin ||
    !/^b34-oidc-cas-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      projectId,
    ) ||
    !state ||
    state.active ||
    state.writeAttempts !== 0 ||
    state.rejectedWrites !== 0
  ) {
    throw new Error("真实 Studio 迟到保存未达到受控状态");
  }
  state.active = { projectId, phase: "armed", hits: 0, release: null };
  return true;
}

export function releaseStudioRealLateInPage(origin, projectId, runtime = globalThis) {
  const state = runtime.__aduiTestStudioRealLate;
  const active = state?.active;
  if (
    runtime.location.origin !== origin ||
    active?.projectId !== projectId ||
    active.phase !== "received" ||
    active.hits !== 1 ||
    state.writeAttempts !== 1 ||
    state.rejectedWrites !== 0 ||
    typeof active.release !== "function"
  ) {
    throw new Error("真实 Studio 迟到保存未达到受控状态");
  }
  const release = active.release;
  active.phase = "released";
  active.release = null;
  release();
  return true;
}

/** 页面只返回已审核的计数、布尔量与 CAS 修订号，不暴露业务正文或凭据。 */
export function studioRealLateStateInPage(runtime = globalThis) {
  const panel = runtime.document.querySelector('[aria-label="服务端工程版本"]');
  const text = panel?.textContent ?? "";
  const button = [...(panel?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "保存至服务端",
  );
  const baselineText = text.match(/CAS 基线：\s*(未建立|\d+)/)?.[1];
  const state = runtime.__aduiTestStudioRealLate;
  return {
    phase: state?.active?.phase ?? "missing",
    hits: state?.active?.hits ?? 0,
    writeAttempts: state?.writeAttempts ?? -1,
    rejectedWrites: state?.rejectedWrites ?? -1,
    busy: [...(panel?.querySelectorAll(".studio-version-help") ?? [])].some((item) =>
      item.textContent?.includes("正在处理工程版本"),
    ),
    disabled: button?.disabled ?? false,
    baselineRevision: baselineText && baselineText !== "未建立" ? Number(baselineText) : null,
    baselineCleared: baselineText === "未建立",
    headCleared: /服务端最新修订号：\s*未查询/.test(text),
    hasError: Boolean(panel?.querySelector('[role="alert"]')),
    savedSecondVersion:
      runtime.document
        .querySelector(".studio-notice")
        ?.textContent?.includes("已追加服务端版本 #2") === true,
    visible: runtime.document.visibilityState === "visible",
  };
}

/** 保存进行时恢复草稿操作必须被现有 UI 互斥锁拒绝。 */
export function attemptRestoreDuringSaveInPage(runtime = globalThis) {
  const menu = runtime.document.querySelector(".studio-file-menu");
  const button = [...(menu?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent.trim() === "恢复草稿",
  );
  if (!button || button.disabled) {
    throw new Error("真实 Studio 迟到保存未达到受控状态");
  }
  if (menu) menu.open = true;
  const originalConfirm = runtime.confirm;
  runtime.confirm = () => true;
  try {
    button.click();
    return true;
  } finally {
    runtime.confirm = originalConfirm;
  }
}

async function waitFor(task, label, tries = 100) {
  for (let index = 0; index < tries; index += 1) {
    try {
      const result = await task();
      if (result) return result;
    } catch {
      // 页面导航时的执行上下文可能暂时不存在，不透传浏览器异常。
    }
    await pause(150);
  }
  throw new Error(label);
}

/** 原有分页 UI 必须实际选中本轮新建的专用工程，不从脚本侧替换应用状态。 */
async function openDedicatedProject(session, origin, projectId) {
  await session.send("Page.navigate", { url: origin + "/" });
  await waitFor(
    () =>
      session.evaluate(function (expected) {
        return location.origin === expected && document.readyState === "complete";
      }, origin),
    "真实 Studio 迟到响应测试准备失败",
  );
  assert.equal(await session.evaluate(enterStudioInPage), true);
  assert.equal(
    await session.evaluate(function () {
      const menu = document.querySelector(".studio-project-browser-menu");
      if (!menu) return false;
      menu.open = true;
      return true;
    }),
    true,
  );

  let found = false;
  for (let index = 0; index < 100; index += 1) {
    const state = await waitFor(async () => {
      const current = await session.evaluate(pageStateInPage);
      return current && !current.busy && current.ids.length > 0 ? current : null;
    }, "真实 Studio 工程列表未找到本次专用工程");
    if (state.ids.includes(projectId)) {
      found = true;
      break;
    }
    if (!state.nextEnabled) break;
    assert.equal(await session.evaluate(clickBrowserControlInPage, "next"), true);
    await waitFor(async () => {
      const next = await session.evaluate(pageStateInPage);
      return next?.pageNumber === state.pageNumber + 1 && !next.busy;
    }, "真实 Studio 工程列表未找到本次专用工程");
  }
  if (!found) throw new Error("真实 Studio 工程列表未找到本次专用工程");

  const opened = await session.evaluate(openProjectInPage, projectId, 1, "confirm");
  if (opened.outcome !== "confirm" || opened.confirmCount !== 1) {
    throw new Error("真实 Studio 迟到响应测试准备失败");
  }
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  assert.equal(await session.evaluate(saveDraftInPage), true);
  assert.equal(await session.evaluate(enableAutoSaveInPage), true);
  const before = await inspectStudioState(session);
  const state = await session.evaluate(studioRealLateStateInPage);
  if (state.baselineRevision !== 1 || before.drafts.count < 1 || before.autoSave !== true) {
    throw new Error("真实 Studio 迟到响应测试准备失败");
  }
  return before;
}

function requireUnchangedDocument(before, after) {
  if (
    before.canvas !== after.canvas ||
    before.autoSave !== after.autoSave ||
    before.drafts?.count !== after.drafts?.count ||
    before.drafts?.hash !== after.drafts?.hash
  ) {
    throw new Error("真实 Studio 迟到保存的本地数据发生变化");
  }
}

/**
 * 等待真实 Studio UI 的受控状态；超时只输出固定布尔量和枚举，不输出工程/身份/响应正文。
 */
async function waitForStudioState(session, name, stage, predicate) {
  let state = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      state = await session.evaluate(studioRealLateStateInPage);
      if (predicate(state)) return state;
    } catch {
      // 导航或渲染期间页面执行上下文可能暂时不可用。
    }
    await pause(150);
  }
  const safeState = {
    phase: ["armed", "sent", "received", "released", "failed", "missing"].includes(state?.phase)
      ? state.phase
      : "unknown",
    hits: Number.isInteger(state?.hits) ? state.hits : -1,
    writeAttempts: Number.isInteger(state?.writeAttempts) ? state.writeAttempts : -1,
    rejectedWrites: Number.isInteger(state?.rejectedWrites) ? state.rejectedWrites : -1,
    busy: state?.busy === true,
    disabled: state?.disabled === true,
    baselineRevision:
      Number.isSafeInteger(state?.baselineRevision) ? state.baselineRevision : null,
    baselineCleared: state?.baselineCleared === true,
    headCleared: state?.headCleared === true,
    hasError: state?.hasError === true,
    savedSecondVersion: state?.savedSecondVersion === true,
    visible: state?.visible === true,
  };
  process.stdout.write(
    name + "：" + stage + "未达到预期，受控页面状态 " + JSON.stringify(safeState) + "\n",
  );
  throw new Error("真实 Studio 迟到保存未达到受控状态");
}

/** 两种框架各在真实 Studio UI 触发保存，第二主体从另一个浏览器推进数据库水位。 */
async function verifyFramework(
  session,
  secondBrowser,
  client,
  origin,
  secondOrigin,
  name,
  projectId,
  first,
  second,
) {
  process.stdout.write(name + "：正在通过真实 Studio 载入本次专用工程并建立 CAS 基线\n");
  await session.send("Page.bringToFront");
  const before = await openDedicatedProject(session, origin, projectId);
  assert.equal(await session.evaluate(armStudioRealLateInPage, origin, projectId), true);
  assert.equal(await session.evaluate(triggerSaveTimingInPage), true);
  const held = await waitForStudioState(
    session,
    name,
    "真实 201 挂起",
    (state) => state.phase === "received" && state.busy && state.disabled,
  );
  if (held.hits !== 1 || held.writeAttempts !== 1 || held.rejectedWrites !== 0) {
    throw new Error("真实 Studio 迟到保存未阻止重复写入");
  }
  assert.equal(await session.evaluate(attemptRestoreDuringSaveInPage), true);
  requireUnchangedDocument(before, await inspectStudioState(session));
  process.stdout.write(name + "：真实 201 已到达并挂起 Studio UI，另一主体准备推进版本 3\n");

  let secondRead;
  try {
    secondRead = await secondBrowser.evaluate(readCasProjectInPage, secondOrigin, projectId, 2);
  } catch {
    process.stdout.write(name + "：第二主体读取真实版本 2 失败\n");
    throw new Error("真实 Studio 迟到保存结果与数据库不一致");
  }
  process.stdout.write(name + "：第二主体已读取真实版本 2\n");
  let third;
  try {
    third = await secondBrowser.evaluate(appendCasVersionInPage, secondOrigin, projectId, 2);
  } catch {
    process.stdout.write(name + "：第二主体提交 CAS 2→3 失败\n");
    throw new Error("真实 Studio 迟到保存结果与数据库不一致");
  }
  process.stdout.write(
    name + "：第二主体追加请求返回 HTTP " + third.status +
      (Number.isSafeInteger(third.revision) ? "、修订号 " + third.revision : "") + "\n",
  );
  if (
    third.status !== 201 ||
    third.revision !== 3 ||
    !/^[0-9a-f]{64}$/.test(third.contentHash ?? "")
  ) {
    throw new Error("真实 Studio 迟到保存结果与数据库不一致");
  }
  requireUnchangedDocument(before, await inspectStudioState(session));
  try {
    assert.equal(await session.evaluate(releaseStudioRealLateInPage, origin, projectId), true);
  } catch {
    process.stdout.write(name + "：旧 201 释放前的请求计数或状态不符合预期\n");
    throw new Error("真实 Studio 迟到保存未达到受控状态");
  }
  process.stdout.write(name + "：已向 Studio 交付真实 201，等待界面确认版本 2\n");
  await waitForStudioState(
    session,
    name,
    "Studio 接收真实 201 并恢复保存界面",
    (state) => !state.busy && state.baselineRevision === 2 && state.savedSecondVersion,
  );
  requireUnchangedDocument(before, await inspectStudioState(session));

  // 第二主体操作时窗口可能在后台；先激活本标签，才派发可见性复核事件。
  await session.send("Page.bringToFront");
  await waitForStudioState(session, name, "浏览器切换到可见状态", (state) => state.visible);
  process.stdout.write(name + "：Studio 页面已可见，触发服务端 CAS 只读复核\n");
  // 保存完成后真实服务端水位已为 3，恢复可见只读复核必须撤销旧基线 2。
  assert.equal(await session.evaluate(triggerStudioResumeInPage), true);
  const stale = await waitForStudioState(
    session,
    name,
    "服务端水位 3 使旧 CAS 基线失效",
    (state) => !state.busy && state.baselineCleared && state.headCleared,
  );
  if (stale.writeAttempts !== 1 || stale.rejectedWrites !== 0) {
    throw new Error("真实 Studio 迟到保存未阻止重复写入");
  }
  assert.equal(await session.evaluate(triggerSaveTimingInPage), true);
  await waitForStudioState(
    session,
    name,
    "过期 CAS 再次保存被拒绝",
    (state) => !state.busy && state.hasError,
  );
  const final = await session.evaluate(studioRealLateStateInPage);
  if (final.writeAttempts !== 1 || final.rejectedWrites !== 0 || !final.baselineCleared) {
    throw new Error("真实 Studio 迟到保存未阻止重复写入");
  }
  requireUnchangedDocument(before, await inspectStudioState(session));

  const latest = await secondBrowser.evaluate(readCasProjectInPage, secondOrigin, projectId, 3);
  if (latest.contentHash !== third.contentHash) {
    throw new Error("真实 Studio 迟到保存结果与数据库不一致");
  }
  await verifyLateCasAudit(
    client,
    projectId,
    first,
    second,
    secondRead.contentHash,
    third.contentHash,
  );
  process.stdout.write(name + "：真实 UI 迟到 201、CAS 复核失效、草稿保护与三版审计检查完成\n");
}

async function run() {
  parseStudioRealLateMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("真实 Studio 迟到响应专项仅允许可信本机 OIDC Lab");
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const target = resolveLabIdentityTarget(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("未找到本机 Chrome/Edge 浏览器");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (!response.ok || response.url !== origin + "/") {
      throw new Error("本机可信 HTTPS Web 服务未就绪");
    }
  }

  const browsers = [];
  let client;
  try {
    const firstBrowser = await startBrowser(executable);
    browsers.push(firstBrowser);
    const first = await waitForLogin(firstBrowser, origins[0], "第一位主体");
    const secondBrowser = await startBrowser(executable);
    browsers.push(secondBrowser);
    process.stdout.write("第二个隔离浏览器必须使用同租户的另一位已预绑定普通测试主体。\n");
    await waitForLogin(secondBrowser, origins[0], "第二位主体");
    await secondBrowser.send("Page.navigate", { url: origins[1] + "/" });
    const second = await waitFor(
      () => secondBrowser.evaluate(identityInPage, origins[1]),
      "真实 Studio 迟到响应测试准备失败",
    );
    requireDifferentSubjects(first, second);

    const serverRequire = createRequire(SERVER_PACKAGE);
    const { Client } = serverRequire("pg");
    client = new Client({
      connectionString: target.connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
    });
    await client.connect();

    const projectIds = [PROJECT_PREFIX + randomUUID(), PROJECT_PREFIX + randomUUID()];
    for (const projectId of projectIds) {
      assert.match(projectId, PROJECT_PATTERN);
      await firstBrowser.evaluate(createCasProjectInPage, origins[0], projectId);
      await grantSecondSubject(client, projectId, first, second);
      await secondBrowser.evaluate(readCasProjectInPage, origins[1], projectId, 1);
    }
    process.stdout.write("两份全新随机专用工程、双主体授权和首版读取检查完成。\n");
    // 第一主体重新导航前注入 Fetch；必须先于 React/Vue API Client 捕获原生 Fetch。
    await firstBrowser.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "(" + installStudioRealLateHookInPage.toString() + ")();",
    });

    await verifyFramework(
      firstBrowser,
      secondBrowser,
      client,
      origins[0],
      origins[1],
      "React",
      projectIds[0],
      first,
      second,
    );
    await verifyFramework(
      firstBrowser,
      secondBrowser,
      client,
      origins[1],
      origins[1],
      "Vue",
      projectIds[1],
      first,
      second,
    );
    process.stdout.write(
      "真实双框架 Studio 迟到 201 专项通过：两个新工程均仅生成三版；CAS 过期拒绝，画布与草稿未改变。测试工程保留供复核。\n",
    );
  } finally {
    try {
      if (client) await client.end();
    } finally {
      for (const browser of browsers.reverse()) await browser.close();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeStudioRealLateFailure(error) + "\n");
    process.exitCode = 1;
  });
}
