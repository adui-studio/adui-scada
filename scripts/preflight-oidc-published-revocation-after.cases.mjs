import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describePublishedRevocationAfterFailure,
  inspectPublishedRevocationAfter,
  parsePublishedRevocationAfterArgs,
} from "./preflight-oidc-published-revocation-after.mjs";
import {
  assertPublishedRevocationAfterRows,
  assertPublishedRevocationTargetRows,
  inspectPublishedRevocationTarget,
} from "./preflight-oidc-published-revocation-target.mjs";

const ID = "d5b4-revoke-12345678-1234-4234-8234-123456789abc";
const ORIGINAL = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
const OWNER_PERMISSIONS = ["project:read", "version:read", "version:append"];
const MIGRATIONS = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];
const TARGET = { issuer: "https://127.0.0.1:18443/realms/adui-scada" };

function project(permissions) {
  return {
    project: [{ head_revision: "1" }],
    versions: [{ revision: "1", created_by: "lab-engineer" }],
    audit: [{ revision: "1", actor_id: "lab-engineer", action: "version:append" }],
    state: [
      {
        release_generation: "0",
        released_revision: null,
        released_content_hash: null,
        last_release_event_id: null,
      },
    ],
    events: [{ count: 0 }],
    grants: permissions.map((permission) => ({ subject_id: "lab-engineer", permission })),
  };
}

function validRows() {
  return {
    database: [{ database_name: "adui_scada", database_user: "adui_scada" }],
    migrations: MIGRATIONS.map((migration_name) => ({ migration_name })),
    unresolved: [{ count: 0 }],
    identity: [{ present: 1 }],
    externalIdentity: [{ present: 1 }],
    dedicated: [{ project_id: ID }],
    target: project(OWNER_PERMISSIONS),
    original: project([...OWNER_PERMISSIONS, "release:read"]),
  };
}

function database({ mutate, throwAt } = {}) {
  const calls = [];
  const rows = validRows();
  mutate?.(rows);
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith("BEGIN") || sql === "ROLLBACK") return { rows: [] };
      if (throwAt && sql.includes(throwAt)) throw new Error("Cookie=SECRET; token=SECRET");
      let key;
      if (sql.includes("current_database()")) key = "database";
      else if (sql.includes("ANY($1::text[])")) key = "migrations";
      else if (sql.includes("finished_at IS NULL")) key = "unresolved";
      else if (sql.includes("scada_external_identities")) key = "externalIdentity";
      else if (sql.includes("scada_identities")) key = "identity";
      else if (sql.includes("project_id LIKE")) key = "dedicated";
      if (key) return { rows: rows[key] };
      const group = params[1] === ID ? "target" : params[1] === ORIGINAL ? "original" : null;
      assert.ok(group, "只允许 D5b4 与原 D5b1 的受控元数据查询");
      if (sql.includes("scada_project_versions")) key = "versions";
      else if (sql.includes("scada_project_audit")) key = "audit";
      else if (sql.includes("scada_project_release_state")) key = "state";
      else if (sql.includes("scada_project_release_events")) key = "events";
      else if (sql.includes("scada_project_grants")) key = "grants";
      else if (sql.includes("scada_projects")) key = "project";
      assert.ok(key, "撤权后审计只允许既有只读 SQL");
      return { rows: rows[group][key] };
    },
  };
  return { client, calls };
}

void describe("D5b4e 撤权后 PostgreSQL 只读审计安全门禁", () => {
  void it("只接受现有独立随机专用工程，拒绝任何写入或阶段切换参数", () => {
    assert.deepEqual(parsePublishedRevocationAfterArgs(["--project-id", ID]), { projectId: ID });
    for (const args of [
      [],
      ["--apply", "--confirm-lab", "adui_scada"],
      ["--project-id", ORIGINAL],
      ["--project-id", "d5b4-revoke-example"],
      ["--project-id", "../secret"],
      ["--project-id", ID, "--revoke"],
      ["--project-id", ID, "--restore"],
      ["--phase", "before", "--project-id", ID],
    ]) {
      assert.throws(() => parsePublishedRevocationAfterArgs(args), /参数仅允许现有独立专用工程 ID/);
    }
  });

  void it("撤权后必须精确保留三项基础 ACL，旧工程仍有四项", () => {
    assert.equal(assertPublishedRevocationAfterRows(validRows(), ID), true);
    assert.throws(
      () => assertPublishedRevocationTargetRows(validRows(), ID),
      /D5b4c 独立工程 release:read 权限不符合预期/,
    );
  });

  void it("撤权前拥有四项 ACL 的工程不能伪装为撤权后通过", () => {
    const rows = validRows();
    rows.target.grants.push({ subject_id: "lab-engineer", permission: "release:read" });
    assert.throws(
      () => assertPublishedRevocationAfterRows(rows, ID),
      /D5b4e 独立工程 release:read 权限不符合预期/,
    );
    assert.equal(assertPublishedRevocationTargetRows(rows, ID), true);
  });

  void it("缺少基础权限、重复权限、其他主体和额外发布权限均拒绝", () => {
    for (const change of [
      (r) => {
        r.target.grants.pop();
      },
      (r) => {
        r.target.grants.push(r.target.grants[0]);
      },
      (r) => {
        r.target.grants[0].subject_id = "other";
      },
      (r) => {
        r.target.grants[0].permission = "release:publish";
      },
      (r) => {
        r.target.grants.push({ subject_id: "other", permission: "release:read" });
      },
    ]) {
      const rows = validRows();
      change(rows);
      assert.throws(
        () => assertPublishedRevocationAfterRows(rows, ID),
        /D5b4e 独立工程 release:read 权限不符合预期/,
      );
    }
  });

  void it("专用工程首版、审计与未发布状态出现任何漂移必须拒绝", () => {
    for (const change of [
      (r) => {
        r.target.project[0].head_revision = "2";
      },
      (r) => {
        r.target.versions.push(r.target.versions[0]);
      },
      (r) => {
        r.target.audit[0].action = "release:publish";
      },
      (r) => {
        r.target.state[0].release_generation = "1";
      },
      (r) => {
        r.target.state[0].released_content_hash = "tampered";
      },
      (r) => {
        r.target.events[0].count = 1;
      },
    ]) {
      const rows = validRows();
      change(rows);
      assert.throws(
        () => assertPublishedRevocationAfterRows(rows, ID),
        /D5b4e 独立工程首版、审计或未发布状态不符合预期/,
      );
    }
  });

  void it("原 D5b1 工程首版与四项 ACL 必须始终保持完整", () => {
    for (const change of [
      (r) => {
        r.original.project[0].head_revision = "2";
      },
      (r) => {
        r.original.grants.pop();
      },
      (r) => {
        r.original.grants[0].subject_id = "other";
      },
      (r) => {
        r.original.state[0].released_revision = "1";
      },
    ]) {
      const rows = validRows();
      change(rows);
      assert.throws(
        () => assertPublishedRevocationAfterRows(rows, ID),
        /D5b4e 原 D5b1 工程或授权发生变化/,
      );
    }
  });

  void it("数据库身份、迁移或可信主体异常必须受控拒绝", () => {
    for (const change of [
      (r) => {
        r.database[0].database_name = "adui_scada_test";
      },
      (r) => {
        r.database[0].database_user = "postgres";
      },
      (r) => {
        r.migrations.pop();
      },
      (r) => {
        r.unresolved[0].count = 1;
      },
      (r) => {
        r.identity = [];
      },
      (r) => {
        r.externalIdentity = [];
      },
    ]) {
      const rows = validRows();
      change(rows);
      assert.throws(
        () => assertPublishedRevocationAfterRows(rows, ID),
        /D5b4e 目标数据库、迁移或可信身份不符合预期/,
      );
    }
  });

  void it("专用工程不存在、出现两份或实际目标 ID 不一致均拒绝", () => {
    for (const dedicated of [
      [],
      [{ project_id: ID }, { project_id: "d5b4-revoke-other" }],
      [{ project_id: ORIGINAL }],
    ]) {
      const rows = validRows();
      rows.dedicated = dedicated;
      assert.throws(
        () => assertPublishedRevocationAfterRows(rows, ID),
        /D5b4e 独立工程不存在、不唯一或出现额外工程/,
      );
    }
  });

  void it("真实查询只允许 REPEATABLE READ READ ONLY、十二条元数据 SELECT 和 ROLLBACK", async () => {
    const { client, calls } = database();
    assert.equal(await inspectPublishedRevocationAfter(client, TARGET, ID), true);
    assert.equal(calls[0].sql, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(calls.at(-1).sql, "ROLLBACK");
    assert.equal(
      calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE|DROP|ALTER|COMMIT)/.test(sql)).length,
      0,
    );
    assert.equal(calls.filter(({ sql }) => sql.startsWith("SELECT")).length, calls.length - 2);
    assert.equal(calls.filter(({ params }) => params[1] === ID).length, 6);
    assert.equal(calls.filter(({ params }) => params[1] === ORIGINAL).length, 6);
  });

  void it("非法工程或未知事务阶段必须在数据库查询前拒绝且不执行 SQL", async () => {
    const { client, calls } = database();
    await assert.rejects(
      inspectPublishedRevocationAfter(client, TARGET, ORIGINAL),
      /D5b4e 参数仅允许现有独立专用工程 ID/,
    );
    await assert.rejects(
      inspectPublishedRevocationTarget(client, TARGET, ID, "restore"),
      /D5b4c 参数仅允许现有独立专用工程 ID/,
    );
    assert.equal(calls.length, 0);
  });

  void it("SQL 失败仍必须回滚且未知错误仅显示脱敏固定中文", async () => {
    const { client, calls } = database({ throwAt: "scada_project_grants" });
    await assert.rejects(inspectPublishedRevocationAfter(client, TARGET, ID), /Cookie=SECRET/);
    assert.equal(calls.at(-1).sql, "ROLLBACK");
    assert.equal(
      describePublishedRevocationAfterFailure(new Error("Cookie=SECRET; token=SECRET")),
      "D5b4e 撤权后数据库只读审计失败，内部诊断已脱敏",
    );
    assert.equal(
      describePublishedRevocationAfterFailure(
        new Error("D5b4e 独立工程 release:read 权限不符合预期"),
      ),
      "D5b4e 独立工程 release:read 权限不符合预期",
    );
  });
});
