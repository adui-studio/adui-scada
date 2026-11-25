import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { PrismaPg } from "@prisma/adapter-pg";
import postgres, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { Pool } from "pg";
import { describe, expect, it } from "vite-plus/test";
import { requirePrisma8ReadOnlyTestUrl } from "../src/database/prisma8-readonly-target.js";
import { PrismaClient } from "../src/generated/prisma/client.js";
import type { Contract } from "../src/generated/prisma8/contract.d.js";
import contractJson from "../src/generated/prisma8/contract.json" with { type: "json" };
import { PrismaProjectVersionStore } from "../src/projects/prisma-project-version-store.js";
import { Prisma8ProjectVersionStore } from "../src/projects/prisma8-project-version-store.js";
import { Prisma8ProjectQueryStore } from "../src/projects/prisma8-project-query-store.js";

const contract = contractFromJson<Contract>(contractJson);

function same(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) throw new Error("工程查询专项与独立预期不一致");
}

async function rejected(operation: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error && error.message === message) return;
  }
  throw new Error("工程查询未按预期拒绝");
}

/** 仅为专用合成工程建立测试夹具；不在业务库或生产库执行查询与写入。 */
async function verifyQueries(): Promise<"MATCHED"> {
  const connectionString = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
  const id = randomUUID();
  const actor = { tenantId: "prisma8-query-" + id, subjectId: "operator" };
  const hiddenActor = { ...actor, subjectId: "other-operator" };
  const other = { tenantId: "prisma8-other-" + id, subjectId: "operator" };
  const projectId = "project-a-" + id;
  const secondId = "project-b-" + id;
  const hiddenId = "project-c-" + id;
  const document = { ...waterTreatmentDemoDocument, projectId };
  const fixtures = [
    { actor, projectId },
    { actor, projectId: secondId },
    { actor: hiddenActor, projectId: hiddenId },
    { actor: other, projectId },
  ];
  const scopes = fixtures.map((fixture) => ({ tenantId: fixture.actor.tenantId, projectId: fixture.projectId }));
  const identities = [actor, hiddenActor, other];
  const confirmedProjects: typeof scopes = [];
  const failures: string[] = [];
  let stage = "连接初始化";
  let old: PrismaClient | undefined;
  let pool: Pool | undefined;
  let client: PostgresClient<Contract> | undefined;
  let creationUnconfirmed = false;
  let ownsIdentities = false;
  let poolFailed = false;

  try {
    const base = { connectionString, connectionTimeoutMillis: 2000, idleTimeoutMillis: 5000 };
    const pgOptions = "-c statement_timeout=5000 -c lock_timeout=2000";
    const writable = new Pool({ ...base, max: 2, options: pgOptions });
    pool = writable;
    writable.on("error", () => { poolFailed = true; });
    const legacy = new PrismaClient({ adapter: new PrismaPg({ ...base, max: 2, options: pgOptions }) });
    old = legacy;
    await legacy.$connect();
    stage = "隔离库及工程结构预检";
    const boundary = await legacy.$queryRaw<Array<{ database_name: string; schema_name: string; read_only: string; ready: boolean }>>`
      SELECT current_database()::text AS database_name, current_schema()::text AS schema_name,
        current_setting('transaction_read_only') AS read_only,
        (to_regclass('public.scada_projects') IS NOT NULL AND
         to_regclass('public.scada_identities') IS NOT NULL AND
         to_regclass('public.scada_project_grants') IS NOT NULL AND
         to_regclass('public.scada_project_versions') IS NOT NULL AND
         to_regclass('public.scada_project_audit') IS NOT NULL AND
         to_regclass('public.scada_project_release_state') IS NOT NULL) AS ready
    `;
    same(boundary, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off", ready: true }]);
    const poolBoundary = await writable.query("SELECT current_database()::text AS database_name, current_schema()::text AS schema_name, current_setting('transaction_read_only') AS read_only");
    same(poolBoundary.rows, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off" }]);
    const next = postgres({ contract, pg: writable });
    client = next;
    const previous = new PrismaProjectVersionStore({
      client: legacy,
      onModuleInit: () => legacy.$connect(),
      onModuleDestroy: () => legacy.$disconnect(),
    });
    const writer = new Prisma8ProjectVersionStore(next);
    const reader = new Prisma8ProjectQueryStore(next);
    const denied = "工程资源不存在或无权访问";

    stage = "随机专用身份与工程创建";
    creationUnconfirmed = true;
    await legacy.$transaction(async (tx) => {
      same(await tx.scadaProject.count({ where: { OR: scopes } }), 0);
      same((await tx.scadaIdentity.createMany({ data: identities })).count, identities.length);
    });
    ownsIdentities = true;
    creationUnconfirmed = false;
    for (const [index, fixture] of fixtures.entries()) {
      creationUnconfirmed = true;
      const store = index === 0 ? writer : previous;
      const created = await store.create(fixture.actor, {
        document: { ...document, projectId: fixture.projectId },
      });
      confirmedProjects.push(scopes[index]!);
      creationUnconfirmed = false;
      same([created.projectId, created.headRevision], [fixture.projectId, 1]);
    }

    stage = "双版本追加十二个连续修订";
    for (let revision = 1; revision < 12; revision += 1) {
      const store = revision % 2 === 0 ? writer : previous;
      const result = await store.append(actor, projectId, { expectedRevision: revision, document });
      same(result.revision, revision + 1);
    }

    // 查询期间所有专用持久化记录必须原样保留。
    const inspect = async () => {
      const where = { OR: scopes };
      return legacy.$transaction(async (tx) => {
        const projects = await tx.scadaProject.findMany({ where, orderBy: [{ tenantId: "asc" }, { projectId: "asc" }] });
        const grants = await tx.scadaProjectGrant.findMany({ where, orderBy: [{ tenantId: "asc" }, { projectId: "asc" }, { subjectId: "asc" }, { permission: "asc" }] });
        const versions = await tx.scadaProjectVersion.findMany({ where, orderBy: [{ tenantId: "asc" }, { projectId: "asc" }, { revision: "asc" }] });
        const audits = await tx.scadaProjectAudit.findMany({ where, orderBy: [{ tenantId: "asc" }, { projectId: "asc" }, { revision: "asc" }] });
        const releases = await tx.scadaProjectReleaseState.findMany({ where, orderBy: [{ tenantId: "asc" }, { projectId: "asc" }] });
        const events = await tx.scadaProjectReleaseEvent.count({ where });
        return { projects, grants, versions, audits, releases, events };
      });
    };
    const before = await inspect();
    same(before.projects.length, 4);
    same(before.versions.length, 15);
    same(before.audits.length, 15);
    same(before.events, 0);

    stage = "工程列表有界分页和租户隔离";
    const first = await reader.list(actor, { limit: 1 });
    same(first.map((item) => item.projectId), [projectId]);
    same(first, await previous.list(actor, { limit: 1 }));
    const second = await reader.list(actor, { limit: 1, afterProjectId: projectId });
    same(second.map((item) => item.projectId), [secondId]);
    same(second, await previous.list(actor, { limit: 1, afterProjectId: projectId }));
    same(await reader.list(actor, { afterProjectId: secondId }), []);
    same((await reader.list(actor)).map((item) => item.projectId), [projectId, secondId]);
    same((await reader.list(hiddenActor)).map((item) => item.projectId), [hiddenId]);
    same((await reader.list(other)).map((item) => [item.projectId, item.headRevision]), [[projectId, 1]]);
    same(await reader.list({ ...actor, subjectId: "missing" }), []);

    stage = "工程详情和历史数值游标分页";
    same(await reader.getProject(actor, projectId), await previous.getProject(actor, projectId));
    same((await reader.getProject(actor, projectId)).headRevision, 12);
    same((await reader.getProject(other, projectId)).headRevision, 1);
    const newest = await reader.listVersions(actor, projectId, { limit: 3 });
    same(newest.map((item) => item.revision), [12, 11, 10]);
    same(newest, await previous.listVersions(actor, projectId, { limit: 3 }));
    const older = await reader.listVersions(actor, projectId, { limit: 3, beforeRevision: 10 });
    same(older.map((item) => item.revision), [9, 8, 7]);
    same(older, await previous.listVersions(actor, projectId, { limit: 3, beforeRevision: 10 }));
    same(await reader.listVersions(actor, projectId, { beforeRevision: 1 }), []);
    same((await reader.listVersions(other, projectId)).map((item) => item.revision), [1]);
    same(Object.keys(newest[0]!).toSorted(), ["contentHash", "createdAt", "projectId", "revision"]);

    stage = "完整快照、发布预检及拒绝等价性";
    same(await reader.read(actor, projectId, 12), await previous.read(actor, projectId, 12));
    same(await reader.read(actor, projectId, 1), await previous.read(actor, projectId, 1));
    const report = await reader.preflightRelease(actor, projectId, 12);
    same(report, await previous.preflightRelease(actor, projectId, 12));
    same([report.revision, report.headRevision, report.contentHash], [12, 12, newest[0]!.contentHash]);
    same(Object.keys(report).toSorted(), ["contentHash", "headRevision", "issues", "passed", "projectId", "revision"]);
    await rejected(() => reader.preflightRelease(actor, projectId, 11), "工程版本已变化，请重新获取最新修订号");
    await rejected(() => reader.read(actor, projectId, 13), "指定工程版本不存在");
    await rejected(() => reader.getProject(actor, hiddenId), denied);
    await rejected(() => reader.listVersions(actor, hiddenId), denied);
    await rejected(() => reader.read(actor, hiddenId, 1), denied);
    await rejected(() => reader.preflightRelease(actor, hiddenId, 1), denied);
    await rejected(() => reader.getProject({ ...actor, tenantId: "missing-" + id }, projectId), denied);
    same(await inspect(), before);

    stage = "专用工程元数据篡改拒绝及精确恢复";
    const key = { tenantId_projectId_revision: { tenantId: actor.tenantId, projectId, revision: 12n } };
    const original = await legacy.scadaProjectVersion.findUniqueOrThrow({ where: key });
    await legacy.scadaProjectVersion.update({
      where: key, data: { contentHash: "0".repeat(64) },
    });
    await rejected(() => reader.read(actor, projectId, 12), "数据库工程版本元数据与快照不一致");
    await rejected(() => reader.preflightRelease(actor, projectId, 12), "数据库工程版本元数据与快照不一致");
    await rejected(() => previous.read(actor, projectId, 12), "数据库工程版本元数据与快照不一致");
    await legacy.scadaProjectVersion.update({ where: key, data: { contentHash: original.contentHash } });
    same(await inspect(), before);

    stage = "专用工程权限撤销后重新查询";
    const target = { tenantId: actor.tenantId, projectId, subjectId: actor.subjectId };
    same((await legacy.scadaProjectGrant.deleteMany({ where: { ...target, permission: "version:read" } })).count, 1);
    same((await reader.getProject(actor, projectId)).headRevision, 12);
    await rejected(() => reader.listVersions(actor, projectId), denied);
    await rejected(() => reader.read(actor, projectId, 12), denied);
    await rejected(() => reader.preflightRelease(actor, projectId, 12), denied);
    same((await legacy.scadaProjectGrant.deleteMany({ where: { ...target, permission: "project:read" } })).count, 1);
    same((await reader.list(actor)).map((item) => item.projectId), [secondId]);
    same(await reader.list(actor), await previous.list(actor));
    await rejected(() => reader.getProject(actor, projectId), denied);
    await rejected(() => previous.getProject(actor, projectId), denied);
    same((await reader.getProject(other, projectId)).headRevision, 1);
    const after = await inspect();
    same(after.projects, before.projects);
    same(after.versions, before.versions);
    same(after.audits, before.audits);
    same(after.releases, before.releases);
    same(after.events, before.events);
    same(after.grants, before.grants.filter((grant) =>
      !(grant.tenantId === target.tenantId && grant.projectId === projectId &&
        grant.subjectId === target.subjectId && ["version:read", "project:read"].includes(grant.permission))));
  } catch {
    failures.push(stage);
  } finally {
    try { await client?.close(); } catch { failures.push("Prisma 8 客户端关闭失败"); }
    try { await pool?.end(); } catch { failures.push("外部连接池关闭失败"); }
    if (poolFailed) failures.push("外部连接池发生异常");
    if (creationUnconfirmed) {
      failures.push("专用夹具创建未确认，禁止自动清理，测试标识：" + id);
    } else if (old && ownsIdentities) {
      try {
        await old.$transaction(async (tx) => {
          if (confirmedProjects.length > 0) {
            const where = { OR: confirmedProjects };
            same(await tx.scadaProjectReleaseEvent.count({ where }), 0);
            await tx.scadaProjectReleaseState.deleteMany({ where });
            await tx.scadaProjectAudit.deleteMany({ where });
            await tx.scadaProjectVersion.deleteMany({ where });
            await tx.scadaProjectGrant.deleteMany({ where });
            same((await tx.scadaProject.deleteMany({ where })).count, confirmedProjects.length);
            same(await tx.scadaProjectReleaseState.count({ where }), 0);
            same(await tx.scadaProjectAudit.count({ where }), 0);
            same(await tx.scadaProjectVersion.count({ where }), 0);
            same(await tx.scadaProjectGrant.count({ where }), 0);
            same(await tx.scadaProject.count({ where }), 0);
          }
          const where = { OR: identities };
          same((await tx.scadaIdentity.deleteMany({ where })).count, identities.length);
          same(await tx.scadaIdentity.count({ where }), 0);
        });
      } catch {
        failures.push("专用夹具清理未确认，禁止自动重试，测试标识：" + id);
      }
    }
    try { await old?.$disconnect(); } catch { failures.push("Prisma 7 客户端关闭失败"); }
  }
  if (failures.length) throw new Error("工程查询专项未通过：" + failures.join("；"));
  return "MATCHED";
}

describe("真实 PostgreSQL Prisma 8 工程查询候选", () => {
  it("验证五项查询、双版本等价、数值分页、权限撤销及零残留", async () => {
    expect(await verifyQueries()).toBe("MATCHED");
    console.info("Prisma 8 工程查询双版本对照、权限隔离及专用夹具清理通过");
  }, 60_000);
});
