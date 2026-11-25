import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { PrismaPg } from "@prisma/adapter-pg";
import postgres, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { Pool } from "pg";
import { describe, expect, it } from "vite-plus/test";
import { AuthSessionService } from "../src/auth/auth-session.service.js";
import { requirePrisma8ReadOnlyTestUrl } from "../src/database/prisma8-readonly-target.js";
import { PrismaClient } from "../src/generated/prisma/client.js";
import type { Contract } from "../src/generated/prisma8/contract.d.js";
import contractJson from "../src/generated/prisma8/contract.json" with { type: "json" };
import { PrismaProjectVersionStore } from "../src/projects/prisma-project-version-store.js";
import { PrismaProjectReleaseStore } from "../src/projects/prisma-project-release-store.js";
import { ProjectReleaseSafetyGate } from "../src/projects/project-release-safety-gate.js";
import { Prisma8ProjectReleaseStore } from "../src/projects/prisma8-project-release-store.js";

const contract = contractFromJson<Contract>(contractJson);
const denied = "工程资源不存在或无权访问";
const invalidSession = "身份会话无效或已经失效";
const releaseConflict = "工程发布状态或幂等请求已变化，请重新读取发布状态";
const gateDenied = "正式发布安全门禁尚未完成，当前请求已被安全拒绝";

function same(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) throw new Error("发布事务专项与独立预期不一致");
}

async function rejected(operation: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error && error.message === message) return;
  }
  throw new Error("发布事务未按预期拒绝");
}

function request(revision: number, generation: number) {
  return { expectedHeadRevision: revision, targetRevision: revision, expectedReleaseGeneration: generation };
}

/** 仅对随机隔离工程验证事务；测试门禁不注册 NestJS Provider 或正式路由。 */
async function verifyRelease(): Promise<"MATCHED"> {
  const connectionString = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
  const id = randomUUID();
  const actor = { tenantId: "prisma8-release-" + id, subjectId: "operator" };
  const projectId = "project-" + id;
  const scope = { tenantId: actor.tenantId, projectId };
  const document = { ...waterTreatmentDemoDocument, projectId };
  const failures: string[] = [];
  let stage = "连接初始化";
  let old: PrismaClient | undefined;
  let pool: Pool | undefined;
  let client: PostgresClient<Contract> | undefined;
  let ownsIdentity = false;
  let ownsProject = false;
  let sessionId: string | undefined;
  let creationUnconfirmed = false;
  let poolFailed = false;

  try {
    const base = { connectionString, connectionTimeoutMillis: 2000, idleTimeoutMillis: 5000 };
    const options = "-c statement_timeout=5000 -c lock_timeout=2000";
    const writable = new Pool({ ...base, max: 2, options });
    pool = writable;
    writable.on("error", () => { poolFailed = true; });
    const legacy = new PrismaClient({ adapter: new PrismaPg({ ...base, max: 2, options }) });
    old = legacy;
    await legacy.$connect();
    stage = "隔离库及发布结构预检";
    const boundary = await legacy.$queryRaw<Array<{ database_name: string; schema_name: string; read_only: string; ready: boolean }>>`
      SELECT current_database()::text AS database_name, current_schema()::text AS schema_name,
        current_setting('transaction_read_only') AS read_only,
        (to_regclass('public.scada_projects') IS NOT NULL AND
         to_regclass('public.scada_identities') IS NOT NULL AND
         to_regclass('public.scada_auth_sessions') IS NOT NULL AND
         to_regclass('public.scada_project_grants') IS NOT NULL AND
         to_regclass('public.scada_project_versions') IS NOT NULL AND
         to_regclass('public.scada_project_audit') IS NOT NULL AND
         to_regclass('public.scada_project_release_state') IS NOT NULL AND
         to_regclass('public.scada_project_release_events') IS NOT NULL) AS ready
    `;
    same(boundary, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off", ready: true }]);
    const otherBoundary = await writable.query("SELECT current_database()::text AS database_name, current_schema()::text AS schema_name, current_setting('transaction_read_only') AS read_only");
    same(otherBoundary.rows, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off" }]);
    const next = postgres({ contract, pg: writable });
    client = next;
    const database = {
      client: legacy,
      onModuleInit: () => legacy.$connect(),
      onModuleDestroy: () => legacy.$disconnect(),
    };
    const versions = new PrismaProjectVersionStore(database);
    const sessions = new AuthSessionService(database);
    const previous = new PrismaProjectReleaseStore(database, new ProjectReleaseSafetyGate());
    const candidate = new Prisma8ProjectReleaseStore(next);
    // 唯一允许成功发布的门禁仅存在于此隔离数据库测试中。
    const legacyTest = new PrismaProjectReleaseStore(database, { assertReady: async () => {} });
    const nextTest = new Prisma8ProjectReleaseStore(next, async () => {});

    stage = "随机身份、会话与工程准备";
    creationUnconfirmed = true;
    await legacy.$transaction(async (tx) => {
      same(await tx.scadaProject.count({ where: scope }), 0);
      await tx.scadaIdentity.create({ data: { ...actor, status: "active" } });
    });
    ownsIdentity = true;
    creationUnconfirmed = false;
    creationUnconfirmed = true;
    const issued = await sessions.issueForVerifiedSubject(actor);
    sessionId = issued.sessionId;
    creationUnconfirmed = false;
    creationUnconfirmed = true;
    const created = await versions.create(actor, { document });
    ownsProject = true;
    creationUnconfirmed = false;
    same([created.projectId, created.headRevision], [projectId, 1]);
    const sid = issued.sessionId;
    same((await legacy.scadaProjectGrant.createMany({ data: [
      { ...scope, subjectId: actor.subjectId, permission: "release:read" },
      { ...scope, subjectId: actor.subjectId, permission: "release:publish" },
    ] })).count, 2);
    const inspect = () => legacy.$transaction(async (tx) => ({
      project: await tx.scadaProject.findUniqueOrThrow({ where: { tenantId_projectId: scope } }),
      state: await tx.scadaProjectReleaseState.findUniqueOrThrow({ where: { tenantId_projectId: scope } }),
      events: await tx.scadaProjectReleaseEvent.findMany({ where: scope, orderBy: { generation: "asc" } }),
      versions: await tx.scadaProjectVersion.findMany({ where: scope, orderBy: { revision: "asc" } }),
      audits: await tx.scadaProjectAudit.findMany({ where: scope, orderBy: { revision: "asc" } }),
    }));

    stage = "未发布读取及真实默认门禁";
    const before = await inspect();
    same(await candidate.readCurrent(actor, sid, projectId), { status: "UNRELEASED", projectId, releaseGeneration: 0 });
    same(await candidate.readCurrent(actor, sid, projectId), await previous.readCurrent(actor, sid, projectId));
    const firstKey = randomUUID();
    await rejected(() => candidate.publish(actor, sid, projectId, request(1, 0), firstKey), gateDenied);
    await rejected(() => previous.publish(actor, sid, projectId, request(1, 0), firstKey), gateDenied);
    same(await inspect(), before);

    stage = "双版本首次提交及幂等重放";
    const first = await nextTest.publish(actor, sid, projectId, request(1, 0), firstKey);
    same(first, await legacyTest.publish(actor, sid, projectId, request(1, 0), firstKey));
    same(first, await candidate.publish(actor, sid, projectId, request(1, 0), firstKey));
    same([first.releaseGeneration, first.releasedRevision], [1, 1]);
    const released = await candidate.readCurrent(actor, sid, projectId);
    same(released, await previous.readCurrent(actor, sid, projectId));
    same(released.status, "RELEASED");
    await rejected(() => nextTest.publish(actor, sid, projectId, request(1, 1), firstKey), releaseConflict);
    await rejected(() => nextTest.publish(actor, sid, projectId, request(1, 1), randomUUID()), releaseConflict);

    stage = "编辑版本与发布指针分离";
    await versions.append(actor, projectId, { document, expectedRevision: 1 });
    same(await candidate.readCurrent(actor, sid, projectId), released);
    await rejected(() => nextTest.publish(actor, sid, projectId, request(1, 1), randomUUID()), "工程版本已变化，请重新获取最新修订号");

    stage = "跨版本并发 CAS";
    const concurrent = await Promise.allSettled([
      legacyTest.publish(actor, sid, projectId, request(2, 1), randomUUID()),
      nextTest.publish(actor, sid, projectId, request(2, 1), randomUUID()),
    ]);
    same(concurrent.filter((item) => item.status === "fulfilled").length, 1);
    const rejectedResult = concurrent.find((item) => item.status === "rejected");
    if (!rejectedResult || !(rejectedResult.reason instanceof Error)) throw new Error("缺少预期 CAS 冲突");
    same(rejectedResult.reason.message, releaseConflict);
    const second = await inspect();
    same([second.project.headRevision, second.state.releaseGeneration, second.state.releasedRevision, second.events.length], [2n, 2n, 2n, 2]);
    same([second.events[1]?.fromRevision, second.events[1]?.fromContentHash], [1n, first.releasedContentHash]);
    same(await candidate.readCurrent(actor, sid, projectId), await previous.readCurrent(actor, sid, projectId));

    stage = "真实指针 CAS 失败后整体回滚";
    await versions.append(actor, projectId, { document, expectedRevision: 2 });
    const baseline = await inspect();
    // 在同一随机工程事务中故意制造指针漂移，使候选插入事件后 CAS 更新失败。
    const conflictTest = new Prisma8ProjectReleaseStore(next, async (tx) => {
      const changed = await tx.execute(
        tx.raw.sql`UPDATE public.scada_project_release_state
          SET released_revision = NULL, released_content_hash = NULL, release_generation = 0, last_release_event_id = NULL
          WHERE tenant_id = ${scope.tenantId} AND project_id = ${scope.projectId} AND release_generation = 2`
          .affectedCount().build(),
      );
      same(changed.affectedRows, 1);
    });
    const thirdKey = randomUUID();
    await rejected(() => conflictTest.publish(actor, sid, projectId, request(3, 2), thirdKey), releaseConflict);
    same(await inspect(), baseline);
    const third = await nextTest.publish(actor, sid, projectId, request(3, 2), thirdKey);
    same([third.releaseGeneration, third.releasedRevision], [3, 3]);
    const final = await inspect();
    same([final.project.headRevision, final.events.length, final.state.lastReleaseEventId], [3n, 3, third.eventId]);
    same(final.versions, baseline.versions);
    same(final.audits, baseline.audits);

    stage = "当前发布读取独立授权及会话失效";
    same(await candidate.readCurrent(actor, sid, projectId), await previous.readCurrent(actor, sid, projectId));
    await rejected(() => candidate.readCurrent({ ...actor, tenantId: "missing-" + id }, sid, projectId), denied);
    await rejected(() => candidate.readCurrent(actor, randomUUID(), projectId), invalidSession);
    same((await legacy.scadaProjectGrant.deleteMany({ where: { ...scope, subjectId: actor.subjectId, permission: "release:read" } })).count, 1);
    await rejected(() => candidate.readCurrent(actor, sid, projectId), denied);
    await rejected(() => previous.readCurrent(actor, sid, projectId), denied);
    same((await legacy.scadaProjectGrant.deleteMany({ where: { ...scope, subjectId: actor.subjectId, permission: "release:publish" } })).count, 1);
    await rejected(() => nextTest.publish(actor, sid, projectId, request(3, 2), thirdKey), denied);
    same(await sessions.revokeForVerifiedSubject(actor, sid), true);
    await rejected(() => candidate.readCurrent(actor, sid, projectId), invalidSession);
    same(await inspect(), final);
  } catch {
    failures.push(stage);
  } finally {
    try { await client?.close(); } catch { failures.push("Prisma 8 客户端关闭失败"); }
    try { await pool?.end(); } catch { failures.push("外部连接池关闭失败"); }
    if (poolFailed) failures.push("外部连接池发生异常");
    if (creationUnconfirmed) {
      failures.push("专用夹具创建未确认，禁止自动清理，测试标识：" + id);
    } else if (old && ownsIdentity) {
      try {
        await old.$transaction(async (tx) => {
          if (ownsProject) {
            same((await tx.scadaProjectReleaseState.deleteMany({ where: scope })).count, 1);
            await tx.scadaProjectReleaseEvent.deleteMany({ where: scope });
            await tx.scadaProjectAudit.deleteMany({ where: scope });
            await tx.scadaProjectVersion.deleteMany({ where: scope });
            await tx.scadaProjectGrant.deleteMany({ where: scope });
            same((await tx.scadaProject.deleteMany({ where: scope })).count, 1);
            same(await tx.scadaProjectReleaseState.count({ where: scope }), 0);
            same(await tx.scadaProjectReleaseEvent.count({ where: scope }), 0);
            same(await tx.scadaProjectAudit.count({ where: scope }), 0);
            same(await tx.scadaProjectVersion.count({ where: scope }), 0);
            same(await tx.scadaProjectGrant.count({ where: scope }), 0);
            same(await tx.scadaProject.count({ where: scope }), 0);
          }
          if (sessionId) {
            const where = { ...actor, sessionId };
            same((await tx.scadaAuthSession.deleteMany({ where })).count, 1);
            same(await tx.scadaAuthSession.count({ where }), 0);
          }
          same((await tx.scadaIdentity.deleteMany({ where: actor })).count, 1);
          same(await tx.scadaIdentity.count({ where: actor }), 0);
        });
      } catch {
        failures.push("专用夹具清理未确认，禁止自动重试，测试标识：" + id);
      }
    }
    try { await old?.$disconnect(); } catch { failures.push("Prisma 7 客户端关闭失败"); }
  }
  if (failures.length) throw new Error("发布事务专项未通过：" + failures.join("；"));
  return "MATCHED";
}

describe("真实 PostgreSQL Prisma 8 工程发布候选", () => {
  it("验证默认拒绝、双版本发布、幂等、CAS 回滚、权限及精确清理", async () => {
    expect(await verifyRelease()).toBe("MATCHED");
    console.info("Prisma 8 发布事务双版本对照、安全拒绝、CAS 回滚及专用夹具清理通过");
  }, 60_000);
});
