import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeTextTransaction } from "../apps/server/src/database/prisma8-text-transaction.ts";
import {
  createB4Project,
  lockB4Identity,
  lockB4SessionIdentity,
  lockB4ProjectGrants,
  lockB4ProjectVersion,
  lockB4ReleaseState,
  lockB4ReleaseEvent,
  lockB4ReleaseRequest,
  lockB4PriorPublish,
} from "../apps/server/src/database/prisma8-b4-routines.ts";

const tenant = "tenant-a";
const subject = "operator-a";
const project = "project-a";
const id = "00000000-0000-4000-8000-000000000001";
const snapshot = {
  projectId: project,
  revision: 1,
  contentHash: "a".repeat(64),
  createdAt: "2026-11-28T00:00:00.000Z",
  document: { name: "测试工程" },
};
const state = { generation: "0", revision: "", hash: "", event_id: "", hash_is_null: "true" };
const event = {
  event_id: id,
  generation: "2",
  action: "PUBLISH",
  revision: "1",
  hash: snapshot.contentHash,
  created_at: snapshot.createdAt,
  semantic_hash: "b".repeat(64),
};

function harness(rows = [], fault = false) {
  const plans = [];
  const tx = {
    raw: {
      sql(strings, ...parameters) {
        return {
          returnsRow: (columns) => ({
            build: () => ({ text: strings.join("?"), parameters, columns }),
          }),
        };
      },
    },
    query(plan) {
      plans.push(plan);
      if (fault) throw new Error("模拟例程不可用");
      return { toArray: () => Promise.resolve(rows) };
    },
    execute() {
      throw new Error("禁止回退直接写入");
    },
  };
  return { port: nativeTextTransaction(tx, "例程返回文本列无效"), plans };
}

void test("九条行锁例程使用固定签名、准确参数顺序和声明列", async () => {
  const cases = [
    [
      "scada_lock_identity",
      ["text", "text"],
      [tenant, subject],
      { status: "active" },
      (tx) => lockB4Identity(tx, tenant, subject),
    ],
    [
      "scada_lock_session_identity",
      ["text", "text", "uuid"],
      [tenant, subject, id],
      { session_id: id },
      (tx) => lockB4SessionIdentity(tx, tenant, subject, id),
    ],
    [
      "scada_lock_project_grants",
      ["text", "text", "text"],
      [tenant, project, subject],
      { permission: "version:append" },
      (tx) => lockB4ProjectGrants(tx, tenant, project, subject),
    ],
    [
      "scada_lock_project_version",
      ["text", "text", "bigint"],
      [tenant, project, 1n],
      { snapshot_data: "{}", content_hash: snapshot.contentHash, created_at: snapshot.createdAt },
      (tx) => lockB4ProjectVersion(tx, tenant, project, 1n),
    ],
    [
      "scada_lock_release_state_share",
      ["text", "text"],
      [tenant, project],
      state,
      (tx) => lockB4ReleaseState(tx, tenant, project, false),
    ],
    [
      "scada_lock_release_state_update",
      ["text", "text"],
      [tenant, project],
      state,
      (tx) => lockB4ReleaseState(tx, tenant, project, true),
    ],
    [
      "scada_lock_release_event",
      ["text", "text", "uuid"],
      [tenant, project, id],
      event,
      (tx) => lockB4ReleaseEvent(tx, tenant, project, id),
    ],
    [
      "scada_lock_release_request",
      ["text", "text", "text", "text", "text"],
      [tenant, project, subject, "PUBLISH", id],
      event,
      (tx) => lockB4ReleaseRequest(tx, tenant, project, subject, "PUBLISH", id),
    ],
    [
      "scada_lock_prior_publish",
      ["text", "text", "bigint", "bigint"],
      [tenant, project, 1n, 2n],
      event,
      (tx) => lockB4PriorPublish(tx, tenant, project, 1n, 2n),
    ],
  ];
  for (const [name, types, parameters, row, invoke] of cases) {
    const h = harness([row]);
    assert.deepEqual(await invoke(h.port), [row]);
    assert.equal(h.plans.length, 1);
    const [plan] = h.plans;
    const columns = Object.keys(row);
    assert.equal(
      plan.text,
      "SELECT " +
        columns.join(", ") +
        " FROM public." +
        name +
        "(" +
        types.map((type) => "?::" + type).join(", ") +
        ")",
    );
    assert.deepEqual(plan.parameters, parameters);
    assert.deepEqual(
      plan.columns,
      Object.fromEntries(columns.map((column) => [column, "pg/text@1"])),
    );
  }
});

void test("原子首版调用只传绑定参数并返回三个精确业务状态", async () => {
  for (const result of ["CREATED", "EXISTS", "DENIED"]) {
    const h = harness([{ result }]);
    assert.equal(await createB4Project(h.port, tenant, subject, snapshot, id), result);
    assert.deepEqual(h.plans, [
      {
        text: "SELECT public.scada_create_project(?::text, ?::text, ?::text, ?::jsonb, ?::text, ?::timestamptz, ?::uuid)::text AS result",
        parameters: [
          tenant,
          project,
          subject,
          JSON.stringify(snapshot),
          snapshot.contentHash,
          snapshot.createdAt,
          id,
        ],
        columns: { result: "pg/text@1" },
      },
    ]);
  }
});

void test("首版拒绝错误修订号、异常结果和无效列", async () => {
  const wrongRevision = harness([{ result: "CREATED" }]);
  await assert.rejects(
    () => createB4Project(wrongRevision.port, tenant, subject, { ...snapshot, revision: 2 }, id),
    { message: "工程首版修订号无效" },
  );
  assert.equal(wrongRevision.plans.length, 0);
  for (const rows of [
    [],
    [{ result: "UNKNOWN" }],
    [{ result: "CREATED" }, { result: "CREATED" }],
  ]) {
    const h = harness(rows);
    await assert.rejects(() => createB4Project(h.port, tenant, subject, snapshot, id), {
      message: "工程首版例程返回结果无效",
    });
    assert.equal(h.plans.length, 1);
  }
  for (const rows of [[{}], [{ result: null }]]) {
    const h = harness(rows);
    await assert.rejects(() => createB4Project(h.port, tenant, subject, snapshot, id), {
      message: "例程返回文本列无效",
    });
  }
});

void test("行锁空结果仍由调用者鉴权，异常列和例程故障不回退直接表操作", async () => {
  const empty = harness([]);
  assert.deepEqual(await lockB4Identity(empty.port, tenant, subject), []);
  const malformed = harness([{ status: null }]);
  await assert.rejects(() => lockB4Identity(malformed.port, tenant, subject), {
    message: "例程返回文本列无效",
  });
  const unavailable = harness([], true);
  await assert.rejects(() => lockB4ProjectGrants(unavailable.port, tenant, project, subject), {
    message: "模拟例程不可用",
  });
  assert.equal(unavailable.plans.length, 1);
  const creation = harness([], true);
  await assert.rejects(() => createB4Project(creation.port, tenant, subject, snapshot, id), {
    message: "模拟例程不可用",
  });
  assert.equal(creation.plans.length, 1);
});

void test("包含 SQL 字符的输入保持绑定参数，不拼接例程名或查询正文", async () => {
  const h = harness([]);
  const hostile = "x' OR '1'='1";
  await lockB4Identity(h.port, hostile, subject);
  assert.equal(h.plans[0].text, "SELECT status FROM public.scada_lock_identity(?::text, ?::text)");
  assert.deepEqual(h.plans[0].parameters, [hostile, subject]);
});
