import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TagHistoryBuffer } from "@adui/scada-core";
import type { TagHistoryPersistenceRequest, TagValue } from "@adui/scada-core";
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
  PrismaTagHistoryStore,
  readPersistedTagHistory,
} from "../src/history/prisma-tag-history-store.js";
import { readPersistedTagHistoryPrisma8 } from "../src/history/prisma8-tag-history-reader.js";
import {
  preparePrisma8HistoryBatch,
  Prisma8TagHistoryStore,
  writePrisma8HistoryBatchInTransaction,
  type Prisma8HistoryWriterScope,
} from "../src/history/prisma8-tag-history-store.js";
import { encodeHistoryPoint } from "../src/history/tag-history-record-codec.js";

const contract = contractFromJson<Contract>(contractJson);
const tagId = "water.level";
const origin = Date.parse("2026-11-24T00:00:00.000Z");
const options = { isolationLevel: "ReadCommitted", timeout: 10000 } as const;

function same(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) throw new Error("历史写入事务结果与独立预期不一致");
}

function request(
  scope: Prisma8HistoryWriterScope,
  batchSequence: number,
  values: readonly TagValue["value"][],
): TagHistoryPersistenceRequest {
  const timestamp = new Date(origin + batchSequence * 10).toISOString();
  const qualities = ["GOOD", "UNCERTAIN", "STALE", "BAD"] as const;
  const buffer = new TagHistoryBuffer(values.length);
  buffer.append({
    kind: "sample",
    values: values.map((value, sequence) => ({
      tagId,
      value,
      quality: qualities[sequence % qualities.length]!,
      sourceTimestamp: null,
      serverTimestamp: timestamp,
      sequence,
    })),
  });
  return {
    projectId: scope.projectId,
    streamId: scope.streamId,
    batchSequence,
    formatVersion: 1,
    records: buffer.prepareArchive(values.length)!.records,
  };
}

async function rejected(read: () => Promise<unknown>, message?: string): Promise<void> {
  try {
    await read();
  } catch (error) {
    if (message === undefined || (error instanceof Error && error.message === message)) return;
  }
  throw new Error("历史写入请求未按预期拒绝");
}

/** 只判断受控 SQLSTATE 或其原始原因，不输出数据库异常正文。 */
function hasSqlState(error: unknown, state: string): boolean {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || typeof current !== "object") return false;
    if (("sqlState" in current && current.sqlState === state) ||
        ("code" in current && current.code === state)) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

/** 真实写入限定显式本机隔离库，创建回执完整后才取得精确清理权。 */
async function verifyWrite(): Promise<"MATCHED"> {
  const connectionString = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
  const id = randomUUID();
  const scope = { tenantId: "prisma8-write-" + id, projectId: "project-" + id, streamId: "stream-" + id };
  const otherTenant = { ...scope, tenantId: "prisma8-other-" + id };
  const otherProject = { ...scope, projectId: "other-" + id };
  const scopes = [scope, otherTenant, otherProject].map(({ tenantId, projectId }) => ({ tenantId, projectId }));
  let legacy: PrismaClient | undefined;
  let writerPool: Pool | undefined;
  let readPool: Pool | undefined;
  let writer: PostgresClient<Contract> | undefined;
  let reader: PostgresClient<Contract> | undefined;
  let ownsFixture = false;
  let createUnconfirmed = false;
  let poolFailed = false;
  let stage = "连接初始化";
  const failures: string[] = [];

  try {
    const base = { connectionString, connectionTimeoutMillis: 2000, idleTimeoutMillis: 5000 };
    const pgOptions = "-c statement_timeout=5000 -c lock_timeout=2000";
    const readOnlyPool = new Pool({ ...base, max: 1, options: pgOptions + " -c default_transaction_read_only=on" });
    readPool = readOnlyPool;
    const writablePool = new Pool({ ...base, max: 2, options: pgOptions });
    writerPool = writablePool;
    for (const pool of [readOnlyPool, writablePool]) {
      pool.on("error", () => { poolFailed = true; });
    }
    const old = new PrismaClient({ adapter: new PrismaPg({ ...base, max: 2, options: pgOptions }) });
    legacy = old;
    await old.$connect();
    stage = "隔离库及历史结构预检";
    const boundary = await old.$queryRaw<Array<{ database_name: string; schema_name: string; read_only: string; ready: boolean }>>`
      SELECT current_database()::text AS database_name, current_schema()::text AS schema_name,
             current_setting('transaction_read_only') AS read_only,
             (to_regclass('public.scada_tag_history_batches') IS NOT NULL AND
              to_regclass('public.scada_tag_history_records') IS NOT NULL AND
              to_regclass('public.scada_tag_history_records_lookup_idx') IS NOT NULL) AS ready
    `;
    same(boundary, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off", ready: true }]);
    const readBoundary = await readOnlyPool.query(`SELECT current_database()::text AS database_name,
      current_schema()::text AS schema_name, current_setting('transaction_read_only') AS read_only`);
    same(readBoundary.rows, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "on" }]);
    const writeBoundary = await writablePool.query(`SELECT current_database()::text AS database_name,
      current_schema()::text AS schema_name, current_setting('transaction_read_only') AS read_only`);
    same(writeBoundary.rows, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off" }]);
    const next = postgres({ contract, pg: writablePool });
    writer = next;
    const read = createPrisma8ReadOnlyClient(readOnlyPool);
    reader = read;
    stage = "随机专用工程创建";
    createUnconfirmed = true;
    same((await old.scadaProject.createMany({ data: scopes })).count, scopes.length);
    ownsFixture = true;
    createUnconfirmed = false;

    const modern = (target = scope) => new Prisma8TagHistoryStore(next, target);
    const previous = (target = scope) => new PrismaTagHistoryStore(old, target);

    async function check(target: Prisma8HistoryWriterScope, input: TagHistoryPersistenceRequest): Promise<void> {
      const params = [target.tenantId, target.projectId, target.streamId, BigInt(input.batchSequence).toString()];
      const batch = await readOnlyPool.query(`SELECT format_version, record_count FROM public.scada_tag_history_batches
        WHERE tenant_id=$1 AND project_id=$2 AND stream_id=$3 AND batch_sequence=$4`, params);
      same(batch.rows, [{ format_version: 1, record_count: input.records.length }]);
      const records = await readOnlyPool.query(`SELECT ordinal, tag_id, timestamp_ms::text AS timestamp_ms, payload
        FROM public.scada_tag_history_records WHERE tenant_id=$1 AND project_id=$2 AND stream_id=$3 AND batch_sequence=$4
        ORDER BY ordinal`, params);
      same(records.rows, input.records.map((point, ordinal) => ({
        ordinal, tag_id: point.tagId, timestamp_ms: BigInt(point.timestampMs).toString(), payload: encodeHistoryPoint(point),
      })));
      const startMs = input.records[0]!.timestampMs;
      const query = { tagId, startMs, endMs: startMs + 1, maxPoints: 256 };
      same(await readPersistedTagHistory(old, target, query), input.records);
      same(await readPersistedTagHistoryPrisma8(read, target, query), input.records);
    }

    async function absent(target: Prisma8HistoryWriterScope, sequence: number): Promise<void> {
      const where = { ...target, batchSequence: BigInt(sequence) };
      same(await old.scadaTagHistoryBatch.count({ where }), 0);
      same(await old.scadaTagHistoryRecord.count({ where }), 0);
    }

    stage = "新版首次写入及双版本重放";
    const initial = request(scope, 1, [-0, "合成历史", true, null]);
    same(await modern().persist(initial), { projectId: scope.projectId, streamId: scope.streamId,
      batchSequence: 1, formatVersion: 1, recordCount: 4, status: "COMMITTED" });
    same((await previous().persist(initial)).status, "ALREADY_COMMITTED");
    same((await modern().persist(initial)).status, "ALREADY_COMMITTED");
    await rejected(() => modern().persist(request(scope, 1, [0, "合成历史", true, null])), "历史归档幂等键内容冲突");
    await rejected(() => modern().persist({ ...initial, records: [...initial.records].reverse() }), "历史归档幂等键内容冲突");
    await check(scope, initial);
    const legacyFirst = request(scope, 2, [12.5]);
    same((await previous().persist(legacyFirst)).status, "COMMITTED");
    same((await modern().persist(legacyFirst)).status, "ALREADY_COMMITTED");
    await check(scope, legacyFirst);

    stage = "同键相同内容跨版本并发";
    const identical = request(scope, 3, [33, 44]);
    const sameRace = await Promise.allSettled([modern().persist(identical), previous().persist(identical)]);
    same(sameRace.map((result) => result.status === "fulfilled" ? result.value.status : "REJECTED").sort(), ["ALREADY_COMMITTED", "COMMITTED"]);
    await check(scope, identical);

    stage = "同键不同内容新版并发";
    const competitors = [request(scope, 4, [50]), request(scope, 4, [60])];
    const race = await Promise.allSettled(competitors.map((input) => modern().persist(input)));
    same(race.filter((result) => result.status === "fulfilled").length, 1);
    same(race.filter((result) => result.status === "rejected" && result.reason instanceof Error && result.reason.message === "历史归档幂等键内容冲突").length, 1);
    const winner = race.findIndex((result) => result.status === "fulfilled");
    const committed = race[winner];
    same(committed?.status === "fulfilled" ? committed.value.status : null, "COMMITTED");
    await check(scope, competitors[winner]!);

    stage = "真实复合外键及只读边界拒绝";
    const missing = { ...scope, projectId: "missing-" + id };
    let foreignKeyRejected = false;
    try { await modern(missing).persist(request(missing, 1, [7])); }
    catch (error) { foreignKeyRejected = hasSqlState(error, "23503"); }
    same(foreignKeyRejected, true);
    await absent(missing, 1);
    await rejected(() => new Prisma8TagHistoryStore(read, scope).persist(request(scope, 5, [7])), "Prisma 8 历史写入候选仅允许隔离库读已提交事务");
    await absent(scope, 5);

    stage = "同事务真实唯一约束故障及整批回滚";
    const rollback = request(scope, 6, [70, 80]);
    const prepared = preparePrisma8HistoryBatch(scope, rollback);
    let tentative = false;
    let constraintRejected = false;
    await rejected(() => next.transaction(async (tx) => {
      same(await writePrisma8HistoryBatchInTransaction(tx, prepared), "COMMITTED");
      tentative = true;
      try {
        await tx.execute(tx.raw.sql`INSERT INTO public.scada_tag_history_records
          (tenant_id, project_id, stream_id, batch_sequence, ordinal, tag_id, timestamp_ms, payload)
          SELECT tenant_id, project_id, stream_id, batch_sequence, ordinal, tag_id, timestamp_ms, payload
          FROM public.scada_tag_history_records
          WHERE tenant_id=${scope.tenantId} AND project_id=${scope.projectId} AND stream_id=${scope.streamId}
            AND batch_sequence=${prepared.key.batchSequence} AND ordinal=0`.affectedCount().build());
      } catch (error) {
        constraintRejected = hasSqlState(error, "23505");
        throw new Error("专用事务唯一约束拒绝");
      }
      throw new Error("专用事务未触发预期唯一约束");
    }, options));
    same(tentative, true);
    same(constraintRejected, true);
    await absent(scope, 6);
    same((await modern().persist(rollback)).status, "COMMITTED");
    await check(scope, rollback);

    stage = "相同流与批次的跨租户及跨工程隔离";
    const tenantInput = request(otherTenant, 1, [999]);
    const projectInput = request(otherProject, 1, [888]);
    same((await modern(otherTenant).persist(tenantInput)).status, "COMMITTED");
    same((await modern(otherProject).persist(projectInput)).status, "COMMITTED");
    await check(scope, initial);
    await check(otherTenant, tenantInput);
    await check(otherProject, projectInput);
  } catch {
    // 只输出固定阶段，不传播 SQL、业务记录或连接凭据。
    failures.push(stage);
  } finally {
    for (const client of [reader, writer]) {
      try { await client?.close(); } catch { failures.push("Prisma 8 客户端关闭失败"); }
    }
    for (const pool of [readPool, writerPool]) {
      try { await pool?.end(); } catch { failures.push("外部连接池关闭失败"); }
    }
    if (poolFailed) failures.push("外部连接池发生异常");
    if (legacy && ownsFixture) {
      try {
        const where = { OR: scopes };
        await legacy.$transaction(async (tx) => {
          await tx.scadaTagHistoryRecord.deleteMany({ where });
          await tx.scadaTagHistoryBatch.deleteMany({ where });
          same((await tx.scadaProject.deleteMany({ where })).count, scopes.length);
          same(await tx.scadaTagHistoryRecord.count({ where }), 0);
          same(await tx.scadaTagHistoryBatch.count({ where }), 0);
          same(await tx.scadaProject.count({ where }), 0);
        });
      } catch { failures.push("专用夹具清理未确认，禁止自动重试，测试标识：" + id); }
    } else if (createUnconfirmed) {
      failures.push("专用工程创建未确认，禁止自动清理，测试标识：" + id);
    }
    try { await legacy?.$disconnect(); } catch { failures.push("Prisma 7 客户端关闭失败"); }
  }
  if (failures.length) throw new Error("历史写入事务专项未通过：" + failures.join("；"));
  return "MATCHED";
}

describe("真实 PostgreSQL Prisma 8 历史归档写入候选", () => {
  it("验证双版本幂等、并发竞争、真实约束回滚、作用域隔离及精确清理", async () => {
    expect(await verifyWrite()).toBe("MATCHED");
    console.info("Prisma 8 历史写入事务及双版本真实对照与专用夹具清理通过");
  }, 60_000);
});
