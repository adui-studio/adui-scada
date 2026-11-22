/** D5b7b 仅校验已经取回的只读元数据，不连接数据库、不读取快照正文。 */
const PROJECT_PATTERN =
  /^d5b7b-published-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TRUSTED_TENANT = "lab-tenant";
const TRUSTED_SUBJECT = "lab-engineer";
const EVIDENCE_ERROR = "D5b7b 发布夹具只读元数据不完整或不一致";

function invalidEvidence() {
  throw new Error(EVIDENCE_ERROR);
}

function plainRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value, keys) {
  return (
    plainRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function integer(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function singleRow(value, keys) {
  if (!Array.isArray(value) || value.length !== 1 || !exactKeys(value[0], keys)) {
    invalidEvidence();
  }
  return value[0];
}

/** 只允许未来明确批准的 D5b7b 独立发布夹具 ID。 */
export function parsePublishedFixtureMetadataArgs(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 2 ||
    args[0] !== "--project-id" ||
    typeof args[1] !== "string" ||
    !PROJECT_PATTERN.test(args[1])
  ) {
    throw new Error("D5b7b 仅允许显式指定独立已发布夹具 ID，禁止写入参数");
  }
  return { projectId: args[1] };
}

/**
 * 仅判断元数据是否值得继续进行独立的真实快照审核。
 * RELEASED_METADATA_ONLY 不是 verified，更不代表生产发布已获批准。
 * 不信任外部传入的主体或库名；输入应来自未来受控 READ ONLY 查询。
 */
export function classifyPublishedFixtureMetadata(rows, projectId) {
  if (
    typeof projectId !== "string" ||
    !PROJECT_PATTERN.test(projectId) ||
    !exactKeys(rows, [
      "context",
      "project",
      "grants",
      "releaseState",
      "releasedVersion",
      "lastEvent",
    ])
  ) {
    invalidEvidence();
  }
  const context = rows.context;
  if (
    !exactKeys(context, [
      "database_name",
      "database_user",
      "tenant_id",
      "subject_id",
      "project_id",
      "identity_count",
      "external_identity_count",
    ]) ||
    context.database_name !== "adui_scada" ||
    context.database_user !== "adui_scada" ||
    context.tenant_id !== TRUSTED_TENANT ||
    context.subject_id !== TRUSTED_SUBJECT ||
    context.project_id !== projectId ||
    integer(context.identity_count) !== 1n ||
    integer(context.external_identity_count) !== 1n
  ) {
    invalidEvidence();
  }

  if (!Array.isArray(rows.project) || rows.project.length > 1) invalidEvidence();
  if (rows.project.length === 0) return { kind: "DENIED" };
  const project = singleRow(rows.project, ["tenant_id", "project_id", "head_revision"]);
  const headRevision = integer(project.head_revision);
  if (
    project.tenant_id !== TRUSTED_TENANT ||
    project.project_id !== projectId ||
    headRevision === null ||
    headRevision <= 0n ||
    headRevision > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    invalidEvidence();
  }

  if (!Array.isArray(rows.grants) || rows.grants.length > 1) invalidEvidence();
  if (rows.grants.length === 0) return { kind: "DENIED" };
  const grant = singleRow(rows.grants, ["subject_id", "permission"]);
  if (grant.subject_id !== TRUSTED_SUBJECT || grant.permission !== "release:read") {
    invalidEvidence();
  }

  const state = singleRow(rows.releaseState, [
    "release_generation",
    "released_revision",
    "released_content_hash",
    "last_release_event_id",
  ]);
  const generation = integer(state.release_generation);
  if (generation === null || generation < 0n || generation > BigInt(Number.MAX_SAFE_INTEGER)) {
    invalidEvidence();
  }
  if (generation === 0n) {
    if (
      state.released_revision !== null ||
      state.released_content_hash !== null ||
      state.last_release_event_id !== null ||
      !Array.isArray(rows.releasedVersion) ||
      rows.releasedVersion.length !== 0 ||
      !Array.isArray(rows.lastEvent) ||
      rows.lastEvent.length !== 0
    ) {
      invalidEvidence();
    }
    return { kind: "UNRELEASED" };
  }

  const revision = integer(state.released_revision);
  if (
    revision === null ||
    revision <= 0n ||
    revision > BigInt(Number.MAX_SAFE_INTEGER) ||
    typeof state.released_content_hash !== "string" ||
    !HASH_PATTERN.test(state.released_content_hash) ||
    typeof state.last_release_event_id !== "string" ||
    !EVENT_PATTERN.test(state.last_release_event_id)
  ) {
    invalidEvidence();
  }
  const version = singleRow(rows.releasedVersion, ["revision", "content_hash"]);
  const event = singleRow(rows.lastEvent, [
    "event_id",
    "tenant_id",
    "project_id",
    "generation",
    "action",
    "to_revision",
    "to_content_hash",
  ]);
  if (
    integer(version.revision) !== revision ||
    version.content_hash !== state.released_content_hash ||
    event.event_id !== state.last_release_event_id ||
    event.tenant_id !== TRUSTED_TENANT ||
    event.project_id !== projectId ||
    integer(event.generation) !== generation ||
    (event.action !== "PUBLISH" && event.action !== "ROLLBACK") ||
    (generation === 1n && event.action !== "PUBLISH") ||
    integer(event.to_revision) !== revision ||
    event.to_content_hash !== state.released_content_hash
  ) {
    invalidEvidence();
  }
  return { kind: "RELEASED_METADATA_ONLY" };
}
