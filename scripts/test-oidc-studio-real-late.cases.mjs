import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  armStudioRealLateInPage,
  classifyStudioLocalDrift,
  attemptRestoreDuringSaveInPage,
  describeStudioRealLateFailure,
  installStudioRealLateHookInPage,
  parseStudioRealLateMode,
  releaseStudioRealLateInPage,
  readStudioContentCanvasInPage,
  setSecondaryBrowserWindowState,
  studioRealLateStateInPage,
} from "./test-oidc-studio-real-late.mjs";

const origin = "https://127.0.0.1:15173";
const projectId = "b34-oidc-cas-00000000-0000-4000-8000-000000000001";
const csrf = "scada_csrf_" + "a".repeat(43);

function runtimeForTest(
  response = new Response(
    JSON.stringify({
      revision: 2,
      contentHash: "b".repeat(64),
    }),
    {
      status: 201,
      headers: { "Content-Type": "application/json" },
    },
  ),
) {
  const calls = [];
  const runtime = {
    location: { origin, href: origin + "/" },
    document: { cookie: "__Host-adui-scada-csrf=" + csrf },
    fetch: async (input, init) => {
      calls.push({ input, init });
      return response;
    },
  };
  return { runtime, calls };
}

function versionRequest(expectedRevision = 1, changedProjectId = projectId, header = csrf) {
  return {
    method: "POST",
    credentials: "same-origin",
    mode: "same-origin",
    headers: { "X-SCADA-CSRF": header },
    body: JSON.stringify({
      expectedRevision,
      document: { projectId: changedProjectId, schemaVersion: "0.3.0" },
    }),
  };
}

/** 最小 SVG DOM 测试夹具：保留 SVG 直系子元素，并模拟 cloneNode 后移除视口网格。 */
function studioCanvasRuntime(children) {
  const source = {
    cloneNode: (deep) => {
      assert.equal(deep, true);
      const copied = children.map((child) => ({
        ...child,
        removed: false,
        getAttribute: (name) => (name === "fill" ? (child.fill ?? null) : null),
        remove() {
          this.removed = true;
        },
      }));
      return {
        children: copied,
        get innerHTML() {
          return copied
            .filter((child) => !child.removed)
            .map((child) => child.markup)
            .join("");
        },
      };
    },
  };
  return {
    document: { querySelector: (selector) => (selector === ".studio-svg" ? source : null) },
  };
}

async function settleResponse() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

void describe("真实双框架 Studio 迟到 201 浏览器安全保护", () => {
  void it("必须完整确认本机 Lab；默认及混合模式均禁止真实数据库写入", () => {
    assert.equal(
      parseStudioRealLateMode(["--run-studio-late", "--confirm-lab", "adui_scada"]),
      true,
    );
    for (const args of [
      [],
      ["--run-studio-late"],
      ["--run-studio-late", "--confirm-lab", "adui_scada_test"],
      ["--run-studio-late", "--confirm-lab", "adui_scada", "--force"],
      ["--run-late-response", "--confirm-lab", "adui_scada"],
    ]) {
      assert.throws(
        () => parseStudioRealLateMode(args),
        /真实 Studio 迟到响应专项必须显式确认本机 Lab/,
      );
    }
  });

  void it("真实 201 到达后保持 UI Promise 挂起，单次释放才交付原始响应", async () => {
    const { runtime, calls } = runtimeForTest();
    installStudioRealLateHookInPage(runtime);
    assert.equal(armStudioRealLateInPage(origin, projectId, runtime), true);
    let returned = false;
    const promise = runtime
      .fetch("/api/v1/projects/" + projectId + "/versions", versionRequest())
      .then((response) => {
        returned = true;
        return response;
      });
    await settleResponse();
    assert.equal(returned, false);
    const state = runtime.__aduiTestStudioRealLate;
    assert.equal(state.active.phase, "received");
    assert.equal(state.active.hits, 1);
    assert.equal(state.writeAttempts, 1);
    assert.equal(state.rejectedWrites, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers["X-SCADA-CSRF"], csrf);
    assert.equal(JSON.parse(calls[0].init.body).expectedRevision, 1);
    assert.equal(releaseStudioRealLateInPage(origin, projectId, runtime), true);
    const response = await promise;
    assert.equal(returned, true);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).revision, 2);
    assert.equal(state.active.phase, "released");
    assert.equal(
      (await runtime.fetch("/api/v1/projects/" + projectId + "/versions", versionRequest())).status,
      403,
    );
    assert.equal(calls.length, 1);
    assert.equal(state.rejectedWrites, 1);
    assert.throws(
      () => releaseStudioRealLateInPage(origin, projectId, runtime),
      /真实 Studio 迟到保存未达到受控状态/,
    );
  });

  void it("不允许在未预设工程、跨 Origin、错误工程 ID 或重复挂起时放行 POST", async () => {
    const { runtime, calls } = runtimeForTest();
    installStudioRealLateHookInPage(runtime);
    assert.equal(
      (await runtime.fetch("/api/v1/projects/" + projectId + "/versions", versionRequest())).status,
      403,
    );
    assert.equal(calls.length, 0);
    assert.throws(
      () => armStudioRealLateInPage("https://127.0.0.1:15174", projectId, runtime),
      /真实 Studio 迟到保存未达到受控状态/,
    );
    assert.throws(
      () => armStudioRealLateInPage(origin, "production-project", runtime),
      /真实 Studio 迟到保存未达到受控状态/,
    );
    assert.throws(
      () => armStudioRealLateInPage(origin, projectId, runtime),
      /真实 Studio 迟到保存未达到受控状态/,
    );
    assert.equal(runtime.__aduiTestStudioRealLate.rejectedWrites, 1);
  });

  void it("只允许当前工程 CAS=1，错误 CSRF、跨站与其他工程写入均被拒绝", async () => {
    const { runtime, calls } = runtimeForTest();
    installStudioRealLateHookInPage(runtime);
    armStudioRealLateInPage(origin, projectId, runtime);
    const paths = [
      ["/api/v1/projects", versionRequest()],
      ["/api/v1/projects/another/versions", versionRequest()],
      ["https://127.0.0.1:15174/api/v1/projects/" + projectId + "/versions", versionRequest()],
      ["/api/v1/projects/" + projectId + "/versions", versionRequest(2)],
      ["/api/v1/projects/" + projectId + "/versions", versionRequest(1, "another")],
      ["/api/v1/projects/" + projectId + "/versions", versionRequest(1, projectId, "bad")],
    ];
    for (const [path, options] of paths) {
      const response = await runtime.fetch(path, options);
      assert.equal(response.status, 403);
    }
    assert.equal(calls.length, 0);
    assert.equal(runtime.__aduiTestStudioRealLate.writeAttempts, paths.length);
    assert.equal(runtime.__aduiTestStudioRealLate.rejectedWrites, paths.length);
    assert.throws(
      () => releaseStudioRealLateInPage(origin, projectId, runtime),
      /真实 Studio 迟到保存未达到受控状态/,
    );
  });

  void it("CSRF Cookie 缺失或重复时不得把版本 POST 交付服务器", async () => {
    for (const cookie of [
      "",
      "__Host-adui-scada-csrf=bad",
      "__Host-adui-scada-csrf=" + csrf + "; __Host-adui-scada-csrf=" + csrf,
    ]) {
      const { runtime, calls } = runtimeForTest();
      runtime.document.cookie = cookie;
      installStudioRealLateHookInPage(runtime);
      armStudioRealLateInPage(origin, projectId, runtime);
      assert.equal(
        (await runtime.fetch("/api/v1/projects/" + projectId + "/versions", versionRequest()))
          .status,
        403,
      );
      assert.equal(calls.length, 0);
    }
  });

  void it("真正 409 或格式错误的 201 不得伪装成受控成功并保持请求挂起", async () => {
    for (const response of [
      new Response("{}", { status: 409 }),
      new Response(JSON.stringify({ revision: 3, contentHash: "a".repeat(64) }), { status: 201 }),
      new Response(JSON.stringify({ revision: 2, contentHash: "bad" }), { status: 201 }),
    ]) {
      const { runtime } = runtimeForTest(response);
      installStudioRealLateHookInPage(runtime);
      armStudioRealLateInPage(origin, projectId, runtime);
      const actual = await runtime.fetch(
        "/api/v1/projects/" + projectId + "/versions",
        versionRequest(),
      );
      assert.equal(actual.status, response.status);
      assert.equal(runtime.__aduiTestStudioRealLate.active.phase, "failed");
      assert.throws(
        () => releaseStudioRealLateInPage(origin, projectId, runtime),
        /真实 Studio 迟到保存未达到受控状态/,
      );
    }
  });

  void it("真实 UI 状态函数只返回脱敏阶段和布尔信息，不读取文档或 Cookie", () => {
    const panel = {
      textContent: "服务端最新修订号：2 · CAS 基线：2",
      querySelectorAll: (selector) =>
        selector === "button"
          ? [{ textContent: "保存至服务端", disabled: true }]
          : [{ textContent: "正在处理工程版本" }],
      querySelector: () => null,
    };
    const runtime = {
      document: {
        querySelector: (selector) => (selector === '[aria-label="服务端工程版本"]' ? panel : null),
      },
      __aduiTestStudioRealLate: {
        active: { phase: "received", hits: 1 },
        writeAttempts: 1,
        rejectedWrites: 0,
      },
    };
    const state = studioRealLateStateInPage(runtime);
    assert.deepEqual(state, {
      phase: "received",
      hits: 1,
      writeAttempts: 1,
      rejectedWrites: 0,
      busy: true,
      disabled: true,
      baselineRevision: 2,
      baselineCleared: false,
      headCleared: false,
      hasError: false,
      savedSecondVersion: false,
      visible: false,
    });
    assert.equal(JSON.stringify(state).includes(csrf), false);
    runtime.document.visibilityState = "visible";
    assert.equal(studioRealLateStateInPage(runtime).visible, true);
  });

  void it("保存期间恢复草稿经真实 TDesign Popup 触发，不改写全局确认函数", async () => {
    let clicks = 0;
    const originalConfirm = () => false;
    const button = {
      textContent: "恢复草稿",
      disabled: false,
      click: () => {
        clicks += 1;
      },
    };
    const popup = {
      querySelector(selector) {
        if (selector === "button.t-button") {
          return { tagName: "BUTTON", click: () => undefined };
        }
        if (selector === ".studio-file-popover") {
          return { getClientRects: () => [{}] };
        }
        return null;
      },
      querySelectorAll: () => [button],
    };
    const runtime = {
      confirm: originalConfirm,
      document: { querySelector: () => popup },
    };
    assert.equal(await attemptRestoreDuringSaveInPage(runtime), true);
    assert.equal(clicks, 1);
    assert.equal(runtime.confirm, originalConfirm);
  });

  void it("切换第二主体窗口只能使用 CDP 指定隔离窗口，不改写页面可见性", async () => {
    const commands = [];
    const session = {
      send: async (method, args) => {
        commands.push({ method, args });
        return method === "Browser.getWindowForTarget" ? { windowId: 17 } : {};
      },
    };
    assert.equal(await setSecondaryBrowserWindowState(session, "normal"), true);
    assert.equal(await setSecondaryBrowserWindowState(session, "minimized"), true);
    assert.deepEqual(commands, [
      { method: "Browser.getWindowForTarget", args: undefined },
      {
        method: "Browser.setWindowBounds",
        args: { windowId: 17, bounds: { windowState: "normal" } },
      },
      { method: "Browser.getWindowForTarget", args: undefined },
      {
        method: "Browser.setWindowBounds",
        args: { windowId: 17, bounds: { windowState: "minimized" } },
      },
    ]);
    assert.equal(
      commands.some((item) => item.method === "Runtime.evaluate"),
      false,
    );
  });

  void it("窗口标识异常、非法状态或 CDP 拒绝时必须显式失败，不能绕过真实 visible", async () => {
    let calls = 0;
    const invalidSession = {
      send: async () => {
        calls += 1;
        return { windowId: 0 };
      },
    };
    await assert.rejects(
      setSecondaryBrowserWindowState(invalidSession, "normal"),
      /隔离第二主体浏览器窗口状态切换失败/,
    );
    await assert.rejects(
      setSecondaryBrowserWindowState(invalidSession, "visible"),
      /隔离第二主体浏览器窗口状态切换失败/,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      setSecondaryBrowserWindowState(
        {
          send: async () => {
            throw new Error("sensitive_token_禁止泄漏");
          },
        },
        "minimized",
      ),
      (error) =>
        error.message === "隔离第二主体浏览器窗口状态切换失败" &&
        !error.message.includes("sensitive_token"),
    );
  });

  void it("仅视口网格几何属性变化时，完整画布内容快照仍相等", () => {
    const content = [
      { localName: "defs", markup: "<defs><pattern id='scada-studio-grid'/></defs>" },
      { localName: "image", markup: "<image href='data:image/svg+xml,固定内容'/>" },
      { localName: "rect", fill: "none", markup: "<rect class='studio-page-boundary'/>" },
      { localName: "g", markup: "<g><rect x='10' width='40'/></g>" },
    ];
    const before = studioCanvasRuntime([
      content[0],
      content[1],
      {
        localName: "rect",
        fill: "url(#scada-studio-grid)",
        markup: "<rect x='0' y='0' width='1920' height='1080' fill='url(#scada-studio-grid)'/>",
      },
      ...content.slice(2),
    ]);
    const after = studioCanvasRuntime([
      content[0],
      content[1],
      {
        localName: "rect",
        fill: "url(#scada-studio-grid)",
        markup: "<rect x='-10' y='20' width='2048' height='1152' fill='url(#scada-studio-grid)'/>",
      },
      ...content.slice(2),
    ]);
    assert.equal(readStudioContentCanvasInPage(before), readStudioContentCanvasInPage(after));
    assert.ok(readStudioContentCanvasInPage(before).includes("studio-page-boundary"));
  });

  void it("图元与渲染内容变化仍必须触发画布差异，不能被视口过滤掩盖", () => {
    const base = [
      { localName: "image", markup: "<image href='data:image/svg+xml,原有图元'/>" },
      {
        localName: "rect",
        fill: "url(#scada-studio-grid)",
        markup: "<rect fill='url(#scada-studio-grid)'/>",
      },
      { localName: "g", markup: "<g transform='rotate(0)'><rect width='30'/></g>" },
    ];
    const before = readStudioContentCanvasInPage(studioCanvasRuntime(base));
    const imageChanged = readStudioContentCanvasInPage(
      studioCanvasRuntime([
        { ...base[0], markup: "<image href='data:image/svg+xml,修改后图元'/>" },
        ...base.slice(1),
      ]),
    );
    const nodeChanged = readStudioContentCanvasInPage(
      studioCanvasRuntime([
        ...base.slice(0, 2),
        { ...base[2], markup: "<g transform='rotate(45)'><rect width='30'/></g>" },
      ]),
    );
    assert.notEqual(before, imageChanged);
    assert.notEqual(before, nodeChanged);
  });

  void it("画布不存在或存在多个直系视口网格时必须安全失败", () => {
    assert.throws(
      () => readStudioContentCanvasInPage({ document: { querySelector: () => null } }),
      /真实 Studio 迟到保存未达到受控状态/,
    );
    const duplicatedGrid = {
      localName: "rect",
      fill: "url(#scada-studio-grid)",
      markup: "<rect fill='url(#scada-studio-grid)'/>",
    };
    assert.throws(
      () => readStudioContentCanvasInPage(studioCanvasRuntime([duplicatedGrid, duplicatedGrid])),
      /真实 Studio 迟到保存未达到受控状态/,
    );
  });

  void it("画布与自动保存状态未变时不误报本地数据变化", () => {
    const before = {
      canvas: "<svg>画布安全基线</svg>",
      autoSave: true,
      drafts: { count: 1, hash: "a".repeat(64) },
    };
    const drift = classifyStudioLocalDrift(before, structuredClone(before));
    assert.deepEqual(drift, {
      canvasChanged: false,
      autoSaveChanged: false,
      draftCountChanged: false,
      draftHashChanged: false,
    });
  });

  void it("独立识别四类本地变化且诊断不得泄露原画布与草稿摘要", () => {
    const secret = "隐私草稿内容_token_secret_禁止输出";
    const baseline = {
      canvas: secret,
      autoSave: true,
      drafts: { count: 1, hash: secret },
    };
    const changed = [
      [{ ...baseline, canvas: "新画布" }, "canvasChanged"],
      [{ ...baseline, autoSave: false }, "autoSaveChanged"],
      [{ ...baseline, drafts: { ...baseline.drafts, count: 2 } }, "draftCountChanged"],
      [{ ...baseline, drafts: { ...baseline.drafts, hash: "b".repeat(64) } }, "draftHashChanged"],
    ];
    for (const [after, category] of changed) {
      const drift = classifyStudioLocalDrift(baseline, after);
      assert.deepEqual(
        Object.entries(drift)
          .filter(([, differs]) => differs)
          .map(([key]) => key),
        [category],
      );
      const diagnostic = JSON.stringify(drift);
      assert.equal(diagnostic.includes(secret), false);
      assert.equal(Object.values(drift).filter(Boolean).length, 1);
    }
  });

  void it("未知错误必须脱敏，不能输出 Cookie、Token 或数据库地址", () => {
    const result = describeStudioRealLateFailure(new Error("secret_token=不可公开"));
    assert.equal(result, "真实 Studio 迟到响应专项未通过，内部错误详情已脱敏");
    assert.equal(result.includes("secret_token"), false);
    assert.equal(
      describeStudioRealLateFailure(new Error("真实 Studio 迟到保存未阻止重复写入")),
      "真实 Studio 迟到保存未阻止重复写入",
    );
  });
});
