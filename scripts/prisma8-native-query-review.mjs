import { isDeepStrictEqual } from "node:util";

function requireMatch(condition, message) {
  if (!condition) throw new Error(message);
}

/** 将独立 SQL 读出的状态和事件转换为 ORM 结果，并验证六字段闭包。 */
export function expectedReleaseSample(state, event) {
  if (state === null) {
    requireMatch(event === null, "无发布状态时不得存在关联事件");
    return null;
  }
  const result = {
    tenantId: state.tenantId,
    projectId: state.projectId,
    releaseGeneration: BigInt(state.releaseGeneration),
    releasedRevision: state.releasedRevision === null ? null : BigInt(state.releasedRevision),
    releasedContentHash: state.releasedContentHash,
    lastReleaseEventId: state.lastReleaseEventId,
    lastReleaseEvent: null,
  };
  if (result.releaseGeneration === 0n) {
    requireMatch(
      result.releasedRevision === null &&
        result.releasedContentHash === null &&
        result.lastReleaseEventId === null &&
        event === null,
      "未发布状态必须具有空关联",
    );
    return result;
  }
  requireMatch(
    result.releaseGeneration > 0n &&
      result.releasedRevision !== null &&
      result.releasedContentHash !== null &&
      result.lastReleaseEventId !== null &&
      event !== null,
    "已发布状态缺少完整的末次事件",
  );
  const related = {
    tenantId: event.tenantId,
    projectId: event.projectId,
    generation: BigInt(event.generation),
    toRevision: BigInt(event.toRevision),
    toContentHash: event.toContentHash,
    eventId: event.eventId,
    action: event.action,
  };
  requireMatch(
    related.tenantId === result.tenantId &&
      related.projectId === result.projectId &&
      related.generation === result.releaseGeneration &&
      related.toRevision === result.releasedRevision &&
      related.toContentHash === result.releasedContentHash &&
      related.eventId === result.lastReleaseEventId &&
      (related.action === "PUBLISH" || related.action === "ROLLBACK"),
    "末次事件不满足六字段闭包或事件类型约束",
  );
  return { ...result, lastReleaseEvent: related };
}

/** 同一 SQL 基准分别核对两个契约；空样本不得计为非空通过。 */
export async function reviewReleaseQueries(reader, expected, absentTenant, absentProject) {
  requireMatch(
    (await reader.state(absentTenant, absentProject)) === null,
    "不存在的发布状态查询未返回空值",
  );
  if (expected === null) return "EMPTY";
  const { tenantId, projectId, lastReleaseEvent } = expected;
  requireMatch(
    isDeepStrictEqual(await reader.state(tenantId, projectId), expected),
    "发布状态及关联事件查询结果不一致",
  );
  requireMatch((await reader.state(absentTenant, projectId)) === null, "错误租户返回发布状态");
  requireMatch((await reader.state(tenantId, absentProject)) === null, "错误工程返回发布状态");
  if (lastReleaseEvent !== null) {
    const { eventId } = lastReleaseEvent;
    requireMatch(
      isDeepStrictEqual(await reader.event(tenantId, projectId, eventId), lastReleaseEvent),
      "显式末次事件查询结果不一致",
    );
    requireMatch(
      (await reader.event(absentTenant, projectId, eventId)) === null,
      "错误租户返回末次事件",
    );
    requireMatch(
      (await reader.event(tenantId, absentProject, eventId)) === null,
      "错误工程返回末次事件",
    );
  }
  return "MATCHED";
}
