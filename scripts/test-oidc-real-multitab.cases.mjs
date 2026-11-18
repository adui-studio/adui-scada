import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeMultiTabFailure,
  installMultiTabVisibilityProbeInPage,
  installPageProbes,
  logoutCurrentSessionInPage,
  prepareFollowerDraft,
  readAuthStatusInPage,
  readMultiTabSessionStateInPage,
  refreshProjectListInPage,
  requireSameCanvasAndDrafts,
  requireSamePrincipal,
  requireUnchangedStudioState,
  requireVisibleTransition,
  resolveMultiTabMode,
  visibilityProbeStateInPage,
} from "./test-oidc-real-multitab.mjs";

const sample = {
  SCADA_DATABASE_URL: "postgresql://scada:secret@127.0.0.1:15432/adui_scada",
  SCADA_LAB_POSTGRES_PORT: "15432",
};

void describe("OIDC 真实多标签页会话安全门禁", () => {
  void it("只接受与显式确认完全一致的本机隔离数据库", () => {
    assert.deepEqual(
      resolveMultiTabMode(["--run-multitab", "--confirm-lab", "adui_scada"], sample),
      { databaseName: "adui_scada" },
    );
    assert.deepEqual(
      resolveMultiTabMode(["--run-multitab", "--confirm-lab", "adui_scada_oidc_lab"], {
        SCADA_DATABASE_URL: "postgresql://scada:secret@127.0.0.1:15432/adui_scada_oidc_lab",
        SCADA_LAB_POSTGRES_PORT: "15432",
      }),
      { databaseName: "adui_scada_oidc_lab" },
    );
  });

  void it("缺少显式确认、库名不一致或数据库不是本机时拒绝启动", () => {
    assert.throws(
      () => resolveMultiTabMode([], sample),
      /真实多标签页测试必须显式确认本机隔离数据库/,
    );
    assert.throws(
      () => resolveMultiTabMode(["--run-multitab", "--confirm-lab", "other"], sample),
      /真实多标签页测试只允许本机隔离数据库/,
    );
    assert.throws(
      () =>
        resolveMultiTabMode(["--run-multitab", "--confirm-lab", "adui_scada"], {
          SCADA_DATABASE_URL: "postgresql://scada:secret@db.example.org/adui_scada",
          SCADA_LAB_POSTGRES_PORT: "15432",
        }),
      /真实多标签页测试只允许本机隔离数据库/,
    );
  });

  void it("真实可见性探针只记录浏览器报告的状态变化", () => {
    let listener;
    const runtime = {
      document: {
        visibilityState: "hidden",
        addEventListener(type, callback) {
          assert.equal(type, "visibilitychange");
          listener = callback;
        },
      },
    };
    assert.equal(installMultiTabVisibilityProbeInPage(runtime), true);
    runtime.document.visibilityState = "visible";
    listener();
    runtime.document.visibilityState = "hidden";
    listener();
    assert.deepEqual(visibilityProbeStateInPage(runtime), {
      visibility: "hidden",
      visibleEvents: 1,
      hiddenEvents: 1,
    });
    assert.equal(
      requireVisibleTransition(
        { visibility: "hidden", visibleEvents: 2, hiddenEvents: 1 },
        { visibility: "visible", visibleEvents: 3, hiddenEvents: 1 },
      ),
      true,
    );
    assert.throws(
      () =>
        requireVisibleTransition(
          { visibility: "hidden", visibleEvents: 2, hiddenEvents: 1 },
          { visibility: "visible", visibleEvents: 2, hiddenEvents: 1 },
        ),
      /真实标签页没有发生可见性切换/,
    );
  });

  void it("初始空白标签页必须在首次激活前安装可见性探针", async () => {
    const calls = [];
    const session = {
      send: async (method, params) => {
        calls.push(method);
        assert.equal(method, "Page.addScriptToEvaluateOnNewDocument");
        assert.match(params.source, /installMultiTabVisibilityProbeInPage/);
        assert.match(params.source, /installAccessDenialFaultInPage/);
      },
      evaluate: async (action) => {
        calls.push("Runtime.evaluate");
        assert.equal(action, installMultiTabVisibilityProbeInPage);
        return true;
      },
    };
    await installPageProbes(session, true);
    assert.deepEqual(calls, ["Page.addScriptToEvaluateOnNewDocument", "Runtime.evaluate"]);
  });

  void it("四个标签页必须对应同一租户和同一主体", () => {
    const principal = { tenantId: "tenant-a", subjectId: "subject-a" };
    assert.equal(requireSamePrincipal(principal, { ...principal }), true);
    assert.throws(
      () =>
        requireSamePrincipal(principal, {
          tenantId: "tenant-a",
          subjectId: "subject-b",
        }),
      /四个标签页未共享同一 BFF 身份/,
    );
  });

  void it("真实注销只使用当前 Origin 的 CSRF 双提交且不返回令牌", async () => {
    const csrf = "scada_csrf_" + "c".repeat(43);
    let request;
    const runtime = {
      location: { origin: "https://127.0.0.1:15173" },
      document: { cookie: "__Host-adui-scada-csrf=" + csrf },
      fetch: async (url, options) => {
        request = { url, options };
        return { status: 204 };
      },
    };
    const result = await logoutCurrentSessionInPage(runtime.location.origin, runtime);
    assert.deepEqual(result, { status: 204 });
    assert.equal(request.url, "/api/v1/auth/logout");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.credentials, "same-origin");
    assert.equal(request.options.mode, "same-origin");
    assert.equal(request.options.headers["X-SCADA-CSRF"], csrf);
    assert.equal("body" in request.options, false);
    assert.equal(JSON.stringify(result).includes(csrf), false);
    assert.equal(
      await readAuthStatusInPage(runtime.location.origin, {
        location: runtime.location,
        fetch: async () => ({ status: 401 }),
      }),
      401,
    );
    await assert.rejects(
      logoutCurrentSessionInPage("https://127.0.0.1:15174", runtime),
      /本地会话注销未返回 HTTP 204/,
    );
  });

  void it("会话状态摘要只返回白名单状态，不包含页面敏感正文", () => {
    const secret = "sensitive-session-content";
    const panel = {
      textContent: "服务端身份已验证 CAS 基线：未建立 服务端最新修订号：未查询",
      querySelectorAll: () => [{ textContent: "只读预览最新版本" }],
      querySelector: () => ({ textContent: "服务端版本已变化 " + secret }),
    };
    const runtime = {
      document: {
        querySelector: (selector) =>
          selector === '[aria-label="服务端工程版本"]'
            ? panel
            : selector === ".studio-notice"
              ? { textContent: "标签页恢复校验发现变更 " + secret }
              : null,
        body: { textContent: secret },
      },
      __aduiTestAccessDenial: { writeAttempts: 0, token: secret },
    };
    const state = readMultiTabSessionStateInPage(runtime);
    assert.deepEqual(state, {
      baselineRevision: null,
      baselineCleared: true,
      headCleared: true,
      recoveryAvailable: true,
      resumeConflictVisible: true,
      identityVerified: true,
      identityRejected: false,
      hasError: true,
      errorCategory: "conflict",
      busy: false,
      writeAttempts: 0,
    });
    assert.equal(JSON.stringify(state).includes(secret), false);
  });

  void it("跟随页先初始化草稿再生成完整保护快照，不能将 CAS 摘要当画布", async () => {
    const actions = [];
    const draft = { count: 1, hash: "a".repeat(64) };
    const canvas = "<svg>工程图元</svg>";
    const session = {
      evaluate: async (action) => {
        actions.push(action.name);
        switch (action.name) {
          case "saveDraftInPage":
          case "enableAutoSaveInPage":
            return true;
          case "stateInPage":
            return { autoSave: true, canvas: "<svg>包含视口网格</svg>" };
          case "readBrowserDraftsInPage":
            return draft;
          case "readStudioContentCanvasInPage":
            return canvas;
          default:
            throw new Error("跟随页快照测试调用了未知操作");
        }
      },
    };
    const snapshot = await prepareFollowerDraft(session);
    assert.deepEqual(actions, [
      "saveDraftInPage",
      "enableAutoSaveInPage",
      "stateInPage",
      "readBrowserDraftsInPage",
      "readStudioContentCanvasInPage",
    ]);
    assert.equal(snapshot.canvas, canvas);
    assert.deepEqual(snapshot.drafts, draft);
    assert.equal(snapshot.autoSave, true);
    assert.equal(requireUnchangedStudioState(snapshot, structuredClone(snapshot)), true);
    assert.throws(
      () => requireSameCanvasAndDrafts({ baselineRevision: 1 }, snapshot),
      /标签页恢复改变了本地画布/,
    );
  });

  void it("本地画布、IndexedDB 草稿和自动保存必须逐项保持一致", () => {
    const before = {
      canvas: "<svg>原画布</svg>",
      drafts: { count: 1, hash: "a".repeat(64) },
      autoSave: true,
    };
    assert.equal(requireUnchangedStudioState(before, structuredClone(before)), true);
    assert.equal(
      requireSameCanvasAndDrafts(before, {
        ...before,
        autoSave: false,
      }),
      true,
    );
    assert.throws(
      () => requireUnchangedStudioState(before, { ...before, canvas: "<svg>变化</svg>" }),
      /标签页恢复改变了本地画布/,
    );
    assert.throws(
      () =>
        requireUnchangedStudioState(before, {
          ...before,
          drafts: { count: 1, hash: "b".repeat(64) },
        }),
      /标签页恢复改变了 IndexedDB 草稿/,
    );
    assert.throws(
      () => requireUnchangedStudioState(before, { ...before, autoSave: false }),
      /标签页恢复改变了自动保存状态/,
    );
  });

  void it("缺失或损坏的本地草稿快照不得被视作没有变化", () => {
    const snapshot = {
      canvas: "<svg>原画布</svg>",
      drafts: { count: 1, hash: "a".repeat(64) },
      autoSave: true,
    };
    for (const invalidDrafts of [
      undefined,
      null,
      {},
      { count: 1 },
      { count: 0, hash: "a".repeat(64) },
      { count: 1, hash: "" },
      { count: 1, hash: "非 SHA-256 摘要" },
      { count: Number.NaN, hash: "a".repeat(64) },
    ]) {
      assert.throws(
        () =>
          requireSameCanvasAndDrafts(
            { ...snapshot, drafts: invalidDrafts },
            { ...snapshot, drafts: invalidDrafts },
          ),
        /标签页恢复改变了 IndexedDB 草稿/,
      );
    }
    assert.throws(
      () => requireSameCanvasAndDrafts({ drafts: snapshot.drafts }, { drafts: snapshot.drafts }),
      /标签页恢复改变了本地画布/,
    );
    assert.throws(
      () =>
        requireSameCanvasAndDrafts(
          { ...snapshot, canvas: undefined },
          { ...snapshot, canvas: undefined },
        ),
      /标签页恢复改变了本地画布/,
    );
  });

  void it("自动保存状态缺失时不能以双方相同的空值绕过保护", () => {
    const snapshot = {
      canvas: "<svg>原画布</svg>",
      drafts: { count: 1, hash: "a".repeat(64) },
      autoSave: true,
    };
    for (const invalidAutoSave of [undefined, null, "true", 1]) {
      assert.throws(
        () =>
          requireUnchangedStudioState(
            { ...snapshot, autoSave: invalidAutoSave },
            { ...snapshot, autoSave: invalidAutoSave },
          ),
        /标签页恢复改变了自动保存状态/,
      );
    }
    assert.equal(requireUnchangedStudioState(snapshot, structuredClone(snapshot)), true);
  });

  void it("工程列表刷新必须点击真实可用按钮", () => {
    let clicks = 0;
    const button = { textContent: "刷新", disabled: false, click: () => (clicks += 1) };
    const runtime = {
      document: {
        querySelector: () => ({ querySelectorAll: () => [button] }),
      },
    };
    assert.equal(refreshProjectListInPage(runtime), true);
    assert.equal(clicks, 1);
    assert.throws(
      () =>
        refreshProjectListInPage({
          document: { querySelector: () => null },
        }),
      /工程列表刷新失败/,
    );
  });

  void it("未知浏览器异常不得泄露原始凭据或堆栈", () => {
    const secret = "Cookie=private-token";
    const message = describeMultiTabFailure(new Error(secret));
    assert.equal(message, "真实多标签页 OIDC 安全专项失败（已脱敏）");
    assert.equal(message.includes(secret), false);
    assert.equal(
      describeMultiTabFailure(new Error("注销后服务端 CAS 基线未失效")),
      "注销后服务端 CAS 基线未失效",
    );
  });
});
