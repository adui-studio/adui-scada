import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import type { Prisma8ReadOnlyClient } from "../database/prisma8-readonly-client.js";
import {
  decodePrisma8HistoryRows,
  preparePrisma8HistoryQuery,
  readPersistedTagHistoryPrisma8,
} from "./prisma8-tag-history-reader.js";

interface HistorySample {
  tenantId: string;
  projectId: string;
  tagId: string;
  timestampMs: string;
}

interface RawHistoryRow extends HistorySample {
  payload: string;
}

/** 对照现有归档的真实只读查询；不得为通过验收而创建或改写历史记录。 */
export async function verifyPrisma8HistoryReadOnly(
  pool: Pool,
  client: Prisma8ReadOnlyClient,
  absentTenant: string,
  absentProject: string,
): Promise<"MATCHED" | "EMPTY"> {
  const sampleResult = await pool.query<HistorySample>(
    `SELECT tenant_id AS "tenantId", project_id AS "projectId",
            tag_id AS "tagId", timestamp_ms::text AS "timestampMs"
     FROM public.scada_tag_history_records
     ORDER BY tenant_id, project_id, stream_id, batch_sequence, ordinal
     LIMIT 1`,
  );
  const sample = sampleResult.rows[0];
  const missingScope = { tenantId: absentTenant, projectId: absentProject };
  const missingQuery = { tagId: "prisma8-readonly", startMs: 0, endMs: 1, maxPoints: 1 };
  if ((await readPersistedTagHistoryPrisma8(client, missingScope, missingQuery)).length !== 0) {
    throw new Error("不存在的历史查询作用域未返回空结果");
  }
  if (!sample) return "EMPTY";

  const startMs = Number(sample.timestampMs);
  if (!Number.isSafeInteger(startMs) || BigInt(startMs).toString() !== sample.timestampMs) {
    throw new TypeError("历史样本时间索引无效");
  }
  const scope = { tenantId: sample.tenantId, projectId: sample.projectId };
  const query = { tagId: sample.tagId, startMs, endMs: startMs + 1, maxPoints: 1000 };
  const prepared = preparePrisma8HistoryQuery(scope, query);
  const baseline = await pool.query<RawHistoryRow>(
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
      query.tagId,
      prepared.start.toString(),
      prepared.end.toString(),
      query.maxPoints + 1,
    ],
  );
  const expected = decodePrisma8HistoryRows(
    baseline.rows.map((row) => ({ ...row, timestampMs: BigInt(row.timestampMs) })),
    prepared,
  );
  const actual = await readPersistedTagHistoryPrisma8(client, scope, query);
  if (expected.length === 0 || !isDeepStrictEqual(actual, expected)) {
    throw new Error("Prisma 8 历史查询与原始有界查询不一致");
  }
  if (
    (
      await readPersistedTagHistoryPrisma8(
        client,
        { ...scope, tenantId: absentTenant },
        query,
      )
    ).length !== 0 ||
    (
      await readPersistedTagHistoryPrisma8(
        client,
        { ...scope, projectId: absentProject },
        query,
      )
    ).length !== 0
  ) {
    throw new Error("历史查询未正确隔离租户与工程");
  }

  return "MATCHED";
}
