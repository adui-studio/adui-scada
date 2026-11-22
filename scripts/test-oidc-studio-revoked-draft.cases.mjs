import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  classifyD5b5LocalChanges,
  describeD5b5StudioFailure,
  parseD5b5StudioMode,
  readRevokedReleaseInStudioPage,
  requireD5b5Prepared,
  requireD5b5Preserved,
} from "./test-oidc-studio-revoked-draft.mjs";

const ID = "d5b4-revoke-12345678-1234-4234-8234-123456789abc";
const OLD_ID = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
const ORIGIN = "https://127.0.0.1:15173";
const PATH = "/api/v1/projects/" + ID + "/releases/current";

function savedState() {
  return {
    projectId: ID,
    canvas: "<svg>首版</svg>",
    documentHash: "a".repeat(64),
    draftCount: 1,
    draftHash: "c".repeat(64),
    autoSave: false,
    baselineRevision: 1,
  };
}

function editedState() {
  return {
    ...savedState(),
    canvas: "<svg>首版与未保存文本</svg>",
    documentHash: "b".repeat(64),
  };
}

function guards() {
  return {
    before: { paths: ["/api/v1/projects?limit=10"], statuses: [200], blocked: 0 },
    after: { paths: ["/api/v1/projects?limit=10", PATH], statuses: [200, 404], blocked: 0 },
  };
}

function response() {
  return { status: 404, noStore: true, direct: true };
}

void describe("D5b5 真实 Studio 撤权发布读取与本地草稿保护", () => {
  void it("只能使用一份已存在的 D5b4 随机工程 ID，拒绝写入及恢复参数", () => {
    assert.deepEqual(parseD5b5StudioMode(["--project-id", ID]), { projectId: ID });
    for (const args of [
      [],
      ["--project-id", OLD_ID],
      ["--project-id", "d5b4-revoke-example"],
      ["--project-id", "../secret"],
      ["--project-id", ID, "--apply"],
      ["--project-id", ID, "--restore"],
      ["--project-id", ID, "--confirm-lab", "adui_scada"],
      ["--phase", "after", "--project-id", ID],
    ]) {
      assert.throws(() => parseD5b5StudioMode(args), /仅允许现有已撤权专用工程/);
    }
  });

  void it("独立 CDP 页面函数只发一次同源 GET，不读取工程响应正文", async () => {
    const requests = [];
    const runtime = {
      location: { origin: ORIGIN },
      __aduiPublishedReadGuard: { paths: [], statuses: [], blocked: 0 },
      fetch: async (path, options) => {
        requests.push({ path, options });
        return {
          status: 404,
          redirected: false,
          url: ORIGIN + PATH,
          headers: { get: () => "no-store" },
          json: () => {
            throw new Error("不允许读取工程响应正文");
          },
          text: () => {
            throw new Error("不允许读取工程响应正文");
          },
        };
      },
    };
    const page = runInNewContext("(" + readRevokedReleaseInStudioPage.toString() + ")");
    const result = await page(ORIGIN, ID, runtime);
    assert.deepEqual({ ...result }, response());
    assert.deepEqual(structuredClone(requests), [
      {
        path: PATH,
        options: {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
        },
      },
    ]);
  });

  void it("CDP 页面函数拒绝错 Origin、旧工程或没有预装写入阻断门禁", async () => {
    let requests = 0;
    const runtime = {
      location: { origin: ORIGIN },
      __aduiPublishedReadGuard: { paths: [], statuses: [], blocked: 0 },
      fetch: async () => {
        requests += 1;
        return { status: 404 };
      },
    };
    for (const [origin, projectId] of [
      ["https://evil.invalid", ID],
      [ORIGIN, OLD_ID],
      [ORIGIN, "d5b4-revoke-example"],
    ]) {
      await assert.rejects(
        readRevokedReleaseInStudioPage(origin, projectId, runtime),
        /浏览器工程请求不符合零写入约束/,
      );
    }
    delete runtime.__aduiPublishedReadGuard;
    await assert.rejects(
      readRevokedReleaseInStudioPage(ORIGIN, ID, runtime),
      /浏览器工程请求不符合零写入约束/,
    );
    assert.equal(requests, 0);
  });

  void it("响应 HTTP 状态、缓存及重定向只做只读观察，不伪造实际 404", async () => {
    for (const options of [
      { status: 200, cache: "no-store", redirected: false },
      { status: 401, cache: "no-store", redirected: false },
      { status: 403, cache: "no-store", redirected: false },
      { status: 404, cache: "private", redirected: false },
      { status: 404, cache: "no-store", redirected: true },
    ]) {
      const runtime = {
        location: { origin: ORIGIN },
        __aduiPublishedReadGuard: {},
        fetch: async () => ({
          status: options.status,
          redirected: options.redirected,
          url: ORIGIN + PATH,
          headers: { get: () => options.cache },
        }),
      };
      const actual = await readRevokedReleaseInStudioPage(ORIGIN, ID, runtime);
      const { before, after } = guards();
      assert.throws(
        () => requireD5b5Preserved(ID, editedState(), editedState(), actual, before, after),
        /已撤权发布接口未返回真实同源 HTTP 404/,
      );
    }
  });

  void it("必须先真实保存 IndexedDB 草稿并产生可区分的未保存图元", () => {
    assert.equal(requireD5b5Prepared(savedState(), editedState(), ID), true);
    assert.deepEqual(classifyD5b5LocalChanges(savedState(), editedState()), {
      canvasChanged: true,
      documentChanged: true,
      draftCountChanged: false,
      draftHashChanged: false,
      autoSaveChanged: false,
      baselineChanged: false,
      projectChanged: false,
    });
  });

  void it("无草稿、无未保存改动、错误 CAS 或自动保存开启均不允许通过准备", () => {
    const variants = [
      { saved: { ...savedState(), draftCount: 0 }, edited: editedState() },
      { saved: savedState(), edited: savedState() },
      { saved: savedState(), edited: { ...editedState(), baselineRevision: null } },
      { saved: savedState(), edited: { ...editedState(), autoSave: true } },
      { saved: savedState(), edited: { ...editedState(), draftHash: "f".repeat(64) } },
      { saved: savedState(), edited: { ...editedState(), draftCount: 2 } },
      { saved: savedState(), edited: { ...editedState(), projectId: OLD_ID } },
      { saved: { ...savedState(), draftHash: "wrong" }, edited: editedState() },
    ];
    for (const { saved, edited } of variants) {
      assert.throws(
        () => requireD5b5Prepared(saved, edited, ID),
        /Studio 本地草稿与未保存编辑准备失败/,
      );
    }
  });

  void it("真实 404 后画布、JSON、IndexedDB 草稿和 CAS 完全一致时通过", () => {
    const { before, after } = guards();
    assert.equal(
      requireD5b5Preserved(ID, editedState(), editedState(), response(), before, after),
      true,
    );
  });

  void it("画布、工程 JSON、草稿、自动保存与 CAS 的任何漂移都必须拒绝", () => {
    const variants = [
      { canvas: "改变的画布" },
      { documentHash: "e".repeat(64) },
      { draftCount: 2 },
      { draftHash: "d".repeat(64) },
      { autoSave: true },
      { baselineRevision: null },
      { projectId: OLD_ID },
    ];
    for (const changes of variants) {
      const { before, after } = guards();
      assert.throws(
        () =>
          requireD5b5Preserved(
            ID,
            editedState(),
            { ...editedState(), ...changes },
            response(),
            before,
            after,
          ),
        /Studio 画布、IndexedDB 草稿或 CAS 基线发生变化/,
      );
    }
    const { before, after } = guards();
    assert.throws(
      () => requireD5b5Preserved(ID, null, null, response(), before, after),
      /Studio 画布、IndexedDB 草稿或 CAS 基线发生变化/,
    );
  });

  void it("额外 GET、已有请求被篡改、写入受阻或错误工程路径全部拒绝", () => {
    const mutations = [
      ({ after }) => {
        after.paths.push(PATH);
      },
      ({ after }) => {
        after.statuses.push(404);
      },
      ({ after }) => {
        after.statuses[1] = 200;
      },
      ({ after }) => {
        after.paths[1] = "/api/v1/projects/" + OLD_ID + "/releases/current";
      },
      ({ after }) => {
        after.paths[0] = "/api/v1/projects?limit=20";
      },
      ({ before }) => {
        before.blocked = 1;
      },
      ({ after }) => {
        after.blocked = 1;
      },
      ({ after }) => {
        after.statuses[0] = 500;
      },
    ];
    for (const modify of mutations) {
      const guard = guards();
      modify(guard);
      assert.throws(
        () =>
          requireD5b5Preserved(
            ID,
            editedState(),
            editedState(),
            response(),
            guard.before,
            guard.after,
          ),
        /浏览器工程请求不符合零写入约束/,
      );
    }
  });

  void it("伪造的正向 200 或缓存 404 不得让撤权后保护误报成功", () => {
    for (const fake of [
      { status: 200, noStore: true, direct: true },
      { status: 401, noStore: true, direct: true },
      { status: 403, noStore: true, direct: true },
      { status: 404, noStore: false, direct: true },
      { status: 404, noStore: true, direct: false },
    ]) {
      const guard = guards();
      assert.throws(
        () =>
          requireD5b5Preserved(ID, editedState(), editedState(), fake, guard.before, guard.after),
        /已撤权发布接口未返回真实同源 HTTP 404/,
      );
    }
  });

  void it("阶段诊断不得泄露工程正文、Cookie、Token 或任意异常", () => {
    assert.equal(
      describeD5b5StudioFailure(new Error("Cookie=SECRET; Token=SECRET")),
      "D5b5 双框架 Studio 草稿保护专项失败，内部信息已脱敏",
    );
    const staged = new Error("D5b5 浏览器阶段失败");
    staged.stage = "Vue：核验本地不变";
    staged.safeReason = "Cookie=SECRET";
    assert.equal(describeD5b5StudioFailure(staged), "D5b5 Vue：核验本地不变失败：内部异常已脱敏");
    staged.safeReason = "D5b5 Studio 画布、IndexedDB 草稿或 CAS 基线发生变化";
    assert.match(describeD5b5StudioFailure(staged), /IndexedDB 草稿或 CAS 基线发生变化/);
    staged.stage = "未知阶段; Token=SECRET";
    assert.doesNotMatch(describeD5b5StudioFailure(staged), /SECRET/);
  });
});
