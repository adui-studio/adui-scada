/** 现有 D5b1 工程仅用于只读基线对照，禁止写入或作为发布夹具复用。 */
export const BASELINE_PROJECT = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
export const BASELINE_ERROR = "D5b7d 原 D5b1 只读基线不完整或发生漂移";

const SUBJECT = "lab-engineer";
const PERMISSIONS = ["project:read", "version:read", "version:append", "release:read"];

function exactRow(row, keys) {
  return (
    row !== null &&
    typeof row === "object" &&
    !Array.isArray(row) &&
    Object.getPrototypeOf(row) === Object.prototype &&
    Object.keys(row).length === keys.length &&
    keys.every((key) => Object.hasOwn(row, key))
  );
}

function oneRow(rows, keys) {
  return Array.isArray(rows) && rows.length === 1 && exactRow(rows[0], keys) ? rows[0] : null;
}

/** 保证原未发布工程及四项 ACL 未漂移；不得读取工程快照或更改权限。 */
export function assertPublishedFixtureBaselineRows(rows) {
  const project = oneRow(rows?.project, ["head_revision"]);
  const version = oneRow(rows?.versions, ["revision", "created_by"]);
  const audit = oneRow(rows?.audit, ["revision", "actor_id", "action"]);
  const state = oneRow(rows?.state, [
    "release_generation",
    "released_revision",
    "released_content_hash",
    "last_release_event_id",
  ]);
  const events = oneRow(rows?.events, ["count"]);
  const grants = rows?.grants;
  if (
    !project ||
    String(project.head_revision) !== "1" ||
    !version ||
    String(version.revision) !== "1" ||
    version.created_by !== SUBJECT ||
    !audit ||
    String(audit.revision) !== "1" ||
    audit.actor_id !== SUBJECT ||
    audit.action !== "version:append" ||
    !state ||
    String(state.release_generation) !== "0" ||
    state.released_revision !== null ||
    state.released_content_hash !== null ||
    state.last_release_event_id !== null ||
    !events ||
    String(events.count) !== "0" ||
    !Array.isArray(grants) ||
    grants.length !== PERMISSIONS.length ||
    !grants.every((grant) => exactRow(grant, ["subject_id", "permission"])) ||
    PERMISSIONS.some(
      (permission) =>
        grants.filter((grant) => grant.subject_id === SUBJECT && grant.permission === permission)
          .length !== 1,
    )
  ) {
    throw new Error(BASELINE_ERROR);
  }
  return true;
}
