import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASELINE_PROJECT } from "./assert-published-fixture-baseline.mjs";
import {
  classifyPublishedFixtureDiscoveryRows,
  describePublishedFixtureDiscoveryFailure,
  discoverPublishedFixtureCandidatesReadonly,
  discoverPublishedFixtureReadonly,
  parsePublishedFixtureDiscoveryArgs,
} from "./discover-published-fixture-readonly.mjs";

const FIRST = "d5b7b-published-12345678-1234-4234-8234-123456789abc";
const SECOND = "d5b7b-published-22345678-1234-4234-8234-123456789abc";
const MIGRATIONS = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];
const target = { issuer: "https://127.0.0.1:18443/realms/scada" };
const FAILURE = /D5b7f 只读发现环境或候选元数据不符合预期/;

function fixture(overrides = {}) {
  const rows = {
    database: [{ database_name: "adui_scada", database_user: "adui_scada" }],
    migrations: MIGRATIONS.map((migration_name) => ({ migration_name })),
    unresolved: [{ count: 0 }],
    identity: [{ "?column?": 1 }],
    external: [{ "?column?": 1 }],
    baseline: {
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
      grants: ["project:read", "version:read", "version:append", "release:read"].map(
        (permission) => ({ subject_id: "lab-engineer", permission }),
      ),
    },
    candidates: [{ project_id: FIRST }],
    ...overrides,
  };
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("BEGIN") || sql === "ROLLBACK") return { rows: [] };
      if (overrides.failOn && sql.includes(overrides.failOn)) {
        throw new Error("Password=SECRET");
      }
      if (sql.startsWith("SELECT p.project_id")) return { rows: rows.candidates };
      if (sql.includes("current_database()")) return { rows: rows.database };
      if (sql.includes("SELECT migration_name")) return { rows: rows.migrations };
      if (sql.includes('FROM public."_prisma_migrations"')) {
        return { rows: rows.unresolved };
      }
      if (sql.includes("scada_external_identities")) return { rows: rows.external };
      if (sql.includes("scada_identities")) return { rows: rows.identity };
      assert.equal(params?.[1], BASELINE_PROJECT, "不得读取非原基线的其他工程");
      const mapping = [
        ["scada_project_versions", "versions"],
        ["scada_project_audit", "audit"],
        ["scada_project_release_state", "state"],
        ["scada_project_release_events", "events"],
        ["scada_project_grants", "grants"],
        ["scada_projects", "project"],
      ];
      const key = mapping.find(([table]) => sql.includes(table))?.[1];
      assert.ok(key, "数据库查询必须来自预期的最小元数据白名单");
      return { rows: rows.baseline[key] };
    },
  };
  return { client, calls, rows };
}

function assertReadonly(calls) {
  assert.equal(calls[0]?.sql, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(calls.at(-1)?.sql, "ROLLBACK");
  assert.equal(calls.filter(({ sql }) => sql.startsWith("BEGIN")).length, 1);
  assert.equal(calls.filter(({ sql }) => sql === "ROLLBACK").length, 1);
  for (const { sql } of calls.slice(1, -1)) {
    assert.match(sql, /^SELECT /);
    assert.doesNotMatch(sql, /\bsnapshot\b|\btoken\b|\bpassword\b/i);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|COMMIT)\b/i);
  }
}

void describe("D5b7f 无工程 ID 只读候选发现安全门禁", () => {
  void it("命令行不接受工程、前缀、数据库、写入及其他参数", () => {
    assert.deepEqual(parsePublishedFixtureDiscoveryArgs([]), { mode: "readonly" });
    for (const args of [
      ["--project-id", FIRST],
      ["--prefix", "other"],
      ["--database", "adui_scada"],
      ["--apply"],
      ["--publish"],
      ["--confirm-lab", "adui_scada"],
    ]) {
      assert.throws(() => parsePublishedFixtureDiscoveryArgs(args), /不接受工程 ID/);
    }
  });

  void it("零个候选只返回 NOT_FOUND，两个候选只返回 AMBIGUOUS", () => {
    assert.deepEqual(classifyPublishedFixtureDiscoveryRows([]), { kind: "NOT_FOUND" });
    assert.deepEqual(
      classifyPublishedFixtureDiscoveryRows([{ project_id: SECOND }, { project_id: FIRST }]),
      { kind: "AMBIGUOUS" },
    );
  });

  void it("唯一合法 UUIDv4 才能形成内部候选", () => {
    assert.deepEqual(classifyPublishedFixtureDiscoveryRows([{ project_id: FIRST }]), {
      kind: "SINGLE",
      projectId: FIRST,
    });
  });

  void it("拒绝重复候选、非法命名空间、越界行和附带敏感字段", () => {
    for (const rows of [
      [{ project_id: FIRST }, { project_id: FIRST }],
      [{ project_id: "d5b4-revoke-12345678-1234-4234-8234-123456789abc" }],
      [{ project_id: FIRST.toUpperCase() }],
      [{ project_id: FIRST, snapshot: "SECRET" }],
      [{ project_id: FIRST }, { project_id: SECOND }, { project_id: FIRST }],
      [{ project_id: null }],
      [{}],
      [Object.create(null)],
    ]) {
      assert.throws(() => classifyPublishedFixtureDiscoveryRows(rows), FAILURE);
    }
  });

  void it("可信环境与 D5b1 基线均满足后才进行唯一前缀查询", async () => {
    const { client, calls } = fixture();
    assert.deepEqual(await discoverPublishedFixtureCandidatesReadonly(client, target), {
      kind: "SINGLE",
      projectId: FIRST,
    });
    assertReadonly(calls);
    assert.equal(calls.length, 14);
    const candidateQuery = calls.find(({ sql }) => sql.startsWith("SELECT p.project_id"));
    assert.ok(candidateQuery);
    assert.deepEqual(candidateQuery.params, ["lab-tenant", "d5b7b-published-%", "lab-engineer"]);
    assert.match(candidateQuery.sql, /ORDER BY p\.project_id LIMIT 2/);
    assert.match(candidateQuery.sql, /r\.release_generation > 0/);
    assert.match(candidateQuery.sql, /g\.permission = 'release:read'/);
    assert.equal(calls.filter(({ params }) => params?.[1] === BASELINE_PROJECT).length, 6);
  });

  void it("没有匹配候选时不枚举其他工程", async () => {
    const { client, calls } = fixture({ candidates: [] });
    assert.deepEqual(await discoverPublishedFixtureCandidatesReadonly(client, target), {
      kind: "NOT_FOUND",
    });
    assertReadonly(calls);
    assert.equal(calls.filter(({ sql }) => sql.startsWith("SELECT p.project_id")).length, 1);
  });

  void it("多个候选必须拒绝输出 ID，也不能触发二次审查", async () => {
    const { client, calls } = fixture({
      candidates: [{ project_id: FIRST }, { project_id: SECOND }],
    });
    const result = await discoverPublishedFixtureReadonly(client, target, async () => {
      throw new Error("不应调用二次审查");
    });
    assert.deepEqual(result, { kind: "AMBIGUOUS" });
    assertReadonly(calls);
  });

  void it("二次审查必须重复校验完整元数据才允许输出 ID", async () => {
    const { client, calls } = fixture();
    let received = null;
    const result = await discoverPublishedFixtureReadonly(
      client,
      target,
      async (_client, _target, id) => {
        received = id;
        return { kind: "RELEASED_METADATA_ONLY" };
      },
    );
    assert.equal(received, FIRST);
    assert.deepEqual(result, { kind: "RELEASED_METADATA_ONLY", projectId: FIRST });
    assertReadonly(calls);
  });

  void it("候选在二次审查前撤权或变为未发布时不输出 ID", async () => {
    for (const kind of ["DENIED", "UNRELEASED", "ERROR"]) {
      const { client, calls } = fixture();
      const result = await discoverPublishedFixtureReadonly(client, target, async () => ({ kind }));
      assert.deepEqual(result, { kind: "NOT_VERIFIED" });
      assertReadonly(calls);
    }
  });

  void it("无效数据库或数据库用户不得运行候选查询", async () => {
    for (const database of [
      [{ database_name: "adui_scada_test", database_user: "adui_scada" }],
      [{ database_name: "adui_scada", database_user: "postgres" }],
    ]) {
      const { client, calls } = fixture({ database });
      await assert.rejects(discoverPublishedFixtureCandidatesReadonly(client, target), FAILURE);
      assertReadonly(calls);
      assert.equal(
        calls.some(({ sql }) => sql.startsWith("SELECT p.project_id")),
        false,
      );
    }
  });

  void it("迁移缺失、重复或存在未完成迁移时停止发现", async () => {
    for (const change of [
      { migrations: [] },
      { migrations: [{ migration_name: MIGRATIONS[0] }, { migration_name: MIGRATIONS[0] }] },
      { unresolved: [{ count: 1 }] },
    ]) {
      const { client, calls } = fixture(change);
      await assert.rejects(discoverPublishedFixtureCandidatesReadonly(client, target), FAILURE);
      assertReadonly(calls);
      assert.equal(
        calls.some(({ sql }) => sql.startsWith("SELECT p.project_id")),
        false,
      );
    }
  });

  void it("可信身份或外部 OIDC 预绑定缺失时禁止发现", async () => {
    for (const change of [{ identity: [] }, { external: [] }]) {
      const { client, calls } = fixture(change);
      await assert.rejects(discoverPublishedFixtureCandidatesReadonly(client, target), FAILURE);
      assertReadonly(calls);
      assert.equal(
        calls.some(({ sql }) => sql.startsWith("SELECT p.project_id")),
        false,
      );
    }
  });

  void it("原 D5b1 首版、发布空指针或四项 ACL 漂移时不得查询候选", async () => {
    for (const mutate of [
      (rows) => {
        rows.baseline.project = [];
      },
      (rows) => {
        rows.baseline.state[0].release_generation = "1";
      },
      (rows) => {
        rows.baseline.events[0].count = 1;
      },
      (rows) => {
        rows.baseline.grants.pop();
      },
    ]) {
      const { client, calls, rows } = fixture();
      mutate(rows);
      await assert.rejects(
        discoverPublishedFixtureCandidatesReadonly(client, target),
        /D5b7d 原 D5b1 只读基线不完整或发生漂移/,
      );
      assertReadonly(calls);
      assert.equal(
        calls.some(({ sql }) => sql.startsWith("SELECT p.project_id")),
        false,
      );
    }
  });

  void it("不可信目标参数须在 BEGIN 前拒绝", async () => {
    const { client, calls } = fixture();
    await assert.rejects(discoverPublishedFixtureCandidatesReadonly(client, {}), FAILURE);
    assert.deepEqual(calls, []);
  });

  void it("SQL 异常必须 ROLLBACK 并隐藏数据库凭据与工程正文", async () => {
    const { client, calls } = fixture({ failOn: "scada_project_grants" });
    await assert.rejects(
      discoverPublishedFixtureCandidatesReadonly(client, target),
      /Password=SECRET/,
    );
    assertReadonly(calls);
    assert.equal(
      describePublishedFixtureDiscoveryFailure(new Error("Password=SECRET")),
      "D5b7f 只读发现失败，内部诊断已脱敏",
    );
  });

  void it("固定诊断不会泄露原始字段或其他工程 ID", () => {
    assert.equal(
      describePublishedFixtureDiscoveryFailure(
        new Error("D5b7f 只读发现环境或候选元数据不符合预期"),
      ),
      "D5b7f 只读发现环境或候选元数据不符合预期",
    );
    assert.equal(
      describePublishedFixtureDiscoveryFailure({ message: FIRST }),
      "D5b7f 只读发现失败，内部诊断已脱敏",
    );
  });
});
