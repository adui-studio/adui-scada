import { createHash } from "node:crypto";

const owner = "adui_scada_lock_owner";
const runtime = "adui_scada_runtime";
const scope = "public.";
const projectArgs = "p_tenant_id text, p_project_id text";
const subjectArgs = "p_tenant_id text, p_subject_id text";
const projectKey = "t.tenant_id = p_tenant_id AND t.project_id = p_project_id";
const stateColumns = "generation text, revision text, hash text, event_id text, hash_is_null text";
const stateSelect = `SELECT t.release_generation::text AS generation,
  COALESCE(t.released_revision::text, '') AS revision,
  COALESCE(t.released_content_hash::text, '') AS hash,
  COALESCE(t.last_release_event_id::text, '') AS event_id,
  (t.released_content_hash IS NULL)::text AS hash_is_null
FROM public.scada_project_release_state t WHERE ${projectKey}`;
const eventColumns =
  "event_id text, generation text, action text, revision text, hash text, created_at text, semantic_hash text";
const eventSelect = `SELECT t.event_id::text AS event_id, t.generation::text AS generation,
  t.action::text AS action, t.to_revision::text AS revision,
  t.to_content_hash::text AS hash, t.created_at::text AS created_at,
  t.request_semantic_hash::text AS semantic_hash
FROM public.scada_project_release_events t WHERE ${projectKey}`;

// 仅锁定原生仓储实际需要的行及返回列；不以通用表名、条件或 SQL 参数构造例程。
const routines = [
  {
    name: "scada_lock_identity",
    args: subjectArgs,
    returns: "status text",
    tables: ["scada_identities"],
    body: `SELECT t.status::text AS status FROM public.scada_identities t
WHERE t.tenant_id = p_tenant_id AND t.subject_id = p_subject_id FOR SHARE`,
  },
  {
    name: "scada_lock_session_identity",
    args: subjectArgs + ", p_session_id uuid",
    returns: "session_id text",
    tables: ["scada_auth_sessions", "scada_identities"],
    body: `SELECT s.session_id::text AS session_id FROM public.scada_auth_sessions s
JOIN public.scada_identities i ON i.tenant_id = s.tenant_id AND i.subject_id = s.subject_id
WHERE s.session_id = p_session_id AND s.tenant_id = p_tenant_id AND s.subject_id = p_subject_id
  AND s.revoked_at IS NULL AND s.issued_at <= CURRENT_TIMESTAMP
  AND s.expires_at > CURRENT_TIMESTAMP AND i.status = 'active'
FOR SHARE OF s, i`,
  },
  {
    name: "scada_lock_project_grants",
    args: projectArgs + ", p_subject_id text",
    returns: "permission text",
    tables: ["scada_project_grants"],
    body: `SELECT t.permission::text AS permission FROM public.scada_project_grants t
WHERE ${projectKey} AND t.subject_id = p_subject_id FOR SHARE`,
  },
  {
    name: "scada_lock_project_version",
    args: projectArgs + ", p_revision bigint",
    returns: "snapshot_data text, content_hash text, created_at text",
    tables: ["scada_project_versions"],
    body: `SELECT t.snapshot::text AS snapshot_data, t.content_hash::text AS content_hash,
  t.created_at::text AS created_at FROM public.scada_project_versions t
WHERE ${projectKey} AND t.revision = p_revision FOR SHARE`,
  },
  ...["share", "update"].map((mode) => ({
    name: "scada_lock_release_state_" + mode,
    args: projectArgs,
    returns: stateColumns,
    tables: ["scada_project_release_state"],
    body: stateSelect + " FOR " + mode.toUpperCase(),
  })),
  {
    name: "scada_lock_release_event",
    args: projectArgs + ", p_event_id uuid",
    returns: eventColumns,
    tables: ["scada_project_release_events"],
    body: eventSelect + " AND t.event_id = p_event_id FOR SHARE",
  },
  {
    name: "scada_lock_release_request",
    args: projectArgs + ", p_subject_id text, p_action text, p_idempotency_key text",
    returns: eventColumns,
    tables: ["scada_project_release_events"],
    body:
      eventSelect +
      ` AND t.actor_id = p_subject_id
  AND t.action = p_action AND t.idempotency_key = p_idempotency_key FOR SHARE`,
  },
  {
    name: "scada_lock_prior_publish",
    args: projectArgs + ", p_revision bigint, p_generation bigint",
    returns: eventColumns,
    tables: ["scada_project_release_events"],
    body:
      eventSelect +
      ` AND t.action = 'PUBLISH' AND t.to_revision = p_revision
  AND t.generation < p_generation ORDER BY t.generation DESC LIMIT 1 FOR SHARE`,
  },
];

// PostgreSQL 行锁要求每张锁定表至少一列 UPDATE。此权限仅为不可登录例程所有者候选。
const permissions = [
  ["scada_identities", "tenant_id subject_id status", "tenant_id"],
  [
    "scada_auth_sessions",
    "session_id tenant_id subject_id revoked_at issued_at expires_at",
    "revoked_at",
  ],
  ["scada_project_grants", "tenant_id project_id subject_id permission", "tenant_id"],
  [
    "scada_project_versions",
    "tenant_id project_id revision snapshot content_hash created_at",
    "tenant_id",
  ],
  [
    "scada_project_release_state",
    "tenant_id project_id release_generation released_revision released_content_hash last_release_event_id",
    "tenant_id",
  ],
  [
    "scada_project_release_events",
    "tenant_id project_id event_id generation action to_revision to_content_hash created_at request_semantic_hash actor_id idempotency_key",
    "tenant_id",
  ],
];

/** 固定锁例程候选；任何调用均只返回新的预览对象，不连接数据库或执行 DDL。 */
export function buildScadaLockRoutinePreview() {
  const ownerGrants = [
    "GRANT USAGE ON SCHEMA public TO " + owner,
    ...permissions.flatMap(([table, read, update]) => [
      "GRANT SELECT (" +
        read.split(" ").join(", ") +
        ") ON TABLE " +
        scope +
        table +
        " TO " +
        owner,
      "GRANT UPDATE (" + update + ") ON TABLE " + scope + table + " TO " + owner,
    ]),
  ];
  const definitions = routines.map((routine) => {
    const qualified = scope + routine.name;
    const signature =
      qualified +
      "(" +
      routine.args
        .split(", ")
        .map((arg) => arg.split(" ")[1])
        .join(", ") +
      ")";
    return {
      name: routine.name,
      tables: [...routine.tables],
      signature,
      selectSql: routine.body,
      createSql: `CREATE FUNCTION ${qualified}(${routine.args}) RETURNS TABLE (${routine.returns})
LANGUAGE sql VOLATILE STRICT PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp SET row_security = on
AS $scada_lock$\n${routine.body}\n$scada_lock$`,
      revokePublicSql: "REVOKE ALL ON FUNCTION " + signature + " FROM PUBLIC",
      ownerSql: "ALTER FUNCTION " + signature + " OWNER TO " + owner,
      executeSql: "GRANT EXECUTE ON FUNCTION " + signature + " TO " + runtime,
    };
  });
  const prerequisites = [
    "LOCK_OWNER_NOLOGIN_NO_MEMBERSHIP_NO_ROLE_CONFIG",
    "LOCK_OWNER_NO_TABLE_OR_SCHEMA_OWNERSHIP_NO_SCHEMA_CREATE",
    "TRUSTED_SCHEMA_AND_EXACT_ROUTINE_IDENTITY_REVIEW",
    "ATOMIC_CREATE_REVOKE_OWNER_AND_EXECUTE_REVIEW",
    "NATIVE_CONTRACT_AND_B3_STATUS_REVIEW_AFTER_ROLE_CHANGE",
    "SAME_TRANSACTION_LOCK_ORDER_AND_CONCURRENT_REVOCATION_TEST",
    "ROW_AUTHORIZATION_AND_RUNTIME_ADMISSION_REVIEW",
  ];
  const planFingerprint = createHash("sha256")
    .update(JSON.stringify({ ownerGrants, definitions, prerequisites }))
    .digest("hex");
  return {
    status: "SCADA_LOCK_ROUTINE_PREVIEW_ONLY",
    ownerRole: owner,
    protectedTableCount: 5,
    lockedTableCount: permissions.length,
    routineCount: definitions.length,
    ownerGrants,
    definitions,
    prerequisites,
    planFingerprint,
    planOnly: true,
    rowLockVerified: false,
    definerSafetyVerified: false,
    rowAuthorizationVerified: false,
    businessAclApproved: false,
    databaseWritten: false,
    admissionPassed: false,
  };
}
