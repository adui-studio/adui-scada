import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { PrismaService } from "../src/database/prisma.service.js";
import {
  PrismaProjectVersionStore,
  ProjectRevisionConflictError,
  ProjectVersionAccessDeniedError,
} from "../src/projects/prisma-project-version-store.js";

// 严格限制到本机独立测试库，绝不连接普通开发库或生产数据库执行写入回归。
const testUrl = process.env.SCADA_TEST_DATABASE_URL;
if (!testUrl) throw new Error("真实数据库测试需显式设置 SCADA_TEST_DATABASE_URL");
let parsedUrl: URL;
try {
  parsedUrl = new URL(testUrl);
} catch {
  throw new Error("真实数据库测试连接字符串格式无效");
}
if (
  !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) ||
  parsedUrl.pathname !== "/adui_scada_test" ||
  !["postgresql:", "postgres:"].includes(parsedUrl.protocol)
) {
  throw new Error("真实数据库测试仅允许连接本机 adui_scada_test 隔离数据库");
}

const tenantA = `test-${randomUUID()}`;
const tenantB = `test-${randomUUID()}`;
const tenantRollback = `test-${randomUUID()}`;
const tenantRevocation = `test-${randomUUID()}`;
const projectId = waterTreatmentDemoDocument.projectId;
const subjectId = "test-engineer";
const principalA = { tenantId: tenantA, subjectId };
const principalB = { tenantId: tenantB, subjectId };
const principalRollback = { tenantId: tenantRollback, subjectId };
const principalRevocation = { tenantId: tenantRevocation, subjectId };
const document = () => JSON.parse(JSON.stringify(waterTreatmentDemoDocument));

let service: PrismaService;
let store: PrismaProjectVersionStore;
const originalUrl = process.env.SCADA_DATABASE_URL;

beforeAll(async () => {
  process.env.SCADA_DATABASE_URL = testUrl;
  service = new PrismaService();
  store = new PrismaProjectVersionStore(service);
  await service.onModuleInit();
  for (const tenantId of [tenantA, tenantB, tenantRollback, tenantRevocation]) {
    await service.client.scadaProject.create({
      data: { tenantId, projectId },
    });
  }
  await service.client.scadaProjectGrant.createMany({
    data: [
      { tenantId: tenantA, projectId, subjectId, permission: "version:append" },
      { tenantId: tenantA, projectId, subjectId, permission: "version:read" },
      { tenantId: tenantRollback, projectId, subjectId, permission: "version:append" },
      { tenantId: tenantRevocation, projectId, subjectId, permission: "version:append" },
    ],
  });
});

afterAll(async () => {
  try {
    if (service) {
      for (const tenantId of [tenantA, tenantB, tenantRollback, tenantRevocation]) {
        await service.client.scadaProjectAudit.deleteMany({ where: { tenantId } });
        await service.client.scadaProjectVersion.deleteMany({ where: { tenantId } });
        await service.client.scadaProjectGrant.deleteMany({ where: { tenantId } });
        await service.client.scadaProject.deleteMany({ where: { tenantId } });
      }
      await service.onModuleDestroy();
    }
  } finally {
    if (originalUrl === undefined) delete process.env.SCADA_DATABASE_URL;
    else process.env.SCADA_DATABASE_URL = originalUrl;
  }
});

describe("PostgreSQL 真实工程版本事务", () => {
  it("首次写入持久化完整快照、修订号和同版本审计", async () => {
    const snapshot = await store.append(principalA, projectId, {
      expectedRevision: null,
      document: document(),
    });
    expect(snapshot.revision).toBe(1);
    const [project, version, audit] = await Promise.all([
      service.client.scadaProject.findUniqueOrThrow({
        where: { tenantId_projectId: { tenantId: tenantA, projectId } },
      }),
      service.client.scadaProjectVersion.findUniqueOrThrow({
        where: { tenantId_projectId_revision: { tenantId: tenantA, projectId, revision: 1n } },
      }),
      service.client.scadaProjectAudit.findFirstOrThrow({
        where: { tenantId: tenantA, projectId, revision: 1n },
      }),
    ]);
    expect(project.headRevision).toBe(1n);
    expect(version.contentHash).toBe(snapshot.contentHash);
    expect(audit.actorId).toBe(subjectId);
  });

  it("两个并发追加使用同一修订号时只能成功一个", async () => {
    const results = await Promise.allSettled([
      store.append(principalA, projectId, { expectedRevision: 1, document: document() }),
      store.append(principalA, projectId, { expectedRevision: 1, document: document() }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(ProjectRevisionConflictError);
    }
    const project = await service.client.scadaProject.findUniqueOrThrow({
      where: { tenantId_projectId: { tenantId: tenantA, projectId } },
    });
    expect(project.headRevision).toBe(2n);
    expect(await service.client.scadaProjectVersion.count({ where: { tenantId: tenantA } })).toBe(
      2,
    );
    expect(await service.client.scadaProjectAudit.count({ where: { tenantId: tenantA } })).toBe(2);
  });

  it("相同工程 ID 不会跨租户读取或追加历史版本", async () => {
    await expect(store.read(principalB, projectId, 1)).rejects.toBeInstanceOf(
      ProjectVersionAccessDeniedError,
    );
    await expect(
      store.append(principalB, projectId, { expectedRevision: null, document: document() }),
    ).rejects.toBeInstanceOf(ProjectVersionAccessDeniedError);
    expect(await service.client.scadaProjectVersion.count({ where: { tenantId: tenantB } })).toBe(
      0,
    );
  });

  it("授权读取重新验证快照摘要及版本元数据", async () => {
    const snapshot = await store.read(principalA, projectId, 1);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.projectId).toBe(projectId);
    expect(snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("数据库版本摘要字段被篡改时拒绝读取", async () => {
    await service.client.scadaProjectVersion.update({
      where: { tenantId_projectId_revision: { tenantId: tenantA, projectId, revision: 1n } },
      data: { contentHash: "0".repeat(64) },
    });
    await expect(store.read(principalA, projectId, 1)).rejects.toThrow(/元数据/);
  });
  it("四张工程业务表及所有物理字段均已设置中文数据库注释", async () => {
    const businessTables = [
      "scada_projects",
      "scada_project_grants",
      "scada_project_versions",
      "scada_project_audit",
    ];
    const tables = await service.client.$queryRaw<
      Array<{ table_name: string; description: string | null }>
    >`
      SELECT c.relname AS table_name, obj_description(c.oid, 'pg_class') AS description
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN (
          'scada_projects', 'scada_project_grants',
          'scada_project_versions', 'scada_project_audit'
        )
    `;
    expect(tables).toHaveLength(businessTables.length);
    for (const row of tables) {
      expect(businessTables).toContain(row.table_name);
      expect(row.description).toMatch(/[一-龥]/);
    }

    const columns = await service.client.$queryRaw<
      Array<{ table_name: string; column_name: string; description: string | null }>
    >`
      SELECT c.relname AS table_name, a.attname AS column_name,
             col_description(c.oid, a.attnum) AS description
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      JOIN pg_attribute AS a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN (
          'scada_projects', 'scada_project_grants',
          'scada_project_versions', 'scada_project_audit'
        )
        AND a.attnum > 0
        AND NOT a.attisdropped
    `;
    expect(columns.length).toBeGreaterThanOrEqual(23);
    for (const row of columns) {
      expect(businessTables).toContain(row.table_name);
      expect(row.description).toMatch(/[一-龥]/);
    }
  });
  it("审计 INSERT 违反 PostgreSQL 约束时版本与水位同步回滚", async () => {
    // 测试独立租户的审计操作被 PostgreSQL CHECK 约束拒绝，其他语句仍执行真实事务。
    let auditQueryIntercepted = false;
    const rejectedAuditClient = service.client.$extends({
      query: {
        scadaProjectAudit: {
          create({ args, query }) {
            auditQueryIntercepted = true;
            return query({
              ...args,
              data: { ...args.data, action: "不支持的审计操作" },
            });
          },
        },
      },
    });
    const failingStore = new PrismaProjectVersionStore({
      client: rejectedAuditClient,
    } as unknown as PrismaService);

    await expect(
      failingStore.append(principalRollback, projectId, {
        expectedRevision: null,
        document: document(),
      }),
    ).rejects.toThrow();
    expect(auditQueryIntercepted).toBe(true);

    const project = await service.client.scadaProject.findUniqueOrThrow({
      where: { tenantId_projectId: { tenantId: tenantRollback, projectId } },
    });
    expect(project.headRevision).toBe(0n);
    expect(
      await service.client.scadaProjectVersion.count({ where: { tenantId: tenantRollback } }),
    ).toBe(0);
    expect(
      await service.client.scadaProjectAudit.count({ where: { tenantId: tenantRollback } }),
    ).toBe(0);

    // 相同修订号仍能写入并审计成功，证明失败事务未遗留部分提交。
    const snapshot = await store.append(principalRollback, projectId, {
      expectedRevision: null,
      document: document(),
    });
    expect(snapshot.revision).toBe(1);
    expect(
      await service.client.scadaProjectAudit.count({ where: { tenantId: tenantRollback } }),
    ).toBe(1);
  });

  it("授权事务先锁工程并撤销权限后，并发版本保存必须被拒绝", async () => {
    let pendingAppend: Promise<unknown> | undefined;
    await service.client.$transaction(
      async (tx) => {
        // 未来授权管理操作须采用与保存相同的工程行锁顺序。
        const locked = await tx.$queryRaw<Array<{ project_id: string }>>`
          SELECT project_id FROM scada_projects
          WHERE tenant_id = ${tenantRevocation} AND project_id = ${projectId}
          FOR UPDATE
        `;
        expect(locked).toHaveLength(1);
        const removed = await tx.scadaProjectGrant.deleteMany({
          where: {
            tenantId: tenantRevocation,
            projectId,
            subjectId,
            permission: "version:append",
          },
        });
        expect(removed.count).toBe(1);
        pendingAppend = store.append(principalRevocation, projectId, {
          expectedRevision: null,
          document: document(),
        });
        // 避免竞争保存的拒绝发生在外部 await 之前成为未处理异常。
        let resolved = false;
        void pendingAppend
          .finally(() => {
            resolved = true;
          })
          .catch(() => undefined);
        await new Promise<void>((resolve) => setTimeout(resolve, 75));
        expect(resolved).toBe(false);
      },
      { maxWait: 2000, timeout: 10000 },
    );

    expect(pendingAppend).toBeDefined();
    await expect(pendingAppend).rejects.toBeInstanceOf(ProjectVersionAccessDeniedError);
    const project = await service.client.scadaProject.findUniqueOrThrow({
      where: { tenantId_projectId: { tenantId: tenantRevocation, projectId } },
    });
    expect(project.headRevision).toBe(0n);
    expect(
      await service.client.scadaProjectVersion.count({ where: { tenantId: tenantRevocation } }),
    ).toBe(0);
    expect(
      await service.client.scadaProjectAudit.count({ where: { tenantId: tenantRevocation } }),
    ).toBe(0);
  });

  it("本机测试数据库连接不可达时查询失败且连接资源可释放", async () => {
    const original = process.env.SCADA_DATABASE_URL;
    let unreachable: PrismaService | undefined;
    try {
      // 隔离本机端口 1，不会连接正常开发库或生产库。
      process.env.SCADA_DATABASE_URL =
        "postgresql://isolated_test:isolated_test@127.0.0.1:1/adui_scada_test";
      unreachable = new PrismaService();
    } finally {
      if (original === undefined) delete process.env.SCADA_DATABASE_URL;
      else process.env.SCADA_DATABASE_URL = original;
    }
    if (!unreachable) throw new Error("未创建本机异常连接测试客户端");
    try {
      await expect(unreachable.client.$queryRaw`SELECT 1`).rejects.toThrow();
    } finally {
      await unreachable.onModuleDestroy();
    }
  });
});
