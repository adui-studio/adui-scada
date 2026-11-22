import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPublishedRevocationTargetRows,
  describePublishedRevocationTargetFailure,
  inspectPublishedRevocationTarget,
  parsePublishedRevocationTargetArgs,
} from "./preflight-oidc-published-revocation-target.mjs";

const ID = "d5b4-revoke-12345678-1234-4234-8234-123456789abc";
const ORIGINAL = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
const PERMISSIONS = ["project:read", "version:read", "version:append", "release:read"];
const MIGRATIONS = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];

function project() {
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
    grants: PERMISSIONS.map((permission) => ({ subject_id: "lab-engineer", permission })),
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
    target: project(),
    original: project(),
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
      assert.ok(group, "只允许两个明确定义的受控工程查询");
      if (sql.includes("scada_project_versions")) key = "versions";
      else if (sql.includes("scada_project_audit")) key = "audit";
      else if (sql.includes("scada_project_release_state")) key = "state";
      else if (sql.includes("scada_project_release_events")) key = "events";
      else if (sql.includes("scada_project_grants")) key = "grants";
      else if (sql.includes("scada_projects")) key = "project";
      assert.ok(key, "只允许受控只读 SQL");
      return { rows: rows[group][key] };
    },
  };
  return { client, calls };
}

void describe("D5b4c 独立撤权工程真实数据库只读核查安全门禁", () => {
  void it("必须明确现有随机专用工程，其他所有创建撤销及额外参数均拒绝", () => {
    assert.deepEqual(parsePublishedRevocationTargetArgs(["--project-id", ID]), { projectId: ID });
    for (const args of [
      [],
      ["--apply", "--confirm-lab", "adui_scada"],
      ["--project-id", ORIGINAL],
      ["--project-id", "d5b4-revoke-example"],
      ["--project-id", "../secret"],
      ["--project-id", ID, "--revoke"],
      ["--project-id", ID, "--restore"],
    ]) {
      assert.throws(
        () => parsePublishedRevocationTargetArgs(args),
        /参数仅允许现有独立专用工程 ID/,
      );
    }
  });

  void it("合法可信库与唯一工程、首版和四项权限同时存在时核查通过", () => {
    assert.equal(assertPublishedRevocationTargetRows(validRows(), ID), true);
  });

  void it("库名、数据库用户、迁移和身份异常时安全拒绝", () => {
    for (const change of [
      (r) => { r.database[0].database_name = "adui_scada_test"; },
      (r) => { r.database[0].database_user = "postgres"; },
      (r) => { r.migrations.pop(); },
      (r) => { r.unresolved[0].count = 1; },
      (r) => { r.identity = []; },
      (r) => { r.externalIdentity = []; },
    ]) {
      const rows = validRows();
      change(rows);
      assert.throws(
        () => assertPublishedRevocationTargetRows(rows, ID),
        /目标数据库、迁移或可信身份不符合预期/,
      );
    }
  });

  void it("零工程、重复工程或传入工程与真实 ID 不一致全部拒绝", () => {
    for (const value of [
      [],
      [{ project_id: ID }, { project_id: "d5b4-revoke-other" }],
      [{ project_id: ORIGINAL }],
    ]) {
      const rows = validRows();
      rows.dedicated = value;
      assert.throws(
        () => assertPublishedRevocationTargetRows(rows, ID),
        /独立工程不存在、不唯一或出现额外工程/,
      );
    }
  });

  void it("新工程编辑修订、创建者、审计或发布代次变化都不能开始撤权", () => {
    for (const change of [
      (r) => { r.target.project[0].head_revision = "2"; },
      (r) => { r.target.versions.push(r.target.versions[0]); },
      (r) => { r.target.audit[0].actor_id = "other"; },
      (r) => { r.target.state[0].release_generation = "1"; },
      (r) => { r.target.state[0].released_revision = "1"; },
      (r) => { r.target.events[0].count = 1; },
    ]) {
      const rows = validRows();
      change(rows);
      assert.throws(
        () => assertPublishedRevocationTargetRows(rows, ID),
        /独立工程首版、审计或未发布状态不符合预期/,
      );
    }
  });

  void it("目标 release:read 缺失、重复、额外发布授权和其他主体授权全部拒绝", () => {
    for (const change of [
      (r) => { r.target.grants.pop(); },
      (r) => { r.target.grants.push(r.target.grants[3]); },
      (r) => { r.target.grants[3].permission = "release:publish"; },
      (r) => { r.target.grants[3].subject_id = "other"; },
    ]) {
      const rows = validRows();
      change(rows);
      assert.throws(
        () => assertPublishedRevocationTargetRows(rows, ID),
        /独立工程 release:read 权限不符合预期/,
      );
    }
  });

  void it("旧 D5b1 只要首版或任何权限变化均拒绝", () => {
    for (const change of [
      (r) => { r.original.project[0].head_revision = "2"; },
      (r) => { r.original.grants.pop(); },
      (r) => { r.original.grants[3].subject_id = "other"; },
      (r) => { r.original.state[0].release_generation = "1"; },
    ]) {
      const rows = validRows();
      change(rows);
      assert.throws(
        () => assertPublishedRevocationTargetRows(rows, ID),
        /原 D5b1 工程或授权发生变化/,
      );
    }
  });

  void it("实际查询必须全部在 REPEATABLE READ READ ONLY 内且两个工程隔离", async () => {
    const { client, calls } = database();
    assert.equal(
      await inspectPublishedRevocationTarget(
        client, { issuer: "https://127.0.0.1:18443/realms/adui-scada" }, ID,
      ),
      true,
    );
    assert.equal(calls[0].sql, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(calls.at(-1).sql, "ROLLBACK");
    assert.equal(
      calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE|DROP|ALTER|COMMIT)/.test(sql)).length,
      0,
    );
    assert.equal(calls.filter(({ params }) => params[1] === ID).length, 6);
    assert.equal(calls.filter(({ params }) => params[1] === ORIGINAL).length, 6);
  });

  void it("非法工程 ID 在连接事务前拒绝且零 SQL", async () => {
    const { client, calls } = database();
    await assert.rejects(
      inspectPublishedRevocationTarget(client, { issuer: "https://example.invalid" }, ORIGINAL),
      /参数仅允许现有独立专用工程 ID/,
    );
    assert.equal(calls.length, 0);
  });

  void it("数据库异常必须回滚且未知错误诊断脱敏", async () => {
    const { client, calls } = database({ throwAt: "scada_project_grants" });
    await assert.rejects(
      inspectPublishedRevocationTarget(
        client, { issuer: "https://127.0.0.1:18443/realms/adui-scada" }, ID,
      ),
      /Cookie=SECRET/,
    );
    assert.equal(calls.at(-1).sql, "ROLLBACK");
    assert.equal(
      describePublishedRevocationTargetFailure(new Error("Cookie=SECRET; token=SECRET")),
      "D5b4c 真实撤权前只读核查失败，内部诊断已脱敏",
    );
  });
});
