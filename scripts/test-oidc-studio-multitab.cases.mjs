import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  armStudioMultiTabWriteInPage,
  createMultitabProjectInPage,
  describeStudioMultiTabFailure,
  installStudioMultiTabWriteGuardInPage,
  parseStudioMultiTabMode,
  studioMultiTabWriteStateInPage,
  verifySameSubjectMultitabAudit,
} from "./test-oidc-studio-multitab.mjs";

const origin = "https://127.0.0.1:15173";
const projectId = "b34-oidc-multitab-00000000-0000-4000-8000-000000000001";
const csrf = "scada_csrf_" + "a".repeat(43);
const hash2 = "b".repeat(64);
const hash3 = "c".repeat(64);

function createRuntime(responseFactory) {
  const calls = [];
  const runtime = {
    location: { origin, href: origin + "/" },
    document: { cookie: "__Host-adui-scada-csrf=" + csrf },
    fetch: async (input, init) => {
      calls.push({ input, init });
      return responseFactory
        ? responseFactory(input, init)
        : new Response(JSON.stringify({ revision: 2, contentHash: hash2 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
    },
  };
  return { runtime, calls };
}

function writeRequest(expectedRevision = 1, id = projectId, header = csrf) {
  return {
    method: "POST",
    credentials: "same-origin",
    mode: "same-origin",
    headers: { "X-SCADA-CSRF": header },
    body: JSON.stringify({
      expectedRevision,
      document: { projectId: id, schemaVersion: "0.3.0" },
    }),
  };
}

void describe("同源多标签页 Studio CAS 写入保护", () => {
  void it("真实写入模式必须显式确认唯一的本机隔离数据库", () => {
    assert.equal(
      parseStudioMultiTabMode(["--run-studio-multitab", "--confirm-lab", "adui_scada"]),
      true,
    );
    for (const args of [
      [],
      ["--run-studio-multitab"],
      ["--run-studio-multitab", "--confirm-lab", "adui_scada_test"],
      ["--run-studio-multitab", "--confirm-lab", "adui_scada", "--force"],
      ["--run-studio-multitab", "--confirm-lab", "adui_scada", "--cleanup"],
    ]) {
      assert.throws(
        () => parseStudioMultiTabMode(args),
        /同源多标签页专项必须显式确认本机隔离 Lab/,
      );
    }
  });

  void it("CDP 独立页面函数不得引用 Node 模块中的工程正则常量", () => {
    assert.equal(createMultitabProjectInPage.toString().includes("PROJECT_PATTERN"), false);
    assert.equal(armStudioMultiTabWriteInPage.toString().includes("PROJECT_PATTERN"), false);
  });

  void it("未知浏览器异常不回显凭据、工程正文或原始堆栈", () => {
    const message = describeStudioMultiTabFailure(
      new Error("token=secret; project=document; stack=private"),
    );
    assert.equal(message, "同源多标签页 CAS 专项未通过，内部错误详情已脱敏");
    assert.equal(message.includes("secret"), false);
    assert.equal(message.includes("document"), false);
  });

  void it("只在同源、受控随机工程 ID 和唯一 CSRF Cookie 下创建首版", async () => {
    const { runtime, calls } = createRuntime(
      async () =>
        new Response(JSON.stringify({ projectId, headRevision: 1 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    assert.deepEqual(await createMultitabProjectInPage(origin, projectId, runtime), {
      created: true,
      headRevision: 1,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "/api/v1/projects");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.equal(calls[0].init.mode, "same-origin");
    assert.equal(calls[0].init.headers["X-SCADA-CSRF"], csrf);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.document.projectId, projectId);
    assert.equal(body.document.schemaVersion, "0.3.0");
    assert.equal(body.document.pages[0].name, "同源多标签页 CAS 验收");
    assert.deepEqual(body.document.tags, []);
  });

  void it("拒绝跨 Origin、非随机工程 ID 和无效 CSRF 且拒绝前零写入", async () => {
    for (const [targetOrigin, targetId, cookie] of [
      ["https://127.0.0.1:15174", projectId, "__Host-adui-scada-csrf=" + csrf],
      [origin, "production-project", "__Host-adui-scada-csrf=" + csrf],
      [origin, projectId, ""],
      [origin, projectId, "__Host-adui-scada-csrf=" + csrf + "; __Host-adui-scada-csrf=" + csrf],
    ]) {
      const { runtime, calls } = createRuntime();
      runtime.document.cookie = cookie;
      await assert.rejects(
        createMultitabProjectInPage(targetOrigin, targetId, runtime),
        /同源多标签页工程创建失败/,
      );
      assert.equal(calls.length, 0);
    }
  });

  void it("创建接口非 201 或返回的工程水位不为 1 时拒绝", async () => {
    for (const response of [
      new Response("{}", { status: 403 }),
      new Response(JSON.stringify({ projectId, headRevision: 2 }), { status: 201 }),
      new Response(JSON.stringify({ projectId: "another", headRevision: 1 }), { status: 201 }),
    ]) {
      const { runtime } = createRuntime(async () => response.clone());
      await assert.rejects(
        createMultitabProjectInPage(origin, projectId, runtime),
        /同源多标签页工程创建失败/,
      );
    }
  });

  void it("安装写入保护时必须匹配当前 HTTPS Origin 且不得重复安装", () => {
    const { runtime } = createRuntime();
    assert.equal(installStudioMultiTabWriteGuardInPage(origin, runtime), true);
    assert.throws(
      () => installStudioMultiTabWriteGuardInPage(origin, runtime),
      /同源多标签页写入保护配置不合法/,
    );
    const { runtime: other } = createRuntime();
    other.location.origin = "https://127.0.0.1:15174";
    assert.throws(
      () => installStudioMultiTabWriteGuardInPage(origin, other),
      /同源多标签页写入保护配置不合法/,
    );
  });

  void it("工程 GET/HEAD 正常透传，且不计入写入尝试", async () => {
    const { runtime, calls } = createRuntime();
    installStudioMultiTabWriteGuardInPage(origin, runtime);
    assert.equal((await runtime.fetch("/api/v1/projects/" + projectId)).status, 201);
    assert.equal(
      (await runtime.fetch("/api/v1/projects/" + projectId, { method: "HEAD" })).status,
      201,
    );
    const state = studioMultiTabWriteStateInPage(runtime);
    assert.equal(calls.length, 2);
    assert.equal(state.writeAttempts, 0);
    assert.equal(state.acceptedWrites, 0);
    assert.equal(state.rejectedWrites, 0);
  });

  void it("未显式 arm 时工程 POST 在浏览器本地拒绝，不触达真实 fetch", async () => {
    const { runtime, calls } = createRuntime();
    installStudioMultiTabWriteGuardInPage(origin, runtime);
    assert.equal(
      (await runtime.fetch("/api/v1/projects/" + projectId + "/versions", writeRequest())).status,
      403,
    );
    assert.equal(calls.length, 0);
    const state = studioMultiTabWriteStateInPage(runtime);
    assert.equal(state.writeAttempts, 1);
    assert.equal(state.acceptedWrites, 0);
    assert.equal(state.rejectedWrites, 1);
  });

  void it("只允许当前工程 CAS=1 的一次真实 201 并核对摘要", async () => {
    const { runtime, calls } = createRuntime();
    installStudioMultiTabWriteGuardInPage(origin, runtime);
    assert.equal(armStudioMultiTabWriteInPage(origin, projectId, 1, runtime), true);
    const response = await runtime.fetch(
      "/api/v1/projects/" + projectId + "/versions",
      writeRequest(),
    );
    assert.equal(response.status, 201);
    assert.equal((await response.json()).revision, 2);
    assert.equal(calls.length, 1);
    const state = studioMultiTabWriteStateInPage(runtime);
    assert.equal(state.phase, "committed");
    assert.equal(state.resultRevision, 2);
    assert.equal(state.resultHash, hash2);
    assert.equal(state.hashValid, true);
    assert.equal(state.writeAttempts, 1);
    assert.equal(state.acceptedWrites, 1);
    assert.equal(state.rejectedWrites, 0);
  });

  void it("已提交一次后第二次版本 POST 必须被拒绝且不触达真实 fetch", async () => {
    const { runtime, calls } = createRuntime();
    installStudioMultiTabWriteGuardInPage(origin, runtime);
    armStudioMultiTabWriteInPage(origin, projectId, 1, runtime);
    await runtime.fetch("/api/v1/projects/" + projectId + "/versions", writeRequest());
    assert.equal(
      (await runtime.fetch("/api/v1/projects/" + projectId + "/versions", writeRequest())).status,
      403,
    );
    assert.equal(calls.length, 1);
    const state = studioMultiTabWriteStateInPage(runtime);
    assert.equal(state.writeAttempts, 2);
    assert.equal(state.acceptedWrites, 1);
    assert.equal(state.rejectedWrites, 1);
  });

  void it("错误工程、错误修订号、错误 CSRF、跨 Origin 与工程创建 POST 均拒绝", async () => {
    const { runtime, calls } = createRuntime();
    installStudioMultiTabWriteGuardInPage(origin, runtime);
    armStudioMultiTabWriteInPage(origin, projectId, 1, runtime);
    const requests = [
      ["/api/v1/projects/another/versions", writeRequest()],
      ["/api/v1/projects/" + projectId + "/versions", writeRequest(2)],
      ["/api/v1/projects/" + projectId + "/versions", writeRequest(1, projectId, "bad")],
      ["https://127.0.0.1:15174/api/v1/projects/" + projectId + "/versions", writeRequest()],
      ["/api/v1/projects", writeRequest()],
      ["/api/v1/projects/" + projectId + "/versions", { ...writeRequest(), method: "DELETE" }],
    ];
    for (const [url, init] of requests) {
      assert.equal((await runtime.fetch(url, init)).status, 403);
    }
    assert.equal(calls.length, 0);
    const state = studioMultiTabWriteStateInPage(runtime);
    assert.equal(state.writeAttempts, requests.length);
    assert.equal(state.acceptedWrites, 0);
    assert.equal(state.rejectedWrites, requests.length);
  });

  void it("缺失或重复 CSRF Cookie 时不把写请求交付服务器", async () => {
    for (const cookie of [
      "",
      "__Host-adui-scada-csrf=bad",
      "__Host-adui-scada-csrf=" + csrf + "; __Host-adui-scada-csrf=" + csrf,
    ]) {
      const { runtime, calls } = createRuntime();
      runtime.document.cookie = cookie;
      installStudioMultiTabWriteGuardInPage(origin, runtime);
      armStudioMultiTabWriteInPage(origin, projectId, 1, runtime);
      assert.equal(
        (await runtime.fetch("/api/v1/projects/" + projectId + "/versions", writeRequest())).status,
        403,
      );
      assert.equal(calls.length, 0);
    }
  });

  void it("arm 只接受本机工程和当前支持的 CAS 水位", () => {
    const { runtime } = createRuntime();
    installStudioMultiTabWriteGuardInPage(origin, runtime);
    for (const [targetOrigin, targetId, revision] of [
      ["https://127.0.0.1:15174", projectId, 1],
      [origin, "production-project", 1],
      [origin, projectId, 0],
      [origin, projectId, 3],
    ]) {
      assert.throws(
        () => armStudioMultiTabWriteInPage(targetOrigin, targetId, revision, runtime),
        /同源多标签页写入保护配置不合法/,
      );
    }
    assert.equal(armStudioMultiTabWriteInPage(origin, projectId, 1, runtime), true);
    assert.throws(
      () => armStudioMultiTabWriteInPage(origin, projectId, 2, runtime),
      /同源多标签页写入保护配置不合法/,
    );
  });

  void it("真实服务端返回 409 时不能误报写入成功", async () => {
    const { runtime, calls } = createRuntime(async () => new Response("{}", { status: 409 }));
    installStudioMultiTabWriteGuardInPage(origin, runtime);
    armStudioMultiTabWriteInPage(origin, projectId, 1, runtime);
    const response = await runtime.fetch(
      "/api/v1/projects/" + projectId + "/versions",
      writeRequest(),
    );
    assert.equal(response.status, 409);
    assert.equal(calls.length, 1);
    const state = studioMultiTabWriteStateInPage(runtime);
    assert.equal(state.phase, "failed");
    assert.equal(state.acceptedWrites, 0);
    assert.equal(state.hashValid, false);
  });

  void it("错误修订号或非法摘要的 201 不能误报写入成功", async () => {
    for (const result of [
      { revision: 3, contentHash: hash2 },
      { revision: 2, contentHash: "bad" },
    ]) {
      const { runtime } = createRuntime(
        async () =>
          new Response(JSON.stringify(result), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
      );
      installStudioMultiTabWriteGuardInPage(origin, runtime);
      armStudioMultiTabWriteInPage(origin, projectId, 1, runtime);
      const response = await runtime.fetch(
        "/api/v1/projects/" + projectId + "/versions",
        writeRequest(),
      );
      assert.equal(response.status, 201);
      const state = studioMultiTabWriteStateInPage(runtime);
      assert.equal(state.phase, "failed");
      assert.equal(state.acceptedWrites, 0);
      assert.equal(state.hashValid, false);
    }
  });

  void it("写入状态只返回受控计数、修订号和摘要，不返回工程 ID 或 Cookie", () => {
    const { runtime } = createRuntime();
    installStudioMultiTabWriteGuardInPage(origin, runtime);
    armStudioMultiTabWriteInPage(origin, projectId, 1, runtime);
    const state = studioMultiTabWriteStateInPage(runtime);
    assert.deepEqual(state, {
      writeAttempts: 0,
      acceptedWrites: 0,
      rejectedWrites: 0,
      phase: "armed",
      resultRevision: null,
      resultHash: null,
      hashValid: false,
      allowedUsed: false,
    });
    const serialized = JSON.stringify(state);
    assert.equal(serialized.includes(projectId), false);
    assert.equal(serialized.includes(csrf), false);
  });

  void it("同一主体的三版数据库版本和审计必须逐版一致", async () => {
    const principal = { tenantId: "tenant-a", subjectId: "user-a" };
    const client = {
      query: async (_sql, values) => {
        assert.deepEqual(values, [principal.tenantId, projectId]);
        if (_sql.includes("scada_project_versions")) {
          return {
            rows: [
              { revision: 1, created_by: "user-a", content_hash: "a".repeat(64) },
              { revision: 2, created_by: "user-a", content_hash: hash2 },
              { revision: 3, created_by: "user-a", content_hash: hash3 },
            ],
          };
        }
        if (_sql.includes("scada_project_audit")) {
          return {
            rows: [
              { revision: 1, actor_id: "user-a" },
              { revision: 2, actor_id: "user-a" },
              { revision: 3, actor_id: "user-a" },
            ],
          };
        }
        return { rows: [{ head_revision: 3 }] };
      },
    };
    assert.deepEqual(
      await verifySameSubjectMultitabAudit(client, projectId, principal, hash2, hash3),
      { versionCount: 3, auditCount: 3, headRevision: 3 },
    );
  });

  void it("数据库出现额外版本、不同操作者或错误摘要时拒绝结案", async () => {
    const principal = { tenantId: "tenant-a", subjectId: "user-a" };
    const client = {
      query: async (sql) => {
        if (sql.includes("scada_project_versions")) {
          return {
            rows: [
              { revision: 1, created_by: "user-a", content_hash: "a".repeat(64) },
              { revision: 2, created_by: "user-a", content_hash: hash2 },
              { revision: 3, created_by: "user-b", content_hash: hash3 },
              { revision: 4, created_by: "user-a", content_hash: "d".repeat(64) },
            ],
          };
        }
        if (sql.includes("scada_project_audit")) {
          return {
            rows: [
              { revision: 1, actor_id: "user-a" },
              { revision: 2, actor_id: "user-a" },
              { revision: 3, actor_id: "user-b" },
              { revision: 4, actor_id: "user-a" },
            ],
          };
        }
        return { rows: [{ head_revision: 4 }] };
      },
    };
    await assert.rejects(
      verifySameSubjectMultitabAudit(client, projectId, principal, hash2, hash3),
      /同源多标签页数据库版本与审计不一致/,
    );
  });
});
