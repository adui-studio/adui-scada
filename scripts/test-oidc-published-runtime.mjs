import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolveProjectBrowserLab } from "./test-project-browser-oidc.mjs";
import {
  executablePath,
  identityInPage,
  startBrowser,
  waitForLogin,
} from "./test-oidc-dual-cas.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_RELEASE_RESPONSE_BYTES = 2 * 1024 * 1024 + 4096;
const SAFE_FAILURES = new Set([
  "正式发布 OIDC 浏览器专项只允许无参数只读模式",
  "正式发布 OIDC 浏览器专项只允许本机可信 HTTPS Lab",
  "正式发布 OIDC 浏览器专项缺少 Chrome/Edge",
  "正式发布 OIDC 浏览器专项缺少预授权工程配置",
  "正式发布 OIDC 浏览器专项工程 ID 配置无效",
  "正式发布 OIDC 浏览器专项两个权限验证工程必须不同",
  "正式发布 OIDC 浏览器专项 React 会话未通过验证",
  "正式发布 OIDC 浏览器专项 Vue 会话未通过验证",
  "正式发布 OIDC 浏览器专项两个 HTTPS Origin 主体不一致",
  "正式发布 OIDC 浏览器专项两个 Origin 发布指针不一致",
  "正式发布 OIDC 浏览器专项匿名请求未返回 401",
  "正式发布 OIDC 浏览器专项 release:read 工程读取失败",
  "正式发布 OIDC 浏览器专项 release:read 不应授予 project:read",
  "正式发布 OIDC 浏览器专项 release:read 不应授予 version:read",
  "正式发布 OIDC 浏览器专项 project:read 不应继承 release:read",
  "正式发布 OIDC 浏览器专项发布读取响应未禁止缓存",
  "正式发布 OIDC 浏览器专项发布读取响应格式无效",
  "正式发布 OIDC 浏览器专项发布指针与快照元数据不一致",
  "正式发布 OIDC 浏览器专项页面入口不可用",
  "正式发布 OIDC 浏览器专项页面状态未达到预期",
  "正式发布 OIDC 浏览器专项实时 Tag 质量标记不正确",
  "正式发布 OIDC 浏览器专项发布预览显示状态不正确",
  "正式发布 OIDC 浏览器专项页面发出了非只读工程请求",
  "正式发布 OIDC 浏览器专项页面读取请求缺少 no-store",
  "正式发布 OIDC 浏览器专项页面读取请求携带了写入凭据",
  "正式发布 OIDC 浏览器专项页面请求审计不完整",
]);

/** 真实浏览器专项只接受无参数只读模式，不提供创建工程或修改 ACL 的选项。 */
export function requirePublishedRuntimeReadonlyMode(args) {
  if (!Array.isArray(args) || args.length !== 0) {
    throw new Error("正式发布 OIDC 浏览器专项只允许无参数只读模式");
  }
  return true;
}

/** 只接受维护者在当前 PowerShell 会话中临时提供的两个已有工程 ID。 */
export function resolvePublishedRuntimeBrowserTarget(env) {
  const origins = resolveProjectBrowserLab(env);
  const allowedProjectId = env.SCADA_OIDC_RELEASE_READ_PROJECT_ID;
  const deniedProjectId = env.SCADA_OIDC_RELEASE_DENIED_PROJECT_ID;
  if (
    typeof allowedProjectId !== "string" ||
    !PROJECT_ID_PATTERN.test(allowedProjectId) ||
    typeof deniedProjectId !== "string" ||
    !PROJECT_ID_PATTERN.test(deniedProjectId)
  ) {
    throw new Error("正式发布 OIDC 浏览器专项缺少预授权工程配置");
  }
  if (allowedProjectId === deniedProjectId) {
    throw new Error("正式发布 OIDC 浏览器专项两个权限验证工程必须不同");
  }
  return { origins, allowedProjectId, deniedProjectId };
}

/**
 * 自包含 CDP 页面函数：验证匿名 401、release:read 独立授权与当前发布响应。
 * 页面仅返回脱敏的发布代次/修订/摘要供两个 Origin 比对，不把快照正文交给 Node。
 */
export async function readPublishedRuntimeInPage(
  expectedOrigin,
  allowedProjectId,
  deniedProjectId,
  runtime = globalThis,
) {
  const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
  if (runtime.location.origin !== expectedOrigin) {
    throw new Error("正式发布 OIDC 浏览器专项请求不是当前可信 Origin");
  }
  if (
    typeof allowedProjectId !== "string" ||
    !identifier.test(allowedProjectId) ||
    typeof deniedProjectId !== "string" ||
    !identifier.test(deniedProjectId) ||
    allowedProjectId === deniedProjectId
  ) {
    throw new Error("正式发布 OIDC 浏览器专项工程 ID 配置无效");
  }

  const request = async (path, credentials = "same-origin") => {
    let response;
    try {
      response = await runtime.fetch(path, {
        method: "GET",
        mode: "same-origin",
        credentials,
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new Error("正式发布 OIDC 浏览器专项发布读取请求失败");
    }
    if (
      response.redirected ||
      (response.url && response.url !== expectedOrigin + path)
    ) {
      throw new Error("正式发布 OIDC 浏览器专项发布读取发生重定向");
    }
    if (response.status === 200) {
      const cacheControl = response.headers?.get("cache-control") ?? "";
      if (!cacheControl.split(",").some((item) => item.trim().toLowerCase() === "no-store")) {
        throw new Error("正式发布 OIDC 浏览器专项发布读取响应未禁止缓存");
      }
    }
    return response;
  };

  const allowedBase = "/api/v1/projects/" + encodeURIComponent(allowedProjectId);
  const allowedReleasePath = allowedBase + "/releases/current";
  const deniedBase = "/api/v1/projects/" + encodeURIComponent(deniedProjectId);
  const deniedReleasePath = deniedBase + "/releases/current";

  const anonymous = await request(allowedReleasePath, "omit");
  if (anonymous.status !== 401) {
    throw new Error("正式发布 OIDC 浏览器专项匿名请求未返回 401");
  }

  const allowed = await request(allowedReleasePath);
  if (allowed.status !== 200) {
    throw new Error("正式发布 OIDC 浏览器专项 release:read 工程读取失败");
  }
  if (!/^application\/json(?:\s*;|$)/i.test(allowed.headers?.get("content-type") ?? "")) {
    throw new Error("正式发布 OIDC 浏览器专项发布读取响应格式无效");
  }
  const contentLength = Number(allowed.headers?.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 0 && contentLength > MAX_RELEASE_RESPONSE_BYTES) {
    throw new Error("正式发布 OIDC 浏览器专项发布读取响应超出容量限制");
  }

  let bodyText;
  try {
    bodyText = await allowed.text();
  } catch {
    throw new Error("正式发布 OIDC 浏览器专项发布读取响应格式无效");
  }
  if (new runtime.TextEncoder().encode(bodyText).byteLength > MAX_RELEASE_RESPONSE_BYTES) {
    throw new Error("正式发布 OIDC 浏览器专项发布读取响应超出容量限制");
  }
  let release;
  try {
    release = JSON.parse(bodyText);
  } catch {
    throw new Error("正式发布 OIDC 浏览器专项发布读取响应格式无效");
  }
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    throw new Error("正式发布 OIDC 浏览器专项发布读取响应格式无效");
  }

  let summary;
  if (release.status === "UNRELEASED") {
    const keys = Object.keys(release).sort().join(",");
    if (
      keys !== "projectId,releaseGeneration,status" ||
      release.projectId !== allowedProjectId ||
      release.releaseGeneration !== 0
    ) {
      throw new Error("正式发布 OIDC 浏览器专项发布指针与快照元数据不一致");
    }
    summary = {
      status: "UNRELEASED",
      releaseGeneration: 0,
      releasedRevision: null,
      releasedContentHash: null,
      eventId: null,
      lastAction: null,
      releasedAt: null,
    };
  } else if (release.status === "RELEASED") {
    const keys = Object.keys(release).sort().join(",");
    if (
      keys !== "eventId,lastAction,projectId,releaseGeneration,releasedAt,releasedContentHash,releasedRevision,snapshot,status" ||
      release.projectId !== allowedProjectId ||
      !Number.isSafeInteger(release.releasedRevision) ||
      release.releasedRevision < 1 ||
      !Number.isSafeInteger(release.releaseGeneration) ||
      release.releaseGeneration < 1 ||
      typeof release.releasedContentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(release.releasedContentHash) ||
      typeof release.eventId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(release.eventId) ||
      (release.lastAction !== "PUBLISH" && release.lastAction !== "ROLLBACK") ||
      typeof release.releasedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(release.releasedAt) ||
      !Number.isFinite(Date.parse(release.releasedAt)) ||
      new Date(release.releasedAt).toISOString() !== release.releasedAt
    ) {
      throw new Error("正式发布 OIDC 浏览器专项发布指针与快照元数据不一致");
    }
    const snapshot = release.snapshot;
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot) ||
      snapshot.formatVersion !== 1 ||
      snapshot.projectId !== allowedProjectId ||
      snapshot.revision !== release.releasedRevision ||
      snapshot.hashAlgorithm !== "SHA-256" ||
      snapshot.contentHash !== release.releasedContentHash ||
      typeof snapshot.createdAt !== "string" ||
      !snapshot.document ||
      typeof snapshot.document !== "object" ||
      snapshot.document.projectId !== allowedProjectId ||
      snapshot.document.schemaVersion !== "0.3.0" ||
      !Array.isArray(snapshot.document.pages) ||
      snapshot.document.pages.length === 0 ||
      !Array.isArray(snapshot.document.tags)
    ) {
      throw new Error("正式发布 OIDC 浏览器专项发布指针与快照元数据不一致");
    }
    summary = {
      status: "RELEASED",
      releaseGeneration: release.releaseGeneration,
      releasedRevision: release.releasedRevision,
      releasedContentHash: release.releasedContentHash,
      eventId: release.eventId,
      lastAction: release.lastAction,
      releasedAt: release.releasedAt,
    };
  } else {
    throw new Error("正式发布 OIDC 浏览器专项发布读取响应格式无效");
  }

  // release:read 单独授权即可读取发布指针，但不能获得工程详情或历史版本读取能力。
  const allowedProject = await request(allowedBase);
  if (allowedProject.status !== 404) {
    throw new Error("正式发布 OIDC 浏览器专项 release:read 不应授予 project:read");
  }
  const allowedVersions = await request(allowedBase + "/versions?limit=1");
  if (allowedVersions.status !== 404) {
    throw new Error("正式发布 OIDC 浏览器专项 release:read 不应授予 version:read");
  }

  // 对照工程必须已存在且当前主体拥有 project:read，但没有 release:read。
  const deniedProject = await request(deniedBase);
  if (deniedProject.status !== 200) {
    throw new Error("正式发布 OIDC 浏览器专项 project:read 对照工程不可读取");
  }
  const deniedRelease = await request(deniedReleasePath);
  if (deniedRelease.status !== 404) {
    throw new Error("正式发布 OIDC 浏览器专项 project:read 不应继承 release:read");
  }

  return summary;
}

/**
 * 自包含 CDP 页面函数：使用真实导航按钮与表单接线验证 React/Vue 页面。
 * 仅临时包装当前隔离页面的 Fetch，审计工程 API 必须全部为同源 GET。
 */
export async function openPublishedRuntimeUiInPage(
  expectedOrigin,
  allowedProjectId,
  deniedProjectId,
  allowedStatus,
  runtime = globalThis,
) {
  const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
  if (
    runtime.location.origin !== expectedOrigin ||
    typeof allowedProjectId !== "string" ||
    !identifier.test(allowedProjectId) ||
    typeof deniedProjectId !== "string" ||
    !identifier.test(deniedProjectId) ||
    allowedProjectId === deniedProjectId ||
    (allowedStatus !== "UNRELEASED" && allowedStatus !== "RELEASED")
  ) {
    throw new Error("正式发布 OIDC 浏览器专项页面工程配置无效");
  }

  const originalFetch = runtime.fetch;
  const calls = [];
  const expectedPaths = new Set([
    "/api/v1/projects/" + encodeURIComponent(allowedProjectId) + "/releases/current",
    "/api/v1/projects/" + encodeURIComponent(deniedProjectId) + "/releases/current",
  ]);
  const auditedFetch = async function (input, init = {}) {
    let inputUrl;
    if (typeof input === "string") {
      inputUrl = input;
    } else if (input && typeof input.url === "string") {
      inputUrl = input.url;
    } else {
      throw new TypeError("正式发布 OIDC 浏览器专项页面请求地址无效");
    }
    const url = new runtime.URL(inputUrl, runtime.location.href);
    if (url.origin === expectedOrigin && url.pathname.startsWith("/api/v1/projects/")) {
      const method = (init.method ?? (input && input.method) ?? "GET").toUpperCase();
      const headers = new runtime.Headers(init.headers ?? (input && input.headers));
      const hasBody = Object.prototype.hasOwnProperty.call(init, "body") && init.body !== undefined;
      if (method !== "GET" || hasBody || headers.has("authorization") || headers.has("x-scada-csrf")) {
        throw new Error("正式发布 OIDC 浏览器专项页面发出了非只读工程请求");
      }
      if (!expectedPaths.has(url.pathname)) {
        throw new Error("正式发布 OIDC 浏览器专项页面工程请求路径超出白名单");
      }
      calls.push({
        method,
        path: url.pathname,
        cache: init.cache ?? "default",
        credentials: init.credentials ?? "same-origin",
        redirect: init.redirect ?? "follow",
        referrerPolicy: init.referrerPolicy ?? "strict-origin-when-cross-origin",
        hasBody,
        hasAuthorization: headers.has("authorization"),
        hasCsrf: headers.has("x-scada-csrf"),
      });
    }
    return originalFetch.call(runtime, input, init);
  };

  runtime.fetch = auditedFetch;
  try {
    const nav = runtime.document.querySelector('nav[aria-label="功能导航"]');
    if (!nav) throw new Error("正式发布 OIDC 浏览器专项页面入口不可用");
    let page = runtime.document.querySelector('[data-testid="published-runtime-page"]');
    if (!page) {
      const button = Array.from(nav.querySelectorAll("button")).find(
        (item) => item.textContent?.trim() === "已发布运行",
      );
      if (!button) throw new Error("正式发布 OIDC 浏览器专项页面入口不可用");
      button.click();
    }

    const waitForPage = async () => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        page = runtime.document.querySelector('[data-testid="published-runtime-page"]');
        if (page) return page;
        await new Promise((resolve) => runtime.setTimeout(resolve, 100));
      }
      throw new Error("正式发布 OIDC 浏览器专项页面入口不可用");
    };
    page = await waitForPage();
    // React useEffect 与 Vue setup 均需先完成共享 API Client 和刷新器初始化。
    await new Promise((resolve) => runtime.setTimeout(resolve, 50));

    const submitProject = async (projectId, expectedState) => {
      const input = page.querySelector(
        "#published-react-project-id, #published-vue-project-id",
      );
      const setter = Object.getOwnPropertyDescriptor(runtime.HTMLInputElement.prototype, "value")?.set;
      if (!input || typeof setter !== "function") {
        throw new Error("正式发布 OIDC 浏览器专项页面入口不可用");
      }
      setter.call(input, projectId);
      input.dispatchEvent(new runtime.Event("input", { bubbles: true }));
      input.dispatchEvent(new runtime.Event("change", { bubbles: true }));
      const submit = Array.from(page.querySelectorAll("button")).find(
        (item) => item.textContent?.trim() === "读取正式发布",
      );
      if (!submit) throw new Error("正式发布 OIDC 浏览器专项页面入口不可用");
      submit.click();

      for (let attempt = 0; attempt < 200; attempt += 1) {
        const status = page.querySelector(".scada-status")?.getAttribute("data-status");
        if (status === expectedState) break;
        if (status === "error") throw new Error("正式发布 OIDC 浏览器专项页面状态未达到预期");
        await new Promise((resolve) => runtime.setTimeout(resolve, 100));
      }
      const status = page.querySelector(".scada-status")?.getAttribute("data-status");
      if (status !== expectedState) {
        throw new Error("正式发布 OIDC 浏览器专项页面状态未达到预期");
      }

      const terms = Array.from(page.querySelectorAll(".scada-diagnostics-grid dt"));
      const projectTerm = terms.find((item) => item.textContent?.trim() === "工程");
      const qualityTerm = terms.find((item) => item.textContent?.trim() === "实时 Tag 质量");
      if (
        projectTerm?.nextElementSibling?.textContent?.trim() !== projectId ||
        !qualityTerm?.nextElementSibling?.textContent?.includes("UNAVAILABLE")
      ) {
        throw new Error("正式发布 OIDC 浏览器专项实时 Tag 质量标记不正确");
      }
      const preview = page.querySelector('[data-testid="published-runtime-svg"]');
      if (expectedState === "verified") {
        if (!preview || !preview.getAttribute("src")?.startsWith("data:image/svg+xml")) {
          throw new Error("正式发布 OIDC 浏览器专项发布预览显示状态不正确");
        }
      } else if (preview) {
        throw new Error("正式发布 OIDC 浏览器专项发布预览显示状态不正确");
      }
      return { status, previewVisible: Boolean(preview) };
    };

    const allowedState = allowedStatus === "RELEASED" ? "verified" : "unreleased";
    const firstAllowed = await submitProject(allowedProjectId, allowedState);
    const denied = await submitProject(deniedProjectId, "denied");
    const recovered = await submitProject(allowedProjectId, allowedState);
    const stop = Array.from(page.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === "停止读取",
    );
    if (stop) stop.click();

    const allGet = calls.every((call) => call.method === "GET");
    const allNoStore = calls.every((call) => call.cache === "no-store");
    const allSameOrigin = calls.every((call) => call.credentials === "same-origin");
    const allNoRedirect = calls.every((call) => call.redirect === "error");
    const allNoBody = calls.every((call) => !call.hasBody);
    const noWriteCredentials = calls.every(
      (call) => !call.hasAuthorization && !call.hasCsrf,
    );
    if (
      calls.length < 3 ||
      !allGet ||
      !allNoStore ||
      !allSameOrigin ||
      !allNoRedirect ||
      !allNoBody ||
      !noWriteCredentials ||
      calls.some((call) => !expectedPaths.has(call.path))
    ) {
      throw new Error("正式发布 OIDC 浏览器专项页面请求审计不完整");
    }
    return {
      allowedState: firstAllowed.status,
      deniedState: denied.status,
      recoveredState: recovered.status,
      allowedPreviewVisible: firstAllowed.previewVisible,
      deniedPreviewVisible: denied.previewVisible,
      recoveredPreviewVisible: recovered.previewVisible,
      tagQualityUnavailable: true,
      auditCount: calls.length,
      auditReadOnly: allGet && allNoStore && allSameOrigin && allNoRedirect && allNoBody && noWriteCredentials,
    };
  } finally {
    runtime.fetch = originalFetch;
  }
}

export function describePublishedRuntimeBrowserFailure(error) {
  const message = error instanceof Error ? error.message : "";
  if (SAFE_FAILURES.has(message)) return message;
  if (error?.pageDiagnostic === "页面脚本异常（已脱敏）") {
    return "正式发布 OIDC 浏览器专项页面脚本异常（已脱敏）";
  }
  const code = error && typeof error === "object" ? error.code : undefined;
  if (code === "ECONNREFUSED") return "本机 HTTPS Web、Keycloak 或浏览器调试服务未监听";
  if (code === "CERT_HAS_EXPIRED" || code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return "本机 HTTPS 证书有效期或域名校验失败";
  }
  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "SELF_SIGNED_CERT_IN_CHAIN") {
    return "本机 HTTPS 根证书未被信任，未关闭 TLS 校验";
  }
  return "正式发布 OIDC 双框架只读专项未通过，内部诊断已脱敏";
}

async function waitForIdentity(session, origin, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const principal = await session.evaluate(identityInPage, origin);
      if (principal) return principal;
    } catch {
      // OIDC 导航或跨 Origin 切换期间页面执行上下文可能短暂销毁。
    }
    await pause(200);
  }
  throw new Error(
    label === "React"
      ? "正式发布 OIDC 浏览器专项 React 会话未通过验证"
      : "正式发布 OIDC 浏览器专项 Vue 会话未通过验证",
  );
}

async function run() {
  requirePublishedRuntimeReadonlyMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) {
    throw new Error("正式发布 OIDC 浏览器专项只允许本机可信 HTTPS Lab");
  }
  // 工程 ID 只允许来自启动 Node 前的当前 PowerShell 进程环境，不从根 .env 读取。
  const allowedProjectId = process.env.SCADA_OIDC_RELEASE_READ_PROJECT_ID;
  const deniedProjectId = process.env.SCADA_OIDC_RELEASE_DENIED_PROJECT_ID;
  loadEnvFile(ROOT_ENV);
  const target = resolvePublishedRuntimeBrowserTarget({
    ...process.env,
    SCADA_OIDC_RELEASE_READ_PROJECT_ID: allowedProjectId,
    SCADA_OIDC_RELEASE_DENIED_PROJECT_ID: deniedProjectId,
  });
  const executable = executablePath();
  if (!executable) throw new Error("正式发布 OIDC 浏览器专项缺少 Chrome/Edge");

  const browser = await startBrowser(executable);
  try {
    const firstPrincipal = await waitForLogin(
      browser,
      target.origins[0],
      "正式发布只读验收",
    );
    let baseline;
    for (const [index, origin] of target.origins.entries()) {
      const framework = index === 0 ? "React" : "Vue";
      await browser.send("Page.navigate", { url: origin + "/" });
      const principal = await waitForIdentity(browser, origin, framework);
      if (
        principal?.tenantId !== firstPrincipal?.tenantId ||
        principal?.subjectId !== firstPrincipal?.subjectId
      ) {
        throw new Error("正式发布 OIDC 浏览器专项两个 HTTPS Origin 主体不一致");
      }
      process.stdout.write(framework + "：正在验证匿名拒绝与独立 release:read 权限。\n");
      let server;
      try {
        server = await browser.evaluate(
          readPublishedRuntimeInPage,
          origin,
          target.allowedProjectId,
          target.deniedProjectId,
        );
      } catch (error) {
        if (error?.pageDiagnostic) {
          throw new Error("正式发布 OIDC 浏览器专项服务端只读权限核验失败");
        }
        throw error;
      }
      process.stdout.write(framework + "：正在验证真实页面、刷新 API 与只读请求审计。\n");
      let ui;
      try {
        ui = await browser.evaluate(
          openPublishedRuntimeUiInPage,
          origin,
          target.allowedProjectId,
          target.deniedProjectId,
          server.status,
        );
      } catch (error) {
        if (error?.pageDiagnostic) {
          throw new Error("正式发布 OIDC 浏览器专项双框架页面接线失败");
        }
        throw error;
      }
      const expectedState = server.status === "RELEASED" ? "verified" : "unreleased";
      assert.equal(ui.allowedState, expectedState);
      assert.equal(ui.deniedState, "denied");
      assert.equal(ui.recoveredState, expectedState);
      assert.equal(ui.allowedPreviewVisible, server.status === "RELEASED");
      assert.equal(ui.deniedPreviewVisible, false);
      assert.equal(ui.recoveredPreviewVisible, server.status === "RELEASED");
      assert.equal(ui.tagQualityUnavailable, true);
      assert.equal(ui.auditReadOnly, true);
      assert.ok(ui.auditCount >= 3);

      if (
        baseline &&
        (server.status !== baseline.status ||
          server.releaseGeneration !== baseline.releaseGeneration ||
          server.releasedRevision !== baseline.releasedRevision ||
          server.releasedContentHash !== baseline.releasedContentHash ||
          server.eventId !== baseline.eventId ||
          server.lastAction !== baseline.lastAction ||
          server.releasedAt !== baseline.releasedAt)
      ) {
        throw new Error("正式发布 OIDC 浏览器专项两个 Origin 发布指针不一致");
      }
      if (!baseline) baseline = server;
      process.stdout.write(
        framework +
          "：发布状态 " +
          (server.status === "RELEASED" ? "已发布" : "未发布") +
          "、授权拒绝、恢复读取与只读请求审计通过。\n",
      );
    }
    process.stdout.write(
      "真实 Keycloak 双 HTTPS Origin 正式发布只读专项通过；未创建或修改工程、ACL、发布记录或工业设备，仅使用现有 OIDC 登录流程建立会话。\n",
    );
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describePublishedRuntimeBrowserFailure(error) + "\n");
    process.exitCode = 1;
  });
}
