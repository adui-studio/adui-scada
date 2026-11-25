import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { TagHistoryPoint, TagHistoryQuery, TagValue } from "@adui/scada-core";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { describe, expect, it } from "vite-plus/test";
import {
  createPrisma8ReadOnlyClient,
  type Prisma8ReadOnlyClient,
} from "../src/database/prisma8-readonly-client.js";
import { requirePrisma8ReadOnlyTestUrl } from "../src/database/prisma8-readonly-target.js";
import { PrismaClient } from "../src/generated/prisma/client.js";
import {
  PrismaTagHistoryStore,
  readPersistedTagHistory,
} from "../src/history/prisma-tag-history-store.js";
import {
  readPersistedTagHistoryPrisma8,
  type Prisma8HistoryScope,
} from "../src/history/prisma8-tag-history-reader.js";
import { decodeHistoryPoint, encodeHistoryPoint } from "../src/history/tag-history-record-codec.js";

const tagId = "water.level";
const otherTagId = "water.other";
const startMs = Date.parse("2026-11-24T00:00:00.000Z");
const query: TagHistoryQuery = { tagId, startMs, endMs: startMs + 2, maxPoints: 5 };

interface RawHistoryRow extends Prisma8HistoryScope {
  tagId: string;
  timestampMs: string;
  payload: string;
}

interface DatabaseBoundary {
  databaseName: string;
  schemaName: string;
  readOnly: string;
  historyReady: boolean;
}

/** 直接构造预期点，不以任一查询实现的输出作为另一实现的预期。 */
function point(
  value: TagValue["value"],
  quality: TagValue["quality"],
  sequence: number,
  offset = 0,
  id = tagId,
): TagHistoryPoint {
  const timestampMs = startMs + offset;
  const serverTimestamp = new Date(timestampMs).toISOString();
  return {
    tagId: id,
    value,
    quality,
    sequence,
    sourceTimestamp: sequence === 0 ? null : serverTimestamp,
    serverTimestamp,
    timestampMs,
    numericValue: quality === "GOOD" && typeof value === "number" ? value : null,
  };
}

function requireBoundary(rows: readonly DatabaseBoundary[], readOnly: "on" | "off"): void {
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row?.databaseName !== "adui_scada_test" ||
    row.schemaName !== "public" ||
    row.readOnly !== readOnly ||
    row.historyReady !== true
  ) {
    throw new Error("隔离数据库、Schema、只读模式或历史归档结构不符合要求");
  }
}

/** 原生查询使用绑定参数和相同的稳定排序，并保留超量检测的一条哨兵记录。 */
async function readRaw(pool: Pool, scope: Prisma8HistoryScope, window: TagHistoryQuery) {
  const { rows } = await pool.query<RawHistoryRow>(
    `SELECT tenant_id AS "tenantId", project_id AS "projectId",
            tag_id AS "tagId", timestamp_ms::text AS "timestampMs", payload
     FROM public.scada_tag_history_records
     WHERE tenant_id = $1 AND project_id = $2 AND tag_id = $3
       AND timestamp_ms >= $4 AND timestamp_ms < $5
     ORDER BY timestamp_ms, stream_id, batch_sequence, ordinal
     LIMIT $6`,
    [
      scope.tenantId,
      scope.projectId,
      window.tagId,
      BigInt(window.startMs).toString(),
      BigInt(window.endMs).toString(),
      window.maxPoints + 1,
    ],
  );
  return rows;
}

function requireSame(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error("历史查询结果与独立预期不一致");
  }
}

async function requireRejected(read: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await read();
  } catch (error) {
    if (error instanceof Error && error.message === message) return;
  }
  throw new Error("历史查询未按预期拒绝");
}

/** 仅清理本次确认创建的三个联合主键，保持外键顺序且在同一事务核对零残留。 */
async function removeFixture(client: PrismaClient, scopes: Prisma8HistoryScope[]): Promise<void> {
  const where = { OR: scopes };
  await client.$transaction(async (transaction) => {
    await transaction.scadaTagHistoryRecord.deleteMany({ where });
    await transaction.scadaTagHistoryBatch.deleteMany({ where });
    const deleted = await transaction.scadaProject.deleteMany({ where });
    requireSame(deleted.count, scopes.length);
    requireSame(await transaction.scadaTagHistoryRecord.count({ where }), 0);
    requireSame(await transaction.scadaTagHistoryBatch.count({ where }), 0);
    requireSame(await transaction.scadaProject.count({ where }), 0);
  });
}

/** 独立写入测试仅接受显式隔离 URL；Prisma 8 与原生对照使用独立只读连接池。 */
async function compareHistory(): Promise<"MATCHED"> {
  const connectionString = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
  const runId = randomUUID();
  const scope = { tenantId: "prisma8-compare-" + runId, projectId: "project-" + runId };
  const otherTenant = { ...scope, tenantId: "prisma8-other-" + runId };
  const otherProject = { ...scope, projectId: "other-" + runId };
  const scopes = [scope, otherTenant, otherProject];
  const streamA = "a-" + runId;
  const streamB = "b-" + runId;
  let client: PrismaClient | undefined;
  let pool: Pool | undefined;
  let db: Prisma8ReadOnlyClient | undefined;
  let ownsFixture = false;
  let createUnconfirmed = false;
  let poolFailed = false;
  let stage = "连接初始化";
  const failures: string[] = [];

  try {
    const writer = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
        options: "-c statement_timeout=5000 -c lock_timeout=2000",
      }),
    });
    client = writer;
    await writer.$connect();
    stage = "写入连接隔离边界";
    const writeBoundary = await writer.$queryRaw<DatabaseBoundary[]>`
      SELECT current_database()::text AS "databaseName", current_schema()::text AS "schemaName",
             current_setting('transaction_read_only') AS "readOnly",
             (to_regclass('public.scada_tag_history_batches') IS NOT NULL AND
              to_regclass('public.scada_tag_history_records') IS NOT NULL AND
              to_regclass('public.scada_tag_history_records_lookup_idx') IS NOT NULL) AS "historyReady"
    `;
    requireBoundary(writeBoundary, "off");

    stage = "只读连接隔离边界";
    const readPool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000,
      options: "-c default_transaction_read_only=on -c statement_timeout=5000",
    });
    pool = readPool;
    readPool.on("error", () => {
      poolFailed = true;
    });
    const readBoundary = await readPool.query<DatabaseBoundary>(`
      SELECT current_database()::text AS "databaseName", current_schema()::text AS "schemaName",
             current_setting('transaction_read_only') AS "readOnly",
             (to_regclass('public.scada_tag_history_batches') IS NOT NULL AND
              to_regclass('public.scada_tag_history_records') IS NOT NULL AND
              to_regclass('public.scada_tag_history_records_lookup_idx') IS NOT NULL) AS "historyReady"
    `);
    requireBoundary(readBoundary.rows, "on");
    stage = "Prisma 8 客户端初始化";
    const reader = createPrisma8ReadOnlyClient(readPool);
    db = reader;

    stage = "随机专用工程创建";
    // 不允许复用已有工程；只有创建回执完整才取得清理所有权。
    createUnconfirmed = true;
    const created = await writer.scadaProject.createMany({ data: scopes });
    requireSame(created.count, scopes.length);
    ownsFixture = true;
    createUnconfirmed = false;

    async function persist(
      target: Prisma8HistoryScope,
      streamId: string,
      batchSequence: number,
      records: readonly TagHistoryPoint[],
    ): Promise<void> {
      const store = new PrismaTagHistoryStore(writer, { ...target, streamId });
      const receipt = await store.persist({
        projectId: target.projectId,
        streamId,
        batchSequence,
        formatVersion: 1,
        records,
      });
      requireSame(receipt, {
        projectId: target.projectId,
        streamId,
        batchSequence,
        formatVersion: 1,
        recordCount: records.length,
        status: "COMMITTED",
      });
    }

    const zero = point(-0, "GOOD", 0);
    const text = point("合成历史", "UNCERTAIN", 1);
    const flag = point(true, "STALE", 2);
    const missing = point(null, "BAD", 3);
    const number = point(12.5, "GOOD", 4, 1);
    const before = point(99, "GOOD", 5, -1);
    const after = point(100, "GOOD", 6, 2);
    const otherTag = point(333, "GOOD", 7, 0, otherTagId);
    const tenantPoint = point(888, "GOOD", 8);
    const projectPoint = point(999, "GOOD", 9);
    const expected = [zero, text, flag, missing, number];

    stage = "Prisma 7 合成归档写入";
    // 故意逆序提交采集流和批次；查询必须按时间、流、批次、记录序号排序。
    await persist(scope, streamB, 1, [missing, before, after, otherTag]);
    await persist(scope, streamA, 2, [flag]);
    await persist(scope, streamA, 1, [zero, text, number]);
    await persist(otherTenant, streamA, 1, [tenantPoint]);
    await persist(otherProject, streamA, 1, [projectPoint]);

    async function compare(
      label: string,
      target: Prisma8HistoryScope,
      window: TagHistoryQuery,
      points: readonly TagHistoryPoint[],
    ): Promise<void> {
      stage = label + "：原生 SQL 及规范编码";
      const rows = await readRaw(readPool, target, window);
      requireSame(
        rows,
        points.map((item) => ({
          ...target,
          tagId: item.tagId,
          timestampMs: BigInt(item.timestampMs).toString(),
          payload: encodeHistoryPoint(item),
        })),
      );
      const native = rows.map((row) =>
        decodeHistoryPoint({ ...row, timestampMs: BigInt(row.timestampMs) }),
      );
      requireSame(native, points);
      stage = label + "：Prisma 7";
      requireSame(await readPersistedTagHistory(writer, target, window), native);
      stage = label + "：Prisma 8";
      requireSame(await readPersistedTagHistoryPrisma8(reader, target, window), native);
    }

    await compare("非空原始值与同毫秒排序", scope, query, expected);
    await compare("左闭右开首毫秒", scope, { ...query, endMs: startMs + 1 }, expected.slice(0, 4));
    await compare("左闭右开次毫秒", scope, { ...query, startMs: startMs + 1 }, [number]);
    await compare("窗口左侧", scope, { ...query, startMs: startMs - 1, endMs: startMs }, [before]);
    await compare("窗口右侧", scope, { ...query, startMs: startMs + 2, endMs: startMs + 3 }, [after]);
    await compare("不同租户", otherTenant, query, [tenantPoint]);
    await compare("不同工程", otherProject, query, [projectPoint]);
    await compare("不同 Tag", scope, { ...query, tagId: otherTagId }, [otherTag]);
    await compare("缺失工程", { ...scope, projectId: "missing-" + runId }, query, []);
    await compare("缺失租户", { ...scope, tenantId: "missing-" + runId }, query, []);
    await compare("缺失 Tag", scope, { ...query, tagId: "water.missing" }, []);

    stage = "超量检测原生 SQL 哨兵";
    const tooMany = { ...query, maxPoints: 4 };
    requireSame((await readRaw(readPool, scope, tooMany)).length, 5);
    stage = "Prisma 7 超量与上限拒绝";
    await requireRejected(
      () => readPersistedTagHistory(writer, scope, tooMany),
      "历史查询结果超过点数上限，请缩小时间范围",
    );
    await requireRejected(
      () => readPersistedTagHistory(writer, scope, { ...query, maxPoints: 1001 }),
      "历史查询点数上限超过服务端限制",
    );
    stage = "Prisma 8 超量与上限拒绝";
    await requireRejected(
      () => readPersistedTagHistoryPrisma8(reader, scope, tooMany),
      "历史查询结果超过点数上限，请缩小时间范围",
    );
    await requireRejected(
      () => readPersistedTagHistoryPrisma8(reader, scope, { ...query, maxPoints: 1001 }),
      "历史查询点数上限超过服务端限制",
    );
  } catch {
    // 只记录固定阶段；不返回第三方异常、SQL、连接地址或实际业务数据。
    failures.push(stage);
  } finally {
    try {
      await db?.close();
    } catch {
      failures.push("Prisma 8 客户端关闭失败");
    }
    try {
      await pool?.end();
    } catch {
      failures.push("只读连接池关闭失败");
    }
    if (poolFailed) failures.push("只读连接池发生异常");
    if (client && ownsFixture) {
      try {
        await removeFixture(client, scopes);
      } catch {
        failures.push("专用夹具清理未确认，禁止自动重试，测试标识：" + runId);
      }
    } else if (createUnconfirmed) {
      failures.push("专用工程创建结果未确认，禁止自动清理，测试标识：" + runId);
    }
    try {
      await client?.$disconnect();
    } catch {
      failures.push("Prisma 7 客户端关闭失败");
    }
  }
  if (failures.length > 0) {
    throw new Error("历史三方对照未通过：" + failures.join("；"));
  }
  return "MATCHED";
}

describe("真实 PostgreSQL 历史归档三方非空对照", () => {
  it(
    "Prisma 7 写入后与 Prisma 8 和原生 SQL 严格一致并清理随机夹具",
    async () => {
      expect(await compareHistory()).toBe("MATCHED");
      console.info("Prisma 7、Prisma 8 与 PostgreSQL 历史非空三方对照及专用夹具清理通过");
    },
    60_000,
  );
});
