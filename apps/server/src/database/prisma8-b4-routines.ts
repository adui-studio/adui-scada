import type { ProjectSnapshot } from "@adui/scada-core";
import type { Prisma8TextTransaction } from "./prisma8-text-transaction.js";

/** 固定 B4 例程，仅通过当前原生事务执行，不回退到受保护表直接行锁。 */
export function lockB4Identity(tx: Prisma8TextTransaction, tenantId: string, subjectId: string) {
  return tx.queryText({
    status: "pg/text@1",
  })`SELECT status FROM public.scada_lock_identity(${tenantId}::text, ${subjectId}::text)`;
}

export function lockB4SessionIdentity(
  tx: Prisma8TextTransaction,
  tenantId: string,
  subjectId: string,
  sessionId: string,
) {
  return tx.queryText({
    session_id: "pg/text@1",
  })`SELECT session_id FROM public.scada_lock_session_identity(${tenantId}::text, ${subjectId}::text, ${sessionId}::uuid)`;
}

export function lockB4ProjectGrants(
  tx: Prisma8TextTransaction,
  tenantId: string,
  projectId: string,
  subjectId: string,
) {
  return tx.queryText({
    permission: "pg/text@1",
  })`SELECT permission FROM public.scada_lock_project_grants(${tenantId}::text, ${projectId}::text, ${subjectId}::text)`;
}

export function lockB4ProjectVersion(
  tx: Prisma8TextTransaction,
  tenantId: string,
  projectId: string,
  revision: bigint,
) {
  return tx.queryText({
    snapshot_data: "pg/text@1",
    content_hash: "pg/text@1",
    created_at: "pg/text@1",
  })`SELECT snapshot_data, content_hash, created_at FROM public.scada_lock_project_version(${tenantId}::text, ${projectId}::text, ${revision}::bigint)`;
}

const STATE_COLUMNS = {
  generation: "pg/text@1",
  revision: "pg/text@1",
  hash: "pg/text@1",
  event_id: "pg/text@1",
  hash_is_null: "pg/text@1",
} as const;

export function lockB4ReleaseState(
  tx: Prisma8TextTransaction,
  tenantId: string,
  projectId: string,
  write: boolean,
) {
  const query = tx.queryText(STATE_COLUMNS);
  return write
    ? query`SELECT generation, revision, hash, event_id, hash_is_null FROM public.scada_lock_release_state_update(${tenantId}::text, ${projectId}::text)`
    : query`SELECT generation, revision, hash, event_id, hash_is_null FROM public.scada_lock_release_state_share(${tenantId}::text, ${projectId}::text)`;
}

const EVENT_COLUMNS = {
  event_id: "pg/text@1",
  generation: "pg/text@1",
  action: "pg/text@1",
  revision: "pg/text@1",
  hash: "pg/text@1",
  created_at: "pg/text@1",
  semantic_hash: "pg/text@1",
} as const;

export type B4ReleaseEventRow = { [Key in keyof typeof EVENT_COLUMNS]: string };

export function lockB4ReleaseEvent(
  tx: Prisma8TextTransaction,
  tenantId: string,
  projectId: string,
  eventId: string,
) {
  return tx.queryText(
    EVENT_COLUMNS,
  )`SELECT event_id, generation, action, revision, hash, created_at, semantic_hash FROM public.scada_lock_release_event(${tenantId}::text, ${projectId}::text, ${eventId}::uuid)`;
}

export function lockB4ReleaseRequest(
  tx: Prisma8TextTransaction,
  tenantId: string,
  projectId: string,
  subjectId: string,
  action: "PUBLISH" | "ROLLBACK",
  idempotencyKey: string,
) {
  return tx.queryText(
    EVENT_COLUMNS,
  )`SELECT event_id, generation, action, revision, hash, created_at, semantic_hash FROM public.scada_lock_release_request(${tenantId}::text, ${projectId}::text, ${subjectId}::text, ${action}::text, ${idempotencyKey}::text)`;
}

export function lockB4PriorPublish(
  tx: Prisma8TextTransaction,
  tenantId: string,
  projectId: string,
  revision: bigint,
  generation: bigint,
) {
  return tx.queryText(
    EVENT_COLUMNS,
  )`SELECT event_id, generation, action, revision, hash, created_at, semantic_hash FROM public.scada_lock_prior_publish(${tenantId}::text, ${projectId}::text, ${revision}::bigint, ${generation}::bigint)`;
}

/** 仅接受共享核心生成的首版快照；例程负责同事务内的工程、授权、版本及审计写入。 */
export async function createB4Project(
  tx: Prisma8TextTransaction,
  tenantId: string,
  subjectId: string,
  snapshot: ProjectSnapshot,
  eventId: string,
): Promise<"CREATED" | "EXISTS" | "DENIED"> {
  if (snapshot.revision !== 1) throw new Error("工程首版修订号无效");
  const rows = await tx.queryText({
    result: "pg/text@1",
  })`SELECT public.scada_create_project(${tenantId}::text, ${snapshot.projectId}::text, ${subjectId}::text, ${JSON.stringify(snapshot)}::jsonb, ${snapshot.contentHash}::text, ${snapshot.createdAt}::timestamptz, ${eventId}::uuid)::text AS result`;
  const result = rows[0]?.result;
  if (rows.length !== 1 || (result !== "CREATED" && result !== "EXISTS" && result !== "DENIED")) {
    throw new Error("工程首版例程返回结果无效");
  }
  return result;
}
