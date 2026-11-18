import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { PrismaService } from "../src/database/prisma.service.js";
import {
  PrismaProjectVersionStore,
  ProjectAlreadyExistsError,
  ProjectVersionAccessDeniedError,
} from "../src/projects/prisma-project-version-store.js";

// 严格限制到本机独立测试库，绝不连接普通开发库或生产数据库执行写入回归。
const testUrl = process.env.SCADA_TEST_DATABASE_URL;
if (!testUrl) throw new Error("真实工程 API 数据库测试需显式设置 SCADA_TEST_DATABASE_URL");
let parsedUrl: URL;
try {
  parsedUrl = new URL(testUrl);
} catch {
  throw new Error("真实工程 API 数据库测试连接字符串格式无效");
}
if (
  !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) ||
  parsedUrl.pathname !== "/adui_scada_test" ||
  !["postgresql:", "postgres:"].includes(parsedUrl.protocol)
) {
  throw new Error("真实工程 API 数据库测试仅允许连接本机 adui_scada_test 隔离数据库");
}

const tenantCreate = "test-" + randomUUID();
const tenantRace = "test-" + randomUUID();
const tenantRollback = "test-" + randomUUID();
const tenantOther = "test-" + randomUUID();
const tenantDisabled = "test-" + randomUUID();
const tenantPaging = "test-" + randomUUID();
const projectId = waterTreatmentDemoDocument.projectId;
const secondProjectId = projectId + "-secondary";
const otherProjectId = "other-tenant-project";
const subjectId = "test-engineer";
const principalCreate = { tenantId: tenantCreate, subjectId };
const principalRace = { tenantId: tenantRace, subjectId };
const principalRollback = { tenantId: tenantRollback, subjectId };
const principalOther = { tenantId: tenantOther, subjectId };
const principalDisabled = { tenantId: tenantDisabled, subjectId };
const principalPaging = { tenantId: tenantPaging, subjectId };
const hiddenSubjectId = "test-hidden-engineer";
const principalHidden = { tenantId: tenantPaging, subjectId: hiddenSubjectId };
const document = (id: string) => {
  const source = JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) as {
    projectId: string;
  };
  source.projectId = id;
  return source;
};

let service: PrismaService;
let store: PrismaProjectVersionStore;
const originalUrl = process.env.SCADA_DATABASE_URL;

beforeAll(async () => {
  process.env.SCADA_DATABASE_URL = testUrl;
  service = new PrismaService();
  store = new PrismaProjectVersionStore(service);
  await service.onModuleInit();
  await service.client.scadaIdentity.createMany({
    data: [
      { tenantId: tenantCreate, subjectId, status: "active" },
      { tenantId: tenantRace, subjectId, status: "active" },
      { tenantId: tenantRollback, subjectId, status: "active" },
      { tenantId: tenantOther, subjectId, status: "active" },
      { tenantId: tenantDisabled, subjectId, status: "disabled" },
      { tenantId: tenantPaging, subjectId, status: "active" },
      { tenantId: tenantPaging, subjectId: hiddenSubjectId, status: "active" },
    ],
  });
});

afterAll(async () => {
  try {
    if (service) {
      for (const tenantId of [
        tenantCreate,
        tenantRace,
        tenantRollback,
        tenantOther,
        tenantDisabled,
        tenantPaging,
      ]) {
        await service.client.scadaProjectReleaseEvent.deleteMany({ where: { tenantId } });
        await service.client.scadaProjectReleaseState.deleteMany({ where: { tenantId } });
        await service.client.scadaProjectAudit.deleteMany({ where: { tenantId } });
        await service.client.scadaProjectVersion.deleteMany({ where: { tenantId } });
        await service.client.scadaProjectGrant.deleteMany({ where: { tenantId } });
        await service.client.scadaProject.deleteMany({ where: { tenantId } });
        await service.client.scadaIdentity.deleteMany({ where: { tenantId } });
      }
      await service.onModuleDestroy();
    }
  } finally {
    if (originalUrl === undefined) delete process.env.SCADA_DATABASE_URL;
    else process.env.SCADA_DATABASE_URL = originalUrl;
  }
});

describe("PostgreSQL 真实工程 API 事务", () => {
  it("创建工程时原子保存创建者三项权限、首版快照、水位与审计", async () => {
    const summary = await store.create(principalCreate, { document: document(projectId) });
    const [project, grants, version, audit, releaseState] = await Promise.all([
      service.client.scadaProject.findUniqueOrThrow({
        where: { tenantId_projectId: { tenantId: tenantCreate, projectId } },
      }),
      service.client.scadaProjectGrant.findMany({
        where: { tenantId: tenantCreate, projectId, subjectId },
      }),
      service.client.scadaProjectVersion.findUniqueOrThrow({
        where: { tenantId_projectId_revision: { tenantId: tenantCreate, projectId, revision: 1n } },
      }),
      service.client.scadaProjectAudit.findFirstOrThrow({
        where: { tenantId: tenantCreate, projectId, revision: 1n },
      }),
      service.client.scadaProjectReleaseState.findUniqueOrThrow({
        where: { tenantId_projectId: { tenantId: tenantCreate, projectId } },
      }),
    ]);

    expect(summary.headRevision).toBe(1);
    expect(project.headRevision).toBe(1n);
    expect(grants.map((grant) => grant.permission).sort()).toEqual([
      "project:read",
      "version:append",
      "version:read",
    ]);
    expect(version.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const snapshot = await store.read(principalCreate, projectId, 1);
    expect(snapshot.contentHash).toBe(version.contentHash);
    expect(audit.actorId).toBe(subjectId);
    expect(audit.action).toBe("version:append");
    expect(releaseState.releaseGeneration).toBe(0n);
    expect(releaseState.releasedRevision).toBeNull();
    expect(releaseState.releasedContentHash).toBeNull();
    expect(releaseState.lastReleaseEventId).toBeNull();
  });

  it("工程列表按租户与 project:read 隔离，详情和历史摘要不暴露完整文档", async () => {
    await store.create(principalCreate, { document: document(secondProjectId) });
    await store.create(principalOther, { document: document(otherProjectId) });

    const projects = await store.list(principalCreate);
    expect(projects.map((project) => project.projectId).sort()).toEqual(
      [projectId, secondProjectId].sort(),
    );
    expect(projects.every((project) => project.headRevision === 1)).toBe(true);
    const firstPage = await store.list(principalCreate, { limit: 1 });
    const secondPage = await store.list(principalCreate, {
      limit: 1,
      afterProjectId: firstPage[0]?.projectId,
    });
    const exhausted = await store.list(principalCreate, {
      limit: 1,
      afterProjectId: secondPage[0]?.projectId,
    });
    expect(firstPage.map((item) => item.projectId)).toEqual([projectId]);
    expect(secondPage.map((item) => item.projectId)).toEqual([secondProjectId]);
    expect(exhausted).toEqual([]);
    await expect(store.getProject(principalCreate, otherProjectId)).rejects.toBeInstanceOf(
      ProjectVersionAccessDeniedError,
    );

    const detail = await store.getProject(principalCreate, projectId);
    expect(detail.projectId).toBe(projectId);
    expect(detail.headRevision).toBe(1);

    await store.append(principalCreate, projectId, {
      expectedRevision: 1,
      document: document(projectId),
    });
    const versions = await store.listVersions(principalCreate, projectId);
    expect(versions.map((version) => version.revision)).toEqual([2, 1]);
    expect(Object.keys(versions[0] ?? {}).sort()).toEqual([
      "contentHash",
      "createdAt",
      "projectId",
      "revision",
    ]);

    const olderPage = await store.listVersions(principalCreate, projectId, {
      limit: "1",
      beforeRevision: "2",
    });
    expect(olderPage.map((version) => version.revision)).toEqual([1]);
    const snapshot = await store.read(principalCreate, projectId, 1);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.projectId).toBe(projectId);
  });

  it("十二项真实授权工程按十条游标分页且同租户无权工程不泄漏", async () => {
    const ids = Array.from(
      { length: 12 },
      (_, index) => "page-" + String(index + 1).padStart(3, "0"),
    );
    // 只向随机测试租户执行现有创建事务，自动形成不可变首版和 ACL。
    for (const id of ids) {
      const created = await store.create(principalPaging, { document: document(id) });
      expect(created.headRevision).toBe(1);
    }
    const hiddenId = "page-013-hidden";
    await store.create(principalHidden, { document: document(hiddenId) });

    const first = await store.list(principalPaging, { limit: 10 });
    expect(first.map((item) => item.projectId)).toEqual(ids.slice(0, 10));
    const second = await store.list(principalPaging, {
      limit: 10,
      afterProjectId: first.at(-1)?.projectId,
    });
    expect(second.map((item) => item.projectId)).toEqual(ids.slice(10));
    expect(
      await store.list(principalPaging, {
        limit: 10,
        afterProjectId: second.at(-1)?.projectId,
      }),
    ).toEqual([]);
    expect(
      (await store.list(principalPaging, { limit: 100 })).map((item) => item.projectId),
    ).toEqual(ids);
    expect(first.every((item) => item.headRevision === 1)).toBe(true);
    expect(second.every((item) => item.headRevision === 1)).toBe(true);
    expect(Object.keys(first[0] ?? {}).sort()).toEqual([
      "createdAt",
      "headRevision",
      "projectId",
      "updatedAt",
    ]);
    expect((await store.list(principalHidden)).map((item) => item.projectId)).toEqual([hiddenId]);
    await expect(store.getProject(principalPaging, hiddenId)).rejects.toBeInstanceOf(
      ProjectVersionAccessDeniedError,
    );
    expect(await service.client.scadaProject.count({ where: { tenantId: tenantPaging } })).toBe(13);
    expect(
      await service.client.scadaProjectAudit.count({ where: { tenantId: tenantPaging } }),
    ).toBe(13);
  });

  it("同一租户重复创建工程返回冲突且不会覆盖既有首版", async () => {
    await expect(
      store.create(principalCreate, { document: document(projectId) }),
    ).rejects.toBeInstanceOf(ProjectAlreadyExistsError);
    const project = await service.client.scadaProject.findUniqueOrThrow({
      where: { tenantId_projectId: { tenantId: tenantCreate, projectId } },
    });
    expect(project.headRevision).toBe(2n);
    expect(
      await service.client.scadaProjectVersion.count({
        where: { tenantId: tenantCreate, projectId },
      }),
    ).toBe(2);
  });

  it("真实 PostgreSQL 创建事务拒绝已停用主体且不留下任何工程与成功审计", async () => {
    await expect(
      store.create(principalDisabled, { document: document(projectId) }),
    ).rejects.toBeInstanceOf(ProjectVersionAccessDeniedError);
    expect(await service.client.scadaProject.count({ where: { tenantId: tenantDisabled } })).toBe(
      0,
    );
    expect(
      await service.client.scadaProjectGrant.count({ where: { tenantId: tenantDisabled } }),
    ).toBe(0);
    expect(
      await service.client.scadaProjectAudit.count({ where: { tenantId: tenantDisabled } }),
    ).toBe(0);
  });

  it("两个并发创建使用相同租户和工程标识时只能成功一个", async () => {
    const results = await Promise.allSettled([
      store.create(principalRace, { document: document(projectId) }),
      store.create(principalRace, { document: document(projectId) }),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof store.create>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ProjectAlreadyExistsError);
    expect(await service.client.scadaProject.count({ where: { tenantId: tenantRace } })).toBe(1);
    expect(await service.client.scadaProjectGrant.count({ where: { tenantId: tenantRace } })).toBe(
      3,
    );
    expect(
      await service.client.scadaProjectVersion.count({ where: { tenantId: tenantRace } }),
    ).toBe(1);
    expect(await service.client.scadaProjectAudit.count({ where: { tenantId: tenantRace } })).toBe(
      1,
    );
  });

  it("审计 INSERT 被 PostgreSQL 约束拒绝时创建工程整体回滚", async () => {
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
      failingStore.create(principalRollback, { document: document(projectId) }),
    ).rejects.toBeInstanceOf(Error);
    expect(auditQueryIntercepted).toBe(true);
    expect(await service.client.scadaProject.count({ where: { tenantId: tenantRollback } })).toBe(
      0,
    );
    expect(
      await service.client.scadaProjectGrant.count({ where: { tenantId: tenantRollback } }),
    ).toBe(0);
    expect(
      await service.client.scadaProjectVersion.count({ where: { tenantId: tenantRollback } }),
    ).toBe(0);
    expect(
      await service.client.scadaProjectAudit.count({ where: { tenantId: tenantRollback } }),
    ).toBe(0);

    const created = await store.create(principalRollback, { document: document(projectId) });
    expect(created.headRevision).toBe(1);
  });
});
