import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  executablePath,
  identityInPage,
  startBrowser,
  waitForLogin,
} from "./test-oidc-dual-cas.mjs";
import { resolveProjectBrowserLab } from "./test-project-browser-oidc.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SAFE_FAILURES = new Set([
  "真实发布预检专项只允许无参数只读模式",
  "真实发布预检专项只允许本机可信 OIDC Lab",
  "真实发布预检专项缺少本机 Chrome/Edge",
  "真实发布预检专项 HTTPS Web 服务不可用",
  "真实发布预检专项 React 会话未通过验证",
  "真实发布预检专项 Vue 会话未通过验证",
  "真实发布预检专项双框架摘要不一致",
]);

/** 本专项没有任何写入模式，不允许后续参数扩大访问边界。 */
export function requireReadonlyReleasePreflightMode(args) {
  if (!Array.isArray(args) || args.length !== 0) {
    throw new Error("真实发布预检专项只允许无参数只读模式");
  }
  return true;
}

export function describeReleasePreflightFailure(error) {
  if (error instanceof Error && SAFE_FAILURES.has(error.message)) return error.message;
  if (error?.pageDiagnostic === "页面脚本断言异常") {
    return "真实发布预检专项浏览器只读契约不符合预期";
  }
  return "真实发布预检专项未通过，内部诊断已脱敏";
}

/**
 * 由 CDP function.toString() 独立运行于真实 HTTPS 页面。
 * 只以浏览器现有 BFF Cookie 发 GET，绝不读取 Cookie、CSRF 或工程文档正文。
 * 不依赖 Node 模块作用域变量，返回给 Node 的仅是脱敏版本摘要。
 */
export async function readReleasePreflightInPage(expectedOrigin, runtime = globalThis) {
  if (runtime.location.origin !== expectedOrigin) {
    throw new Error("发布预检请求不是当前可信 Origin");
  }

  const request = async (path) => {
    let response;
    try {
      response = await runtime.fetch(path, {
        method: "GET",
        mode: "same-origin",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new Error("发布预检只读 HTTP 请求失败");
    }
    if (
      response.redirected ||
      (response.url && new URL(response.url).origin !== expectedOrigin)
    ) {
      throw new Error("发布预检只读 HTTP 发生非预期重定向");
    }
    return response;
  };

  const json = async (response) => {
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers?.get("content-type") ?? "")) {
      throw new Error("发布预检接口没有返回 JSON");
    }
    try {
      return await response.json();
    } catch {
      throw new Error("发布预检接口返回无效 JSON");
    }
  };

  const list = await request("/api/v1/projects?limit=100");
  if (list.status !== 200) throw new Error("发布预检授权工程列表不可读取");
  const projects = await json(list);
  if (!Array.isArray(projects) || projects.length === 0 || projects.length > 100) {
    throw new Error("发布预检没有可检查的授权工程");
  }

  for (const project of projects) {
    const projectId = project?.projectId;
    const revision = project?.headRevision;
    if (
      typeof projectId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(projectId) ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    ) {
      throw new Error("发布预检工程列表水位不合法");
    }

    const base = "/api/v1/projects/" + encodeURIComponent(projectId);
    const versionResponse = await request(base + "/versions?limit=1");
    if (versionResponse.status === 404) continue;
    if (versionResponse.status !== 200) {
      throw new Error("发布预检历史版本摘要不可读取");
    }
    const versions = await json(versionResponse);
    const version = Array.isArray(versions) && versions.length === 1 ? versions[0] : null;
    if (
      version?.projectId !== projectId ||
      version.revision !== revision ||
      typeof version.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(version.contentHash)
    ) {
      throw new Error("发布预检历史版本与当前水位不一致");
    }

    const preflight = await request(base + "/versions/" + revision + "/release-preflight");
    if (preflight.status !== 200) throw new Error("发布预检当前版本 HTTP 状态不正确");
    if (!preflight.headers?.get("cache-control")?.includes("no-store")) {
      throw new Error("发布预检结果未禁止 HTTP 缓存");
    }
    const report = await json(preflight);
    if (
      !report ||
      typeof report !== "object" ||
      Array.isArray(report) ||
      Object.keys(report).sort().join(",") !==
        "contentHash,headRevision,issues,passed,projectId,revision" ||
      report.projectId !== projectId ||
      report.revision !== revision ||
      report.headRevision !== revision ||
      report.contentHash !== version.contentHash ||
      typeof report.passed !== "boolean" ||
      !Array.isArray(report.issues) ||
      report.issues.length > 10000 ||
      (report.passed ? report.issues.length !== 0 : report.issues.length === 0) ||
      !report.issues.every(
        (issue) =>
          issue &&
          typeof issue === "object" &&
          !Array.isArray(issue) &&
          Object.keys(issue).sort().join(",") === "code,message,path,severity" &&
          typeof issue.code === "string" &&
          /^[A-Z_]+$/.test(issue.code) &&
          issue.severity === "error" &&
          typeof issue.path === "string" &&
          issue.path.length > 0 &&
          issue.path.length <= 512 &&
          typeof issue.message === "string" &&
          issue.message.length > 0 &&
          issue.message.length <= 512,
      )
    ) {
      throw new Error("发布预检报告与已保存版本不一致");
    }

    const invalid = await request(base + "/versions/0/release-preflight");
    if (invalid.status !== 400) throw new Error("发布预检非法修订号未受控拒绝");

    const staleRevision = revision === Number.MAX_SAFE_INTEGER ? revision - 1 : revision + 1;
    const stale = await request(
      base + "/versions/" + staleRevision + "/release-preflight",
    );
    if (stale.status !== 409) throw new Error("发布预检过期水位未受控拒绝");

    const detail = await request(base);
    if (detail.status !== 200) throw new Error("发布预检后工程摘要不可读取");
    const current = await json(detail);
    if (current?.projectId !== projectId || current.headRevision !== revision) {
      throw new Error("发布预检前后工程水位发生变化");
    }

    return {
      projectId,
      revision,
      contentHash: version.contentHash,
      passed: report.passed,
      issueCount: report.issues.length,
    };
  }
  throw new Error("发布预检没有同时拥有版本读取权限的工程");
}

async function waitForIdentity(session, origin) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const identity = await session.evaluate(identityInPage, origin);
      if (identity) return identity;
    } catch {
      // 页面切换执行上下文时继续等待同源 BFF 确认。
    }
    await pause(150);
  }
  return null;
}

async function run() {
  requireReadonlyReleasePreflightMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) {
    throw new Error("真实发布预检专项只允许本机可信 OIDC Lab");
  }
  loadEnvFile(ROOT_ENV);
  const origins = resolveProjectBrowserLab(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("真实发布预检专项缺少本机 Chrome/Edge");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (response.status !== 200 || response.url !== origin + "/") {
      throw new Error("真实发布预检专项 HTTPS Web 服务不可用");
    }
  }

  const browser = await startBrowser(executable);
  try {
    const principal = await waitForLogin(browser, origins[0], "发布预检");
    let baseline;
    for (const [index, origin] of origins.entries()) {
      const name = index === 0 ? "React" : "Vue";
      await browser.send("Page.navigate", { url: origin + "/" });
      const current = await waitForIdentity(browser, origin);
      if (!current) {
        throw new Error(
          index === 0
            ? "真实发布预检专项 React 会话未通过验证"
            : "真实发布预检专项 Vue 会话未通过验证",
        );
      }
      assert.deepEqual(current, principal, "两个 HTTPS Origin 必须是同一可信主体");
      process.stdout.write(name + "：正在只读验证工程版本与服务端发布预检报告。\n");
      const result = await browser.evaluate(readReleasePreflightInPage, origin);
      if (baseline) {
        if (
          result.projectId !== baseline.projectId ||
          result.revision !== baseline.revision ||
          result.contentHash !== baseline.contentHash ||
          result.passed !== baseline.passed ||
          result.issueCount !== baseline.issueCount
        ) {
          throw new Error("真实发布预检专项双框架摘要不一致");
        }
      } else {
        baseline = result;
      }
      process.stdout.write(name + "：版本、内容摘要、400/409 拒绝与无缓存报告通过。\n");
    }
    process.stdout.write(
      "真实 Keycloak 双 HTTPS Origin 服务端发布只读预检通过；未创建或修改工程、ACL、发布记录及工业设备。\n",
    );
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeReleasePreflightFailure(error) + "\n");
    process.exitCode = 1;
  });
}
