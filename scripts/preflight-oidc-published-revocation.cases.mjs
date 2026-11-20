import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPublishedRevocationPreflightRows,
  describePublishedRevocationPreflightFailure,
  inspectPublishedRevocationReadiness,
  parsePublishedRevocationPreflightArgs,
  resolvePublishedRevocationPreflightTarget,
} from "./preflight-oidc-published-revocation.mjs";

const BASELINE = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
const PERMISSIONS = [
  "project:read",
  "version:read",
  "version:append",
  "release:read",
];
const MIGRATIONS = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];

function validRows() {
  return {
    database: [{ database_name: "adui_scada", database_user: "adui_scada" }],
    migrations: MIGRATIONS.map((migration_name) => ({ migration_name })),
    unresolved: [{ count: 0 }],
    identity: [{ "?column?": 1 }],
    externalIdentity: [{ "?column?": 1 }],
    project: [{ head_revision: "1" }],
    versions: [{ revision: "1", created_by: "lab-engineer" }],
    audit: [{ revision: "1", actor_id: "lab-engineer", action: "version:append" }],
    state: [{
      release_generation: "0",
      released_revision: null,
      released_content_hash: null,
      last_release_event_id: null,
    }],
    events: [{ count: 0 }],
    grants: PERMISSIONS.map((permission) => ({
      subject_id: "lab-engineer",
      permission,
    })),
    dedicated: [{ count: 0 }],
  };
}

function database({ alteredRows, failAt } = {}) {
  const calls = [];
  const rows = validRows();
  alteredRows?.(rows);
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("BEGIN") || sql === "ROLLBACK") return { rows: [] };
      if (failAt && sql.includes(failAt)) throw new Error("密钥不应出现在终端");
      const key = sql.includes("current_database()")
        ? "database"
        : sql.includes("ANY($1::text[])")
          ? "migrations"
          : sql.includes("finished_at IS NULL")
            ? "unresolved"
            : sql.includes("scada_external_identities")
              ? "externalIdentity"
              : sql.includes("scada_identities")
                ? "identity"
                : sql.includes("scada_project_versions")
                  ? "versions"
                  : sql.includes("scada_project_audit")
                    ? "audit"
                    : sql.includes("scada_project_release_state")
                      ? "state"
                      : sql.includes("scada_project_release_events")
                        ? "events"
                        : sql.includes("scada_project_grants")
                          ? "grants"
                          : sql.includes("project_id LIKE")
                            ? "dedicated"
                            : "project";
      return { rows: rows[key] };
    },
  };
  return { client, calls };
}

void describe("D5b4a 发布读取真实 ACL 撤销前只读安全预检", () => {
  void it("只允许无参只读模式，撤权、授权和额外参数全部拒绝", () => {
    assert.deepEqual(parsePublishedRevocationPreflightArgs([]), { mode: "readonly" });
    for (const args of [
      ["--apply"],
      ["--run-revoke", "--confirm-lab", "adui_scada"],
      ["--project-id", BASELINE],
      ["--restore"],
      ["--delete", "all"],
    ]) {
      assert.throws(
        () => parsePublishedRevocationPreflightArgs(args),
        /只读预检不接受任何写入或额外参数/,
      );
    }
  });

  void it("非生产可信目标缺失时必须在数据库连接前拒绝", () => {
    assert.throws(
      () => resolvePublishedRevocationPreflightTarget({ NODE_ENV: "production" }),
      /只能连接可信本机 OIDC Lab/,
    );
    assert.throws(
      () => resolvePublishedRevocationPreflightTarget({}),
      /只能连接可信本机 OIDC Lab/,
    );
  });

  void it("真实发布迁移、原工程首版与独立 read 权限完整时允许预检", () => {
    assert.equal(assertPublishedRevocationPreflightRows(validRows()), true);
  });

  void it("数据库目标、缺少发布迁移或未解决迁移都必须拒绝", () => {
    for (const modify of [
      (rows) => { rows.database[0].database_name = "adui_scada_test"; },
      (rows) => { rows.database[0].database_user = "other"; },
      (rows) => { rows.migrations.pop(); },
      (rows) => { rows.unresolved[0].count = 1; },
    ]) {
      const rows = validRows();
      modify(rows);
      assert.throws(
        () => assertPublishedRevocationPreflightRows(rows),
        /目标数据库或发布迁移不符合预期/,
      );
    }
  });

  void it("可信身份停用或外部预绑定缺失必须拒绝", () => {
    for (const key of ["identity", "externalIdentity"]) {
      const rows = validRows();
      rows[key] = [];
      assert.throws(
        () => assertPublishedRevocationPreflightRows(rows),
        /测试身份与 Keycloak 预绑定不符合预期/,
      );
    }
  });

  void it("原工程修订、审计或发布指针变化必须停止预检", () => {
    for (const modify of [
      (rows) => { rows.project[0].head_revision = "2"; },
      (rows) => { rows.versions[0].created_by = "other"; },
      (rows) => { rows.audit[0].action = "release:publish"; },
      (rows) => { rows.state[0].release_generation = "1"; },
      (rows) => { rows.state[0].released_revision = "1"; },
      (rows) => { rows.events[0].count = 1; },
    ]) {
      const rows = validRows();
      modify(rows);
      assert.throws(
        () => assertPublishedRevocationPreflightRows(rows),
        /基线工程或未发布状态不符合预期/,
      );
    }
  });

  void it("D5b1 基线 release:read 缺失、重复或混入新权限均拒绝", () => {
    for (const modify of [
      (rows) => { rows.grants.pop(); },
      (rows) => { rows.grants[3].subject_id = "other"; },
      (rows) => { rows.grants[3].permission = "release:publish"; },
      (rows) => { rows.grants.push(rows.grants[0]); },
    ]) {
      const rows = validRows();
      modify(rows);
      assert.throws(
        () => assertPublishedRevocationPreflightRows(rows),
        /基线授权发生变化/,
      );
    }
  });

  void it("已有 D5b4 工程不得误以为仍是零夹具状态", () => {
    const rows = validRows();
    rows.dedicated[0].count = 1;
    assert.throws(
      () => assertPublishedRevocationPreflightRows(rows),
      /已发现 D5b4 专用工程/,
    );
  });

  void it("真实查询必须使用只读可重复读事务，并只引用原 D5b1 工程", async () => {
    const { client, calls } = database();
    assert.equal(
      await inspectPublishedRevocationReadiness(client, {
        issuer: "https://127.0.0.1:18443/realms/adui-scada",
      }),
      true,
    );
    assert.equal(calls[0].sql, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(calls.at(-1).sql, "ROLLBACK");
    assert.equal(
      calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE|DROP|ALTER|COMMIT)/i.test(sql)).length,
      0,
    );
    assert.equal(
      calls.filter(({ params }) => Array.isArray(params) && params[1] === BASELINE).length,
      6,
    );
  });

  void it("SQL 故障必须回滚且未知异常不能输出凭据", async () => {
    const { client, calls } = database({ failAt: "scada_project_grants" });
    await assert.rejects(
      () =>
        inspectPublishedRevocationReadiness(client, {
          issuer: "https://127.0.0.1:18443/realms/adui-scada",
        }),
      /密钥不应出现在终端/,
    );
    assert.equal(calls.at(-1).sql, "ROLLBACK");
    assert.equal(
      describePublishedRevocationPreflightFailure(new Error("Cookie=secret; token=secret")),
      "D5b4a 只读预检失败，内部诊断已脱敏",
    );
  });
});
