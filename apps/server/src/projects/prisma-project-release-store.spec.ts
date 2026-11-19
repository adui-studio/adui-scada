import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";
import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
import type { PrismaService } from "../database/prisma.service.js";
import type { AuthenticatedProjectPrincipal } from "./project-access-policy.js";
import {
  PrismaProjectReleaseStore,
  ProjectReleaseConflictError,
  ProjectReleasePreflightRejectedError,
  ProjectReleaseSessionInvalidError,
} from "./prisma-project-release-store.js";
import {
  ProjectReleaseGateUnavailableError,
  ProjectReleaseSafetyGate,
} from "./project-release-safety-gate.js";

const PRINCIPAL: AuthenticatedProjectPrincipal = {
  tenantId: "tenant-release-test",
  subjectId: "engineer-release-test",
};
const SESSION_ID = "9b0d8c2d-6d45-4f0f-8d5c-12e4a0d3a7a1";
const PROJECT_ID = waterTreatmentDemoDocument.projectId;
const CREATED_AT = "2026-11-19T00:00:00.000Z";
const REQUEST = {
  expectedHeadRevision: 1,
  targetRevision: 1,
  expectedReleaseGeneration: 0,
};
const IDEMPOTENCY_KEY = "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e8";

function createDocument(unsupported = false): ScadaDocument {
  const copy = JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) as ScadaDocument;
  if (unsupported) {
    const node = copy.pages[0]?.nodes[1];
    if (!node) throw new Error("测试工程缺少预期图元");
    (node.props as Record<string, unknown>).color = "red";
  }
  return copy;
}

function semanticHash(
  projectId: string,
  request: typeof REQUEST = REQUEST,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action: "PUBLISH",
        projectId,
        expectedHeadRevision: request.expectedHeadRevision,
        targetRevision: request.targetRevision,
        expectedReleaseGeneration: request.expectedReleaseGeneration,
      }),
      "utf8",
    )
    .digest("hex");
}

interface HarnessOptions {
  readonly head?: bigint;
  readonly sessionActive?: boolean;
  readonly permissions?: readonly string[];
  readonly state?: {
    readonly releaseGeneration: bigint;
    readonly releasedRevision: bigint | null;
    readonly releasedContentHash: string | null;
    readonly lastReleaseEventId: string | null;
  };
  readonly snapshot?: Awaited<ReturnType<typeof createProjectSnapshot>>;
  readonly storedHash?: string;
  readonly previousEvent?: {
    readonly eventId: string;
    readonly generation: bigint;
    readonly action: string;
    readonly toRevision: bigint;
    readonly toContentHash: string;
    readonly createdAt: Date;
    readonly requestSemanticHash: string;
  } | null;
  readonly updateCount?: number;
  readonly allowGate?: boolean;
}

async function createHarness(options: HarnessOptions = {}) {
  const steps: string[] = [];
  const snapshot =
    options.snapshot ??
    (await createProjectSnapshot(createDocument(), {
      revision: 1,
      createdAt: CREATED_AT,
    }));
  const state = options.state ?? {
    releaseGeneration: 0n,
    releasedRevision: null,
    releasedContentHash: null,
    lastReleaseEventId: null,
  };
  const eventId = "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e8";

  const tx = {
    $queryRaw: vi.fn<
      (parts: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>
    >(async (parts) => {
      const query = parts.join("?");
      if (query.includes("FROM scada_projects")) {
        steps.push("锁定工程");
        return [{ head_revision: options.head ?? 1n }];
      }
      if (query.includes("FROM scada_auth_sessions")) {
        steps.push("锁定会话与主体");
        return options.sessionActive === false ? [] : [{ session_id: SESSION_ID }];
      }
      if (query.includes("FROM scada_project_grants")) {
        steps.push("锁定发布授权");
        return (options.permissions ?? ["release:publish"]).map((permission) => ({ permission }));
      }
      if (query.includes("FROM scada_project_release_state")) {
        steps.push("锁定发布状态");
        return [{ release_generation: state.releaseGeneration }];
      }
      throw new Error("测试遇到未登记的数据库锁查询");
    }),
    scadaProjectReleaseState: {
      findUnique: vi.fn(async () => {
        steps.push("读取发布状态");
        return state;
      }),
      updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => {
        steps.push("更新发布指针");
        expect(args.data.releaseGeneration).toBe(state.releaseGeneration + 1n);
        return { count: options.updateCount ?? 1 };
      }),
    },
    scadaProjectReleaseEvent: {
      findFirst: vi.fn(async () => {
        steps.push("查询幂等事件");
        return options.previousEvent ?? null;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        steps.push("追加发布事件");
        return {
          eventId: args.data.eventId,
          generation: args.data.generation,
          action: args.data.action,
          toRevision: args.data.toRevision,
          toContentHash: args.data.toContentHash,
          createdAt: args.data.createdAt,
        };
      }),
    },
    scadaProjectVersion: {
      findUnique: vi.fn(async () => {
        steps.push("读取不可变快照");
        return {
          snapshot,
          contentHash: options.storedHash ?? snapshot.contentHash,
          createdAt: new Date(snapshot.createdAt),
        };
      }),
    },
  };
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );
  const database = { client: { $transaction: transaction } } as unknown as PrismaService;
  const gate = options.allowGate
    ? {
        assertReady: vi.fn(async () => {
          steps.push("通过测试安全门禁");
        }),
      }
    : new ProjectReleaseSafetyGate();

  return {
    store: new PrismaProjectReleaseStore(database, gate as ProjectReleaseSafetyGate),
    tx,
    steps,
    transaction,
    gate,
    snapshot,
    eventId,
  };
}

describe("正式发布事务仓储", () => {
  it("请求字段、幂等键或目标版本无效时不打开数据库事务", async () => {
    const harness = await createHarness();
    for (const [input, key] of [
      [{ ...REQUEST, actorId: "attacker" }, IDEMPOTENCY_KEY],
      [{ ...REQUEST, snapshot: {} }, IDEMPOTENCY_KEY],
      [{ ...REQUEST, targetRevision: 2 }, IDEMPOTENCY_KEY],
      [REQUEST, ""],
      [REQUEST, "scada_s_" + "s".repeat(43)],
      [REQUEST, "B2F8A51C-03C6-4E6C-A4D0-4D7F6EF4A4E8"],
      [REQUEST, ["duplicate", "header"]],
    ] as const) {
      await expect(
        harness.store.publish(PRINCIPAL, SESSION_ID, PROJECT_ID, input, key),
      ).rejects.toThrow(/正式发布请求|Idempotency-Key/);
    }
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it("缺少可信主体时不访问数据库；缺少会话标识时在事务锁内拒绝", async () => {
    const noPrincipal = await createHarness();
    await expect(
      noPrincipal.store.publish(null, SESSION_ID, PROJECT_ID, REQUEST, IDEMPOTENCY_KEY),
    ).rejects.toThrow(/不存在或无权访问/);
    expect(noPrincipal.transaction).not.toHaveBeenCalled();

    const noSession = await createHarness();
    await expect(
      noSession.store.publish(PRINCIPAL, null, PROJECT_ID, REQUEST, IDEMPOTENCY_KEY),
    ).rejects.toBeInstanceOf(ProjectReleaseSessionInvalidError);
    expect(noSession.steps).toEqual(["锁定工程"]);
  });

  it("按工程、会话、主体、ACL、发布状态的固定顺序锁定并复核权限", async () => {
    const harness = await createHarness({ sessionActive: false });
    await expect(
      harness.store.publish(PRINCIPAL, SESSION_ID, PROJECT_ID, REQUEST, IDEMPOTENCY_KEY),
    ).rejects.toBeInstanceOf(ProjectReleaseSessionInvalidError);
    expect(harness.steps).toEqual(["锁定工程", "锁定会话与主体"]);
    expect(harness.tx.scadaProjectReleaseEvent.create).not.toHaveBeenCalled();
  });

  it("缺少独立 release:publish 授权时拒绝且不读取发布状态", async () => {
    const harness = await createHarness({ permissions: ["project:read", "version:append"] });
    await expect(
      harness.store.publish(PRINCIPAL, SESSION_ID, PROJECT_ID, REQUEST, IDEMPOTENCY_KEY),
    ).rejects.toThrow(/不存在或无权访问/);
    expect(harness.steps).toEqual(["锁定工程", "锁定会话与主体", "锁定发布授权"]);
    expect(harness.tx.scadaProjectReleaseState.findUnique).not.toHaveBeenCalled();
    expect(harness.tx.scadaProjectReleaseEvent.create).not.toHaveBeenCalled();
  });

  it("head 或 releaseGeneration 发生变化时返回冲突且不写事件", async () => {
    const staleHead = await createHarness({ head: 2n, allowGate: true });
    await expect(
      staleHead.store.publish(PRINCIPAL, SESSION_ID, PROJECT_ID, REQUEST, IDEMPOTENCY_KEY),
    ).rejects.toThrow(/工程版本已变化/);
    expect(staleHead.tx.scadaProjectReleaseEvent.create).not.toHaveBeenCalled();

    const staleGeneration = await createHarness({
      state: {
        releaseGeneration: 1n,
        releasedRevision: 1n,
        releasedContentHash: "a".repeat(64),
        lastReleaseEventId: "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e8",
      },
      allowGate: true,
    });
    await expect(
      staleGeneration.store.publish(
        PRINCIPAL,
        SESSION_ID,
        PROJECT_ID,
        REQUEST,
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(ProjectReleaseConflictError);
    expect(staleGeneration.tx.scadaProjectReleaseEvent.create).not.toHaveBeenCalled();
  });

  it("不同幂等键重复选择当前已发布修订时保守冲突", async () => {
    const harness = await createHarness({
      state: {
        releaseGeneration: 1n,
        releasedRevision: 1n,
        releasedContentHash: "a".repeat(64),
        lastReleaseEventId: "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e8",
      },
      allowGate: true,
    });
    await expect(
      harness.store.publish(
        PRINCIPAL,
        SESSION_ID,
        PROJECT_ID,
        { ...REQUEST, expectedReleaseGeneration: 1 },
        "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e9",
      ),
    ).rejects.toBeInstanceOf(ProjectReleaseConflictError);
    expect(harness.tx.scadaProjectVersion.findUnique).not.toHaveBeenCalled();
    expect(harness.tx.scadaProjectReleaseEvent.create).not.toHaveBeenCalled();
  });

  it("快照摘要或数据库元数据不一致时拒绝发布", async () => {
    const snapshot = await createProjectSnapshot(createDocument(), {
      revision: 1,
      createdAt: CREATED_AT,
    });
    const harness = await createHarness({
      snapshot,
      storedHash: "0".repeat(64),
      allowGate: true,
    });
    await expect(
      harness.store.publish(PRINCIPAL, SESSION_ID, PROJECT_ID, REQUEST, IDEMPOTENCY_KEY),
    ).rejects.toThrow(/数据库工程版本元数据与快照不一致/);
    expect(harness.tx.scadaProjectReleaseEvent.create).not.toHaveBeenCalled();
  });

  it("静态兼容性不通过时返回结构化问题且不调用工业安全门禁", async () => {
    const snapshot = await createProjectSnapshot(createDocument(true), {
      revision: 1,
      createdAt: CREATED_AT,
    });
    const harness = await createHarness({ snapshot, allowGate: true });
    await expect(
      harness.store.publish(PRINCIPAL, SESSION_ID, PROJECT_ID, REQUEST, IDEMPOTENCY_KEY),
    ).rejects.toBeInstanceOf(ProjectReleasePreflightRejectedError);
    expect(harness.gate.assertReady).not.toHaveBeenCalled();
    expect(harness.tx.scadaProjectReleaseEvent.create).not.toHaveBeenCalled();
  });

  it("当前正式工业安全门禁默认拒绝且不会写入事件或发布指针", async () => {
    const harness = await createHarness();
    await expect(
      harness.store.publish(PRINCIPAL, SESSION_ID, PROJECT_ID, REQUEST, IDEMPOTENCY_KEY),
    ).rejects.toBeInstanceOf(ProjectReleaseGateUnavailableError);
    expect(harness.tx.scadaProjectReleaseEvent.create).not.toHaveBeenCalled();
    expect(harness.tx.scadaProjectReleaseState.updateMany).not.toHaveBeenCalled();
  });

  it("通过隔离测试门禁后在同一事务追加事件并 CAS 更新发布指针", async () => {
    const harness = await createHarness({ allowGate: true });
    const result = await harness.store.publish(
      PRINCIPAL,
      SESSION_ID,
      PROJECT_ID,
      REQUEST,
      IDEMPOTENCY_KEY,
    );

    expect(result).toMatchObject({
      projectId: PROJECT_ID,
      action: "PUBLISH",
      headRevision: 1,
      releasedRevision: 1,
      releasedContentHash: harness.snapshot.contentHash,
      releaseGeneration: 1,
    });
    expect(result.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(Date.parse(result.createdAt)).not.toBeNaN();
    const createdEvent = harness.tx.scadaProjectReleaseEvent.create.mock.calls[0]?.[0];
    expect(result.eventId).toBe(createdEvent?.data.eventId);
    expect(harness.steps).toEqual([
      "锁定工程",
      "锁定会话与主体",
      "锁定发布授权",
      "锁定发布状态",
      "读取发布状态",
      "查询幂等事件",
      "读取不可变快照",
      "通过测试安全门禁",
      "追加发布事件",
      "更新发布指针",
    ]);
    expect(harness.tx.scadaProjectReleaseEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: PRINCIPAL.tenantId,
          projectId: PROJECT_ID,
          generation: 1n,
          action: "PUBLISH",
          fromRevision: null,
          fromContentHash: null,
          toRevision: 1n,
          toContentHash: harness.snapshot.contentHash,
          actorId: PRINCIPAL.subjectId,
          idempotencyKey: IDEMPOTENCY_KEY,
          requestSemanticHash: semanticHash(PROJECT_ID),
        }),
      }),
    );
    expect(harness.tx.scadaProjectReleaseState.updateMany).toHaveBeenCalledTimes(1);
  });

  it("相同幂等键和语义重试返回原事件而不新增事件或代次", async () => {
    const previousEvent = {
      eventId: "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e8",
      generation: 1n,
      action: "PUBLISH",
      toRevision: 1n,
      toContentHash: "a".repeat(64),
      createdAt: new Date(CREATED_AT),
      requestSemanticHash: semanticHash(PROJECT_ID),
    };
    const harness = await createHarness({ previousEvent, allowGate: true });
    const result = await harness.store.publish(
      PRINCIPAL,
      SESSION_ID,
      PROJECT_ID,
      REQUEST,
      IDEMPOTENCY_KEY,
    );

    expect(result.eventId).toBe(previousEvent.eventId);
    expect(result.releaseGeneration).toBe(1);
    expect(harness.tx.scadaProjectVersion.findUnique).not.toHaveBeenCalled();
    expect(harness.tx.scadaProjectReleaseEvent.create).not.toHaveBeenCalled();
    expect(harness.tx.scadaProjectReleaseState.updateMany).not.toHaveBeenCalled();
  });

  it("相同幂等键携带不同语义时冲突且不新增事件", async () => {
    const previousEvent = {
      eventId: "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e8",
      generation: 1n,
      action: "PUBLISH",
      toRevision: 1n,
      toContentHash: "a".repeat(64),
      createdAt: new Date(CREATED_AT),
      requestSemanticHash: "0".repeat(64),
    };
    const harness = await createHarness({ previousEvent, allowGate: true });
    await expect(
      harness.store.publish(PRINCIPAL, SESSION_ID, PROJECT_ID, REQUEST, IDEMPOTENCY_KEY),
    ).rejects.toBeInstanceOf(ProjectReleaseConflictError);
    expect(harness.tx.scadaProjectReleaseEvent.create).not.toHaveBeenCalled();
  });

  it("发布指针 CAS 未更新任何行时拒绝并让事务整体回滚", async () => {
    const harness = await createHarness({ allowGate: true, updateCount: 0 });
    await expect(
      harness.store.publish(PRINCIPAL, SESSION_ID, PROJECT_ID, REQUEST, IDEMPOTENCY_KEY),
    ).rejects.toBeInstanceOf(ProjectReleaseConflictError);
    expect(harness.tx.scadaProjectReleaseEvent.create).toHaveBeenCalledTimes(1);
    expect(harness.tx.scadaProjectReleaseState.updateMany).toHaveBeenCalledTimes(1);
  });
});
