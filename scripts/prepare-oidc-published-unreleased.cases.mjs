import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  createPublishedFixtureInPage,
  describePublishedFixtureError,
  grantPublishedFixtureRead,
  parsePublishedFixtureMode,
  preflightPublishedFixture,
  resolvePublishedFixtureTarget,
  verifyPublishedFixtureInPage,
} from "./prepare-oidc-published-unreleased.mjs";

const PROJECT_ID = "d5b-unreleased-12345678-1234-4234-8234-123456789abc";
const PRINCIPAL = { tenantId: "lab-tenant", subjectId: "lab-engineer" };
const ORIGIN = "https://127.0.0.1:15173";
const CSRF = "scada_csrf_" + "A".repeat(43);

function database({ invalidHead = false, released = false, failInsert = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM public.scada_projects") && sql.includes("FOR UPDATE")) {
        return { rows: [{ head_revision: invalidHead ? "2" : "1" }] };
      }
      if (sql.includes("FROM public.scada_project_versions")) {
        return { rows: [{ revision: "1", created_by: "lab-engineer" }] };
      }
      if (sql.includes("FROM public.scada_project_audit")) {
        return { rows: [{ revision: "1", actor_id: "lab-engineer", action: "version:append" }] };
      }
      if (sql.includes("FROM public.scada_project_release_state")) {
        return {
          rows: [
            {
              release_generation: released ? "1" : "0",
              released_revision: null,
              released_content_hash: null,
              last_release_event_id: null,
            },
          ],
        };
      }
      if (sql.includes("FROM public.scada_project_release_events")) return { rows: [] };
      if (sql.includes("FROM public.scada_project_grants") && sql.includes("SELECT subject_id")) {
        return {
          rows: ["project:read", "version:read", "version:append"].map((permission) => ({
            subject_id: "lab-engineer",
            permission,
          })),
        };
      }
      if (sql.includes("INSERT INTO public.scada_project_grants")) {
        if (failInsert) throw new Error("数据库内部错误含敏感信息");
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM public.scada_project_grants") && sql.includes("SELECT permission")) {
        return {
          rows: ["project:read", "version:read", "version:append", "release:read"].map(
            (permission) => ({ permission }),
          ),
        };
      }
      return { rows: [] };
    },
  };
  return { client, calls };
}

void describe("D5b1 本机专用未发布测试夹具安全门禁", () => {
  void it("默认只读，写入必须精确确认数据库；未知及额外参数拒绝", () => {
    assert.deepEqual(parsePublishedFixtureMode([]), { apply: false });
    assert.deepEqual(parsePublishedFixtureMode(["--apply", "--confirm-lab", "adui_scada"]), {
      apply: true,
    });
    for (const args of [
      ["--apply"],
      ["--confirm-lab", "adui_scada"],
      ["--apply", "--confirm-lab", "adui_scada_test"],
      ["--apply", "--confirm-lab", "adui_scada", "--release"],
      ["--delete", "all"],
    ]) {
      assert.throws(() => parsePublishedFixtureMode(args), /夹具参数不合法/);
    }
  });

  void it("不可信环境必须在连接数据库前拒绝", () => {
    assert.throws(
      () => resolvePublishedFixtureTarget({ NODE_ENV: "production" }),
      /只能访问已确认的本机可信 Lab/,
    );
  });

  void it("只读预检必须确认发布迁移、零未解决迁移、身份和零夹具", async () => {
    const calls = [];
    const client = {
      async query(sql) {
        calls.push(sql);
        if (sql.includes('public."_prisma_migrations"') && sql.includes("ANY(")) {
          return {
            rows: [
              { migration_name: "20261118000000_release_state_and_events" },
              { migration_name: "20261119000000_release_state_event_integrity" },
              { migration_name: "20261119180000_release_read_permission" },
            ],
          };
        }
        if (sql.includes('public."_prisma_migrations"')) {
          return { rows: [{ count: 0 }] };
        }
        if (sql.includes("FROM public.scada_projects")) return { rows: [] };
        return { rows: [{ "?column?": 1 }] };
      },
    };
    assert.equal(
      await preflightPublishedFixture(client, {
        issuer: "https://127.0.0.1:18443/realms/adui-scada",
      }),
      true,
    );
    assert.equal(calls.filter((sql) => /INSERT|UPDATE|DELETE|DROP/i.test(sql)).length, 0);
  });

  void it("正式工程 API 只能在同源写入随机前缀工程并发送 CSRF", async () => {
    const requests = [];
    const runtime = {
      location: { origin: ORIGIN },
      document: { cookie: "__Host-adui-scada-csrf=" + CSRF },
      async fetch(path, options) {
        requests.push({ path, options });
        return {
          status: 201,
          async json() {
            return { projectId: PROJECT_ID, headRevision: 1 };
          },
        };
      },
    };
    const isolated = runInNewContext("(" + createPublishedFixtureInPage.toString() + ")");
    assert.equal(await isolated(ORIGIN, PROJECT_ID, runtime), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/api/v1/projects");
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[0].options.headers["X-SCADA-CSRF"], CSRF);
    const body = JSON.parse(requests[0].options.body);
    assert.deepEqual(Object.keys(body), ["document"]);
    assert.equal(body.document.projectId, PROJECT_ID);
    assert.deepEqual(body.document.tags, []);
    assert.deepEqual(body.document.pages[0].nodes, []);
    runtime.location.origin = "https://evil.invalid";
    await assert.rejects(isolated(ORIGIN, PROJECT_ID, runtime), /工程创建被拒绝/);
    runtime.location.origin = ORIGIN;
    await assert.rejects(isolated(ORIGIN, "../existing", runtime), /工程创建被拒绝/);
    assert.equal(requests.length, 1);
  });

  void it("新建专用工程状态完整时只增加一项 release:read", async () => {
    const { client, calls } = database();
    assert.equal(await grantPublishedFixtureRead(client, PROJECT_ID, PRINCIPAL), true);
    const inserts = calls.filter(({ sql }) => sql.includes("INSERT"));
    assert.equal(inserts.length, 1);
    assert.match(inserts[0].sql, /scada_project_grants/);
    assert.match(inserts[0].sql, /release:read/);
    assert.deepEqual(inserts[0].params, ["lab-tenant", PROJECT_ID, "lab-engineer"]);
    assert.equal(calls[0].sql, "BEGIN ISOLATION LEVEL SERIALIZABLE");
    assert.equal(calls.at(-1).sql, "COMMIT");
    assert.equal(
      calls.some(({ sql }) => /^\s*(?:DROP|DELETE|UPDATE|PUBLISH)\b/i.test(sql)),
      false,
    );
  });

  void it("既有工程历史异常或已发布状态拒绝写入并 ROLLBACK", async () => {
    for (const option of [{ invalidHead: true }, { released: true }]) {
      const { client, calls } = database(option);
      await assert.rejects(
        () => grantPublishedFixtureRead(client, PROJECT_ID, PRINCIPAL),
        /ACL 写入失败/,
      );
      assert.equal(
        calls.some(({ sql }) => sql.includes("INSERT")),
        false,
      );
      assert.equal(calls.at(-1).sql, "ROLLBACK");
    }
  });

  void it("数据库插入失败必须回滚且不暴露 SQL 内部异常", async () => {
    const { client, calls } = database({ failInsert: true });
    await assert.rejects(
      () => grantPublishedFixtureRead(client, PROJECT_ID, PRINCIPAL),
      /ACL 写入失败/,
    );
    assert.equal(calls.at(-1).sql, "ROLLBACK");
    assert.equal(
      describePublishedFixtureError(new Error("数据库内部错误含敏感信息")),
      "D5b1 夹具准备失败，详细错误已脱敏",
    );
  });

  void it("非法工程 ID 和伪造主体不能进入 ACL 事务", async () => {
    const { client, calls } = database();
    await assert.rejects(
      () => grantPublishedFixtureRead(client, "existing-project", PRINCIPAL),
      /初始版本或 ACL 状态不一致/,
    );
    await assert.rejects(
      () => grantPublishedFixtureRead(client, PROJECT_ID, { ...PRINCIPAL, subjectId: "admin" }),
      /初始版本或 ACL 状态不一致/,
    );
    assert.equal(calls.length, 0);
  });

  void it("真实只读发布 GET 只接受 HTTP 200 UNRELEASED 代次零", async () => {
    const urls = [];
    const runtime = {
      location: { origin: ORIGIN },
      async fetch(url, options) {
        urls.push({ url, options });
        return {
          status: 200,
          async json() {
            return { status: "UNRELEASED", projectId: PROJECT_ID, releaseGeneration: 0 };
          },
        };
      },
    };
    const isolated = runInNewContext("(" + verifyPublishedFixtureInPage.toString() + ")");
    assert.equal(await isolated(ORIGIN, PROJECT_ID, runtime), true);
    assert.equal(urls[0].options.method, "GET");
    assert.equal(urls[0].options.cache, "no-store");
    assert.equal(urls[0].url, "/api/v1/projects/" + PROJECT_ID + "/releases/current");
    runtime.fetch = async () => ({ status: 404 });
    await assert.rejects(isolated(ORIGIN, PROJECT_ID, runtime), /只读确认失败/);
    assert.equal(urls.length, 1);
  });
});
