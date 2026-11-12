import { describe, expect, it, vi } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { createProjectSnapshot } from "@adui/scada-core";
import type { ProjectSnapshot } from "@adui/scada-core";
import type { PrismaService } from "../database/prisma.service.js";
import type { AuthenticatedProjectPrincipal } from "./project-access-policy.js";
import {
  PrismaProjectVersionStore,
  ProjectRevisionConflictError,
  ProjectRevisionNotFoundError,
  ProjectVersionAccessDeniedError,
} from "./prisma-project-version-store.js";

const principal: AuthenticatedProjectPrincipal = { tenantId: "tenant-a", subjectId: "engineer-1" };
const document = () => JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
const projectId = waterTreatmentDemoDocument.projectId;
const save = (expectedRevision: number | null = null) => ({
  expectedRevision,
  document: document(),
});

interface FakeOptions {
  readonly projectExists?: boolean;
  readonly head?: bigint;
  readonly permissions?: string[];
  readonly failAudit?: boolean;
  readonly stored?: ProjectSnapshot | null;
  readonly storedHash?: string;
}

function mockStore(options: FakeOptions = {}) {
  const steps: string[] = [];
  const tx = {
    $queryRaw: vi.fn<
      (
        parts: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<Array<{ head_revision: bigint }>>
    >(async (parts, ...values) => {
      steps.push("工程行锁");
      const query = parts.join("?");
      expect(query).toMatch(/FOR (?:UPDATE|SHARE)/);
      expect(values).toEqual([principal.tenantId, projectId]);
      if (options.projectExists === false) return [];
      return [{ head_revision: options.head ?? 0n }];
    }),
    scadaProjectGrant: {
      findMany: vi.fn<() => Promise<Array<{ permission: string }>>>(async () => {
        steps.push("权限复查");
        return (options.permissions ?? ["version:append", "version:read"]).map((permission) => ({
          permission,
        }));
      }),
    },
    scadaProjectVersion: {
      create: vi.fn<(_request: { data: Record<string, unknown> }) => Promise<void>>(
        async (_request) => {
          steps.push("写入版本");
        },
      ),
      findUnique: vi.fn<
        () => Promise<{ snapshot: ProjectSnapshot; contentHash: string; createdAt: Date } | null>
      >(async () => {
        steps.push("读取版本");
        const snapshot = options.stored;
        if (!snapshot) return null;
        return {
          snapshot,
          contentHash: options.storedHash ?? snapshot.contentHash,
          createdAt: new Date(snapshot.createdAt),
        };
      }),
    },
    scadaProject: {
      update: vi.fn<(_request: { data: Record<string, unknown> }) => Promise<void>>(
        async (_request) => {
          steps.push("推进修订号");
        },
      ),
    },
    scadaProjectAudit: {
      create: vi.fn<(_request: { data: Record<string, unknown> }) => Promise<void>>(
        async (_request) => {
          steps.push("写入审计");
          if (options.failAudit) throw new Error("模拟审计数据库写入失败");
        },
      ),
    },
  };
  const transaction = vi.fn<
    (callback: (client: typeof tx) => Promise<unknown>) => Promise<unknown>
  >(async (callback) => {
    return callback(tx);
  });
  const db = { client: { $transaction: transaction } } as unknown as PrismaService;
  return { store: new PrismaProjectVersionStore(db), tx, steps, transaction };
}

describe("Prisma 工程版本事务仓储", () => {
  it("拒绝空主体和无效租户，且不访问数据库", async () => {
    const fake = mockStore();
    await expect(fake.store.append(null, projectId, save())).rejects.toBeInstanceOf(
      ProjectVersionAccessDeniedError,
    );
    await expect(
      fake.store.append({ tenantId: "../danger", subjectId: "user" }, projectId, save()),
    ).rejects.toBeInstanceOf(ProjectVersionAccessDeniedError);
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it("拒绝伪造身份字段或文档工程 ID 不一致的保存请求", async () => {
    const fake = mockStore();
    await expect(
      fake.store.append(principal, projectId, { ...save(), actorId: "another-user" }),
    ).rejects.toThrow(/只允许/);
    await expect(fake.store.append(principal, "different-project", save())).rejects.toThrow(
      /不一致/,
    );
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it("工程不存在和授权缺失使用相同的拒绝错误", async () => {
    const missing = mockStore({ projectExists: false });
    await expect(missing.store.append(principal, projectId, save())).rejects.toBeInstanceOf(
      ProjectVersionAccessDeniedError,
    );
    const forbidden = mockStore({ permissions: [] });
    await expect(forbidden.store.append(principal, projectId, save())).rejects.toBeInstanceOf(
      ProjectVersionAccessDeniedError,
    );
    expect(missing.tx.scadaProjectVersion.create).not.toHaveBeenCalled();
    expect(forbidden.tx.scadaProjectVersion.create).not.toHaveBeenCalled();
  });

  it("只读权限或未知权限不允许追加版本", async () => {
    for (const permissions of [["version:read"], ["version:append", "project:admin"]]) {
      const fake = mockStore({ permissions });
      await expect(fake.store.append(principal, projectId, save())).rejects.toBeInstanceOf(
        ProjectVersionAccessDeniedError,
      );
      expect(fake.tx.scadaProjectAudit.create).not.toHaveBeenCalled();
    }
  });

  it("过期预期修订号拒绝覆盖较新的工程版本", async () => {
    const fake = mockStore({ head: 3n });
    await expect(fake.store.append(principal, projectId, save(2))).rejects.toBeInstanceOf(
      ProjectRevisionConflictError,
    );
    expect(fake.tx.scadaProjectVersion.create).not.toHaveBeenCalled();
    expect(fake.tx.scadaProject.update).not.toHaveBeenCalled();
  });

  it("首次保存按工程行锁、权限、版本、修订号、审计的顺序提交", async () => {
    const fake = mockStore();
    const snapshot = await fake.store.append(principal, projectId, save());
    expect(snapshot.revision).toBe(1);
    expect(snapshot.projectId).toBe(projectId);
    expect(fake.steps).toEqual(["工程行锁", "权限复查", "写入版本", "推进修订号", "写入审计"]);
    const saved = fake.tx.scadaProjectVersion.create.mock.calls[0]?.[0];
    expect(saved?.data?.tenantId).toBe(principal.tenantId);
    expect(saved?.data?.createdBy).toBe(principal.subjectId);
    expect(saved?.data?.contentHash).toBe(snapshot.contentHash);
    expect(fake.tx.scadaProjectAudit.create.mock.calls[0]?.[0]?.data?.actorId).toBe(
      principal.subjectId,
    );
  });

  it("后续版本从数据库水位严格追加且分配正确修订号", async () => {
    const fake = mockStore({ head: 4n });
    const snapshot = await fake.store.append(principal, projectId, save(4));
    expect(snapshot.revision).toBe(5);
    expect(fake.tx.scadaProject.update.mock.calls[0]?.[0]?.data?.headRevision).toBe(5n);
  });

  it("修订号达到安全上限时禁止继续写入", async () => {
    const fake = mockStore({ head: BigInt(Number.MAX_SAFE_INTEGER) });
    await expect(
      fake.store.append(principal, projectId, save(Number.MAX_SAFE_INTEGER)),
    ).rejects.toThrow(/安全整数/);
    expect(fake.tx.scadaProjectVersion.create).not.toHaveBeenCalled();
  });

  it("审计写入失败时将异常交给 Prisma 事务回滚，不伪造成功结果", async () => {
    const fake = mockStore({ failAudit: true });
    await expect(fake.store.append(principal, projectId, save())).rejects.toThrow(
      /模拟审计数据库写入失败/,
    );
    expect(fake.steps).toEqual(["工程行锁", "权限复查", "写入版本", "推进修订号", "写入审计"]);
  });

  it("版本读取先锁工程并复查读取权限", async () => {
    const fake = mockStore({ permissions: ["version:append"] });
    await expect(fake.store.read(principal, projectId, 1)).rejects.toBeInstanceOf(
      ProjectVersionAccessDeniedError,
    );
    expect(fake.tx.scadaProjectVersion.findUnique).not.toHaveBeenCalled();
  });

  it("已授权但指定版本不存在时返回明确的不存在错误", async () => {
    const fake = mockStore();
    await expect(fake.store.read(principal, projectId, 1)).rejects.toBeInstanceOf(
      ProjectRevisionNotFoundError,
    );
  });

  it("读取真实摘要匹配的快照并复核数据库列", async () => {
    const snapshot = await createProjectSnapshot(document(), {
      revision: 1,
      createdAt: "2026-11-12T01:00:00.000Z",
    });
    const fake = mockStore({ stored: snapshot });
    const result = await fake.store.read(principal, projectId, 1);
    expect(result).toEqual(snapshot);
    expect(fake.steps).toEqual(["工程行锁", "权限复查", "读取版本"]);
  });

  it("拒绝数据库版本摘要列与 JSONB 快照不一致", async () => {
    const snapshot = await createProjectSnapshot(document(), {
      revision: 1,
      createdAt: "2026-11-12T01:00:00.000Z",
    });
    const fake = mockStore({ stored: snapshot, storedHash: "0".repeat(64) });
    await expect(fake.store.read(principal, projectId, 1)).rejects.toThrow(/元数据/);
  });

  it("版本查询拒绝非安全整数并且不访问数据库", async () => {
    const fake = mockStore();
    for (const revision of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(fake.store.read(principal, projectId, revision)).rejects.toThrow(/修订号/);
    }
    expect(fake.transaction).not.toHaveBeenCalled();
  });
});
