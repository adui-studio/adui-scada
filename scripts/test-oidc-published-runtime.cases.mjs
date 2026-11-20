import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { describe, it } from "node:test";
import {
  describePublishedRuntimeBrowserFailure,
  openPublishedRuntimeUiInPage,
  readPublishedRuntimeInPage,
  requirePublishedRuntimeReadonlyMode,
  resolvePublishedRuntimeBrowserTarget,
} from "./test-oidc-published-runtime.mjs";

const origin = "https://127.0.0.1:15173";
const allowedProjectId = "release-read-only-project";
const deniedProjectId = "project-read-only-control";
const hash = "a".repeat(64);
const eventId = "4b8a31b8-4df1-4d19-a1ef-91b19a7d84b5";
const releasedAt = "2026-11-20T00:00:00.000Z";
const createdAt = "2026-11-19T00:00:00.000Z";

const lab = {
  NODE_ENV: "development",
  NODE_USE_SYSTEM_CA: "1",
  SCADA_OIDC_DEV_HTTPS_ENABLED: "true",
  SCADA_OIDC_ENABLED: "true",
  SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "false",
  SCADA_LOCAL_DEMO_API_ENABLED: "false",
  SCADA_WEB_HOST: "127.0.0.1",
  SCADA_SERVER_HOST: "127.0.0.1",
  SCADA_REACT_DEV_PORT: "15173",
  SCADA_VUE_DEV_PORT: "15174",
  SCADA_SERVER_PORT: "15172",
  SCADA_OIDC_WEB_ORIGINS: "https://127.0.0.1:15173,https://127.0.0.1:15174",
  SCADA_OIDC_REDIRECT_URI: "https://127.0.0.1:15173/api/v1/auth/oidc/callback",
  SCADA_LAB_KEYCLOAK_PORT: "18443",
  SCADA_OIDC_ISSUER: "https://127.0.0.1:18443/realms/adui-scada",
  SCADA_LAB_POSTGRES_PORT: "15432",
  SCADA_DATABASE_URL: "postgresql://127.0.0.1:15432/adui_scada",
  SCADA_OIDC_RELEASE_READ_PROJECT_ID: allowedProjectId,
  SCADA_OIDC_RELEASE_DENIED_PROJECT_ID: deniedProjectId,
};

function unreleased(projectId = allowedProjectId) {
  return { status: "UNRELEASED", projectId, releaseGeneration: 0 };
}

function released(projectId = allowedProjectId) {
  const snapshot = {
    formatVersion: 1,
    projectId,
    revision: 3,
    createdAt,
    hashAlgorithm: "SHA-256",
    contentHash: hash,
    document: {
      schemaVersion: "0.3.0",
      projectId,
      tags: [],
      pages: [{ id: "main", name: "主画面", size: { width: 1920, height: 1080 }, nodes: [] }],
    },
  };
  return {
    status: "RELEASED",
    projectId,
    releasedRevision: 3,
    releasedContentHash: hash,
    releaseGeneration: 2,
    eventId,
    lastAction: "PUBLISH",
    releasedAt,
    snapshot,
  };
}

function makeResponse(path, status, body, options = {}) {
  const headers = new Map([
    ["cache-control", options.cacheControl ?? "no-store"],
    ["content-type", options.contentType ?? "application/json; charset=utf-8"],
    ...(options.contentLength ? [["content-length", String(options.contentLength)]] : []),
  ]);
  return {
    status,
    ok: status >= 200 && status < 300,
    redirected: options.redirected ?? false,
    url: options.url ?? origin + path,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function fixture(options = {}) {
  const calls = [];
  const allowed = options.release ?? unreleased();
  const fetch = async (path, request) => {
    calls.push({ path, request });
    if (path === "/api/v1/projects/" + allowedProjectId + "/releases/current") {
      if (request.credentials === "omit") {
        return makeResponse(path, options.anonymousStatus ?? 401, { message: "未认证" }, { cacheControl: options.anonymousCache ?? "no-store" });
      }
      return makeResponse(path, options.allowedStatus ?? 200, allowed, {
        cacheControl: options.allowedCache ?? "no-store",
        contentLength: options.contentLength,
      });
    }
    if (path === "/api/v1/projects/" + allowedProjectId) {
      return makeResponse(path, options.allowedProjectStatus ?? 404, { message: "拒绝" }, { cacheControl: options.allowedProjectCache ?? "no-store" });
    }
    if (path === "/api/v1/projects/" + allowedProjectId + "/versions?limit=1") {
      return makeResponse(path, options.allowedVersionStatus ?? 404, { message: "拒绝" }, { cacheControl: options.allowedVersionCache ?? "no-store" });
    }
    if (path === "/api/v1/projects/" + deniedProjectId) {
      return makeResponse(path, options.deniedProjectStatus ?? 200, { projectId: deniedProjectId }, { cacheControl: options.deniedProjectCache ?? "no-store" });
    }
    if (path === "/api/v1/projects/" + deniedProjectId + "/releases/current") {
      return makeResponse(path, options.deniedReleaseStatus ?? 404, { message: "拒绝" }, { cacheControl: options.deniedReleaseCache ?? "no-store" });
    }
    throw new Error("测试夹具收到未登记的只读请求");
  };
  return {
    calls,
    runtime: {
      location: { origin, href: origin + "/" },
      fetch,
      TextEncoder,
      Headers,
      URL,
      Request,
      setTimeout,
      Event,
    },
  };
}

void describe("真实 Keycloak 双 HTTPS Origin 发布读取只读安全门禁", () => {
  void it("只接受无参数只读模式，不提供工程创建或 ACL 写入选项", () => {
    assert.equal(requirePublishedRuntimeReadonlyMode([]), true);
    for (const args of [
      ["--write"],
      ["--create-project"],
      ["--grant"],
      ["--confirm-lab", "adui_scada"],
      ["--run", "--confirm-lab", "adui_scada"],
    ]) {
      assert.throws(
        () => requirePublishedRuntimeReadonlyMode(args),
        /只允许无参数只读模式/,
      );
    }
  });

  void it("仅接受本机 HTTPS Keycloak Lab 与两个不同的预授权工程 ID", () => {
    assert.deepEqual(resolvePublishedRuntimeBrowserTarget(lab), {
      origins: ["https://127.0.0.1:15173", "https://127.0.0.1:15174"],
      allowedProjectId,
      deniedProjectId,
    });
    for (const invalid of [
      { ...lab, SCADA_OIDC_RELEASE_READ_PROJECT_ID: "../outside" },
      { ...lab, SCADA_OIDC_RELEASE_DENIED_PROJECT_ID: "" },
      { ...lab, SCADA_OIDC_RELEASE_DENIED_PROJECT_ID: allowedProjectId },
      { ...lab, SCADA_DATABASE_URL: "postgresql://db.example.com:15432/adui_scada" },
      { ...lab, SCADA_OIDC_ISSUER: "https://idp.example.com/realms/adui-scada" },
      { ...lab, SCADA_OIDC_DEV_HTTPS_ENABLED: "false" },
    ]) {
      assert.throws(() => resolvePublishedRuntimeBrowserTarget(invalid));
    }
  });

  void it("真实页面请求匿名 401、release:read 单独读取，并拒绝 project/version 权限继承", async () => {
    const { runtime, calls } = fixture();
    const result = await readPublishedRuntimeInPage(origin, allowedProjectId, deniedProjectId, runtime);
    assert.deepEqual(result, {
      status: "UNRELEASED",
      releaseGeneration: 0,
      releasedRevision: null,
      releasedContentHash: null,
      eventId: null,
      lastAction: null,
      releasedAt: null,
    });
    assert.equal(calls.length, 6);
    assert.ok(calls.every(({ request }) => request.method === "GET"));
    assert.ok(calls.every(({ request }) => request.mode === "same-origin"));
    assert.ok(calls.every(({ request }) => request.cache === "no-store"));
    assert.ok(calls.every(({ request }) => request.redirect === "error"));
    assert.ok(calls.every(({ request }) => request.referrerPolicy === "no-referrer"));
    assert.ok(calls.every(({ request }) => !("body" in request)));
    assert.ok(calls.every(({ request }) => !("Authorization" in request.headers)));
    assert.equal(calls[0].request.credentials, "omit");
    assert.equal(calls[1].request.credentials, "same-origin");
    assert.equal(calls[2].path, "/api/v1/projects/" + allowedProjectId);
    assert.equal(calls[3].path, "/api/v1/projects/" + allowedProjectId + "/versions?limit=1");
    assert.equal(calls[4].path, "/api/v1/projects/" + deniedProjectId);
    assert.equal(calls[5].path, "/api/v1/projects/" + deniedProjectId + "/releases/current");
  });

  void it("Guard 在 401/404 阶段提前拒绝时不依赖成功响应的 no-store 断言", async () => {
    const { runtime } = fixture({
      anonymousCache: "",
      allowedProjectCache: "",
      allowedVersionCache: "",
      deniedReleaseCache: "",
    });
    const result = await readPublishedRuntimeInPage(origin, allowedProjectId, deniedProjectId, runtime);
    assert.equal(result.status, "UNRELEASED");
  });

  void it("已发布响应校验快照指针和事件元数据，仅向 Node 返回脱敏摘要", async () => {
    const { runtime, calls } = fixture({ release: released() });
    const result = await readPublishedRuntimeInPage(origin, allowedProjectId, deniedProjectId, runtime);
    assert.deepEqual(result, {
      status: "RELEASED",
      releaseGeneration: 2,
      releasedRevision: 3,
      releasedContentHash: hash,
      eventId,
      lastAction: "PUBLISH",
      releasedAt,
    });
    assert.equal(calls.length, 6);
  });

  void it("匿名身份不是 401、release:read 被拒绝或无 no-store 时均失败", async () => {
    for (const options of [
      { anonymousStatus: 200 },
      { allowedStatus: 404 },
      { allowedCache: "private" },
      { allowedProjectStatus: 200 },
      { allowedVersionStatus: 200 },
      { deniedProjectStatus: 404 },
      { deniedReleaseStatus: 200 },
    ]) {
      const { runtime } = fixture(options);
      await assert.rejects(
        readPublishedRuntimeInPage(origin, allowedProjectId, deniedProjectId, runtime),
      );
    }
  });

  void it("发布快照字段额外扩展、摘要篡改、跨工程或超容量时拒绝", async () => {
    const tamperedHash = released();
    tamperedHash.releasedContentHash = "0".repeat(64);
    const extraField = { ...unreleased(), headRevision: 9 };
    const wrongProject = unreleased("another-project");
    for (const release of [tamperedHash, extraField, wrongProject]) {
      const { runtime } = fixture({ release });
      await assert.rejects(
        readPublishedRuntimeInPage(origin, allowedProjectId, deniedProjectId, runtime),
      );
    }
    const oversized = fixture({ release: released(), contentLength: 3 * 1024 * 1024 });
    await assert.rejects(
      readPublishedRuntimeInPage(origin, allowedProjectId, deniedProjectId, oversized.runtime),
      /超出容量限制/,
    );
  });

  void it("跨 Origin 与非法工程 ID 在发出请求前拒绝", async () => {
    const { runtime, calls } = fixture();
    await assert.rejects(
      readPublishedRuntimeInPage("https://untrusted.example.org", allowedProjectId, deniedProjectId, runtime),
      /不是当前可信 Origin/,
    );
    await assert.rejects(
      readPublishedRuntimeInPage(origin, "../outside", deniedProjectId, runtime),
      /工程 ID 配置无效/,
    );
    assert.equal(calls.length, 0);
  });

  void it("CDP 序列化后服务端页面函数仍可独立运行，不引用 Node 模块作用域", async () => {
    const isolated = runInNewContext("(" + readPublishedRuntimeInPage.toString() + ")");
    const { runtime } = fixture();
    const result = await isolated(origin, allowedProjectId, deniedProjectId, runtime);
    assert.equal(result.status, "UNRELEASED");
    assert.doesNotMatch(readPublishedRuntimeInPage.toString(), /PROJECT_ID_PATTERN|MAX_RELEASE_RESPONSE_BYTES/);
    assert.doesNotMatch(openPublishedRuntimeUiInPage.toString(), /PROJECT_ID_PATTERN|MAX_RELEASE_RESPONSE_BYTES/);
  });

  void it("React/Vue 页面函数只通过真实只读按钮发出 GET，撤权后不显示预览并可重新读取", async () => {
    const { runtime } = fixture();
    class FakeInput {
      constructor() {
        this.value = "";
      }
      dispatchEvent() {
        return true;
      }
    }
    Object.defineProperty(FakeInput.prototype, "value", {
      get() { return this._value ?? ""; },
      set(value) { this._value = value; },
    });
    const input = new FakeInput();
    let pageExists = false;
    let status = "idle";
    let currentProject = "";
    let previewVisible = false;
    const projectTerm = { textContent: "工程", nextElementSibling: { textContent: "" } };
    const qualityTerm = { textContent: "实时 Tag 质量", nextElementSibling: { textContent: "不可用 · UNAVAILABLE" } };
    const statusElement = { getAttribute: () => status };
    const page = {
      querySelector(selector) {
        if (selector === "#published-react-project-id, #published-vue-project-id") return input;
        if (selector === ".scada-status") return statusElement;
        if (selector === '[data-testid="published-runtime-svg"]') {
          return previewVisible ? { getAttribute: () => "data:image/svg+xml;charset=utf-8,..." } : null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === "button") return [submitButton, stopButton];
        if (selector === ".scada-diagnostics-grid dt") return [projectTerm, qualityTerm];
        return [];
      },
    };
    const submitButton = {
      textContent: "读取正式发布",
      click() {
        currentProject = input.value;
        const path = "/api/v1/projects/" + currentProject + "/releases/current";
        void runtime.fetch(path, {
          method: "GET",
          mode: "same-origin",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/json" },
        }).then((response) => {
          status = response.status === 404 ? "denied" : "unreleased";
          previewVisible = false;
          projectTerm.nextElementSibling.textContent = currentProject;
        });
      },
    };
    const stopButton = { textContent: "停止读取", click() {} };
    const navButton = {
      textContent: "已发布运行",
      click() { pageExists = true; },
    };
    runtime.HTMLInputElement = FakeInput;
    runtime.Event = class FakeEvent {};
    runtime.document = {
      querySelector(selector) {
        if (selector === 'nav[aria-label="功能导航"]') {
          return { querySelectorAll: () => [navButton] };
        }
        if (selector === '[data-testid="published-runtime-page"]') return pageExists ? page : null;
        return null;
      },
    };
    const isolated = runInNewContext("(" + openPublishedRuntimeUiInPage.toString() + ")");
    const result = await isolated(origin, allowedProjectId, deniedProjectId, "UNRELEASED", runtime);
    assert.equal(result.allowedState, "unreleased");
    assert.equal(result.deniedState, "denied");
    assert.equal(result.recoveredState, "unreleased");
    assert.equal(result.tagQualityUnavailable, true);
    assert.equal(result.auditReadOnly, true);
    assert.equal(result.auditCount, 3);
  });

  void it("未知浏览器错误不得泄漏工程 ID、Cookie、Token、URL 或堆栈", () => {
    const secret = "Cookie=private; Bearer secret; https://private.example; " + allowedProjectId;
    assert.equal(
      describePublishedRuntimeBrowserFailure(new Error(secret)),
      "正式发布 OIDC 双框架只读专项未通过，内部诊断已脱敏",
    );
    assert.equal(
      describePublishedRuntimeBrowserFailure({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }),
      "本机 HTTPS 证书有效期或域名校验失败",
    );
  });
});
