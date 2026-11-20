import { readProjectSnapshot } from "./project-snapshot.ts";
import type { ProjectSnapshot } from "./project-snapshot.ts";

/** 正式发布只读响应不包含工程编辑 head、草稿和现场 Tag 数据。 */
export type PublishedRelease =
  | {
      readonly status: "UNRELEASED";
      readonly projectId: string;
      readonly releaseGeneration: 0;
    }
  | {
      readonly status: "RELEASED";
      readonly projectId: string;
      readonly releasedRevision: number;
      readonly releasedContentHash: string;
      readonly releaseGeneration: number;
      readonly eventId: string;
      readonly lastAction: "PUBLISH" | "ROLLBACK";
      readonly releasedAt: string;
      readonly snapshot: ProjectSnapshot;
    };

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNRELEASED_FIELDS = ["status", "projectId", "releaseGeneration"];
const RELEASED_FIELDS = [
  "status",
  "projectId",
  "releasedRevision",
  "releasedContentHash",
  "releaseGeneration",
  "eventId",
  "lastAction",
  "releasedAt",
  "snapshot",
];

function requireFields(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("正式发布响应必须是普通对象");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("正式发布响应必须是普通对象");
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new TypeError("正式发布响应包含未知字段或缺少必需字段");
  }
  return source;
}

function requireSafePositive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(label + "必须是正安全整数");
  }
  return value as number;
}

function requireReleaseTime(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError("正式发布时间必须是有效的 UTC ISO 8601 毫秒时间");
  }
  return value;
}

/**
 * 统一校验服务端正式发布指针、事件元数据与不可变快照。
 * 不信任任意网络响应；不读取 head、不回退到草稿、演示文档或历史版本。
 */
export async function parsePublishedRelease(
  input: unknown,
  requestedProjectId: string,
): Promise<PublishedRelease> {
  if (typeof requestedProjectId !== "string" || !PROJECT_ID_PATTERN.test(requestedProjectId)) {
    throw new TypeError("正式发布工程 ID 必须是合法的 1～128 字符 ASCII 标识符");
  }

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("正式发布响应必须是普通对象");
  }
  const status = (input as Record<string, unknown>).status;
  if (status === "UNRELEASED") {
    const source = requireFields(input, UNRELEASED_FIELDS);
    if (source.projectId !== requestedProjectId || source.releaseGeneration !== 0) {
      throw new TypeError("未发布状态与工程 ID 或代次不一致");
    }
    return Object.freeze({
      status: "UNRELEASED",
      projectId: requestedProjectId,
      releaseGeneration: 0,
    });
  }

  if (status !== "RELEASED") {
    throw new TypeError("正式发布状态类型无效");
  }
  const source = requireFields(input, RELEASED_FIELDS);
  const revision = requireSafePositive(source.releasedRevision, "正式发布修订号");
  const generation = requireSafePositive(source.releaseGeneration, "正式发布代次");
  const hash = source.releasedContentHash;
  const eventId = source.eventId;
  const action = source.lastAction;
  if (
    source.projectId !== requestedProjectId ||
    typeof hash !== "string" ||
    !HASH_PATTERN.test(hash) ||
    typeof eventId !== "string" ||
    !EVENT_ID_PATTERN.test(eventId) ||
    (action !== "PUBLISH" && action !== "ROLLBACK")
  ) {
    throw new TypeError("正式发布指针或事件元数据无效");
  }
  const releasedAt = requireReleaseTime(source.releasedAt);
  const snapshot = await readProjectSnapshot(source.snapshot);
  if (
    snapshot.projectId !== requestedProjectId ||
    snapshot.revision !== revision ||
    snapshot.contentHash !== hash
  ) {
    throw new TypeError("正式发布指针与不可变快照不一致");
  }
  return Object.freeze({
    status: "RELEASED",
    projectId: requestedProjectId,
    releasedRevision: revision,
    releasedContentHash: hash,
    releaseGeneration: generation,
    eventId,
    lastAction: action,
    releasedAt,
    snapshot,
  });
}
