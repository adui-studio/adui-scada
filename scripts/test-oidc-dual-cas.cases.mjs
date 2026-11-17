import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendCasVersionInPage,
  armHeldCasResponseInPage,
  heldCasResponsePhaseInPage,
  releaseHeldCasResponseInPage,
  verifyLateCasAudit,
  createCasProjectInPage,
  describeDualOidcFailure,
  grantSecondSubject,
  identityInPage,
  parseDualOidcMode,
  readCasProjectInPage,
  requireCasResult,
  requireDifferentSubjects,
  verifyCasAudit,
} from "./test-oidc-dual-cas.mjs";

const origin = "https://127.0.0.1:15173";
const projectId = "b34-oidc-cas-00000000-0000-4000-8000-000000000001";
const first = { tenantId: "test-lab", subjectId: "test-a" };
const second = { tenantId: "test-lab", subjectId: "test-b" };
const csrf = "scada_csrf_" + "a".repeat(43);

void describe("真实双 Keycloak 主体 CAS 浏览器安全预检", () => {
  void it("默认只读，写入必须使用完整的本机 Lab 双重确认", () => {
    assert.deepEqual(parseDualOidcMode([]), { write: false });
    assert.deepEqual(parseDualOidcMode(["--run-cas", "--confirm-lab", "adui_scada"]), {
      write: true,
    });
    assert.deepEqual(parseDualOidcMode(["--run-late-response", "--confirm-lab", "adui_scada"]), {
      write: true,
      lateResponse: true,
    });
    for (const args of [
      ["--run-cas"],
      ["--run-cas", "--confirm-lab", "adui_scada_test"],
      ["--run-cas", "--confirm-lab", "adui_scada", "--force"],
      ["--run-late-response"],
      ["--run-late-response", "--confirm-lab", "adui_scada_test"],
      ["--run-late-response", "--confirm-lab", "adui_scada", "--force"],
    ]) {
      assert.throws(() => parseDualOidcMode(args), /只支持只读预检或显式确认的本机 CAS 验收/);
    }
  });

  void it("拒绝相同主体、不同租户和非法的可信身份上下文", () => {
    assert.doesNotThrow(() => requireDifferentSubjects(first, second));
    assert.throws(
      () => requireDifferentSubjects(first, first),
      /两次登录映射到同一本地主体，第二个浏览器须使用另一位已预绑定的测试用户/,
    );
    assert.throws(
      () => requireDifferentSubjects(first, { ...second, tenantId: "other" }),
      /两次登录所属租户不一致，请核对第二位测试用户的本机身份预绑定/,
    );
    assert.throws(
      () => requireDifferentSubjects(first, { ...second, subjectId: "不可信" }),
      /真实身份响应格式不正确/,
    );
  });

  void it("只能接受恰好一个 HTTP 201、一个 HTTP 409 与合法成功摘要", () => {
    const hash = "b".repeat(64);
    assert.deepEqual(
      requireCasResult([{ status: 409 }, { status: 201, revision: 2, contentHash: hash }]),
      { winnerIndex: 1, contentHash: hash },
    );
    assert.throws(
      () => requireCasResult([{ status: 201 }, { status: 201 }]),
      /结果不是一次 201 与一次 409/,
    );
    assert.throws(
      () => requireCasResult([{ status: 201, revision: 2, contentHash: "bad" }, { status: 409 }]),
      /事务历史或审计不一致/,
    );
  });

  void it("身份只从同源真实 BFF 读取，不跨 Origin 读取或公开 Cookie", async () => {
    const runtime = {
      location: { origin },
      fetch: async (path, options) => {
        assert.equal(path, "/api/v1/auth/me");
        assert.equal(options.method, "GET");
        assert.equal(options.credentials, "same-origin");
        return { status: 200, json: async () => ({ authenticated: true, principal: first }) };
      },
    };
    assert.deepEqual(await identityInPage(origin, runtime), first);
    assert.equal(await identityInPage("https://127.0.0.1:15174", runtime), null);
  });

  void it("工程准备仅允许专用前缀，缺少 CSRF 或跨 Origin 时零写入", async () => {
    let writes = 0;
    const runtime = {
      location: { origin },
      document: { cookie: "" },
      fetch: async () => {
        writes += 1;
        throw new Error("不可访问");
      },
    };
    await assert.rejects(
      createCasProjectInPage("https://127.0.0.1:15174", projectId, runtime),
      /禁止修改其他工程/,
    );
    await assert.rejects(
      createCasProjectInPage(origin, "production-project", runtime),
      /禁止修改其他工程/,
    );
    await assert.rejects(
      createCasProjectInPage(origin, projectId, runtime),
      /缺少有效 CSRF Cookie/,
    );
    assert.equal(writes, 0);
  });

  void it("专用工程通过正式同源 POST 新建空白 0.3.0 文档且不触碰已有工程", async () => {
    const runtime = {
      location: { origin },
      document: { cookie: "__Host-adui-scada-csrf=" + csrf },
      fetch: async (path, options) => {
        assert.equal(path, "/api/v1/projects");
        assert.equal(options.method, "POST");
        assert.equal(options.credentials, "same-origin");
        assert.equal(options.headers["X-SCADA-CSRF"], csrf);
        const value = JSON.parse(options.body);
        assert.equal(value.document.projectId, projectId);
        assert.equal(value.document.schemaVersion, "0.3.0");
        assert.deepEqual(value.document.tags, []);
        assert.equal(value.document.pages.length, 1);
        assert.deepEqual(value.document.pages[0].nodes, []);
        return { status: 201, json: async () => ({ projectId, headRevision: 1 }) };
      },
    };
    assert.equal(await createCasProjectInPage(origin, projectId, runtime), true);
  });

  void it("两会话只能从同源读取限定测试工程首版，拒绝无效快照", async () => {
    const runtime = {
      location: { origin },
      fetch: async (_, options) => {
        assert.equal(options.method, "GET");
        return {
          status: 200,
          json: async () => ({
            projectId,
            revision: 1,
            contentHash: "a".repeat(64),
            document: {
              schemaVersion: "0.3.0",
              projectId,
              tags: [],
              pages: [{ name: "双主体 CAS 验收", nodes: [] }],
            },
          }),
        };
      },
    };
    assert.deepEqual(await readCasProjectInPage(origin, projectId, 1, runtime), {
      revision: 1,
      contentHash: "a".repeat(64),
    });
    await assert.rejects(
      readCasProjectInPage("https://127.0.0.1:15174", projectId, 1, runtime),
      /首版契约不正确/,
    );
  });

  void it("浏览器 CAS 请求只携带当前会话 CSRF，失败不泄漏响应正文", async () => {
    const runtime = {
      location: { origin },
      document: { cookie: "__Host-adui-scada-csrf=" + csrf },
      fetch: async (path, options) => {
        assert.equal(path, "/api/v1/projects/" + projectId + "/versions");
        assert.equal(options.headers["X-SCADA-CSRF"], csrf);
        assert.equal(JSON.parse(options.body).expectedRevision, 1);
        return { status: 409, json: async () => ({ secret: "不能带回 Node" }) };
      },
    };
    assert.deepEqual(await appendCasVersionInPage(origin, projectId, 1, runtime), { status: 409 });
  });

  void it("仅允许向新建空白工程授权第二主体的三项固定 ACL", async () => {
    const sql = [];
    const client = {
      query: async (statement, values) => {
        sql.push({ statement, values });
        if (statement.includes("FROM public.scada_projects")) {
          return { rows: [{ head_revision: "1" }] };
        }
        if (statement.includes("FROM public.scada_project_versions")) {
          return { rows: [{ created_by: first.subjectId }] };
        }
        if (statement.includes("FROM public.scada_identities")) {
          return { rows: [{ subject_id: first.subjectId }, { subject_id: second.subjectId }] };
        }
        if (statement.includes("FROM public.scada_project_grants")) {
          return {
            rows: ["project:read", "version:read", "version:append"].map((permission) => ({
              subject_id: first.subjectId,
              permission,
            })),
          };
        }
        return { rows: [] };
      },
    };
    await grantSecondSubject(client, projectId, first, second);
    const inserts = sql.filter((row) => row.statement.startsWith("INSERT"));
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].values, [first.tenantId, projectId, second.subjectId]);
    assert.equal(sql.at(-1).statement, "COMMIT");
    await assert.rejects(
      grantSecondSubject(client, "existing-project", first, second),
      /专用工程 ACL 准备失败/,
    );
  });

  void it("真实数据库摘要和操作主体必须与 HTTP CAS 成功者一致", async () => {
    const hash = "e".repeat(64);
    const client = {
      query: async (statement) => {
        if (statement.includes("FROM public.scada_project_versions")) {
          return {
            rows: [
              { revision: "1", created_by: first.subjectId, content_hash: "a".repeat(64) },
              { revision: "2", created_by: second.subjectId, content_hash: hash },
            ],
          };
        }
        if (statement.includes("FROM public.scada_project_audit")) {
          return {
            rows: [
              { revision: "1", actor_id: first.subjectId },
              { revision: "2", actor_id: second.subjectId },
            ],
          };
        }
        return { rows: [{ head_revision: "2" }] };
      },
    };
    await verifyCasAudit(client, projectId, first, second, 1, hash);
    await assert.rejects(
      verifyCasAudit(client, projectId, first, second, 0, hash),
      /事务历史或审计不一致/,
    );
  });

  void it("未知浏览器异常与敏感字段必须统一脱敏", () => {
    const diagnostic = describeDualOidcFailure(new Error("secret_cookie=不允许进入终端"));
    assert.equal(diagnostic, "双身份 OIDC Lab 专项未通过，内部错误详情已脱敏");
    assert.equal(diagnostic.includes("secret_cookie"), false);
    const sameSubject = new Error(
      "两次登录映射到同一本地主体，第二个浏览器须使用另一位已预绑定的测试用户",
    );
    assert.equal(describeDualOidcFailure(sameSubject), sameSubject.message);
    const differentTenant = new Error(
      "两次登录所属租户不一致，请核对第二位测试用户的本机身份预绑定",
    );
    assert.equal(describeDualOidcFailure(differentTenant), differentTenant.message);
  });

  void it("迟到响应模式只向本次随机专用工程发一次正式同源 POST", async () => {
    const calls = [];
    const response = new Response(JSON.stringify({ revision: 2, contentHash: "b".repeat(64) }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
    const runtime = {
      location: { origin },
      document: { cookie: "__Host-adui-scada-csrf=" + csrf },
      fetch: async (path, options) => {
        calls.push({ path, options });
        return response;
      },
    };
    assert.equal(armHeldCasResponseInPage(origin, projectId, runtime), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(heldCasResponsePhaseInPage(origin, projectId, runtime), "received");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/api/v1/projects/" + projectId + "/versions");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.credentials, "same-origin");
    assert.equal(calls[0].options.headers["X-SCADA-CSRF"], csrf);
    assert.equal(JSON.parse(calls[0].options.body).expectedRevision, 1);
    assert.deepEqual(await releaseHeldCasResponseInPage(origin, projectId, runtime), {
      status: 201,
      revision: 2,
      contentHash: "b".repeat(64),
    });
    assert.equal(heldCasResponsePhaseInPage(origin, projectId, runtime), "missing");
    assert.equal(calls.length, 1);
  });

  void it("迟到响应未完成、跨站、重复启动及缺少 CSRF 必须拒绝，不能额外发起写入", async () => {
    let writes = 0;
    let resolveResponse;
    const runtime = {
      location: { origin },
      document: { cookie: "__Host-adui-scada-csrf=" + csrf },
      fetch: () => {
        writes += 1;
        return new Promise((resolve) => {
          resolveResponse = resolve;
        });
      },
    };
    assert.throws(
      () => armHeldCasResponseInPage("https://127.0.0.1:15174", projectId, runtime),
      /请求状态不符合预期/,
    );
    assert.throws(
      () => armHeldCasResponseInPage(origin, "existing-project", runtime),
      /请求状态不符合预期/,
    );
    assert.equal(writes, 0);
    assert.equal(armHeldCasResponseInPage(origin, projectId, runtime), true);
    assert.equal(heldCasResponsePhaseInPage(origin, projectId, runtime), "pending");
    await assert.rejects(
      releaseHeldCasResponseInPage(origin, projectId, runtime),
      /请求状态不符合预期/,
    );
    assert.throws(() => armHeldCasResponseInPage(origin, projectId, runtime), /请求状态不符合预期/);
    assert.equal(writes, 1);
    resolveResponse(
      new Response(JSON.stringify({ revision: 2, contentHash: "a".repeat(64) }), {
        status: 201,
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(heldCasResponsePhaseInPage(origin, projectId, runtime), "received");
    assert.equal((await releaseHeldCasResponseInPage(origin, projectId, runtime)).revision, 2);
    runtime.document.cookie = "";
    assert.throws(
      () => armHeldCasResponseInPage(origin, projectId, runtime),
      /缺少有效 CSRF Cookie/,
    );
    assert.equal(writes, 1);
  });

  void it("真实响应非 201 或签名摘要错误时不得释放为成功，不能泄漏响应正文", async () => {
    for (const response of [
      new Response(JSON.stringify({ secret: "sensitive" }), { status: 409 }),
      new Response(JSON.stringify({ revision: 2, contentHash: "wrong" }), { status: 201 }),
    ]) {
      const runtime = {
        location: { origin },
        document: { cookie: "__Host-adui-scada-csrf=" + csrf },
        fetch: async () => response,
      };
      armHeldCasResponseInPage(origin, projectId, runtime);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(heldCasResponsePhaseInPage(origin, projectId, runtime), "failed");
      await assert.rejects(
        releaseHeldCasResponseInPage(origin, projectId, runtime),
        /请求状态不符合预期/,
      );
    }
  });

  void it("第二主体只能以修订号 2 追加到 3，旧主体修订号 2 返回 409", async () => {
    let writes = 0;
    const runtime = {
      location: { origin },
      document: { cookie: "__Host-adui-scada-csrf=" + csrf },
      fetch: async (_, options) => {
        writes += 1;
        assert.equal(JSON.parse(options.body).expectedRevision, 2);
        return { status: 409 };
      },
    };
    assert.deepEqual(await appendCasVersionInPage(origin, projectId, 2, runtime), { status: 409 });
    await assert.rejects(
      appendCasVersionInPage(origin, projectId, 3, runtime),
      /事务历史或审计不一致/,
    );
    await assert.rejects(
      appendCasVersionInPage(origin, "existing-project", 2, runtime),
      /事务历史或审计不一致/,
    );
    assert.equal(writes, 1);
  });

  void it("迟到成功回包与第三版必须逐项核对真实版本和审计，拒绝额外版本", async () => {
    const hash2 = "b".repeat(64);
    const hash3 = "c".repeat(64);
    const versions = [
      { revision: "1", created_by: first.subjectId, content_hash: "a".repeat(64) },
      { revision: "2", created_by: first.subjectId, content_hash: hash2 },
      { revision: "3", created_by: second.subjectId, content_hash: hash3 },
    ];
    const audits = [
      { revision: "1", actor_id: first.subjectId },
      { revision: "2", actor_id: first.subjectId },
      { revision: "3", actor_id: second.subjectId },
    ];
    const client = {
      query: async (sql, params) => {
        assert.deepEqual(params, [first.tenantId, projectId]);
        if (sql.includes("FROM public.scada_project_versions")) return { rows: versions };
        if (sql.includes("FROM public.scada_project_audit")) return { rows: audits };
        return { rows: [{ head_revision: "3" }] };
      },
    };
    await verifyLateCasAudit(client, projectId, first, second, hash2, hash3);
    versions.push({ revision: "4", created_by: first.subjectId, content_hash: hash3 });
    await assert.rejects(
      verifyLateCasAudit(client, projectId, first, second, hash2, hash3),
      /版本或审计不一致/,
    );
    versions.pop();
    audits[2].actor_id = first.subjectId;
    await assert.rejects(
      verifyLateCasAudit(client, projectId, first, second, hash2, hash3),
      /版本或审计不一致/,
    );
  });
});
