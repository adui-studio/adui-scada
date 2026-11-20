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
  "正式发布运行只读专项两端登录主体不一致",
  "正式发布运行只读专项没有进入发布页面",
  "正式发布运行只读专项发布读取没有受控拒绝",
  "正式发布运行只读专项检测到非只读工程请求",
]);

export function requirePublishedReadonlyMode(args) {
  if (!Array.isArray(args) || args.length !== 0) {
    throw new Error("正式发布运行只读专项只接受无参数模式");
  }
  return true;
}

export function describePublishedReadonlyFailure(error) {
  if (error instanceof Error && FAILURES.has(error.message)) return error.message;
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
    blocked: 0,
  };
  runtime.__aduiPublishedReadGuard = state;
  runtime.fetch = (input, init) => {
    const raw =
      typeof input === "string"
        ? input
        : typeof input?.url === "string"
          ? input.url
          : null;
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
    return original(input, init);
  };
  return true;
}

/** 仅返回安全分类和请求路径，不读取 Cookie、快照或原始响应正文。 */
export function publishedReadGuardStateInPage(runtime = globalThis) {
  const state = runtime.__aduiPublishedReadGuard;
  if (!state) return null;
  return { paths: state.paths.slice(), blocked: state.blocked };
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
  const setter = Object.getOwnPropertyDescriptor(
    runtime.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("正式发布运行页面输入接口不可用");
  setter.call(input, projectId);
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
  const quality = [...panel.querySelectorAll("dd")].some(
    (item) => item.textContent?.includes("UNAVAILABLE"),
  );
  return { status, snapshot, quality };
}

async function waitForState(fn, failure, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const value = await browser.evaluate(fn);
      if (value) return value;
    } catch {
      // 页面懒加载或跳转期间只读等待，不展示敏感异常正文。
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
  try {
    const identity = await waitForLogin(browser, origins[0], "正式发布运行只读专项");
    if (!identity) throw new Error("正式发布运行只读专项真实登录失败");
    const missingProject = "d5a-missing-" + crypto.randomUUID();
    for (const [index, origin] of origins.entries()) {
      const name = index === 0 ? "React" : "Vue";
      await browser.send("Page.navigate", { url: origin + "/" });
      const principal = await waitForState(
        () => browser.evaluate(identityInPage, origin),
        "正式发布运行只读专项真实登录失败",
        100,
      );
      assert.deepEqual(principal, identity, "正式发布运行只读专项两端登录主体不一致");
      await browser.evaluate(installPublishedReadGuardInPage, origin);
      await browser.evaluate(openPublishedRuntimeInPage);
      await waitForState(
        () => browser.evaluate(publishedRuntimeUiStateInPage).then((x) => x?.status === "idle"),
        "正式发布运行只读专项没有进入发布页面",
      );
      const before = await browser.evaluate(publishedReadGuardStateInPage);
      assert.deepEqual(before.paths, [], "未选择工程时不得预读取工程 API");
      await browser.evaluate(enterPublishedProjectInPage, missingProject);
      await browser.evaluate(submitPublishedProjectInPage);
      const denied = await waitForState(
        () => browser.evaluate(publishedRuntimeUiStateInPage).then((x) =>
          x?.status === "denied" ? x : null,
        ),
        "正式发布运行只读专项发布读取没有受控拒绝",
      );
      assert.equal(denied.snapshot, false, "无授权时不应出现发布快照");
      assert.equal(denied.quality, true, "未接入现场数据应标记为不可用");
      const guard = await browser.evaluate(publishedReadGuardStateInPage);
      assert.equal(guard.blocked, 0, "正式发布运行只读专项检测到非只读工程请求");
      assert.deepEqual(guard.paths, [
        "/api/v1/projects/" + missingProject + "/releases/current",
      ], "真实页面只能向目标发布指针发起一个 GET");
      process.stdout.write(name + "：真实会话、发布入口、默认零请求、无授权拒绝与零工程写入通过。\n");
    }
    process.stdout.write(
      "真实双 HTTPS Origin 已发布运行 D5a 只读拒绝专项通过；未创建发布指针、工程、ACL 或工业设备操作。\n",
    );
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
