import { describe, expect, it, vi } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import type { PrismaService } from "../database/prisma.service.js";
import type {
  ProjectAccessAction,
  AuthenticatedProjectPrincipal,
} from "./project-access-policy.js";
import {
  PrismaProjectVersionStore,
  ProjectAlreadyExistsError,
  ProjectRequestValidationError,
  ProjectVersionAccessDeniedError,
} from "./prisma-project-version-store.js";

const PRINCIPAL: AuthenticatedProjectPrincipal = {
  tenantId: "tenant-a",
  subjectId: "engineer-a",
};
const PROJECT_ID = waterTreatmentDemoDocument.projectId;
const CREATED_AT = new Date("2026-11-14T00:00:00.000Z");

interface ProjectRow {
  readonly projectId: string;
  readonly headRevision: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface VersionRow {
  readonly projectId: string;
  readonly revision: bigint;
  readonly createdAt: Date;
  readonly contentHash: string;
}

interface HarnessOptions {
  readonly permissions?: readonly ProjectAccessAction[];
  readonly headRevision?: bigint;
  readonly projectExists?: boolean;
  readonly duplicateProject?: boolean;
  readonly failAudit?: boolean;
  readonly identityActive?: boolean;
}

function createDocument() {
  return JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
}

function createHarness(options: HarnessOptions = {}) {
  const steps: string[] = [];
  const projectRow: ProjectRow = {
    projectId: PROJECT_ID,
    headRevision: options.headRevision ?? 1n,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  const versionRows: VersionRow[] = [
    {
      projectId: PROJECT_ID,
      revision: 2n,
      createdAt: CREATED_AT,
      contentHash: "b".repeat(64),
    },
    {
      projectId: PROJECT_ID,
      revision: 1n,
      createdAt: CREATED_AT,
      contentHash: "a".repeat(64),
    },
  ];

  const project = {
    create: vi.fn<(args: { readonly data: Record<string, unknown> }) => Promise<void>>(async () => {
      steps.push("创建工程");
      if (options.duplicateProject) {
        throw Object.assign(new Error("模拟唯一约束冲突"), { code: "P2002" });
      }
    }),
    findUnique: vi.fn<(args: unknown) => Promise<ProjectRow | null>>(async () => {
      steps.push("读取工程摘要");
      return projectRow;
    }),
    findMany: vi.fn<(args: unknown) => Promise<ProjectRow[]>>(async () => {
      steps.push("查询工程列表");
      return [projectRow];
    }),
    update: vi.fn<(args: unknown) => Promise<void>>(async () => {
      steps.push("推进工程水位");
    }),
  };
  const grants = {
    createMany: vi.fn<
      (args: { readonly data: readonly Record<string, unknown>[] }) => Promise<void>
    >(async () => {
      steps.push("创建工程授权");
    }),
    findMany: vi.fn<() => Promise<Array<{ readonly permission: string }>>>(async () => {
      steps.push("复查工程授权");
      return (options.permissions ?? ["project:read", "version:read", "version:append"]).map(
        (permission) => ({ permission }),
      );
    }),
  };
  const versions = {
    create: vi.fn<(args: unknown) => Promise<void>>(async () => {
      steps.push("写入历史快照");
    }),
    findMany: vi.fn<(args: unknown) => Promise<VersionRow[]>>(async () => {
      steps.push("查询历史摘要");
      return versionRows;
    }),
  };
  const audits = {
    create: vi.fn<(args: unknown) => Promise<void>>(async () => {
      steps.push("写入成功审计");
      if (options.failAudit) throw new Error("模拟审计写入失败");
    }),
  };
  const tx = {
    $queryRaw: vi.fn<
      (
        parts: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<Array<{ head_revision: bigint }>>
    >(async (parts) => {
      if (parts[0]?.includes("scada_identities")) {
        steps.push("复核创建者状态");
        return options.identityActive === false ? [] : [{ head_revision: 0n, status: "active" }];
      }
      steps.push("锁定工程行");
      return options.projectExists === false ? [] : [{ head_revision: options.headRevision ?? 1n }];
    }),
    scadaProject: project,
    scadaProjectGrant: grants,
    scadaProjectVersion: versions,
    scadaProjectAudit: audits,
  };
  const transaction = vi.fn<
    (callback: (client: typeof tx) => Promise<unknown>) => Promise<unknown>
  >(async (callback) => callback(tx));
  const client = {
    $transaction: transaction,
    scadaProject: project,
  };
  const database = { client } as unknown as PrismaService;

  return {
    store: new PrismaProjectVersionStore(database),
    steps,
    project,
    grants,
    versions,
    audits,
    transaction,
  };
}

describe("工程 API 事务仓储", () => {
  it("创建工程时按顺序原子写入三项权限、首版快照、水位与成功审计", async () => {
    const harness = createHarness();
    const result = await harness.store.create(PRINCIPAL, { document: createDocument() });

    expect(result).toEqual({
      projectId: PROJECT_ID,
      headRevision: 1,
      createdAt: CREATED_AT.toISOString(),
      updatedAt: CREATED_AT.toISOString(),
    });
    expect(harness.steps).toEqual([
      "复核创建者状态",
      "创建工程",
      "创建工程授权",
      "写入历史快照",
      "推进工程水位",
      "写入成功审计",
      "读取工程摘要",
    ]);
    expect(harness.grants.createMany.mock.calls[0]?.[0].data).toHaveLength(3);
    expect(harness.audits.create.mock.calls[0]?.[0]).toMatchObject({
      data: { action: "version:append", revision: 1n, actorId: PRINCIPAL.subjectId },
    });
  });

  it("创建工程拒绝客户端附带租户或主体字段", async () => {
    const harness = createHarness();

    await expect(
      harness.store.create(PRINCIPAL, {
        document: createDocument(),
        tenantId: "attacker-tenant",
      }),
    ).rejects.toBeInstanceOf(ProjectRequestValidationError);
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it("已停用的可信主体即使经过外层 Guard 也不能创建工程或写入授权", async () => {
    const harness = createHarness({ identityActive: false });

    await expect(
      harness.store.create(PRINCIPAL, { document: createDocument() }),
    ).rejects.toBeInstanceOf(ProjectVersionAccessDeniedError);
    expect(harness.steps).toEqual(["复核创建者状态"]);
    expect(harness.project.create).not.toHaveBeenCalled();
    expect(harness.grants.createMany).not.toHaveBeenCalled();
    expect(harness.versions.create).not.toHaveBeenCalled();
    expect(harness.audits.create).not.toHaveBeenCalled();
  });

  it("同一租户重复创建工程映射为冲突且不继续写入", async () => {
    const harness = createHarness({ duplicateProject: true });

    await expect(
      harness.store.create(PRINCIPAL, { document: createDocument() }),
    ).rejects.toBeInstanceOf(ProjectAlreadyExistsError);
    expect(harness.grants.createMany).not.toHaveBeenCalled();
    expect(harness.versions.create).not.toHaveBeenCalled();
    expect(harness.audits.create).not.toHaveBeenCalled();
  });

  it("工程列表只查询当前租户明确授予 project:read 的工程", async () => {
    const harness = createHarness();
    const result = await harness.store.list(PRINCIPAL);
    const query = harness.project.findMany.mock.calls[0]?.[0] as {
      where: { tenantId: string; grants: { some: { subjectId: string; permission: string } } };
    };

    expect(result).toHaveLength(1);
    expect(query.where.tenantId).toBe(PRINCIPAL.tenantId);
    expect(query.where.grants.some).toEqual({
      tenantId: PRINCIPAL.tenantId,
      subjectId: PRINCIPAL.subjectId,
      permission: "project:read",
    });
  });

  it("读取工程详情在共享锁内复核 project:read", async () => {
    const harness = createHarness();
    const result = await harness.store.getProject(PRINCIPAL, PROJECT_ID);

    expect(result.headRevision).toBe(1);
    expect(harness.steps).toEqual(["锁定工程行", "复查工程授权", "读取工程摘要"]);
  });

  it("缺少 project:read 时统一拒绝工程详情且不读取工程记录", async () => {
    const harness = createHarness({ permissions: ["version:read"] });

    await expect(harness.store.getProject(PRINCIPAL, PROJECT_ID)).rejects.toBeInstanceOf(
      ProjectVersionAccessDeniedError,
    );
    expect(harness.project.findUnique).not.toHaveBeenCalled();
  });

  it("历史版本默认每页 20 条且只返回摘要", async () => {
    const harness = createHarness();
    const result = await harness.store.listVersions(PRINCIPAL, PROJECT_ID, {});

    const query = harness.versions.findMany.mock.calls[0]?.[0] as {
      take: number;
      orderBy: { revision: string };
      select: Record<string, boolean>;
    };
    expect(result.map((item) => item.revision)).toEqual([2, 1]);
    expect(query.take).toBe(20);
    expect(query.orderBy).toEqual({ revision: "desc" });
    expect(query.select).not.toHaveProperty("snapshot");
  });

  it("历史版本使用 beforeRevision 向较早修订分页", async () => {
    const harness = createHarness();
    await harness.store.listVersions(PRINCIPAL, PROJECT_ID, {
      limit: "5",
      beforeRevision: "3",
    });

    const query = harness.versions.findMany.mock.calls[0]?.[0] as {
      take: number;
      where: { revision: { lt: bigint } };
    };
    expect(query.take).toBe(5);
    expect(query.where.revision.lt).toBe(3n);
  });

  it("历史分页拒绝超限数量与未知参数", async () => {
    const harness = createHarness();

    await expect(
      harness.store.listVersions(PRINCIPAL, PROJECT_ID, { limit: "101" }),
    ).rejects.toThrow("每页数量不能超过 100 条");
    await expect(
      harness.store.listVersions(PRINCIPAL, PROJECT_ID, { limit: "20", tenantId: "other" }),
    ).rejects.toThrow("工程版本分页只允许 limit 与 beforeRevision 参数");
    expect(harness.transaction).not.toHaveBeenCalled();
  });
});
