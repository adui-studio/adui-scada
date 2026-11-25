import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { HttpException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaPg } from "@prisma/adapter-pg";
import postgres, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { Pool } from "pg";
import { describe, expect, it } from "vite-plus/test";
import { Prisma8AuthSessionService } from "../src/auth/prisma8-auth-session.service.js";
import { Prisma8ScadaProjectGuard } from "../src/auth/prisma8-scada-project.guard.js";
import { SCADA_PROJECT_PERMISSION, ScadaProjectGuard } from "../src/auth/scada-project.guard.js";
import type { ScadaAuthenticatedRequest } from "../src/auth/scada-session.guard.js";
import { requirePrisma8ReadOnlyTestUrl } from "../src/database/prisma8-readonly-target.js";
import { PrismaClient } from "../src/generated/prisma/client.js";
import type { Contract } from "../src/generated/prisma8/contract.d.js";
import contractJson from "../src/generated/prisma8/contract.json" with { type: "json" };
import { PrismaProjectVersionStore } from "../src/projects/prisma-project-version-store.js";
import { PrismaProjectReleaseStore } from "../src/projects/prisma-project-release-store.js";
import { Prisma8ProjectVersionStore } from "../src/projects/prisma8-project-version-store.js";
import { Prisma8ProjectQueryStore } from "../src/projects/prisma8-project-query-store.js";
import { Prisma8ProjectReleaseStore } from "../src/projects/prisma8-project-release-store.js";
import { ProjectReleaseSafetyGate } from "../src/projects/project-release-safety-gate.js";
import type { AuthenticatedProjectPrincipal, ProjectAccessAction } from "../src/projects/project-access-policy.js";
import type { SecurityAuditDecision, SecurityAuditReporter } from "../src/security/scada-security-audit.js";

const contract = contractFromJson<Contract>(contractJson);
const denied = "工程资源不存在或无权访问";
const actions: readonly ProjectAccessAction[] = [
  "project:read", "version:read", "version:append", "release:publish", "release:rollback", "release:read",
];
const ownerPermissions: readonly ProjectAccessAction[] = ["project:read", "version:read", "version:append"];

function same(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) throw new Error("工程 ACL 专项与独立预期不一致");
}

async function rejected(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error && error.message === denied) return;
  }
  throw new Error("撤权后的仓储操作未按预期拒绝");
}

function context(request: ScadaAuthenticatedRequest, action: ProjectAccessAction): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata(SCADA_PROJECT_PERMISSION, action, handler);
  return {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => class TestRoute {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** 只在本机隔离库创建随机专用夹具；不引入授权管理接口或正式发布行为。 */
async function verifyAcl(): Promise<"MATCHED"> {
  const connectionString = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
  const id = randomUUID();
  const owner = { tenantId: "prisma8-acl-" + id, subjectId: "owner" };
  const reader = { ...owner, subjectId: "reader" };
  const publisher = { ...owner, subjectId: "publisher" };
  const foreign = { tenantId: "prisma8-acl-other-" + id, subjectId: reader.subjectId };
  const identities = [owner, reader, publisher, foreign];
  const projectId = "project-" + id;
  const siblingId = "sibling-" + id;
  const document = { ...waterTreatmentDemoDocument, projectId };
  const fixtures = [
    { actor: owner, projectId },
    { actor: owner, projectId: siblingId },
    { actor: foreign, projectId },
  ];
  const scopes = fixtures.map((fixture) => ({ tenantId: fixture.actor.tenantId, projectId: fixture.projectId }));
  const ownedScopes: typeof scopes = [];
  const failures: string[] = [];
  let stage = "连接初始化";
  let old: PrismaClient | undefined;
  let pool: Pool | undefined;
  let client: PostgresClient<Contract> | undefined;
  let ownsIdentities = false;
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

    stage = "隔离库及 ACL 结构预检";
    const boundary = await legacy.$queryRaw<Array<{ database_name: string; schema_name: string; read_only: string; ready: boolean }>>`
      SELECT current_database()::text AS database_name, current_schema()::text AS schema_name,
        current_setting('transaction_read_only') AS read_only,
        (to_regclass('public.scada_projects') IS NOT NULL AND
         to_regclass('public.scada_identities') IS NOT NULL AND
         to_regclass('public.scada_auth_sessions') IS NOT NULL AND
         to_regclass('public.scada_project_grants') IS NOT NULL AND
         to_regclass('public.scada_project_grants_subject_idx') IS NOT NULL AND
         to_regclass('public.scada_project_versions') IS NOT NULL AND
         to_regclass('public.scada_project_audit') IS NOT NULL AND
         to_regclass('public.scada_project_release_state') IS NOT NULL AND
         to_regclass('public.scada_project_release_events') IS NOT NULL) AS ready
    `;
    same(boundary, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off", ready: true }]);
    const migration = await legacy.$queryRaw<Array<{ ready: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM public._prisma_migrations
        WHERE migration_name = '20261119180000_release_read_permission'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ready
    `;
    same(migration, [{ ready: true }]);
    const poolBoundary = await writable.query("SELECT current_database()::text AS database_name, current_schema()::text AS schema_name, current_setting('transaction_read_only') AS read_only");
    same(poolBoundary.rows, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off" }]);

    const next = postgres({ contract, pg: writable });
    client = next;
    const database = {
      client: legacy,
      onModuleInit: () => legacy.$connect(),
      onModuleDestroy: () => legacy.$disconnect(),
    };
    const previous = new PrismaProjectVersionStore(database);
    const writer = new Prisma8ProjectVersionStore(next);
    const query = new Prisma8ProjectQueryStore(next);
    const release = new Prisma8ProjectReleaseStore(next);
    const oldRelease = new PrismaProjectReleaseStore(database, new ProjectReleaseSafetyGate());
    const sessions = new Prisma8AuthSessionService(next);
    const records: SecurityAuditDecision[] = [];
    const audit: SecurityAuditReporter = { record: (decision) => { records.push(decision); } };
    const guards = [
      new ScadaProjectGuard(database, new Reflector(), audit),
      new Prisma8ScadaProjectGuard(next, new Reflector(), audit),
    ];

    stage = "双版本专用工程及精确授权准备";
    creationUnconfirmed = true;
    await legacy.$transaction(async (tx) => {
      same(await tx.scadaIdentity.count({ where: { OR: identities } }), 0);
      same(await tx.scadaProject.count({ where: { OR: scopes } }), 0);
      same((await tx.scadaIdentity.createMany({ data: identities })).count, identities.length);
    });
    ownsIdentities = true;
    creationUnconfirmed = false;
    for (const [index, fixture] of fixtures.entries()) {
      creationUnconfirmed = true;
      const store = index === 0 ? writer : previous;
      const created = await store.create(fixture.actor, { document: { ...document, projectId: fixture.projectId } });
      ownedScopes.push(scopes[index]!);
      creationUnconfirmed = false;
      same([created.projectId, created.headRevision], [fixture.projectId, 1]);
    }
    const scope = { tenantId: owner.tenantId, projectId };
    creationUnconfirmed = true;
    same((await legacy.scadaProjectGrant.createMany({ data: [
      { ...scope, subjectId: reader.subjectId, permission: "release:read" },
      { ...scope, subjectId: publisher.subjectId, permission: "release:publish" },
      { ...scope, subjectId: publisher.subjectId, permission: "release:rollback" },
    ] })).count, 3);
    creationUnconfirmed = false;
    creationUnconfirmed = true;
    const issued = await sessions.issueForVerifiedSubject(reader);
    sessionId = issued.sessionId;
    creationUnconfirmed = false;
    same(await sessions.authenticateWithSession(issued.token), { principal: reader, sessionId: issued.sessionId });

    const inspect = () => legacy.$transaction(async (tx) => {
      const where = { OR: scopes };
      return {
        projects: await tx.scadaProject.findMany({ where, orderBy: [{ tenantId: "asc" }, { projectId: "asc" }] }),
        grants: await tx.scadaProjectGrant.findMany({ where, orderBy: [{ tenantId: "asc" }, { projectId: "asc" }, { subjectId: "asc" }, { permission: "asc" }] }),
        versions: await tx.scadaProjectVersion.findMany({ where, orderBy: [{ tenantId: "asc" }, { projectId: "asc" }, { revision: "asc" }] }),
        audits: await tx.scadaProjectAudit.findMany({ where, orderBy: [{ tenantId: "asc" }, { projectId: "asc" }, { revision: "asc" }] }),
        releases: await tx.scadaProjectReleaseState.findMany({ where, orderBy: [{ tenantId: "asc" }, { projectId: "asc" }] }),
        events: await tx.scadaProjectReleaseEvent.count({ where }),
      };
    });
    const before = await inspect();
    same([before.projects.length, before.grants.length, before.versions.length, before.audits.length, before.releases.length, before.events], [3, 12, 3, 3, 3, 0]);
    for (const fixture of fixtures) {
      const grants = before.grants.filter((grant) => grant.tenantId === fixture.actor.tenantId &&
        grant.subjectId === fixture.actor.subjectId && grant.projectId === fixture.projectId);
      same(new Set(grants.map((grant) => grant.permission)), new Set(ownerPermissions));
    }

    const check = async (
      principal: AuthenticatedProjectPrincipal,
      targetId: string,
      action: ProjectAccessAction,
      allowed: boolean,
      routeTenant?: string,
    ): Promise<void> => {
      for (const guard of guards) {
        records.length = 0;
        const params = routeTenant === undefined ? { projectId: targetId } : { projectId: targetId, tenantId: routeTenant };
        let status = 200;
        try {
          same(await guard.canActivate(context({ headers: {}, params, scadaPrincipal: principal }, action)), true);
        } catch (error) {
          if (!(error instanceof HttpException)) throw new Error("工程权限查询发生非预期异常");
          same(error.message, denied);
          status = error.getStatus();
        }
        same(status, allowed ? 200 : 404);
        same(records, [{
          action: "project.authorize",
          outcome: allowed ? "allowed" : "denied",
          reason: allowed ? "permission_granted" : routeTenant !== undefined && routeTenant !== principal.tenantId ? "invalid_scope" : "permission_denied",
        }]);
      }
    };

    stage = "六项独立权限、同名工程和主体隔离";
    for (const action of actions) {
      await check(owner, projectId, action, ownerPermissions.includes(action));
      await check(reader, projectId, action, action === "release:read");
      await check(publisher, projectId, action, action === "release:publish" || action === "release:rollback");
      await check(foreign, projectId, action, ownerPermissions.includes(action));
    }
    await check(reader, siblingId, "release:read", false);
    await check(owner, projectId, "version:read", false, foreign.tenantId);
    await check({ ...owner, subjectId: "missing" }, projectId, "project:read", false);
    await check(owner, "missing-" + id, "project:read", false);
    await check(owner, projectId, "devices:write" as ProjectAccessAction, false);
    same(await query.getProject(owner, projectId), await previous.getProject(owner, projectId));
    await rejected(() => query.read(reader, projectId, 1));
    const unreleased = { status: "UNRELEASED", projectId, releaseGeneration: 0 };
    same(await release.readCurrent(reader, issued.sessionId, projectId), unreleased);
    same(await oldRelease.readCurrent(reader, issued.sessionId, projectId), unreleased);
    same(await inspect(), before);

    stage = "旧 Guard 通过后受控撤权及仓储锁内复核";
    await check(owner, projectId, "version:append", true);
    await check(reader, projectId, "release:read", true);
    // 仅在已确认的专用工程内取得与仓储一致的排他锁后移除两条明确授权。
    await legacy.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ project_id: string }>>`
        SELECT project_id FROM public.scada_projects WHERE tenant_id = ${scope.tenantId} AND project_id = ${projectId} FOR UPDATE
      `;
      same(locked, [{ project_id: projectId }]);
      same((await tx.scadaProjectGrant.deleteMany({ where: { ...scope, subjectId: owner.subjectId, permission: "version:append" } })).count, 1);
      same((await tx.scadaProjectGrant.deleteMany({ where: { ...scope, subjectId: reader.subjectId, permission: "release:read" } })).count, 1);
    });
    await check(owner, projectId, "version:append", false);
    await check(reader, projectId, "release:read", false);
    await check(owner, projectId, "version:read", true);
    await check(owner, siblingId, "version:append", true);
    await check(foreign, projectId, "version:append", true);
    await check(publisher, projectId, "release:publish", true);
    await rejected(() => writer.append(owner, projectId, { expectedRevision: 1, document }));
    await rejected(() => previous.append(owner, projectId, { expectedRevision: 1, document }));
    await rejected(() => release.readCurrent(reader, issued.sessionId, projectId));
    await rejected(() => oldRelease.readCurrent(reader, issued.sessionId, projectId));
    const after = await inspect();
    same(after.projects, before.projects);
    same(after.versions, before.versions);
    same(after.audits, before.audits);
    same(after.releases, before.releases);
    same(after.events, 0);
    same(after.grants, before.grants.filter((grant) =>
      !(grant.tenantId === scope.tenantId && grant.projectId === projectId &&
        ((grant.subjectId === owner.subjectId && grant.permission === "version:append") ||
         (grant.subjectId === reader.subjectId && grant.permission === "release:read")))));
    same(await sessions.authenticate(issued.token), reader);
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
          if (ownedScopes.length > 0) {
            const where = { OR: ownedScopes };
            same(await tx.scadaProjectReleaseEvent.count({ where }), 0);
            await tx.scadaProjectReleaseState.deleteMany({ where });
            await tx.scadaProjectAudit.deleteMany({ where });
            await tx.scadaProjectVersion.deleteMany({ where });
            await tx.scadaProjectGrant.deleteMany({ where });
            same((await tx.scadaProject.deleteMany({ where })).count, ownedScopes.length);
            same(await tx.scadaProjectReleaseState.count({ where }), 0);
            same(await tx.scadaProjectAudit.count({ where }), 0);
            same(await tx.scadaProjectVersion.count({ where }), 0);
            same(await tx.scadaProjectGrant.count({ where }), 0);
            same(await tx.scadaProject.count({ where }), 0);
          }
          if (sessionId) {
            const where = { ...reader, sessionId };
            same((await tx.scadaAuthSession.deleteMany({ where })).count, 1);
            same(await tx.scadaAuthSession.count({ where }), 0);
          }
          const where = { OR: identities };
          same(await tx.scadaAuthSession.count({ where }), 0);
          same((await tx.scadaIdentity.deleteMany({ where })).count, identities.length);
          same(await tx.scadaIdentity.count({ where }), 0);
        });
      } catch {
        failures.push("专用夹具清理未确认，禁止自动重试，测试标识：" + id);
      }
    }
    try { await old?.$disconnect(); } catch { failures.push("Prisma 7 客户端关闭失败"); }
  }
  if (failures.length) throw new Error("工程 ACL 专项未通过：" + failures.join("；"));
  return "MATCHED";
}

describe("真实 PostgreSQL Prisma 8 工程 ACL Guard 候选", () => {
  it("验证双版本六项独立授权、隔离、撤权后仓储复核与精确清理", async () => {
    expect(await verifyAcl()).toBe("MATCHED");
    console.info("Prisma 8 工程 ACL 双版本对照、撤权复核与专用夹具清理通过");
  }, 60_000);
});
