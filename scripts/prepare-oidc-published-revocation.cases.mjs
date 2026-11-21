import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  createPublishedRevokeFixtureInPage,
  describePublishedRevokeFixtureFailure,
  grantPublishedRevokeFixtureRead,
  parsePublishedRevokeFixtureMode,
  verifyPublishedRevokeFixtureInPage,
} from "./prepare-oidc-published-revocation.mjs";

const PROJECT_ID = "d5b4-revoke-12345678-1234-4234-8234-123456789abc";
const BASELINE = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
const PRINCIPAL = { tenantId: "lab-tenant", subjectId: "lab-engineer" };
const ORIGIN = "https://127.0.0.1:15173";
const CSRF = "scada_csrf_" + "A".repeat(43);
const OWNER_PERMISSIONS = ["project:read", "version:read", "version:append"];

function database(options = {}) {
  const calls = [];
  let inserted = false;
  const grants = (permissions) =>
    permissions.map((permission) => ({ subject_id: PRINCIPAL.subjectId, permission }));
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith("BEGIN") || sql === "ROLLBACK" || sql === "COMMIT") {
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO public.scada_project_grants")) {
        if (options.failInsert) throw new Error("Cookie=SECRET; token=SECRET");
        inserted = true;
        return { rows: [] };
      }
      if (sql.includes("FROM public.scada_projects")) {
        return { rows: [{ head_revision: options.invalidHead ? "2" : "1" }] };
      }
      if (sql.includes("FROM public.scada_project_versions")) {
        return { rows: [{ revision: "1", created_by: PRINCIPAL.subjectId }] };
      }
      if (sql.includes("FROM public.scada_project_audit")) {
        return {
          rows: [{ revision: "1", actor_id: PRINCIPAL.subjectId, action: "version:append" }],
        };
      }
      if (sql.includes("FROM public.scada_project_release_state")) {
        return {
          rows: [
            {
              release_generation: options.released ? "1" : "0",
              released_revision: null,
              released_content_hash: null,
              last_release_event_id: null,
            },
          ],
        };
      }
      if (sql.includes("FROM public.scada_project_release_events")) return { rows: [] };
      if (sql.includes("FROM public.scada_project_grants")) {
        if (params[1] === BASELINE) {
          const existing = [...OWNER_PERMISSIONS, "release:read"];
          if (options.baselineRevoked) existing.pop();
          return { rows: grants(existing) };
        }
        const existing = [...OWNER_PERMISSIONS];
        if (inserted) existing.push("release:read");
        if (options.extraGrant) existing.push("release:publish");
        if (options.missingOwnerGrant) existing.pop();
        return { rows: grants(existing) };
      }
      throw new Error("测试查询不在预设 SQL 白名单内");
    },
  };
  return { client, calls };
}

function browserRuntime() {
  const calls = [];
  const runtime = {
    location: { origin: ORIGIN },
    document: { cookie: "__Host-adui-scada-csrf=" + CSRF },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        status: 201,
        async json() {
          return { projectId: PROJECT_ID, headRevision: 1 };
        },
      };
    },
  };
  return { runtime, calls };
}

void describe("D5b4b 独立真实撤权工程创建与最小授权安全门禁", () => {
  void it("默认仅执行只读预检，创建必须显式双重确认", () => {
    assert.deepEqual(parsePublishedRevokeFixtureMode([]), { apply: false });
    assert.deepEqual(parsePublishedRevokeFixtureMode(["--apply", "--confirm-lab", "adui_scada"]), {
      apply: true,
    });
    for (const args of [
      ["--apply"],
      ["--confirm-lab", "adui_scada"],
      ["--apply", "--confirm-lab", "adui_scada_test"],
      ["--apply", "--confirm-lab", "adui_scada", "--project-id", BASELINE],
      ["--run-revoke", "--confirm-lab", "adui_scada"],
      ["--restore"],
      ["--apply", "--apply", "--confirm-lab", "adui_scada"],
    ]) {
      assert.throws(() => parsePublishedRevokeFixtureMode(args), /专用工程准备参数不合法/);
    }
  });

  void it("未知 SQL 和浏览器异常绝不输出 Cookie 或令牌", () => {
    assert.equal(
      describePublishedRevokeFixtureFailure(new Error("Cookie=SECRET; token=SECRET")),
      "D5b4b 专用工程准备失败，内部细节已脱敏",
    );
    assert.equal(
      describePublishedRevokeFixtureFailure(
        new Error("D5b4b 独立 release:read 授权写入失败，必须人工复核新工程"),
      ),
      "D5b4b 独立 release:read 授权写入失败，必须人工复核新工程",
    );
  });

  void it("只能在同源正式工程 API 创建一份随机前缀空白工程", async () => {
    const { runtime, calls } = browserRuntime();
    const action = runInNewContext("(" + createPublishedRevokeFixtureInPage.toString() + ")");
    assert.equal(await action(ORIGIN, PROJECT_ID, runtime), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/v1/projects");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.credentials, "same-origin");
    assert.equal(calls[0].options.redirect, "error");
    assert.equal(calls[0].options.headers["X-SCADA-CSRF"], CSRF);
    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.document.projectId, PROJECT_ID);
    assert.equal(payload.document.schemaVersion, "0.3.0");
    assert.deepEqual(payload.document.tags, []);
    assert.equal(payload.document.pages[0].nodes.length, 0);
  });

  void it("跨站、旧 D5b1 工程、错误 ID 和缺失或重复 CSRF 时不发工程 POST", async () => {
    const { runtime, calls } = browserRuntime();
    const action = runInNewContext("(" + createPublishedRevokeFixtureInPage.toString() + ")");
    for (const [origin, id, cookie] of [
      ["https://evil.invalid", PROJECT_ID, "__Host-adui-scada-csrf=" + CSRF],
      [ORIGIN, BASELINE, "__Host-adui-scada-csrf=" + CSRF],
      [ORIGIN, "../other", "__Host-adui-scada-csrf=" + CSRF],
      [ORIGIN, PROJECT_ID, ""],
      [ORIGIN, PROJECT_ID, "__Host-adui-scada-csrf=" + CSRF + "; __Host-adui-scada-csrf=" + CSRF],
    ]) {
      runtime.document.cookie = cookie;
      await assert.rejects(action(origin, id, runtime), /新工程创建未通过正式 API 验证/);
    }
    assert.equal(calls.length, 0);
  });

  void it("工程 API 非 201 或返回的工程 ID 与首版修订号不一致必须拒绝", async () => {
    const { runtime, calls } = browserRuntime();
    const action = runInNewContext("(" + createPublishedRevokeFixtureInPage.toString() + ")");
    for (const [status, summary] of [
      [404, { projectId: PROJECT_ID, headRevision: 1 }],
      [201, { projectId: BASELINE, headRevision: 1 }],
      [201, { projectId: PROJECT_ID, headRevision: 2 }],
    ]) {
      runtime.fetch = async (url, options) => {
        calls.push({ url, options });
        return { status, json: async () => summary };
      };
      await assert.rejects(action(ORIGIN, PROJECT_ID, runtime), /新工程创建未通过正式 API 验证/);
    }
    assert.equal(calls.length, 3);
  });

  void it("只在专用工程通过首版审计、未发布和基线授权核验后新增单条 read", async () => {
    const { client, calls } = database();
    assert.equal(await grantPublishedRevokeFixtureRead(client, PROJECT_ID, PRINCIPAL), true);
    assert.equal(calls[0].sql, "BEGIN ISOLATION LEVEL SERIALIZABLE");
    assert.equal(calls.at(-1).sql, "COMMIT");
    const inserts = calls.filter(({ sql }) => sql.startsWith("INSERT INTO"));
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].params, [PRINCIPAL.tenantId, PROJECT_ID, PRINCIPAL.subjectId]);
    assert.match(inserts[0].sql, /'release:read'/);
    assert.equal(calls.filter(({ sql }) => /^(DELETE|UPDATE|DROP|ALTER)/.test(sql)).length, 0);
    const baselineReads = calls.filter(({ params }) => params[1] === BASELINE);
    assert.equal(baselineReads.length, 1);
    assert.match(baselineReads[0].sql, /^SELECT/);
  });

  void it("非法项目或伪造主体在打开事务之前必须拒绝", async () => {
    const { client, calls } = database();
    for (const [id, principal] of [
      [BASELINE, PRINCIPAL],
      ["d5b4-revoke-xxx", PRINCIPAL],
      [PROJECT_ID, { tenantId: "other", subjectId: PRINCIPAL.subjectId }],
      [PROJECT_ID, { tenantId: PRINCIPAL.tenantId, subjectId: "other" }],
    ]) {
      await assert.rejects(
        grantPublishedRevokeFixtureRead(client, id, principal),
        /初始版本、发布状态或 ACL 不符合预期/,
      );
    }
    assert.equal(calls.length, 0);
  });

  void it("新工程版本、发布状态、ACL 多余权限或原 D5b1 撤权必须回滚", async () => {
    for (const options of [
      { invalidHead: true },
      { released: true },
      { extraGrant: true },
      { missingOwnerGrant: true },
      { baselineRevoked: true },
    ]) {
      const { client, calls } = database(options);
      await assert.rejects(
        grantPublishedRevokeFixtureRead(client, PROJECT_ID, PRINCIPAL),
        /授权写入失败/,
      );
      assert.equal(calls.at(-1).sql, "ROLLBACK");
      assert.equal(
        calls.some(({ sql }) => sql.startsWith("INSERT INTO")),
        false,
      );
    }
  });

  void it("授权 INSERT 出错必须回滚，绝不继续运行其他写操作", async () => {
    const { client, calls } = database({ failInsert: true });
    await assert.rejects(
      grantPublishedRevokeFixtureRead(client, PROJECT_ID, PRINCIPAL),
      /授权写入失败/,
    );
    assert.equal(calls.at(-1).sql, "ROLLBACK");
    assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO")).length, 1);
    assert.equal(
      calls.some(({ sql }) => sql === "COMMIT"),
      false,
    );
  });

  void it("已授权项目只读 HTTP 200 必须是无快照的 UNRELEASED 且禁止缓存", async () => {
    const path = "/api/v1/projects/" + PROJECT_ID + "/releases/current";
    const calls = [];
    const runtime = {
      location: { origin: ORIGIN },
      fetch: async (url, options) => {
        calls.push({ url, options });
        return {
          status: 200,
          headers: { get: () => "no-store" },
          json: async () => ({ status: "UNRELEASED", projectId: PROJECT_ID, releaseGeneration: 0 }),
        };
      },
    };
    const action = runInNewContext("(" + verifyPublishedRevokeFixtureInPage.toString() + ")");
    assert.equal(await action(ORIGIN, PROJECT_ID, runtime), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, path);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].options.credentials, "same-origin");
    assert.equal(calls[0].options.cache, "no-store");
  });

  void it("HTTP 404、非未发布、缺少禁缓存或夹带编辑正文一律拒绝", async () => {
    const calls = [];
    const runtime = {
      location: { origin: ORIGIN },
      fetch: async (_url, options) => {
        calls.push(options);
        return { status: 404, headers: { get: () => "no-store" } };
      },
    };
    const action = runInNewContext("(" + verifyPublishedRevokeFixtureInPage.toString() + ")");
    await assert.rejects(action(ORIGIN, PROJECT_ID, runtime), /HTTP 200 验证失败/);
    for (const [header, payload] of [
      ["private", { status: "UNRELEASED", projectId: PROJECT_ID, releaseGeneration: 0 }],
      ["no-store", { status: "RELEASED", projectId: PROJECT_ID, releaseGeneration: 1 }],
      [
        "no-store",
        { status: "UNRELEASED", projectId: PROJECT_ID, releaseGeneration: 0, snapshot: {} },
      ],
    ]) {
      runtime.fetch = async (_url, options) => {
        calls.push(options);
        return { status: 200, headers: { get: () => header }, json: async () => payload };
      };
      await assert.rejects(action(ORIGIN, PROJECT_ID, runtime), /HTTP 200 验证失败/);
    }
    await assert.rejects(action("https://evil.invalid", PROJECT_ID, runtime), /HTTP 200 验证失败/);
    assert.equal(calls.length, 4);
  });
});
