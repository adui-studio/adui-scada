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
const projectId = waterTreatmentDemoDocument.projectId;
const subjectId = "test-engineer";
const principalA = { tenantId: tenantA, subjectId };
const principalB = { tenantId: tenantB, subjectId };
const document = () => JSON.parse(JSON.stringify(waterTreatmentDemoDocument));

let service: PrismaService;
let store: PrismaProjectVersionStore;
const originalUrl = process.env.SCADA_DATABASE_URL;

beforeAll(async () => {
  process.env.SCADA_DATABASE_URL = testUrl;
  service = new PrismaService();
  store = new PrismaProjectVersionStore(service);
  await service.onModuleInit();
  for (const tenantId of [tenantA, tenantB]) {
    await service.client.scadaProject.create({
      data: { tenantId, projectId },
    });
  }
  await service.client.scadaProjectGrant.createMany({
    data: [
      { tenantId: tenantA, projectId, subjectId, permission: "version:append" },
      { tenantId: tenantA, projectId, subjectId, permission: "version:read" },
    ],
  });
});

afterAll(async () => {
  try {
    if (service) {
      for (const tenantId of [tenantA, tenantB]) {
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
    expect(
      await service.client.scadaProjectVersion.count({ where: { tenantId: tenantA } }),
    ).toBe(2);
    expect(await service.client.scadaProjectAudit.count({ where: { tenantId: tenantA } })).toBe(2);
  });

  it("相同工程 ID 不会跨租户读取或追加历史版本", async () => {
    await expect(store.read(principalB, projectId, 1)).rejects.toBeInstanceOf(
      ProjectVersionAccessDeniedError,
    );
    await expect(
      store.append(principalB, projectId, { expectedRevision: null, document: document() }),
    ).rejects.toBeInstanceOf(ProjectVersionAccessDeniedError);
    expect(
      await service.client.scadaProjectVersion.count({ where: { tenantId: tenantB } }),
    ).toBe(0);
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
});
