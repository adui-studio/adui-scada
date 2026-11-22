import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeD5b4gRevocationFailure,
  parseD5b4gRevocationMode,
  revokeD5b4PublishedRead,
} from "./revoke-oidc-published-read-target.mjs";
import { inspectPublishedRevocationTarget } from "./preflight-oidc-published-revocation-target.mjs";

const ID = "d5b4-revoke-12345678-1234-4234-8234-123456789abc";
const ORIGINAL = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
const TARGET = { issuer: "https://127.0.0.1:18443/realms/adui-scada" };
const MIGRATIONS = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];
const PERMISSIONS = ["project:read", "version:read", "version:append", "release:read"];

function project() {
  return {
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

/** 内存数据库仅用于离线验证 SQL 顺序，模拟回滚不代表真实 PostgreSQL 事务通过。 */
function database({ initial, onSerial, onDelete, onCommit } = {}) {
  const calls = [];
  let rows = validRows();
  initial?.(rows);
  let backup = null;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith("BEGIN")) {
        backup = structuredClone(rows);
        if (sql === "BEGIN ISOLATION LEVEL SERIALIZABLE") onSerial?.(rows);
        return { rows: [] };
      }
      if (sql === "ROLLBACK") {
        if (backup) rows = backup;
        backup = null;
        return { rows: [] };
      }
      if (sql === "COMMIT") {
        onCommit?.(rows);
        backup = null;
        return { rows: [] };
      }
      if (sql.startsWith("DELETE FROM public.scada_project_grants")) {
        assert.deepEqual(params, ["lab-tenant", ID, "lab-engineer"]);
        assert.match(sql, /permission = 'release:read' RETURNING subject_id, permission/);
        const expected = rows.target.grants.filter(
          (entry) => entry.subject_id === "lab-engineer" && entry.permission === "release:read",
        );
        rows.target.grants = rows.target.grants.filter((entry) => !expected.includes(entry));
        const returning = onDelete?.(rows, expected) ?? expected;
        return { rows: structuredClone(returning) };
      }
      let key;
      if (sql.includes("current_database()")) key = "database";
      else if (sql.includes("ANY($1::text[])")) key = "migrations";
      else if (sql.includes("finished_at IS NULL")) key = "unresolved";
      else if (sql.includes("scada_external_identities")) key = "externalIdentity";
      else if (sql.includes("scada_identities")) key = "identity";
      else if (sql.includes("project_id LIKE")) key = "dedicated";
      if (key) return { rows: structuredClone(rows[key]) };
      const group = params[1] === ID ? "target" : params[1] === ORIGINAL ? "original" : null;
      assert.ok(group, "必须只读取固定 D5b4 工程及原 D5b1 工程");
      if (sql.includes("scada_project_versions")) key = "versions";
      else if (sql.includes("scada_project_audit")) key = "audit";
      else if (sql.includes("scada_project_release_state")) key = "state";
      else if (sql.includes("scada_project_release_events")) key = "events";
      else if (sql.includes("scada_project_grants")) key = "grants";
      else if (sql.includes("scada_projects")) key = "project";
      assert.ok(key && sql.startsWith("SELECT "), "只能使用原有 SQL 查询与单条定向 DELETE");
      return { rows: structuredClone(rows[group][key]) };
    },
  };
  return { client, calls, snapshot: () => structuredClone(rows) };
}

function deletes(calls) {
  return calls.filter(({ sql }) => sql.startsWith("DELETE"));
}

void describe("D5b4g 独立工程单条 release:read 撤销安全门禁", () => {
  void it("默认只有精确工程 ID 的只读模式，写入必须双重确认同一工程", () => {
    assert.deepEqual(parseD5b4gRevocationMode(["--project-id", ID]), {
      projectId: ID,
      apply: false,
    });
    assert.deepEqual(
      parseD5b4gRevocationMode([
        "--project-id", ID, "--apply", "--confirm-lab", "adui_scada", "--confirm-project", ID,
      ]),
      { projectId: ID, apply: true },
    );
  });

  void it("旧 D5b1、非随机 ID、额外参数和错误工程确认全部在 SQL 前拒绝", () => {
    for (const args of [
      [],
      ["--project-id", ORIGINAL],
      ["--project-id", "../secret"],
      ["--project-id", ID, "--revoke"],
      ["--project-id", ID, "--apply"],
      ["--project-id", ID, "--apply", "--confirm-lab", "adui_scada"],
      ["--project-id", ID, "--apply", "--confirm-lab", "adui_scada", "--confirm-project", ORIGINAL],
      ["--project-id", ID, "--apply", "--confirm-lab", "adui_scada", "--confirm-project", ID, "x"],
      ["--project-id", ID, "--apply", "--confirm-lab", "production", "--confirm-project", ID],
    ]) {
      assert.throws(() => parseD5b4gRevocationMode(args), /仅允许独立专用工程/);
    }
    const { client, calls } = database();
    return assert.rejects(revokeD5b4PublishedRead(client, TARGET, ORIGINAL), /仅允许独立专用工程/)
      .then(() => assert.equal(calls.length, 0));
  });

  void it("只读预检必须真实使用现有 READ ONLY 事务且没有任何 DELETE", async () => {
    const { client, calls } = database();
    assert.equal(await inspectPublishedRevocationTarget(client, TARGET, ID), true);
    assert.equal(calls[0].sql, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(calls.at(-1).sql, "ROLLBACK");
    assert.equal(deletes(calls).length, 0);
  });

  void it("有效数据时只删目标主体一条 release:read，提交前后核对新旧工程", async () => {
    const { client, calls, snapshot } = database();
    assert.equal(await revokeD5b4PublishedRead(client, TARGET, ID), true);
    assert.equal(deletes(calls).length, 1);
    assert.equal(calls.filter(({ sql }) => sql === "COMMIT").length, 1);
    assert.equal(calls.filter(({ sql }) => sql === "BEGIN ISOLATION LEVEL SERIALIZABLE").length, 1);
    assert.equal(
      calls.filter(({ sql }) => sql === "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .length,
      2,
    );
    assert.equal(snapshot().target.grants.length, 3);
    assert.deepEqual(snapshot().original.grants, project().grants);
    assert.equal(
      calls.filter(({ sql }) => /^(INSERT|UPDATE|DROP|ALTER|TRUNCATE)/.test(sql)).length,
      0,
    );
  });

  void it("目标根本不存在或原始四项 ACL 不完整时拒绝 DELETE", async () => {
    for (const initial of [
      (rows) => { rows.dedicated = []; },
      (rows) => { rows.target.project = []; },
      (rows) => { rows.target.grants.pop(); },
      (rows) => { rows.original.grants.pop(); },
    ]) {
      const { client, calls } = database({ initial });
      await assert.rejects(revokeD5b4PublishedRead(client, TARGET, ID));
      assert.equal(deletes(calls).length, 0);
    }
  });

  void it("只读预检与行锁之间发生版本或 ACL 漂移必须回滚且零 DELETE", async () => {
    for (const onSerial of [
      (r) => { r.target.versions[0].revision = "2"; },
      (r) => { r.target.grants.push({ subject_id: "other", permission: "release:read" }); },
      (r) => { r.original.grants.pop(); },
      (r) => { r.target.state[0].release_generation = "1"; },
      (r) => { r.dedicated.push({ project_id: "d5b4-revoke-extra" }); },
    ]) {
      const { client, calls } = database({ onSerial });
      await assert.rejects(revokeD5b4PublishedRead(client, TARGET, ID), /禁止自动重试或恢复/);
      assert.equal(deletes(calls).length, 0);
      assert.equal(calls.at(-1).sql, "ROLLBACK");
    }
  });

  void it("事务加锁时工程已消失必须停止，不触碰旧工程", async () => {
    const { client, calls } = database({ onSerial: (r) => { r.target.project = []; } });
    await assert.rejects(revokeD5b4PublishedRead(client, TARGET, ID), /禁止自动重试或恢复/);
    assert.equal(deletes(calls).length, 0);
    assert.equal(calls.at(-1).sql, "ROLLBACK");
  });

  void it("DELETE RETURNING 缺行或返回不同主体权限必须回滚，不能 COMMIT", async () => {
    for (const onDelete of [
      () => [],
      () => [{ subject_id: "other", permission: "release:read" }],
      () => [{ subject_id: "lab-engineer", permission: "version:read" }],
    ]) {
      const { client, calls, snapshot } = database({ onDelete });
      await assert.rejects(revokeD5b4PublishedRead(client, TARGET, ID), /禁止自动重试或恢复/);
      assert.equal(deletes(calls).length, 1);
      assert.equal(calls.filter(({ sql }) => sql === "COMMIT").length, 0);
      assert.equal(calls.at(-1).sql, "ROLLBACK");
      assert.equal(snapshot().target.grants.length, 4);
    }
  });

  void it("删除后出现多余授权或旧 D5b1 变更不能提交", async () => {
    for (const onDelete of [
      (r, returning) => {
        r.target.grants.push({ subject_id: "other", permission: "release:read" });
        return returning;
      },
      (r, returning) => {
        r.original.grants.pop();
        return returning;
      },
      (r, returning) => {
        r.target.state[0].released_revision = "1";
        return returning;
      },
    ]) {
      const { client, calls } = database({ onDelete });
      await assert.rejects(revokeD5b4PublishedRead(client, TARGET, ID), /禁止自动重试或恢复/);
      assert.equal(calls.filter(({ sql }) => sql === "COMMIT").length, 0);
      assert.equal(calls.at(-1).sql, "ROLLBACK");
    }
  });

  void it("真实撤权完成后不得在同一工程重复删除第二次", async () => {
    const { client, calls } = database();
    assert.equal(await revokeD5b4PublishedRead(client, TARGET, ID), true);
    await assert.rejects(revokeD5b4PublishedRead(client, TARGET, ID));
    assert.equal(deletes(calls).length, 1);
  });

  void it("COMMIT 失败时不能声称成功，必须提示结果未确认且禁止重试", async () => {
    const { client, calls } = database({
      onCommit: () => { throw new Error("Cookie=SECRET"); },
    });
    await assert.rejects(revokeD5b4PublishedRead(client, TARGET, ID), /禁止自动重试或恢复/);
    assert.equal(deletes(calls).length, 1);
    assert.equal(calls.filter(({ sql }) => sql === "COMMIT").length, 1);
    assert.equal(calls.at(-1).sql, "ROLLBACK");
  });

  void it("提交后只读检查发现漂移仍必须报未确认，不能自动补授权", async () => {
    const { client, calls } = database({
      onCommit: (rows) => { rows.target.grants.push({ subject_id: "other", permission: "release:read" }); },
    });
    await assert.rejects(revokeD5b4PublishedRead(client, TARGET, ID), /禁止自动重试或恢复/);
    assert.equal(deletes(calls).length, 1);
    assert.equal(calls.filter(({ sql }) => sql === "COMMIT").length, 1);
    assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT")).length, 0);
  });

  void it("未知异常、凭据与 SQL 正文只能转化为固定中文脱敏类别", () => {
    assert.equal(
      describeD5b4gRevocationFailure(new Error("Cookie=SECRET; Token=SECRET")),
      "D5b4g 独立撤权候选未通过，内部信息已脱敏",
    );
    assert.equal(
      describeD5b4gRevocationFailure(
        new Error("D5b4g 单条 release:read 撤权事务未能确认，禁止自动重试或恢复"),
      ),
      "D5b4g 单条 release:read 撤权事务未能确认，禁止自动重试或恢复",
    );
  });
});
