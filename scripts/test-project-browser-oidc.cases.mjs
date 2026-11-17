import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeBrowserPageException,
  describeProjectBrowserFailure,
  describeSaveTimingTimeout,
  requireSaveTimingBaseline,
  inspectStudioState,
  installAccessDenialFaultInPage,
  armAccessDenialInPage,
  armSaveTimingInPage,
  releaseSaveTimingInPage,
  triggerSaveTimingInPage,
  saveTimingStateInPage,
  triggerConflictPreviewInPage,
  conflictPreviewStateInPage,
  triggerStudioResumeInPage,
  openProjectInPage,
  requireAuthorizedProjectPage,
  requireRealMultiPageCoverage,
  prepareAuthorizedMultiPageInPage,
  resolveProjectBrowserMode,
  resolveProjectBrowserLab,
} from "./test-project-browser-oidc.mjs";

const sample = {
  NODE_ENV: "development",
  NODE_EXTRA_CA_CERTS: process.execPath,
  SCADA_OIDC_ENABLED: "true",
  SCADA_OIDC_DEV_HTTPS_ENABLED: "true",
  SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "false",
  SCADA_LOCAL_DEMO_API_ENABLED: "false",
  SCADA_WEB_HOST: "127.0.0.1",
  SCADA_SERVER_HOST: "127.0.0.1",
  SCADA_SERVER_PORT: "13001",
  SCADA_REACT_DEV_PORT: "15173",
  SCADA_VUE_DEV_PORT: "15174",
  SCADA_LAB_KEYCLOAK_PORT: "18443",
  SCADA_LAB_POSTGRES_PORT: "15432",
  SCADA_OIDC_ISSUER: "https://127.0.0.1:18443/realms/adui-scada",
  SCADA_OIDC_WEB_ORIGINS: "https://127.0.0.1:15173,https://127.0.0.1:15174",
  SCADA_OIDC_REDIRECT_URI: "https://127.0.0.1:15173/api/v1/auth/oidc/callback",
  SCADA_DATABASE_URL: "postgresql://127.0.0.1:15432/adui_scada",
};

void describe("OIDC 工程浏览器专项环境保护", () => {
  void it("只接受两套本机 HTTPS Origin 与受控 Keycloak Realm", () => {
    assert.deepEqual(resolveProjectBrowserLab(sample), [
      "https://127.0.0.1:15173",
      "https://127.0.0.1:15174",
    ]);
  });

  void it("拒绝远程 Keycloak Issuer 和不受信的回调地址", () => {
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, SCADA_OIDC_ISSUER: "https://example.com" }),
      /仅允许本机 Keycloak 隔离 Realm/,
    );
    assert.throws(
      () =>
        resolveProjectBrowserLab({
          ...sample,
          SCADA_OIDC_REDIRECT_URI: "https://example.com/callback",
        }),
      /OIDC 回调必须与已登记的 HTTPS Origin 一致/,
    );
  });

  void it("拒绝远程数据库、其他库名与端口", () => {
    for (const url of [
      "postgresql://db.example.com:15432/adui_scada",
      "postgresql://127.0.0.1:15432/business",
      "postgresql://127.0.0.1:5432/adui_scada",
    ]) {
      assert.throws(
        () => resolveProjectBrowserLab({ ...sample, SCADA_DATABASE_URL: url }),
        /拒绝非本机隔离数据库目标/,
      );
    }
  });

  void it("关闭可信 OIDC 或允许不安全回环时拒绝执行", () => {
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, SCADA_OIDC_ENABLED: "false" }),
      /只读 HTTPS 探针要求显式启用可信 OIDC 开发代理/,
    );
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, SCADA_OIDC_ALLOW_INSECURE_LOOPBACK: "true" }),
      /只允许安全的本机非生产环境/,
    );
  });

  void it("缺少可信 Node.js 根证书时拒绝执行", () => {
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, NODE_EXTRA_CA_CERTS: undefined }),
      /保持 TLS 校验/,
    );
    assert.throws(
      () =>
        resolveProjectBrowserLab({
          ...sample,
          NODE_EXTRA_CA_CERTS: "Z:/__adui_missing_ca__/rootCA.pem",
        }),
      /本机根证书无法读取/,
    );
  });

  void it("错误诊断不得泄漏原始凭据、路径和堆栈", () => {
    assert.equal(
      describeProjectBrowserFailure(new Error("内部请求包含敏感 Cookie")),
      "浏览器安全回归断言失败，检查终端测试条件及真实页面状态",
    );
    assert.equal(
      describeProjectBrowserFailure(new Error("工程浏览器测试拒绝非本机隔离数据库目标")),
      "工程浏览器测试拒绝非本机隔离数据库目标",
    );
    assert.equal(
      describeProjectBrowserFailure({ code: "ECONNREFUSED" }),
      "本机 Web 或浏览器调试端口未监听",
    );
    assert.equal(
      describeProjectBrowserFailure(
        new Error("React 隔离 Lab 没有授权工程，请先由维护者按受控流程准备至少一份工程"),
      ),
      "React 隔离 Lab 没有授权工程，请先由维护者按受控流程准备至少一份工程",
    );
    for (const reason of ["React BFF 会话未通过验证", "Vue BFF 会话未通过验证"]) {
      assert.equal(describeProjectBrowserFailure(new Error(reason)), reason);
    }
  });

  void it("工程载入诊断只允许固定阶段和类别，不返回真实页面正文", () => {
    const safe = "服务器工程载入阶段返回受控错误（确认前：版本冲突）";
    assert.equal(
      describeBrowserPageException({
        exception: { className: "Error", description: "Error: " + safe + "\n敏感数据" },
      }),
      safe,
    );
    assert.equal(
      describeBrowserPageException({
        exception: {
          className: "Error",
          description: "Error: " + safe + "；Bearer secret",
        },
      }),
      "页面脚本断言异常",
    );
    const error = new Error("浏览器页面操作失败，请检查当前 Studio 状态");
    error.pageDiagnostic = safe;
    assert.equal(describeProjectBrowserFailure(error), "浏览器页面操作失败：" + safe);
    error.pageDiagnostic = safe + "；敏感信息";
    assert.equal(
      describeProjectBrowserFailure(error),
      "浏览器页面操作失败，请检查当前 Studio 状态",
    );
  });

  void it("CDP 异常只返回白名单错误原因或安全类别，不泄漏原始堆栈", () => {
    assert.equal(
      describeBrowserPageException({
        exception: {
          className: "Error",
          description: "Error: 未找到工程管理入口\n堆栈和私密内容不得展示",
        },
      }),
      "未找到工程管理入口",
    );
    assert.equal(
      describeBrowserPageException({
        exception: {
          className: "ReferenceError",
          description: "ReferenceError: 包含私密 Cookie 的未知变量",
        },
      }),
      "页面脚本引用异常",
    );
    assert.equal(
      describeBrowserPageException({ exception: { className: "OtherError" } }),
      "页面脚本异常（已脱敏）",
    );
  });

  void it("授权工程列表 HTTP 拒绝只显示状态码，不能返回正文", () => {
    assert.deepEqual(requireAuthorizedProjectPage({ status: 200, projects: [] }), []);
    assert.throws(
      () => requireAuthorizedProjectPage({ status: 403, projects: ["敏感工程"] }),
      (error) => describeProjectBrowserFailure(error) === "工程列表接口返回 HTTP 403",
    );
    assert.throws(
      () => requireAuthorizedProjectPage({ status: 0, projects: [] }),
      (error) => describeProjectBrowserFailure(error) === "工程列表接口状态异常",
    );
  });

  void it("页面安全诊断不得输出任意未知错误内容", () => {
    const error = new Error("浏览器页面操作失败，请检查当前 Studio 状态");
    error.pageDiagnostic = "包含 Token 的异常详情";
    assert.equal(
      describeProjectBrowserFailure(error),
      "浏览器页面操作失败，请检查当前 Studio 状态",
    );
    error.pageDiagnostic = "页面脚本类型异常";
    assert.equal(describeProjectBrowserFailure(error), "浏览器页面操作失败：页面脚本类型异常");
  });

  void it("CDP 页面状态与 IndexedDB 读取分别序列化执行，防止跨作用域引用异常", async () => {
    const actions = [];
    const page = {
      canvas: "<svg></svg>",
      server: "当前工程：demo；CAS 基线：1",
      autoSave: true,
    };
    const drafts = { count: 1, hash: "只供测试的摘要" };
    const session = {
      async evaluate(action) {
        actions.push({ name: action.name, source: action.toString() });
        if (action.name === "stateInPage") return page;
        if (action.name === "readBrowserDraftsInPage") return drafts;
        throw new Error("测试收到了意外的浏览器动作");
      },
    };

    assert.deepEqual(await inspectStudioState(session), { ...page, drafts });
    assert.deepEqual(
      actions.map((action) => action.name),
      ["stateInPage", "readBrowserDraftsInPage"],
    );
    assert.equal(actions[0].source.includes("readBrowserDraftsInPage"), false);
    assert.equal(actions[1].source.includes("indexedDB.open"), true);
  });

  void it("上一轮版本冲突错误残留时，新一轮确认载入不能误报失败", async () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const state = { error: "服务端工程版本已更新", notice: "", busy: false };
    const button = {
      disabled: false,
      click() {
        setTimeout(() => {
          state.error = "";
          state.busy = true;
        }, 10);
        setTimeout(() => {
          state.busy = false;
          state.notice = "已打开最新服务端版本，CAS 基线已建立";
          globalThis.window.confirm();
        }, 30);
      },
    };
    const versionPanel = {
      querySelector(selector) {
        return selector === '[role="alert"]' && state.error ? { textContent: state.error } : null;
      },
      querySelectorAll(selector) {
        return selector === ".studio-version-help" && state.busy
          ? [{ textContent: "正在处理工程版本…" }]
          : [];
      },
    };
    const item = {
      querySelector(selector) {
        return selector === "code" ? { textContent: "test-project" } : button;
      },
    };
    globalThis.document = {
      querySelector(selector) {
        if (selector === ".studio-project-browser-panel") {
          return { querySelectorAll: () => [item] };
        }
        if (selector === '[aria-label="服务端工程版本"]') return versionPanel;
        if (selector === ".studio-notice") return { textContent: state.notice };
        return null;
      },
    };
    globalThis.window = { confirm: () => false };
    try {
      assert.deepEqual(await openProjectInPage("test-project", 1, "confirm"), {
        confirmCount: 1,
        intercepted: 0,
        outcome: "confirm",
      });
      assert.equal(state.error, "");
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  });

  void it("新一轮确认载入真的失败时仍必须拒绝，不得误认为旧冲突", async () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const state = { error: "服务端工程版本已更新", notice: "", busy: false };
    const button = {
      disabled: false,
      click() {
        setTimeout(() => {
          state.error = "";
          state.busy = true;
        }, 10);
        setTimeout(() => {
          state.busy = false;
          state.error = "服务端工程版本读取被拒绝";
        }, 30);
      },
    };
    const versionPanel = {
      querySelector(selector) {
        return selector === '[role="alert"]' && state.error ? { textContent: state.error } : null;
      },
      querySelectorAll(selector) {
        return selector === ".studio-version-help" && state.busy
          ? [{ textContent: "正在处理工程版本…" }]
          : [];
      },
    };
    const item = {
      querySelector(selector) {
        return selector === "code" ? { textContent: "test-project" } : button;
      },
    };
    globalThis.document = {
      querySelector(selector) {
        if (selector === ".studio-project-browser-panel") {
          return { querySelectorAll: () => [item] };
        }
        if (selector === '[aria-label="服务端工程版本"]') return versionPanel;
        if (selector === ".studio-notice") return { textContent: state.notice };
        return null;
      },
    };
    globalThis.window = { confirm: () => false };
    try {
      await assert.rejects(
        openProjectInPage("test-project", 1, "confirm"),
        /服务器工程载入阶段返回受控错误（确认前）/,
      );
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  });

  void it("上一轮错误跨过忙碌阶段残留时仍允许本次正常取消载入", async () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const state = { error: "服务端工程版本已更新", notice: "", busy: false };
    const button = {
      disabled: false,
      click() {
        setTimeout(() => {
          state.busy = true;
        }, 10);
        setTimeout(() => {
          state.busy = false;
        }, 150);
        setTimeout(() => {
          globalThis.window.confirm();
        }, 260);
      },
    };
    const versionPanel = {
      querySelector(selector) {
        return selector === '[role="alert"]' && state.error ? { textContent: state.error } : null;
      },
      querySelectorAll(selector) {
        return selector === ".studio-version-help" && state.busy
          ? [{ textContent: "正在处理工程版本…" }]
          : [];
      },
    };
    const item = {
      querySelector(selector) {
        return selector === "code" ? { textContent: "test-project" } : button;
      },
    };
    globalThis.document = {
      querySelector(selector) {
        if (selector === ".studio-project-browser-panel") {
          return { querySelectorAll: () => [item] };
        }
        if (selector === '[aria-label="服务端工程版本"]') return versionPanel;
        if (selector === ".studio-notice") return { textContent: state.notice };
        return null;
      },
    };
    globalThis.window = { confirm: () => false };
    try {
      assert.deepEqual(await openProjectInPage("test-project", 1, "cancel"), {
        confirmCount: 1,
        intercepted: 0,
        outcome: "cancel",
      });
      assert.equal(state.error, "服务端工程版本已更新");
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  });

  void it("旧错误已清除又以相同内容新出现时必须继续拒绝载入", async () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const state = { error: "服务端工程版本已更新", notice: "", busy: false };
    const button = {
      disabled: false,
      click() {
        setTimeout(() => {
          state.error = "";
          state.busy = true;
        }, 10);
        setTimeout(() => {
          state.busy = false;
        }, 60);
        setTimeout(() => {
          state.error = "服务端工程版本已更新";
        }, 150);
      },
    };
    const versionPanel = {
      querySelector(selector) {
        return selector === '[role="alert"]' && state.error ? { textContent: state.error } : null;
      },
      querySelectorAll(selector) {
        return selector === ".studio-version-help" && state.busy
          ? [{ textContent: "正在处理工程版本…" }]
          : [];
      },
    };
    const item = {
      querySelector(selector) {
        return selector === "code" ? { textContent: "test-project" } : button;
      },
    };
    globalThis.document = {
      querySelector(selector) {
        if (selector === ".studio-project-browser-panel") {
          return { querySelectorAll: () => [item] };
        }
        if (selector === '[aria-label="服务端工程版本"]') return versionPanel;
        if (selector === ".studio-notice") return { textContent: state.notice };
        return null;
      },
    };
    globalThis.window = { confirm: () => false };
    try {
      await assert.rejects(
        openProjectInPage("test-project", 1, "confirm"),
        /服务器工程载入阶段返回受控错误（确认前：版本冲突）/,
      );
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  });

  void it("严格多页验收必须实际访问至少十一项授权工程的有效第二页", () => {
    assert.doesNotThrow(() => requireRealMultiPageCoverage(true, true));
    assert.doesNotThrow(() => requireRealMultiPageCoverage(false, false));
    assert.throws(
      () => requireRealMultiPageCoverage(false, true),
      /真实多页验收要求至少十一项已授权工程，当前未覆盖有效的第二页/,
    );
  });

  void it("多页数据准备必须显式确认本机可信 OIDC Lab", () => {
    const lab = {
      ...sample,
      SCADA_DATABASE_URL:
        "postgresql://adui_scada:only-for-test@127.0.0.1:15432/adui_scada?schema=public",
      SCADA_DB_HOST: "127.0.0.1",
      SCADA_DB_PORT: "15432",
      SCADA_DB_NAME: "adui_scada",
      SCADA_DB_USER: "adui_scada",
    };
    assert.deepEqual(resolveProjectBrowserMode([], lab), {
      requireMultiPage: false,
      prepareMultiPage: false,
    });
    assert.deepEqual(resolveProjectBrowserMode(["--require-multipage"], lab), {
      requireMultiPage: true,
      prepareMultiPage: false,
    });
    assert.deepEqual(resolveProjectBrowserMode(["--simulate-access-denial"], lab), {
      requireMultiPage: false,
      prepareMultiPage: false,
      simulateAccessDenial: true,
    });
    assert.deepEqual(resolveProjectBrowserMode(["--simulate-resume-check"], lab), {
      requireMultiPage: false,
      prepareMultiPage: false,
      simulateResumeCheck: true,
    });
    assert.deepEqual(resolveProjectBrowserMode(["--simulate-save-timing"], lab), {
      requireMultiPage: false,
      prepareMultiPage: false,
      simulateSaveTiming: true,
    });
    assert.deepEqual(
      resolveProjectBrowserMode(["--prepare-multipage", "--confirm-lab", "adui_scada"], lab),
      { requireMultiPage: false, prepareMultiPage: true },
    );
    assert.throws(
      () => resolveProjectBrowserMode(["--prepare-multipage"], lab),
      /仅支持 --require-multipage、--simulate-access-denial、--simulate-resume-check、--simulate-save-timing 或显式确认的多页数据准备参数/,
    );
    assert.throws(
      () =>
        resolveProjectBrowserMode(["--prepare-multipage", "--confirm-lab", "adui_scada"], {
          ...lab,
          SCADA_DATABASE_URL: "postgresql://127.0.0.1:15432/adui_scada_test",
        }),
      /多页数据准备配置不符合本机可信 Lab 边界/,
    );
  });

  void it("权限拒绝专项只接受单一只读模拟模式，禁止组合写入确认参数", () => {
    assert.throws(
      () =>
        resolveProjectBrowserMode(
          ["--simulate-access-denial", "--confirm-lab", "adui_scada"],
          sample,
        ),
      /仅支持 --require-multipage、--simulate-access-denial、--simulate-resume-check、--simulate-save-timing 或显式确认的多页数据准备参数/,
    );
    assert.throws(
      () => resolveProjectBrowserMode(["--simulate-access-denial", "--prepare-multipage"], sample),
      /仅支持 --require-multipage、--simulate-access-denial、--simulate-resume-check、--simulate-save-timing 或显式确认的多页数据准备参数/,
    );
  });

  void it("标签页恢复模式不得与数据库写入确认或其他浏览器模式组合", () => {
    for (const parameters of [
      ["--simulate-resume-check", "--confirm-lab", "adui_scada"],
      ["--simulate-resume-check", "--prepare-multipage"],
      ["--simulate-resume-check", "--simulate-access-denial"],
    ]) {
      assert.throws(
        () => resolveProjectBrowserMode(parameters, sample),
        /仅支持 --require-multipage、--simulate-access-denial、--simulate-resume-check、--simulate-save-timing 或显式确认的多页数据准备参数/,
      );
    }
  });

  void it("延迟保存模式不得与数据库写入确认或其他浏览器模式组合", () => {
    for (const parameters of [
      ["--simulate-save-timing", "--confirm-lab", "adui_scada"],
      ["--simulate-save-timing", "--prepare-multipage"],
      ["--simulate-save-timing", "--simulate-access-denial"],
      ["--simulate-save-timing", "--simulate-resume-check"],
    ]) {
      assert.throws(
        () => resolveProjectBrowserMode(parameters, sample),
        /仅支持 --require-multipage、--simulate-access-denial、--simulate-resume-check、--simulate-save-timing 或显式确认的多页数据准备参数/,
      );
    }
  });

  void it("保存模拟只挂起当前工程的版本 POST，禁止任何工程写入穿透", async () => {
    let forwarded = 0;
    const runtime = {
      location: {
        origin: "https://127.0.0.1:15173",
        href: "https://127.0.0.1:15173/studio",
      },
      async fetch() {
        forwarded += 1;
        return new Response("{}", { status: 200 });
      },
    };
    installAccessDenialFaultInPage(runtime);
    assert.equal(armSaveTimingInPage("project-1", 409, runtime), true);
    const delayed = runtime.fetch("/api/v1/projects/project-1/versions", { method: "POST" });
    assert.equal(runtime.__aduiTestAccessDenial.save.hits, 1);
    assert.equal(runtime.__aduiTestAccessDenial.writeAttempts, 1);
    assert.equal(
      (await runtime.fetch("/api/v1/projects/project-2/versions", { method: "POST" })).status,
      403,
    );
    assert.equal(
      (await runtime.fetch("https://example.invalid/api/v1/projects", { method: "POST" })).status,
      403,
    );
    assert.equal(forwarded, 0);
    assert.equal(releaseSaveTimingInPage(runtime), true);
    assert.equal((await delayed).status, 409);
    assert.equal(runtime.__aduiTestAccessDenial.writeAttempts, 3);
    assert.equal((await runtime.fetch("/api/v1/projects/project-1")).status, 200);
    assert.equal(forwarded, 1);
    assert.throws(() => releaseSaveTimingInPage(runtime), /保存时序模拟尚未命中唯一的版本追加请求/);
  });

  void it("保存时序状态只允许固定 401、409、503 且不接受重复挂起", async () => {
    for (const status of [401, 503]) {
      const runtime = {
        location: {
          origin: "https://127.0.0.1:15174",
          href: "https://127.0.0.1:15174/studio",
        },
        async fetch() {
          throw new Error("不能向真实工程 API 转发写入");
        },
      };
      installAccessDenialFaultInPage(runtime);
      assert.throws(() => armSaveTimingInPage("test", 201, runtime), /保存时序模拟参数不合法/);
      assert.throws(() => armSaveTimingInPage("", status, runtime), /保存时序模拟参数不合法/);
      assert.equal(armSaveTimingInPage("test", status, runtime), true);
      assert.throws(() => armSaveTimingInPage("test", status, runtime), /保存时序模拟参数不合法/);
      assert.throws(
        () => releaseSaveTimingInPage(runtime),
        /保存时序模拟尚未命中唯一的版本追加请求/,
      );
      const pending = runtime.fetch("/api/v1/projects/test/versions", { method: "POST" });
      assert.equal(releaseSaveTimingInPage(runtime), true);
      assert.equal((await pending).status, status);
      assert.equal(runtime.__aduiTestAccessDenial.writeAttempts, 1);
    }
  });

  void it("保存等待超时按固定状态分类并阻止异常正文进入终端", () => {
    const pending = { hits: 0, writeAttempts: 0, busy: false, disabled: false };
    const message = describeSaveTimingTimeout("React", 503, "pending", pending);
    assert.equal(message, "React 延迟保存 503：版本 POST 未命中");
    assert.equal(describeProjectBrowserFailure(new Error(message)), message);
    assert.equal(
      describeSaveTimingTimeout("Vue", 409, "pending", {
        hits: 1,
        writeAttempts: 1,
        busy: true,
        disabled: false,
      }),
      "Vue 延迟保存 409：保存按钮未禁用",
    );
    assert.equal(
      describeSaveTimingTimeout("React", 401, "pending", {
        hits: 1,
        writeAttempts: 2,
        busy: true,
        disabled: true,
      }),
      "React 延迟保存 401：工程写入次数异常",
    );
    const unsafe = "React 延迟保存 503：版本 POST 未命中；Bearer 敏感内容";
    assert.equal(
      describeProjectBrowserFailure(new Error(unsafe)),
      "浏览器安全回归断言失败，检查终端测试条件及真实页面状态",
    );
    assert.equal(
      describeSaveTimingTimeout("任意身份", 503, "pending", pending),
      "浏览器延迟保存状态异常（已脱敏）",
    );
  });

  void it("保存拒绝完成超时区分操作未结束和错误提示未显示", () => {
    assert.equal(requireSaveTimingBaseline("React", 503, false, false), true);
    assert.throws(
      () => requireSaveTimingBaseline("Vue", 409, false, true),
      (error) =>
        describeProjectBrowserFailure(error) === "Vue 延迟保存 409：CAS 基线状态不符合预期",
    );
    assert.equal(
      describeProjectBrowserFailure(new Error("Vue 延迟保存 409：CAS 基线状态不符合预期；secret")),
      "浏览器安全回归断言失败，检查终端测试条件及真实页面状态",
    );
    const stillBusy = describeSaveTimingTimeout("React", 503, "completed", {
      hits: 1,
      writeAttempts: 1,
      busy: true,
      hasError: false,
    });
    assert.equal(stillBusy, "React 延迟保存 503：保存操作未结束");
    assert.equal(describeProjectBrowserFailure(new Error(stillBusy)), stillBusy);
    const missingError = describeSaveTimingTimeout("Vue", 401, "completed", {
      hits: 1,
      writeAttempts: 1,
      busy: false,
      hasError: false,
    });
    assert.equal(missingError, "Vue 延迟保存 401：页面未显示拒绝错误");
    assert.equal(describeProjectBrowserFailure(new Error(missingError)), missingError);
    assert.equal(
      describeSaveTimingTimeout("React", 409, "completed", null),
      "React 延迟保存 409：无法读取浏览器状态",
    );
    assert.equal(
      describeProjectBrowserFailure(new Error("React 权限模拟工程列表加载未达到预期状态")),
      "浏览器阶段超时：React 权限模拟工程列表加载未达到预期状态",
    );
    assert.equal(
      describeProjectBrowserFailure(new Error("React 权限模拟工程列表加载未达到预期状态；secret")),
      "浏览器安全回归断言失败，检查终端测试条件及真实页面状态",
    );
  });

  void it("保存时序浏览器动作仅操作真实按钮并返回受控计数", () => {
    const originalDocument = globalThis.document;
    const originalState = globalThis.__aduiTestAccessDenial;
    let clicks = 0;
    const details = { open: false };
    const save = {
      disabled: false,
      textContent: "保存至服务端",
      click() {
        clicks += 1;
      },
    };
    const panel = {
      textContent: "CAS 基线：1",
      closest: () => details,
      querySelectorAll(selector) {
        if (selector === "button") return [save];
        if (selector === ".studio-version-help") {
          return [{ textContent: "正在处理工程版本…" }];
        }
        return [];
      },
      querySelector: () => null,
    };
    globalThis.document = {
      querySelector: () => panel,
    };
    globalThis.__aduiTestAccessDenial = {
      save: { hits: 1 },
      writeAttempts: 1,
    };
    try {
      assert.equal(triggerSaveTimingInPage(), true);
      assert.equal(clicks, 2);
      assert.equal(details.open, true);
      assert.deepEqual(saveTimingStateInPage(), {
        hits: 1,
        writeAttempts: 1,
        busy: true,
        disabled: false,
        hasError: false,
        baselineCleared: false,
      });
      save.disabled = true;
      assert.throws(() => triggerSaveTimingInPage(), /保存时序模拟操作按钮不可用/);
      assert.equal(clicks, 2);
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalState === undefined) delete globalThis.__aduiTestAccessDenial;
      else globalThis.__aduiTestAccessDenial = originalState;
    }
  });

  void it("标签页恢复的 401 模拟仅可命中同源身份接口并保持工程写入阻断", async () => {
    let forwarded = 0;
    const runtime = {
      location: {
        origin: "https://127.0.0.1:15173",
        href: "https://127.0.0.1:15173/studio",
      },
      async fetch() {
        forwarded += 1;
        return new Response("{}", { status: 200 });
      },
    };
    installAccessDenialFaultInPage(runtime);
    assert.equal(armAccessDenialInPage("project-1", "identity", 401, runtime), true);
    assert.equal((await runtime.fetch("/api/v1/auth/me")).status, 401);
    assert.equal((await runtime.fetch("/api/v1/projects/project-1")).status, 200);
    assert.equal((await runtime.fetch("/api/v1/projects", { method: "POST" })).status, 403);
    assert.equal(runtime.__aduiTestAccessDenial.hits, 1);
    assert.equal(runtime.__aduiTestAccessDenial.writeAttempts, 1);
    assert.equal(forwarded, 1);
    assert.throws(
      () => armAccessDenialInPage("project-1", "identity", 404, runtime),
      /权限拒绝模拟参数不合法/,
    );
  });

  void it("标签页恢复事件只在页面可见时派发，绝不执行网络写入", () => {
    const previous = globalThis.document;
    const seen = [];
    globalThis.document = {
      visibilityState: "visible",
      dispatchEvent(event) {
        seen.push(event.type);
      },
    };
    try {
      assert.equal(triggerStudioResumeInPage(), true);
      assert.deepEqual(seen, ["visibilitychange"]);
      globalThis.document.visibilityState = "hidden";
      assert.throws(() => triggerStudioResumeInPage(), /标签页恢复测试要求浏览器页面处于可见状态/);
      assert.deepEqual(seen, ["visibilitychange"]);
    } finally {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    }
  });

  void it("隔离浏览器永久拒绝任何工程写请求且不转发到真实 Lab", async () => {
    let forwarded = 0;
    const runtime = {
      location: {
        origin: "https://127.0.0.1:15173",
        href: "https://127.0.0.1:15173/studio",
      },
      async fetch() {
        forwarded += 1;
        return new Response("{}", { status: 200 });
      },
    };
    installAccessDenialFaultInPage(runtime);
    for (const [url, method] of [
      ["/api/v1/projects", "POST"],
      ["/api/v1/projects/project-1/versions", "POST"],
      ["https://remote.invalid/api/v1/projects", "DELETE"],
    ]) {
      const response = await runtime.fetch(url, { method });
      assert.equal(response.status, 403);
    }
    assert.equal(forwarded, 0);
    assert.equal(runtime.__aduiTestAccessDenial.writeAttempts, 3);

    const read = await runtime.fetch("/api/v1/projects?limit=10");
    assert.equal(read.status, 200);
    assert.equal(forwarded, 1);
  });

  void it("模拟拒绝只命中指定的只读路径和 401/403/404，不影响登录请求", async () => {
    let forwarded = 0;
    const runtime = {
      location: {
        origin: "https://127.0.0.1:15173",
        href: "https://127.0.0.1:15173/studio",
      },
      async fetch() {
        forwarded += 1;
        return new Response("{}", { status: 200 });
      },
    };
    installAccessDenialFaultInPage(runtime);
    for (const [scope, status, path] of [
      ["history", 401, "/api/v1/projects/project-1/versions?limit=10"],
      ["list", 403, "/api/v1/projects?limit=10"],
      ["detail", 404, "/api/v1/projects/project-1"],
    ]) {
      assert.equal(armAccessDenialInPage("project-1", scope, status, runtime), true);
      const rejected = await runtime.fetch(path);
      assert.equal(rejected.status, status);
      assert.equal(runtime.__aduiTestAccessDenial.hits, 1);
      assert.equal((await runtime.fetch("/api/v1/auth/me")).status, 200);
      assert.equal((await runtime.fetch("https://remote.invalid/api/v1/projects")).status, 200);
      assert.equal(runtime.__aduiTestAccessDenial.hits, 1);
    }
    assert.equal(forwarded, 6);
    assert.equal(runtime.__aduiTestAccessDenial.writeAttempts, 0);
    assert.throws(
      () => armAccessDenialInPage("project-1", "detail", 201, runtime),
      /权限拒绝模拟参数不合法/,
    );
    assert.throws(() => armAccessDenialInPage("", "list", 401, runtime), /权限拒绝模拟参数不合法/);
    assert.throws(
      () => armAccessDenialInPage("project-1", "write", 403, runtime),
      /权限拒绝模拟参数不合法/,
    );
  });

  void it("已存在十一项授权工程时多页准备不执行任何写入", async () => {
    const origin = "https://127.0.0.1:15173";
    const projects = Array.from({ length: 11 }, (_, i) => ({
      projectId: "existing-" + String(i).padStart(2, "0"),
      headRevision: 1,
    }));
    const runtime = {
      location: { origin },
      document: { cookie: "" },
      fetch: async (path, options) => {
        assert.equal(options.method, "GET");
        if (path === "/api/v1/auth/me") {
          return {
            status: 200,
            json: async () => ({
              authenticated: true,
              principal: { tenantId: "test", subjectId: "engineer" },
            }),
          };
        }
        assert.equal(path, "/api/v1/projects?limit=100");
        return { status: 200, json: async () => projects };
      },
    };
    assert.deepEqual(await prepareAuthorizedMultiPageInPage(origin, runtime), {
      before: 11,
      created: 0,
      after: 11,
    });
  });

  void it("通过正式同源创建接口补齐十一项工程，使用当前会话 CSRF 且只写最小测试文档", async () => {
    const origin = "https://127.0.0.1:15173";
    const token = "scada_csrf_" + "c".repeat(43);
    const projects = [{ projectId: "existing", headRevision: 1 }];
    let writes = 0;
    const runtime = {
      location: { origin },
      document: { cookie: "__Host-adui-scada-csrf=" + token },
      crypto: {
        randomUUID: () => "00000000-0000-4000-8000-" + String(++writes).padStart(12, "0"),
      },
      fetch: async (path, options) => {
        assert.equal(options.credentials, "same-origin");
        assert.equal(options.mode, "same-origin");
        if (path === "/api/v1/auth/me") {
          return {
            status: 200,
            json: async () => ({
              authenticated: true,
              principal: { tenantId: "test", subjectId: "engineer" },
            }),
          };
        }
        if (options.method === "POST") {
          assert.equal(path, "/api/v1/projects");
          assert.equal(options.headers["X-SCADA-CSRF"], token);
          const payload = JSON.parse(options.body);
          assert.deepEqual(Object.keys(payload), ["document"]);
          assert.equal(payload.document.schemaVersion, "0.3.0");
          assert.deepEqual(payload.document.tags, []);
          assert.equal(payload.document.pages.length, 1);
          assert.deepEqual(payload.document.pages[0].nodes, []);
          const created = { projectId: payload.document.projectId, headRevision: 1 };
          projects.push(created);
          return { status: 201, json: async () => created };
        }
        const url = new URL(path, origin);
        const limit = Number(url.searchParams.get("limit"));
        const after = url.searchParams.get("afterProjectId") || "";
        const page = [...projects]
          .filter((item) => item.projectId > after)
          .sort((a, b) => a.projectId.localeCompare(b.projectId))
          .slice(0, limit);
        return { status: 200, json: async () => page };
      },
    };
    assert.deepEqual(await prepareAuthorizedMultiPageInPage(origin, runtime), {
      before: 1,
      created: 10,
      after: 11,
    });
    assert.equal(writes, 10);
    assert.equal(projects.length, 11);
    assert.deepEqual(await prepareAuthorizedMultiPageInPage(origin, runtime), {
      before: 11,
      created: 0,
      after: 11,
    });
    assert.equal(writes, 10);
  });

  void it("多页数据准备拒绝跨 Origin 与缺少 CSRF，拒绝前不写入", async () => {
    const origin = "https://127.0.0.1:15173";
    let writes = 0;
    const runtime = {
      location: { origin },
      document: { cookie: "" },
      fetch: async (path, options) => {
        if (options.method === "POST") writes++;
        if (path === "/api/v1/auth/me") {
          return {
            status: 200,
            json: async () => ({
              authenticated: true,
              principal: { tenantId: "test", subjectId: "engineer" },
            }),
          };
        }
        return { status: 200, json: async () => [{ projectId: "existing", headRevision: 1 }] };
      },
    };
    await assert.rejects(
      prepareAuthorizedMultiPageInPage("https://127.0.0.1:15174", runtime),
      /多页数据准备只允许本机 React Origin/,
    );
    await assert.rejects(
      prepareAuthorizedMultiPageInPage(origin, runtime),
      /多页数据准备 CSRF Cookie 无效/,
    );
    assert.equal(writes, 0);
  });

  void it("冲突后通过真正的只读预览按钮操作，不能调用页面写入函数", () => {
    let clicks = 0;
    const button = {
      textContent: "只读预览最新版本",
      disabled: false,
      click: () => {
        clicks += 1;
      },
    };
    const panel = { querySelectorAll: () => [button] };
    const originalDocument = globalThis.document;
    globalThis.document = {
      querySelector: (selector) => (selector === '[aria-label="服务端工程版本"]' ? panel : null),
    };
    try {
      assert.equal(triggerConflictPreviewInPage(), true);
      assert.equal(clicks, 1);
      button.disabled = true;
      assert.throws(() => triggerConflictPreviewInPage(), /冲突恢复只读预览按钮不可用/);
    } finally {
      globalThis.document = originalDocument;
    }
  });

  void it("预览状态只暴露受控计数、布尔量和修订号", () => {
    const originalDocument = globalThis.document;
    const previousFault = globalThis.__aduiTestAccessDenial;
    const panel = {
      textContent: "服务端最新修订号：3 · CAS 基线：未建立",
      querySelectorAll: (selector) =>
        selector === ".studio-version-help" ? [{ textContent: "已只读核验" }] : [],
      querySelector: (selector) =>
        selector === ".studio-version-comparison"
          ? { querySelector: () => ({ textContent: "服务端版本 #3 · 与当前内容不同" }) }
          : null,
    };
    globalThis.__aduiTestAccessDenial = { writeAttempts: 1, secret: "保密令牌" };
    globalThis.document = { querySelector: () => panel };
    try {
      const state = conflictPreviewStateInPage();
      assert.deepEqual(state, {
        writeAttempts: 1,
        busy: false,
        baselineCleared: true,
        hasError: false,
        comparisonVisible: true,
        previewRevision: 3,
      });
      assert.equal(JSON.stringify(state).includes("保密令牌"), false);
    } finally {
      globalThis.document = originalDocument;
      globalThis.__aduiTestAccessDenial = previousFault;
    }
  });

  void it("不允许生产模式启动交互式本机测试", () => {
    assert.throws(
      () => resolveProjectBrowserLab({ ...sample, NODE_ENV: "production" }),
      /只允许安全的本机非生产环境/,
    );
  });
});
