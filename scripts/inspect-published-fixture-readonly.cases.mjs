import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describePublishedFixtureReadonlyFailure,
  inspectPublishedFixtureReadonly,
} from "./inspect-published-fixture-readonly.mjs";
import { BASELINE_PROJECT } from "./assert-published-fixture-baseline.mjs";

const PROJECT = "d5b7b-published-12345678-1234-4234-8234-123456789abc";
const EVENT = "12345678-1234-4234-8234-123456789abc";
const HASH = "a".repeat(64);
const MIGRATIONS = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];

function fixture(change = {}) {
  const rows = {
    database: [{ database_name: "adui_scada", database_user: "adui_scada" }],
    migrations: MIGRATIONS.map((migration_name) => ({ migration_name })),
    unresolved: [{ count: 0 }],
    identity: [{ "?column?": 1 }],
    external: [{ "?column?": 1 }],
    project: [{ tenant_id: "lab-tenant", project_id: PROJECT, head_revision: "2" }],
    grants: [{ subject_id: "lab-engineer", permission: "release:read" }],
    releaseState: [
      {
        release_generation: "1",
        released_revision: "1",
        released_content_hash: HASH,
        last_release_event_id: EVENT,
      },
    ],
    releasedVersion: [{ revision: "1", content_hash: HASH }],
    lastEvent: [
      {
        event_id: EVENT,
        tenant_id: "lab-tenant",
        project_id: PROJECT,
        generation: "1",
        action: "PUBLISH",
        to_revision: "1",
        to_content_hash: HASH,
      },
    ],
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
    ...change,
  };
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("BEGIN") || sql === "ROLLBACK") return { rows: [] };
      if (change.failOn && sql.includes(change.failOn)) throw new Error("Token=SECRET");
      const queries = [
        ["current_database()", "database"],
        ["SELECT migration_name", "migrations"],
        ["COUNT(*)", "unresolved"],
        ["scada_external_identities", "external"],
        ["scada_identities", "identity"],
        ["scada_project_grants", "grants"],
        ["scada_project_audit", "audit"],
        ["scada_project_release_state", "releaseState"],
        ["scada_project_release_events", "lastEvent"],
        ["scada_project_versions", "releasedVersion"],
        ["scada_projects", "project"],
      ];
      const key = queries.find(([part]) => sql.includes(part))?.[1] ?? "unknown";
      assert.notEqual(key, "unknown", "数据库查询必须只来自已审核的元数据白名单");
      if (Array.isArray(params) && params[1] === BASELINE_PROJECT) {
        const keys = {
          project: "project",
          releasedVersion: "versions",
          audit: "audit",
          releaseState: "state",
          unresolved: "events",
          grants: "grants",
        };
        const baselineKey = keys[key];
        assert.ok(baselineKey, "原 D5b1 只能查询六项指定基线元数据");
        return { rows: rows.baseline[baselineKey] };
      }
      return { rows: rows[key] };
    },
  };
  return { client, calls, rows };
}

const target = { issuer: "https://127.0.0.1:18443/realms/scada" };

function assertReadonly(calls) {
  assert.equal(calls[0]?.sql, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(calls.at(-1)?.sql, "ROLLBACK");
  assert.equal(calls.filter((entry) => entry.sql.startsWith("BEGIN")).length, 1);
  assert.equal(calls.filter((entry) => entry.sql === "ROLLBACK").length, 1);
  for (const entry of calls.slice(1, -1)) {
    assert.match(entry.sql, /^SELECT /);
    assert.doesNotMatch(entry.sql, /\bsnapshot\b|\bpassword\b|\btoken\b/i);
    assert.doesNotMatch(entry.sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|COMMIT)\b/i);
  }
}

void describe("D5b7c 真实发布夹具 PostgreSQL 元数据只读审查", () => {
  void it("一致元数据仅给出待核验标记，完整事务回滚", async () => {
    const { client, calls } = fixture();
    const state = await inspectPublishedFixtureReadonly(client, target, PROJECT);
    assert.deepEqual(state, { kind: "RELEASED_METADATA_ONLY" });
    assertReadonly(calls);
    assert.equal(calls.length, 18);
  });

  void it("实际查询只使用绑定参数与可信工程，不读取快照正文", async () => {
    const { client, calls } = fixture();
    await inspectPublishedFixtureReadonly(client, target, PROJECT);
    assertReadonly(calls);
    assert.deepEqual(calls.find((entry) => entry.sql.includes("scada_projects") && entry.params?.[1] === PROJECT).params, [
      "lab-tenant",
      PROJECT,
    ]);
    assert.deepEqual(calls.find((entry) => entry.sql.includes("scada_project_grants") && entry.params?.[1] === PROJECT).params, [
      "lab-tenant",
      PROJECT,
      "lab-engineer",
    ]);
    assert.deepEqual(
      calls.find((entry) => entry.sql.includes("scada_external_identities")).params,
      [target.issuer, "lab-tenant", "lab-engineer"],
    );
    assert.deepEqual(calls.find((entry) => entry.sql.includes("scada_project_versions") && entry.params?.[1] === PROJECT).params, [
      "lab-tenant",
      PROJECT,
      "1",
    ]);
    assert.deepEqual(
      calls.find((entry) => entry.sql.includes("scada_project_release_events") && entry.params?.[1] === PROJECT).params,
      ["lab-tenant", PROJECT, EVENT],
    );
  });

  void it("未发布独立授权工程只返回 UNRELEASED，绝不冒充已发布", async () => {
    const { client, calls } = fixture({
      releaseState: [
        {
          release_generation: "0",
          released_revision: null,
          released_content_hash: null,
          last_release_event_id: null,
        },
      ],
    });
    assert.deepEqual(await inspectPublishedFixtureReadonly(client, target, PROJECT), {
      kind: "UNRELEASED",
    });
    assertReadonly(calls);
    assert.equal(
      calls.some((entry) => entry.sql.includes("scada_project_versions") && entry.params?.[1] === PROJECT),
      false,
    );
    assert.equal(
      calls.some((entry) => entry.sql.includes("scada_project_release_events") && entry.params?.[1] === PROJECT),
      false,
    );
  });

  void it("可信身份或 OIDC 预绑定缺失时不得查询工程", async () => {
    for (const change of [{ identity: [] }, { external: [] }]) {
      const { client, calls } = fixture(change);
      await assert.rejects(
        inspectPublishedFixtureReadonly(client, target, PROJECT),
        /D5b7c 发布夹具只读数据库元数据或迁移不符合预期/,
      );
      assertReadonly(calls);
      assert.equal(
        calls.some((entry) => entry.sql.includes("scada_projects")),
        false,
      );
    }
  });

  void it("工程不存在直接 DENIED，不读取发布状态", async () => {
    const { client, calls } = fixture({ project: [] });
    assert.deepEqual(await inspectPublishedFixtureReadonly(client, target, PROJECT), {
      kind: "DENIED",
    });
    assertReadonly(calls);
    assert.equal(
      calls.some((entry) => entry.sql.includes("scada_project_release_state") && entry.params?.[1] === PROJECT),
      false,
    );
  });

  void it("读取授权已撤销返回 DENIED，不查询事件与历史版本", async () => {
    const { client, calls } = fixture({ grants: [] });
    assert.deepEqual(await inspectPublishedFixtureReadonly(client, target, PROJECT), {
      kind: "DENIED",
    });
    assertReadonly(calls);
    assert.equal(
      calls.some((entry) => entry.sql.includes("scada_project_release_state") && entry.params?.[1] === PROJECT),
      false,
    );
  });

  void it("任何数据库名或实际登录用户不符必须拒绝并回滚", async () => {
    for (const database of [
      [{ database_name: "adui_scada_test", database_user: "adui_scada" }],
      [{ database_name: "adui_scada", database_user: "postgres" }],
    ]) {
      const { client, calls } = fixture({ database });
      await assert.rejects(
        inspectPublishedFixtureReadonly(client, target, PROJECT),
        /D5b7c 发布夹具只读数据库元数据或迁移不符合预期/,
      );
      assertReadonly(calls);
      assert.equal(
        calls.some((entry) => entry.sql.includes("scada_projects")),
        false,
      );
    }
  });

  void it("缺失或重复迁移与未处理迁移均拒绝", async () => {
    for (const change of [
      { migrations: [] },
      { migrations: [{ migration_name: MIGRATIONS[0] }, { migration_name: MIGRATIONS[0] }] },
      { unresolved: [{ count: 1 }] },
    ]) {
      const { client, calls } = fixture(change);
      await assert.rejects(
        inspectPublishedFixtureReadonly(client, target, PROJECT),
        /D5b7c 发布夹具只读数据库元数据或迁移不符合预期/,
      );
      assertReadonly(calls);
    }
  });

  void it("发布指针与目标版本或最后事件摘要不一致仍拒绝", async () => {
    for (const change of [
      { releasedVersion: [{ revision: "1", content_hash: "b".repeat(64) }] },
      { lastEvent: [] },
      {
        lastEvent: [
          {
            event_id: EVENT,
            tenant_id: "lab-tenant",
            project_id: "other",
            generation: "1",
            action: "PUBLISH",
            to_revision: "1",
            to_content_hash: HASH,
          },
        ],
      },
    ]) {
      const { client, calls } = fixture(change);
      await assert.rejects(
        inspectPublishedFixtureReadonly(client, target, PROJECT),
        /D5b7b 发布夹具只读元数据不完整或不一致/,
      );
      assertReadonly(calls);
    }
  });

  void it("非法工程 ID 和无效可信 Issuer 在事务前拒绝", async () => {
    const { client, calls } = fixture();
    await assert.rejects(
      inspectPublishedFixtureReadonly(client, target, "../../secret"),
      /仅允许显式指定独立已发布夹具/,
    );
    await assert.rejects(
      inspectPublishedFixtureReadonly(client, {}, PROJECT),
      /D5b7c 发布夹具只读数据库元数据或迁移不符合预期/,
    );
    assert.deepEqual(calls, []);
  });

  void it("SQL 查询失败必须执行 ROLLBACK，未知错误严格脱敏", async () => {
    const { client, calls } = fixture({ failOn: "scada_project_release_events" });
    await assert.rejects(inspectPublishedFixtureReadonly(client, target, PROJECT), /Token=SECRET/);
    assertReadonly(calls);
    assert.equal(
      describePublishedFixtureReadonlyFailure(new Error("Token=SECRET")),
      "D5b7c 数据库只读审查失败，内部诊断已脱敏",
    );
  });

  void it("诊断只接受固定中文原因，不透露任何工程正文或凭据", () => {
    assert.equal(
      describePublishedFixtureReadonlyFailure(new Error("D5b7b 发布夹具只读元数据不完整或不一致")),
      "D5b7b 发布夹具只读元数据不完整或不一致",
    );
    assert.equal(
      describePublishedFixtureReadonlyFailure({ message: "Password=SECRET" }),
      "D5b7c 数据库只读审查失败，内部诊断已脱敏",
    );
  });
});
