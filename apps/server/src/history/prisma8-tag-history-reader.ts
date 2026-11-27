import { selectTagHistory } from "@adui/scada-core";
import type { TagHistoryPoint, TagHistoryQuery } from "@adui/scada-core";
import type { Prisma8Service } from "../database/prisma8.service.js";
import { decodeHistoryPoint } from "./tag-history-record-codec.js";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_QUERY_POINTS = 1_000;

export interface Prisma8HistoryScope {
  readonly tenantId: string;
  readonly projectId: string;
}

interface HistoryRow extends Prisma8HistoryScope {
  readonly tagId: string;
  readonly timestampMs: bigint;
  readonly payload: string;
}

/** 复用共享时间范围与 Tag 校验；输入必须在发出查询前完成验证。 */
export function preparePrisma8HistoryQuery(scope: Prisma8HistoryScope, query: TagHistoryQuery) {
  const { tenantId, projectId } = scope;
  if (
    typeof tenantId !== "string" ||
    typeof projectId !== "string" ||
    !ID_PATTERN.test(tenantId) ||
    !ID_PATTERN.test(projectId)
  ) {
    throw new TypeError("历史归档作用域标识无效");
  }
  const checkedQuery = { ...query };
  selectTagHistory([], checkedQuery);
  if (checkedQuery.maxPoints > MAX_QUERY_POINTS) {
    throw new RangeError("历史查询点数上限超过服务端限制");
  }

  return {
    tenantId,
    projectId,
    tagId: checkedQuery.tagId,
    start: BigInt(checkedQuery.startMs),
    end: BigInt(checkedQuery.endMs),
    maxPoints: checkedQuery.maxPoints,
  };
}

/** 原生读取检查作用域、窗口和规范编码，不接受越界或被截断的结果。 */
export function decodePrisma8HistoryRows(
  rows: readonly HistoryRow[],
  prepared: ReturnType<typeof preparePrisma8HistoryQuery>,
): readonly TagHistoryPoint[] {
  if (rows.length > prepared.maxPoints) {
    throw new RangeError("历史查询结果超过点数上限，请缩小时间范围");
  }
  return rows.map((row) => {
    if (
      row.tenantId !== prepared.tenantId ||
      row.projectId !== prepared.projectId ||
      row.tagId !== prepared.tagId ||
      typeof row.timestampMs !== "bigint" ||
      row.timestampMs < prepared.start ||
      row.timestampMs >= prepared.end
    ) {
      throw new TypeError("历史查询返回记录超出限定作用域或时间范围");
    }
    return decodeHistoryPoint(row);
  });
}

/** 原生历史查询端口，仅供可信内部调用，尚未开放 HTTP 历史 API。 */
export async function readPersistedTagHistoryPrisma8(
  database: Prisma8Service,
  scope: Prisma8HistoryScope,
  query: TagHistoryQuery,
): Promise<readonly TagHistoryPoint[]> {
  const prepared = preparePrisma8HistoryQuery(scope, query);
  const rows = await database.readTransaction((tx) => tx.orm.public.ScadaTagHistoryRecord.where({
    tenantId: prepared.tenantId,
    projectId: prepared.projectId,
    tagId: prepared.tagId,
  })
    .where((row) => row.timestampMs.gte(prepared.start))
    .where((row) => row.timestampMs.lt(prepared.end))
    .orderBy([
      (row) => row.timestampMs.asc(),
      (row) => row.streamId.asc(),
      (row) => row.batchSequence.asc(),
      (row) => row.ordinal.asc(),
    ])
    .limit(prepared.maxPoints + 1)
    .select("tenantId", "projectId", "tagId", "timestampMs", "payload")
    .all());

  return decodePrisma8HistoryRows(rows, prepared);
}
