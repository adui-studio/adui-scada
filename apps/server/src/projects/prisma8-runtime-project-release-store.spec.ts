import "reflect-metadata";
import { createHash } from "node:crypto";
import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import { describe, expect, it } from "vite-plus/test";
import {
  assertPrisma8Writable,
  readPrisma8Transaction,
  writePrisma8Transaction,
  type Prisma8Transaction,
} from "../database/prisma8-read-transaction.js";
import type { Prisma8Client, Prisma8Service } from "../database/prisma8.service.js";
import { Prisma8RuntimeProjectReleaseStore } from "./prisma8-runtime-project-release-store.js";

const actor = { tenantId: "tenant-a", subjectId: "operator-a" };
const projectId = waterTreatmentDemoDocument.projectId;
const sessionId = "9b0d8c2d-6d45-4f0f-8d5c-12e4a0d3a7a1";
const key = "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e8";
const eventId = "d47c7556-674b-4fba-9848-9a3f1edcc635";
const earlierEventId = "9bd5c867-588d-449e-8aef-d7691b3b8fa1";
const rollbackEventId = "7129a613-3f07-4107-8f89-c13a787a8e5c";
const createdAt = "2026-11-27T00:00:00.000Z";
const storageHash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
const publish = { expectedHeadRevision: 1, targetRevision: 1, expectedReleaseGeneration: 0 };
const rollback = { targetRevision: 1, expectedReleaseGeneration: 2 };
const denied = "工程资源不存在或无权访问";
const conflict = "工程发布状态或幂等请求已变化，请重新读取发布状态";
const gateDenied = "正式发布安全门禁尚未完成，当前请求已被安全拒绝";
const readOnlyDenied = "Prisma 8 只读提供方禁止写入";

type Row = Record<string, string>;
type Plan = { text: string; parameters: unknown[] };

function semanticHash(action: "PUBLISH" | "ROLLBACK"): string {
  const request =
    action === "PUBLISH" ? { action, projectId, ...publish } : { action, projectId, ...rollback };
  return createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
}

async function harness(readOnly = false) {
  const mode = readOnly ? "on" : "off";
  const config = { connectionString: undefined, expectedSystemIdentifier: "123456789", readOnly };
  const boundary = {
    database: "adui_scada",
    role: "adui_scada",
    sessionRole: "adui_scada",
    schema: "public",
    version: "190000",
    systemIdentifier: "123456789",
    storageHash,
    readOnly: mode,
    defaultReadOnly: mode,
    recovery: "false",
    isolation: "read committed",
  };
  const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
    revision: 1,
    createdAt,
  });
  const currentSnapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
    revision: 2,
    createdAt,
  });
  const targetEvent = {
    event_id: earlierEventId,
    generation: "1",
    action: "PUBLISH",
    revision: "1",
    hash: snapshot.contentHash,
    created_at: createdAt,
    semantic_hash: semanticHash("PUBLISH"),
  };
  const state = {
    missingProject: false,
    head: "1",
    activeSession: true,
    permissions: ["release:publish"],
    release: {
      generation: "0",
      revision: "",
      hash: "",
      event_id: "",
      hash_is_null: "true",
    },
    currentEvent: null as Row | null,
    priorEvent: null as Row | null,
    replay: null as Row | null,
    snapshotRows: [
      {
        snapshot_data: JSON.stringify(snapshot),
        content_hash: snapshot.contentHash,
        created_at: createdAt,
      },
    ] as Row[],
    boundaryChecks: 0,
    drift: false,
    committed: 0,
    rejected: 0,
  };
  const reads: Plan[] = [];
  const writes: Plan[] = [];
  const steps: string[] = [];
  const options: unknown[] = [];

  function released() {
    state.release = {
      generation: "2",
      revision: "2",
      hash: currentSnapshot.contentHash,
      event_id: eventId,
      hash_is_null: "false",
    };
    state.currentEvent = {
      event_id: eventId,
      generation: "2",
      action: "PUBLISH",
      revision: "2",
      hash: currentSnapshot.contentHash,
      created_at: createdAt,
      semantic_hash: "b".repeat(64),
    };
    state.priorEvent = targetEvent;
  }

  const tx = {
    raw: {
      sql: (strings: TemplateStringsArray, ...parameters: unknown[]) => {
        const plan = { text: strings.join("?"), parameters };
        return {
          returnsRow: () => ({ build: () => plan }),
          affectedCount: () => ({ build: () => plan }),
        };
      },
    },
    query: (plan: Plan) => {
      reads.push(plan);
      let rows: Row[];
      if (plan.text.includes("current_database()")) {
        steps.push("边界");
        state.boundaryChecks += 1;
        rows = [
          state.drift && state.boundaryChecks === 2 ? { ...boundary, role: "wrong" } : boundary,
        ];
      } else if (plan.text.includes("FROM public.scada_projects")) {
        steps.push("工程锁");
        rows = state.missingProject ? [] : [{ project_id: projectId, head_revision: state.head }];
      } else if (plan.text.includes("public.scada_lock_session_identity(")) {
        steps.push("会话锁");
        rows = state.activeSession ? [{ session_id: sessionId }] : [];
      } else if (plan.text.includes("public.scada_lock_project_grants(")) {
        steps.push("授权锁");
        rows = state.permissions.map((permission) => ({ permission }));
      } else if (plan.text.includes("public.scada_lock_release_state_")) {
        steps.push("发布状态");
        rows = [state.release];
      } else if (plan.text.includes("public.scada_lock_project_version(")) {
        steps.push("不可变快照");
        rows = state.snapshotRows;
      } else if (plan.text.includes("public.scada_lock_release_request(")) {
        steps.push("幂等事件");
        rows = state.replay ? [state.replay] : [];
      } else if (plan.text.includes("public.scada_lock_prior_publish(")) {
        steps.push("曾发布证明");
        rows = state.priorEvent ? [state.priorEvent] : [];
      } else if (plan.text.includes("public.scada_lock_release_event(")) {
        steps.push("当前事件");
        rows = state.currentEvent ? [state.currentEvent] : [];
      } else {
        throw new Error("原生发布事务出现未预期查询");
      }
      return { toArray: () => Promise.resolve(rows) };
    },
    execute: (plan: Plan) => {
      writes.push(plan);
      throw new Error("正式安全门禁未就绪时禁止发布数据写入");
    },
  };

  const client = {
    transaction: async (
      operation: (transaction: Prisma8Transaction) => Promise<unknown>,
      option: unknown,
    ) => {
      options.push(option);
      try {
        const result = await operation(tx as unknown as Prisma8Transaction);
        state.committed += 1;
        return result;
      } catch (error) {
        state.rejected += 1;
        throw error;
      }
    },
  } as unknown as Prisma8Client;
  const database = {
    assertWritable: () => assertPrisma8Writable(config),
    readTransaction: <T>(operation: (transaction: Prisma8Transaction) => Promise<T>) =>
      readPrisma8Transaction(client, config, storageHash, operation),
    writeTransaction: <T>(operation: (transaction: Prisma8Transaction) => Promise<T>) =>
      writePrisma8Transaction(client, config, storageHash, operation),
  } as Prisma8Service;

  return {
    store: new Prisma8RuntimeProjectReleaseStore(database),
    state,
    snapshot,
    currentSnapshot,
    targetEvent,
    released,
    steps,
    reads,
    writes,
    options,
  };
}

describe("全新原生工程发布与回滚仓储", () => {
  it("发布与回滚只接受各自白名单和有效幂等标识", async () => {
    const h = await harness();
    await expect(
      h.store.publish(actor, sessionId, projectId, { ...publish, actorId: "伪造" }, key),
    ).rejects.toThrow(
      "正式发布请求只允许 expectedHeadRevision、targetRevision 和 expectedReleaseGeneration",
    );
    await expect(
      h.store.rollback(actor, sessionId, projectId, { ...rollback, expectedHeadRevision: 1 }, key),
    ).rejects.toThrow("正式回滚请求只允许 targetRevision 和 expectedReleaseGeneration");
    await expect(
      h.store.rollback(
        actor,
        sessionId,
        projectId,
        { ...rollback, expectedReleaseGeneration: 0 },
        key,
      ),
    ).rejects.toThrow("预期发布代次必须是大于零的安全整数");
    await expect(h.store.publish(actor, sessionId, projectId, publish, "invalid")).rejects.toThrow(
      "Idempotency-Key 必须为服务端生成的 UUID v4",
    );
    await expect(h.store.readCurrent(null, sessionId, projectId)).rejects.toThrow(denied);
    expect(h.options).toHaveLength(0);
  });

  it("严格只读配置拒绝三个需要行锁的入口且不获取事务", async () => {
    const h = await harness(true);
    await expect(h.store.readCurrent(actor, sessionId, projectId)).rejects.toThrow(readOnlyDenied);
    await expect(h.store.publish(actor, sessionId, projectId, publish, key)).rejects.toThrow(
      readOnlyDenied,
    );
    await expect(h.store.rollback(actor, sessionId, projectId, rollback, key)).rejects.toThrow(
      readOnlyDenied,
    );
    expect(h.options).toHaveLength(0);
    expect(h.reads).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
  });

  it("未发布状态仅在会话与独立读取权限的共享锁内返回", async () => {
    const h = await harness();
    h.state.permissions = ["release:read"];
    await expect(h.store.readCurrent(actor, sessionId, projectId)).resolves.toEqual({
      status: "UNRELEASED",
      projectId,
      releaseGeneration: 0,
    });
    expect(h.steps).toEqual(["边界", "工程锁", "会话锁", "授权锁", "发布状态", "边界"]);
    expect(h.options).toEqual([{ isolationLevel: "ReadCommitted", timeout: 10000 }]);
    expect(h.reads[1]?.parameters).toEqual([actor.tenantId, projectId]);
    expect(h.reads[2]?.parameters).toEqual([actor.tenantId, actor.subjectId, sessionId]);
    expect(h.reads[2]?.text).toContain("public.scada_lock_session_identity(");
    expect(h.reads[3]?.parameters).toEqual([actor.tenantId, projectId, actor.subjectId]);
    expect(h.reads[3]?.text).toContain("public.scada_lock_project_grants(");
    expect(h.reads[4]?.text).toContain("public.scada_lock_release_state_share(");
    expect(h.reads.every((plan) => !plan.text.includes("head_revision"))).toBe(true);
    expect(h.writes).toHaveLength(0);
  });

  it("读取当前已发布快照必须核验指针、末次回滚事件和不可变摘要", async () => {
    const h = await harness();
    h.released();
    h.state.permissions = ["release:read"];
    h.state.currentEvent = { ...h.state.currentEvent!, action: "ROLLBACK" };
    h.state.snapshotRows = [
      {
        snapshot_data: JSON.stringify(h.currentSnapshot),
        content_hash: h.currentSnapshot.contentHash,
        created_at: createdAt,
      },
    ];
    await expect(h.store.readCurrent(actor, sessionId, projectId)).resolves.toEqual({
      status: "RELEASED",
      projectId,
      releasedRevision: 2,
      releasedContentHash: h.currentSnapshot.contentHash,
      releaseGeneration: 2,
      eventId,
      lastAction: "ROLLBACK",
      releasedAt: createdAt,
      snapshot: h.currentSnapshot,
    });
    expect(h.steps).toEqual([
      "边界",
      "工程锁",
      "会话锁",
      "授权锁",
      "发布状态",
      "不可变快照",
      "当前事件",
      "边界",
    ]);
    expect(h.writes).toHaveLength(0);
  });

  it("缺失工程、失效会话及非独立读取权限不得接触发布状态", async () => {
    const missing = await harness();
    missing.state.missingProject = true;
    await expect(missing.store.readCurrent(actor, sessionId, projectId)).rejects.toThrow(denied);
    expect(missing.steps).toEqual(["边界", "工程锁"]);
    const expired = await harness();
    expired.state.activeSession = false;
    await expect(expired.store.readCurrent(actor, sessionId, projectId)).rejects.toThrow(
      "身份会话无效或已经失效",
    );
    expect(expired.steps).toEqual(["边界", "工程锁", "会话锁"]);
    for (const permissions of [["version:read"], ["release:read", "unknown"]]) {
      const h = await harness();
      h.state.permissions = permissions;
      await expect(h.store.readCurrent(actor, sessionId, projectId)).rejects.toThrow(denied);
      expect(h.steps).toEqual(["边界", "工程锁", "会话锁", "授权锁"]);
    }
  });

  it("非十进制发布代次及当前指针与事件不一致时失败关闭", async () => {
    const invalid = await harness();
    invalid.state.permissions = ["release:read"];
    invalid.state.release.generation = "0x0";
    await expect(invalid.store.readCurrent(actor, sessionId, projectId)).rejects.toThrow(
      "数据库工程正式发布状态不符合生命周期约束",
    );
    const h = await harness();
    h.released();
    h.state.permissions = ["release:read"];
    h.state.snapshotRows = [
      {
        snapshot_data: JSON.stringify(h.currentSnapshot),
        content_hash: h.currentSnapshot.contentHash,
        created_at: createdAt,
      },
    ];
    h.state.currentEvent = { ...h.state.currentEvent!, generation: "1" };
    await expect(h.store.readCurrent(actor, sessionId, projectId)).rejects.toThrow(
      "数据库当前正式发布事件与指针不一致",
    );
    expect(h.state.committed).toBe(0);
    expect(h.writes).toHaveLength(0);
  });

  it("合法发布仍由固定生产安全门禁拒绝且不执行任何写入", async () => {
    const h = await harness();
    await expect(h.store.publish(actor, sessionId, projectId, publish, key)).rejects.toMatchObject({
      message: gateDenied,
      blocks: expect.arrayContaining([
        { code: "RUNTIME_ADMISSION_UNAVAILABLE", path: "runtime" },
        { code: "INDUSTRIAL_READ_POLICY_UNAVAILABLE", path: "industrial" },
      ]),
    });
    expect(h.steps).toEqual([
      "边界",
      "工程锁",
      "会话锁",
      "授权锁",
      "发布状态",
      "幂等事件",
      "不可变快照",
    ]);
    expect(h.reads[1]?.text).toContain("FOR UPDATE");
    expect(h.reads[4]?.text).toContain("public.scada_lock_release_state_update(");
    expect(h.reads[5]?.text).toContain("public.scada_lock_release_request(");
    expect(h.reads[5]?.parameters).toEqual([
      actor.tenantId,
      projectId,
      actor.subjectId,
      "PUBLISH",
      key,
    ]);
    expect(h.state.rejected).toBe(1);
    expect(h.writes).toHaveLength(0);
  });

  it("编辑水位冲突及发布代次冲突均不读取目标快照", async () => {
    const stale = await harness();
    stale.state.head = "2";
    await expect(stale.store.publish(actor, sessionId, projectId, publish, key)).rejects.toThrow(
      "工程版本已变化，请重新获取最新修订号",
    );
    expect(stale.steps).not.toContain("不可变快照");
    const h = await harness();
    h.released();
    await expect(h.store.publish(actor, sessionId, projectId, publish, key)).rejects.toThrow(
      conflict,
    );
    expect(h.steps).not.toContain("不可变快照");
    expect(h.writes).toHaveLength(0);
  });

  it("同主体同动作同语义发布重试返回原事件而不是当前编辑水位", async () => {
    const h = await harness();
    h.released();
    h.state.head = "3";
    h.state.replay = h.targetEvent;
    await expect(h.store.publish(actor, sessionId, projectId, publish, key)).resolves.toEqual({
      projectId,
      action: "PUBLISH",
      headRevision: 1,
      releasedRevision: 1,
      releasedContentHash: h.snapshot.contentHash,
      releaseGeneration: 1,
      eventId: earlierEventId,
      createdAt,
    });
    expect(h.steps).not.toContain("不可变快照");
    expect(h.writes).toHaveLength(0);
    const invalid = await harness();
    invalid.released();
    invalid.state.replay = { ...invalid.targetEvent, semantic_hash: "c".repeat(64) };
    await expect(invalid.store.publish(actor, sessionId, projectId, publish, key)).rejects.toThrow(
      conflict,
    );
    expect(invalid.writes).toHaveLength(0);
  });

  it("回滚必须独立授权且拒绝过期代次和当前版本", async () => {
    const unauthorized = await harness();
    unauthorized.released();
    await expect(
      unauthorized.store.rollback(actor, sessionId, projectId, rollback, key),
    ).rejects.toThrow(denied);
    expect(unauthorized.steps).not.toContain("发布状态");
    const stale = await harness();
    stale.released();
    stale.state.permissions = ["release:rollback"];
    await expect(
      stale.store.rollback(
        actor,
        sessionId,
        projectId,
        { ...rollback, expectedReleaseGeneration: 1 },
        key,
      ),
    ).rejects.toThrow(conflict);
    expect(stale.steps).not.toContain("曾发布证明");
    const same = await harness();
    same.released();
    same.state.permissions = ["release:rollback"];
    await expect(
      same.store.rollback(actor, sessionId, projectId, { ...rollback, targetRevision: 2 }, key),
    ).rejects.toThrow(conflict);
    expect(same.writes).toHaveLength(0);
  });

  it("已保存但没有同租户工程首发证明的版本不能成为回滚目标", async () => {
    const h = await harness();
    h.released();
    h.state.permissions = ["release:rollback"];
    h.state.priorEvent = null;
    await expect(h.store.rollback(actor, sessionId, projectId, rollback, key)).rejects.toThrow(
      conflict,
    );
    const proof = h.reads.find((plan) => plan.text.includes("public.scada_lock_prior_publish("));
    expect(proof?.parameters).toEqual([actor.tenantId, projectId, 1n, 2n]);
    expect(proof?.text).toContain(
      "public.scada_lock_prior_publish(?::text, ?::text, ?::bigint, ?::bigint)",
    );
    expect(h.steps).not.toContain("不可变快照");
    expect(h.writes).toHaveLength(0);
  });

  it("真实首发凭证与快照匹配的回滚仍需当前安全门禁且不读取编辑 head", async () => {
    const h = await harness();
    h.released();
    h.state.permissions = ["release:rollback"];
    await expect(h.store.rollback(actor, sessionId, projectId, rollback, key)).rejects.toThrow(
      gateDenied,
    );
    expect(h.steps).toEqual([
      "边界",
      "工程锁",
      "会话锁",
      "授权锁",
      "发布状态",
      "幂等事件",
      "当前事件",
      "曾发布证明",
      "不可变快照",
    ]);
    expect(h.reads[1]?.text).toContain("FOR UPDATE");
    expect(h.reads.every((plan) => !plan.text.includes("head_revision"))).toBe(true);
    expect(h.reads[5]?.parameters).toEqual([
      actor.tenantId,
      projectId,
      actor.subjectId,
      "ROLLBACK",
      key,
    ]);
    expect(h.state.rejected).toBe(1);
    expect(h.writes).toHaveLength(0);
  });

  it("回滚目标快照摘要与既有发布事件不一致时拒绝", async () => {
    const h = await harness();
    h.released();
    h.state.permissions = ["release:rollback"];
    h.state.priorEvent = { ...h.targetEvent, hash: "c".repeat(64) };
    await expect(h.store.rollback(actor, sessionId, projectId, rollback, key)).rejects.toThrow(
      "数据库回滚目标快照与发布事件不一致",
    );
    expect(h.writes).toHaveLength(0);
    expect(h.state.committed).toBe(0);
  });

  it("回滚幂等重放不虚构编辑 head 且拒绝与请求代次不一致的事件", async () => {
    const h = await harness();
    h.released();
    h.state.permissions = ["release:rollback"];
    h.state.release.generation = "4";
    h.state.currentEvent = { ...h.state.currentEvent!, generation: "4" };
    h.state.replay = {
      ...h.targetEvent,
      event_id: rollbackEventId,
      generation: "3",
      action: "ROLLBACK",
      semantic_hash: semanticHash("ROLLBACK"),
    };
    await expect(h.store.rollback(actor, sessionId, projectId, rollback, key)).resolves.toEqual({
      projectId,
      action: "ROLLBACK",
      releasedRevision: 1,
      releasedContentHash: h.snapshot.contentHash,
      releaseGeneration: 3,
      eventId: rollbackEventId,
      createdAt,
    });
    expect(h.steps).not.toContain("曾发布证明");
    expect(h.writes).toHaveLength(0);
    const invalid = await harness();
    invalid.released();
    invalid.state.permissions = ["release:rollback"];
    invalid.state.release.generation = "4";
    invalid.state.currentEvent = { ...invalid.state.currentEvent!, generation: "4" };
    invalid.state.replay = { ...h.state.replay, generation: "2" };
    await expect(
      invalid.store.rollback(actor, sessionId, projectId, rollback, key),
    ).rejects.toThrow(conflict);
    expect(invalid.writes).toHaveLength(0);
  });

  it("读取返回之前原生事务后置身份漂移拒绝结果", async () => {
    const h = await harness();
    h.state.permissions = ["release:read"];
    h.state.drift = true;
    await expect(h.store.readCurrent(actor, sessionId, projectId)).rejects.toThrow(
      "Prisma 8 运行时数据库身份、标记或连接边界不一致",
    );
    expect(h.steps.at(-1)).toBe("边界");
    expect(h.state.committed).toBe(0);
    expect(h.state.rejected).toBe(1);
  });
});
