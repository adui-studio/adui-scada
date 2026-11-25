import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { waterTreatmentDemoDocument, readProjectSnapshot } from "@adui/scada-core";
import { PrismaPg } from "@prisma/adapter-pg";
import postgres, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { Pool } from "pg";
import { describe, expect, it } from "vite-plus/test";
import { createPrisma8ReadOnlyClient } from "../src/database/prisma8-readonly-client.js";
import { requirePrisma8ReadOnlyTestUrl } from "../src/database/prisma8-readonly-target.js";
import { PrismaClient } from "../src/generated/prisma/client.js";
import type { Contract } from "../src/generated/prisma8/contract.d.js";
import contractJson from "../src/generated/prisma8/contract.json" with { type: "json" };
import {
  PrismaProjectVersionStore,
  ProjectRevisionConflictError,
} from "../src/projects/prisma-project-version-store.js";
import {
  Prisma8ProjectVersionStore,
  appendPrisma8ProjectVersionInTransaction,
} from "../src/projects/prisma8-project-version-store.js";

const contract = contractFromJson<Contract>(contractJson);
const options = { isolationLevel: "ReadCommitted", timeout: 10000 } as const;

function same(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) throw new Error("工程版本专项与独立预期不一致");
}

async function rejected(operation: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error && error.message === message) return;
  }
  throw new Error("工程版本请求未按预期拒绝");
}

function hasSqlState(error: unknown, state: string): boolean {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || typeof current !== "object") return false;
    if (
      ("sqlState" in current && current.sqlState === state) ||
      ("code" in current && current.code === state)
    )
      return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

/** 随机租户与工程仅用于真实隔离数据库；创建未确认时禁止自动清理。 */
async function verify(): Promise<"MATCHED"> {
  const connectionString = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
  const id = randomUUID();
  const actor = { tenantId: "prisma8-version-" + id, subjectId: "operator" };
  const other = { tenantId: "prisma8-other-" + id, subjectId: "operator" };
  const document = waterTreatmentDemoDocument;
  const projectId = document.projectId;
  const scopes = [actor, other].map(({ tenantId }) => ({ tenantId, projectId }));
  const save = (expectedRevision: number) => ({ expectedRevision, document });
  const failures: string[] = [];
  let stage = "连接初始化";
  let legacy: PrismaClient | undefined;
  let writerPool: Pool | undefined;
  let readPool: Pool | undefined;
  let writer: PostgresClient<Contract> | undefined;
  let reader: PostgresClient<Contract> | undefined;
  let ownsIdentities = false;
  let creationUnconfirmed = false;
  let poolFailed = false;
  const confirmedProjects: typeof scopes = [];

  try {
    const base = { connectionString, connectionTimeoutMillis: 2000, idleTimeoutMillis: 5000 };
    const pgOptions = "-c statement_timeout=5000 -c lock_timeout=2000";
    const writablePool = new Pool({ ...base, max: 2, options: pgOptions });
    writerPool = writablePool;
    const readOnlyPool = new Pool({
      ...base,
      max: 1,
      options: pgOptions + " -c default_transaction_read_only=on",
    });
    readPool = readOnlyPool;
    for (const pool of [writablePool, readOnlyPool]) {
      pool.on("error", () => {
        poolFailed = true;
      });
    }
    const old = new PrismaClient({
      adapter: new PrismaPg({ ...base, max: 2, options: pgOptions }),
    });
    legacy = old;
    await old.$connect();
    stage = "隔离库与工程结构预检";
    const boundary = await old.$queryRaw<
      Array<{ database_name: string; schema_name: string; read_only: string; ready: boolean }>
    >`
      SELECT current_database()::text AS database_name, current_schema()::text AS schema_name,
        current_setting('transaction_read_only') AS read_only,
        (to_regclass('public.scada_projects') IS NOT NULL AND
         to_regclass('public.scada_identities') IS NOT NULL AND
         to_regclass('public.scada_project_grants') IS NOT NULL AND
         to_regclass('public.scada_project_versions') IS NOT NULL AND
         to_regclass('public.scada_project_audit') IS NOT NULL AND
         to_regclass('public.scada_project_release_state') IS NOT NULL) AS ready
    `;
    same(boundary, [
      { database_name: "adui_scada_test", schema_name: "public", read_only: "off", ready: true },
    ]);
    for (const [pool, readOnly] of [
      [writablePool, "off"],
      [readOnlyPool, "on"],
    ] as const) {
      const result = await pool.query(
        "SELECT current_database()::text AS database_name, current_schema()::text AS schema_name, current_setting('transaction_read_only') AS read_only",
      );
      same(result.rows, [
        { database_name: "adui_scada_test", schema_name: "public", read_only: readOnly },
      ]);
    }
    const next = postgres({ contract, pg: writablePool });
    writer = next;
    const read = createPrisma8ReadOnlyClient(readOnlyPool);
    reader = read;
    const modern = new Prisma8ProjectVersionStore(next);
    const previous = new PrismaProjectVersionStore({
      client: old,
      onModuleInit: () => old.$connect(),
      onModuleDestroy: () => old.$disconnect(),
    });

    stage = "专用主体创建";
    creationUnconfirmed = true;
    await old.$transaction(async (tx) => {
      same(await tx.scadaProject.count({ where: { OR: scopes } }), 0);
      same((await tx.scadaIdentity.createMany({ data: [actor, other] })).count, 2);
    });
    ownsIdentities = true;
    creationUnconfirmed = false;

    stage = "新版与旧版首版工程创建";
    creationUnconfirmed = true;
    const created = await modern.create(actor, { document });
    confirmedProjects.push(scopes[0]!);
    creationUnconfirmed = false;
    same(created.headRevision, 1);
    creationUnconfirmed = true;
    same((await previous.create(other, { document })).headRevision, 1);
    confirmedProjects.push(scopes[1]!);
    creationUnconfirmed = false;

    const inspect = async (tenantId: string, head: number): Promise<void> => {
      const where = { tenantId, projectId };
      const project = await old.scadaProject.findUnique({ where: { tenantId_projectId: where } });
      same(project?.headRevision, BigInt(head));
      const grants = await old.scadaProjectGrant.findMany({
        where,
        orderBy: { permission: "asc" },
      });
      same(
        grants.map((grant) => [grant.subjectId, grant.permission]),
        [
          ["operator", "project:read"],
          ["operator", "version:append"],
          ["operator", "version:read"],
        ],
      );
      const release = await old.scadaProjectReleaseState.findUnique({
        where: { tenantId_projectId: where },
      });
      same(
        [
          release?.releaseGeneration,
          release?.releasedRevision,
          release?.releasedContentHash,
          release?.lastReleaseEventId,
        ],
        [0n, null, null, null],
      );
      const versions = await old.scadaProjectVersion.findMany({
        where,
        orderBy: { revision: "asc" },
      });
      const audits = await old.scadaProjectAudit.findMany({ where, orderBy: { revision: "asc" } });
      same(versions.length, head);
      same(audits.length, head);
      for (let index = 0; index < head; index += 1) {
        const version = versions[index]!;
        const audit = audits[index]!;
        const snapshot = await readProjectSnapshot(version.snapshot);
        same(
          [
            version.revision,
            snapshot.revision,
            version.contentHash,
            snapshot.contentHash,
            version.createdAt.toISOString(),
            snapshot.createdAt,
          ],
          [
            BigInt(index + 1),
            index + 1,
            snapshot.contentHash,
            snapshot.contentHash,
            snapshot.createdAt,
            snapshot.createdAt,
          ],
        );
        same(
          [snapshot.projectId, version.createdBy, audit.revision, audit.actorId, audit.action],
          [projectId, "operator", BigInt(index + 1), "operator", "version:append"],
        );
      }
    };
    await inspect(actor.tenantId, 1);
    await inspect(other.tenantId, 1);
    same((await previous.read(actor, projectId, 1)).revision, 1);

    stage = "跨版本追加及权限拒绝";
    same((await previous.append(actor, projectId, save(1))).revision, 2);
    same((await modern.append(other, projectId, save(1))).revision, 2);
    const updated = await modern.append(actor, projectId, save(2));
    same(await previous.read(actor, projectId, 3), updated);
    await rejected(() => modern.create(actor, { document }), "当前租户下已存在相同工程标识的工程");
    await rejected(
      () => modern.create({ ...actor, subjectId: "missing" }, { document }),
      "工程资源不存在或无权访问",
    );
    await rejected(
      () => modern.append({ ...actor, subjectId: "missing" }, projectId, save(3)),
      "工程资源不存在或无权访问",
    );
    await rejected(
      () => modern.append({ ...actor, tenantId: "missing-" + id }, projectId, save(3)),
      "工程资源不存在或无权访问",
    );
    await rejected(
      () => modern.append(actor, projectId, save(2)),
      "工程版本已变化，请重新获取最新修订号",
    );
    await rejected(
      () => new Prisma8ProjectVersionStore(read).append(actor, projectId, save(3)),
      "Prisma 8 工程版本候选仅允许隔离库读已提交写事务",
    );

    stage = "双版本同水位并发竞争";
    const race = await Promise.allSettled([
      modern.append(actor, projectId, save(3)),
      previous.append(actor, projectId, save(3)),
    ]);
    same(race.filter((item) => item.status === "fulfilled").length, 1);
    same(
      race.filter(
        (item) => item.status === "rejected" && item.reason instanceof ProjectRevisionConflictError,
      ).length,
      1,
    );
    await inspect(actor.tenantId, 4);
    await inspect(other.tenantId, 2);

    stage = "真实唯一约束故障及工程水位回滚";
    let constraintRejected = false;
    await rejected(
      () =>
        next.transaction(async (tx) => {
          same(
            (await appendPrisma8ProjectVersionInTransaction(tx, actor, projectId, save(4)))
              .revision,
            5,
          );
          try {
            await tx.execute(
              tx.raw.sql`INSERT INTO public.scada_project_audit
          (event_id, tenant_id, project_id, revision, actor_id, action)
          SELECT event_id, tenant_id, project_id, revision, actor_id, action FROM public.scada_project_audit
          WHERE tenant_id = ${actor.tenantId} AND project_id = ${projectId} AND revision = 5`
                .affectedCount()
                .build(),
            );
          } catch (error) {
            constraintRejected = hasSqlState(error, "23505");
            throw new Error("专用审计唯一约束拒绝");
          }
          throw new Error("专用事务未触发唯一约束");
        }, options),
      "专用审计唯一约束拒绝",
    );
    same(constraintRejected, true);
    await inspect(actor.tenantId, 4);
    same((await modern.append(actor, projectId, save(4))).revision, 5);
    await inspect(actor.tenantId, 5);
    await inspect(other.tenantId, 2);
  } catch {
    failures.push(stage);
  } finally {
    for (const client of [reader, writer]) {
      try {
        await client?.close();
      } catch {
        failures.push("Prisma 8 客户端关闭失败");
      }
    }
    for (const pool of [readPool, writerPool]) {
      try {
        await pool?.end();
      } catch {
        failures.push("外部连接池关闭失败");
      }
    }
    if (poolFailed) failures.push("外部连接池发生异常");
    if (creationUnconfirmed) {
      failures.push("专用夹具创建未确认，禁止自动清理，测试标识：" + id);
    } else if (legacy && ownsIdentities) {
      try {
        await legacy.$transaction(async (tx) => {
          if (confirmedProjects.length > 0) {
            const where = { OR: confirmedProjects };
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
          const identities = { OR: [actor, other] };
          same((await tx.scadaIdentity.deleteMany({ where: identities })).count, 2);
          same(await tx.scadaIdentity.count({ where: identities }), 0);
        });
      } catch {
        failures.push("专用夹具清理未确认，禁止自动重试，测试标识：" + id);
      }
    }
    try {
      await legacy?.$disconnect();
    } catch {
      failures.push("Prisma 7 客户端关闭失败");
    }
  }
  if (failures.length) throw new Error("工程版本事务专项未通过：" + failures.join("；"));
  return "MATCHED";
}

describe("真实 PostgreSQL Prisma 8 工程版本事务候选", () => {
  it("验证双版本创建追加、权限与 CAS、真实审计约束回滚及精确清理", async () => {
    expect(await verify()).toBe("MATCHED");
    console.info("Prisma 8 工程版本事务及双版本真实对照与专用夹具清理通过");
  }, 60_000);
});
