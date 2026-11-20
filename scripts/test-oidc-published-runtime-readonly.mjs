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
import { resolveProjectBrowserLab } from "./test-project-browser-oidc.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const FAILURES = new Set([
  "正式发布运行只读专项只接受无参数模式",
  "正式发布运行只读专项缺少可信本机环境",
  "正式发布运行只读专项缺少本机 Chrome/Edge",
  "正式发布运行只读专项 HTTPS 页面不可用",
  "正式发布运行只读专项真实登录失败",
  "正式发布运行只读专项 React BFF 会话未通过验证",
  "正式发布运行只读专项 Vue BFF 会话未通过验证",
  "正式发布运行只读专项两端登录主体不一致",
  "正式发布运行只读专项没有进入发布页面",
  "正式发布运行只读专项发布读取没有受控拒绝",
  "正式发布运行只读专项检测到非只读工程请求",
]);

const PUBLISHED_STEPS = [
  "BFF 会话",
  "导航就绪",
  "只读门禁安装",
  "打开运行页面",
  "运行页面就绪",
  "默认零请求",
  "输入工程 ID",
  "提交发布读取",
  "等待受控拒绝",
  "核对只读断言",
];
const PUBLISHED_PHASES = new Set([
  "OIDC 登录",
  ...["React", "Vue"].flatMap((name) => PUBLISHED_STEPS.map((step) => name + "：" + step)),
]);
const PUBLISHED_PAGE_DIAGNOSTICS = new Set([
  "页面脚本引用异常",
  "页面脚本类型异常",
  "页面脚本语法异常",
  "浏览器存储或 DOM 异常",
  "页面脚本断言异常",
  "页面脚本异常（已脱敏）",
]);

export function requirePublishedReadonlyMode(args) {
  if (!Array.isArray(args) || args.length !== 0) {
    throw new Error("正式发布运行只读专项只接受无参数模式");
  }
  return true;
}

export function describePublishedReadonlyFailure(error) {
  if (error instanceof Error && FAILURES.has(error.message)) return error.message;
  if (
    error instanceof Error &&
    error.message === "正式发布运行只读专项阶段失败" &&
    PUBLISHED_PHASES.has(error.stage)
  ) {
    const reason = PUBLISHED_PAGE_DIAGNOSTICS.has(error.pageDiagnostic)
      ? error.pageDiagnostic
      : error.failureKind === "assertion"
        ? "只读安全断言不符"
        : error.failureKind === "reference"
          ? "测试脚本引用异常"
          : "异常已脱敏";
    return "正式发布运行只读专项" + error.stage + "失败：" + reason;
  }
  return "正式发布运行只读专项未通过，内部诊断已脱敏";
}

/** CDP 独立页面函数，禁止 Node 词法作用域依赖和任何工程 API 写入。 */
export function installPublishedReadGuardInPage(origin, runtime = globalThis) {
  if (runtime.location?.origin !== origin || runtime.__aduiPublishedReadGuard) {
    throw new Error("正式发布运行只读安全门禁安装失败");
  }
  const original = runtime.fetch.bind(runtime);
  const state = {
    paths: [],
    statuses: [],
    blocked: 0,
  };
  runtime.__aduiPublishedReadGuard = state;
  runtime.fetch = (input, init) => {
    const raw =
      typeof input === "string" ? input : typeof input?.url === "string" ? input.url : null;
    if (!raw) throw new Error("正式发布运行只读请求地址非法");
    const target = new URL(raw, runtime.location.origin + "/");
    const isProject = target.pathname.startsWith("/api/v1/projects");
    if (!isProject) return original(input, init);
    const method = (init?.method ?? input?.method ?? "GET").toUpperCase();
    if (
      target.origin !== origin ||
      method !== "GET" ||
      init?.body !== undefined ||
      init?.headers?.Authorization !== undefined ||
      init?.headers?.authorization !== undefined
    ) {
      state.blocked++;
      throw new Error("正式发布运行拒绝非只读工程请求");
    }
    state.paths.push(target.pathname + target.search);
    return Promise.resolve(original(input, init)).then((response) => {
      state.statuses.push(response.status);
      return response;
    });
  };
  return true;
}

/** 仅返回安全分类和请求路径，不读取 Cookie、快照或原始响应正文。 */
export function publishedReadGuardStateInPage(runtime = globalThis) {
  const state = runtime.__aduiPublishedReadGuard;
  if (!state) return null;
  return { paths: state.paths.slice(), statuses: state.statuses.slice(), blocked: state.blocked };
}

/** 等待实际导航加载完成，避免身份先于 React/Vue 按钮就绪而误判。 */
export function publishedNavigationReadyInPage(runtime = globalThis) {
  return (
    runtime.document.readyState === "complete" &&
    [...runtime.document.querySelectorAll("nav.scada-app-nav button")].some(
      (item) => item.textContent?.trim() === "已发布运行" && !item.disabled,
    )
  );
}

/** 通过真实导航与按钮激活页面，不调用 React/Vue 内部方法。 */
export function openPublishedRuntimeInPage(runtime = globalThis) {
  const button = [...runtime.document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === "已发布运行",
  );
  if (!button || button.disabled) throw new Error("正式发布运行入口不可用");
  button.click();
  return true;
}

export function enterPublishedProjectInPage(projectId, runtime = globalThis) {
  if (!/^d5a-missing-[0-9a-f-]{36}$/.test(projectId)) {
    throw new Error("正式发布运行专项工程标识不安全");
  }
  const panel = runtime.document.querySelector('[data-testid="published-runtime-page"]');
  if (!panel) throw new Error("正式发布运行页面不可用");
  const input = panel.querySelector('input[placeholder="输入已授权工程 ID"]');
  if (!input) throw new Error("正式发布运行页面缺少工程选择器");
  const inputPrototype = runtime.HTMLInputElement.prototype;
  if (typeof Object.getOwnPropertyDescriptor(inputPrototype, "value")?.set !== "function") {
    throw new Error("正式发布运行页面输入接口不可用");
  }
  Reflect.set(inputPrototype, "value", projectId, input);
  input.dispatchEvent(new runtime.Event("input", { bubbles: true }));
  return true;
}

/** 输入确认后才允许点击，防止框架状态仍是旧工程 ID。 */
export function submitPublishedProjectInPage(runtime = globalThis) {
  const panel = runtime.document.querySelector('[data-testid="published-runtime-page"]');
  const form = panel?.querySelector("form");
  const submit = [...(form?.querySelectorAll("button") ?? [])].find(
    (item) => item.textContent?.trim() === "读取正式发布",
  );
  if (!submit || submit.disabled) throw new Error("正式发布运行按钮不可用");
  submit.click();
  return true;
}

export function publishedRuntimeUiStateInPage(runtime = globalThis) {
  const panel = runtime.document.querySelector('[data-testid="published-runtime-page"]');
  if (!panel) return null;
  const status = panel.querySelector(".scada-status")?.getAttribute("data-status") ?? "";
  const snapshot = Boolean(panel.querySelector('[data-testid="published-runtime-svg"]'));
  const quality = [...panel.querySelectorAll("dd")].some((item) =>
    item.textContent?.includes("UNAVAILABLE"),
  );
  return { status, snapshot, quality };
}

/** 只执行调用者传入的读取操作；导航切换可重试，其他错误立即安全失败。 */
export async function waitForState(fn, failure, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "隔离浏览器页面执行失败") {
        throw error;
      }
    }
    await pause(150);
  }
  throw new Error(failure);
}

async function run() {
  requirePublishedReadonlyMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) {
    throw new Error("正式发布运行只读专项缺少可信本机环境");
  }
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("正式发布运行只读专项缺少本机 Chrome/Edge");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (response.status !== 200 || response.url !== origin + "/") {
      throw new Error("正式发布运行只读专项 HTTPS 页面不可用");
    }
  }

  const browser = await startBrowser(executable);
  let stage = "OIDC 登录";
  const reportStage = (phase) => {
    stage = phase;
    process.stdout.write("正式发布运行只读专项：" + phase + "，正在验证\n");
  };
  try {
    reportStage(stage);
    const identity = await waitForLogin(browser, origins[0], "正式发布运行只读专项");
    if (!identity) throw new Error("正式发布运行只读专项真实登录失败");
    const missingProject = "d5a-missing-" + crypto.randomUUID();
    for (const [index, origin] of origins.entries()) {
      const name = index === 0 ? "React" : "Vue";
      reportStage(name + "：BFF 会话");
      await browser.send("Page.navigate", { url: origin + "/" });
      const principal = await waitForState(
        () => browser.evaluate(identityInPage, origin),
        index === 0
          ? "正式发布运行只读专项 React BFF 会话未通过验证"
          : "正式发布运行只读专项 Vue BFF 会话未通过验证",
        100,
      );
      assert.deepEqual(principal, identity, "正式发布运行只读专项两端登录主体不一致");
      reportStage(name + "：导航就绪");
      await waitForState(
        () => browser.evaluate(publishedNavigationReadyInPage),
        "正式发布运行只读专项没有进入发布页面",
      );
      reportStage(name + "：只读门禁安装");
      await browser.evaluate(installPublishedReadGuardInPage, origin);
      reportStage(name + "：打开运行页面");
      await browser.evaluate(openPublishedRuntimeInPage);
      reportStage(name + "：运行页面就绪");
      await waitForState(
        () => browser.evaluate(publishedRuntimeUiStateInPage).then((x) => x?.status === "idle"),
        "正式发布运行只读专项没有进入发布页面",
      );
      reportStage(name + "：默认零请求");
      const before = await browser.evaluate(publishedReadGuardStateInPage);
      assert.deepEqual(before.paths, [], "未选择工程时不得预读取工程 API");
      reportStage(name + "：输入工程 ID");
      await browser.evaluate(enterPublishedProjectInPage, missingProject);
      reportStage(name + "：提交发布读取");
      await browser.evaluate(submitPublishedProjectInPage);
      reportStage(name + "：等待受控拒绝");
      const denied = await waitForState(
        () =>
          browser
            .evaluate(publishedRuntimeUiStateInPage)
            .then((x) => (x?.status === "denied" ? x : null)),
        "正式发布运行只读专项发布读取没有受控拒绝",
      );
      reportStage(name + "：核对只读断言");
      assert.equal(denied.snapshot, false, "无授权时不应出现发布快照");
      assert.equal(denied.quality, true, "未接入现场数据应标记为不可用");
      const guard = await browser.evaluate(publishedReadGuardStateInPage);
      assert.equal(guard.blocked, 0, "正式发布运行只读专项检测到非只读工程请求");
      assert.deepEqual(
        guard.paths,
        ["/api/v1/projects/" + missingProject + "/releases/current"],
        "真实页面只能向目标发布指针发起一个 GET",
      );
      assert.deepEqual(guard.statuses, [404], "真实服务端必须返回不可区分的 404 拒绝");
      process.stdout.write(
        name + "：真实会话、发布入口、默认零请求、无授权拒绝与零工程写入通过。\n",
      );
    }
    process.stdout.write(
      "真实双 HTTPS Origin 已发布运行 D5a 只读拒绝专项通过；未创建发布指针、工程、ACL 或工业设备操作。\n",
    );
  } catch (error) {
    const failure = new Error("正式发布运行只读专项阶段失败");
    failure.stage = stage;
    failure.pageDiagnostic = error?.pageDiagnostic;
    failure.failureKind =
      error instanceof assert.AssertionError
        ? "assertion"
        : error instanceof ReferenceError
          ? "reference"
          : "unknown";
    throw failure;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describePublishedReadonlyFailure(error) + "\n");
    process.exitCode = 1;
  });
}
