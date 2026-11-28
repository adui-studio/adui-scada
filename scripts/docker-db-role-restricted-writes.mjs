import { createHash } from "node:crypto";

const runtime = "adui_scada_runtime";
const projectOwner = "adui_scada_project_create_owner";
const cleanupOwner = "adui_scada_oidc_cleanup_owner";
const cleanupBatchSize = 128;

function routine(signature, owner, createSql, ownerGrants) {
  return {
    signature,
    ownerRole: owner,
    createSql,
    ownerGrants,
    revokePublicSql: "REVOKE ALL ON FUNCTION " + signature + " FROM PUBLIC",
    ownerSql: "ALTER FUNCTION " + signature + " OWNER TO " + owner,
    executeSql: "GRANT EXECUTE ON FUNCTION " + signature + " TO " + runtime,
    planOnly: true,
    databaseWritten: false,
    admissionPassed: false,
  };
}

// 首版工程、初始授权、发布状态和审计必须在同一调用内完成；不得另设补授权入口。
function projectCreatePreview() {
  const signature = "public.scada_create_project(text, text, text, jsonb, text, timestamptz, uuid)";
  const sql = `CREATE FUNCTION public.scada_create_project(
  p_tenant_id text, p_project_id text, p_subject_id text, p_snapshot jsonb,
  p_content_hash text, p_created_at timestamptz, p_event_id uuid
) RETURNS text
LANGUAGE plpgsql VOLATILE STRICT PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp SET row_security = on
AS $scada_create$
DECLARE
  affected bigint;
BEGIN
  IF char_length(p_tenant_id) NOT BETWEEN 1 AND 128
    OR char_length(p_project_id) NOT BETWEEN 1 AND 128
    OR char_length(p_subject_id) NOT BETWEEN 1 AND 128
    OR p_content_hash !~ '^[0-9a-f]{64}$'
    OR NOT isfinite(p_created_at)
    OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
    OR p_snapshot->>'projectId' IS DISTINCT FROM p_project_id
    OR p_snapshot->'revision' IS DISTINCT FROM '1'::jsonb
    OR p_snapshot->>'contentHash' IS DISTINCT FROM p_content_hash
    OR (p_snapshot->>'createdAt')::timestamptz IS DISTINCT FROM p_created_at THEN
    RAISE EXCEPTION '工程首版参数不一致';
  END IF;
  IF (SELECT i.status FROM public.scada_lock_identity(p_tenant_id, p_subject_id) i)
    IS DISTINCT FROM 'active' THEN
    RETURN 'DENIED';
  END IF;
  INSERT INTO public.scada_projects (tenant_id, project_id, head_revision, created_at, updated_at)
  VALUES (p_tenant_id, p_project_id, 1, p_created_at, p_created_at)
  ON CONFLICT (tenant_id, project_id) DO NOTHING;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN RETURN 'EXISTS'; END IF;
  IF affected <> 1 THEN RAISE EXCEPTION '工程创建影响行数异常'; END IF;
  INSERT INTO public.scada_project_versions
    (tenant_id, project_id, revision, snapshot, content_hash, created_by, created_at)
  VALUES (p_tenant_id, p_project_id, 1, p_snapshot, p_content_hash, p_subject_id, p_created_at);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION '工程首版影响行数异常'; END IF;
  INSERT INTO public.scada_project_release_state (tenant_id, project_id, release_generation, updated_at)
  VALUES (p_tenant_id, p_project_id, 0, p_created_at);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION '初始发布状态影响行数异常'; END IF;
  INSERT INTO public.scada_project_grants (tenant_id, project_id, subject_id, permission)
  VALUES (p_tenant_id, p_project_id, p_subject_id, 'project:read'),
    (p_tenant_id, p_project_id, p_subject_id, 'version:read'),
    (p_tenant_id, p_project_id, p_subject_id, 'version:append');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 3 THEN RAISE EXCEPTION '初始工程授权影响行数异常'; END IF;
  INSERT INTO public.scada_project_audit (event_id, tenant_id, project_id, revision, actor_id, action)
  VALUES (p_event_id, p_tenant_id, p_project_id, 1, p_subject_id, 'version:append');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION '首版审计影响行数异常'; END IF;
  RETURN 'CREATED';
END;
$scada_create$`;
  const grants = [
    "GRANT USAGE ON SCHEMA public TO " + projectOwner,
    "GRANT EXECUTE ON FUNCTION public.scada_lock_identity(text, text) TO " + projectOwner,
    "GRANT SELECT (tenant_id, project_id) ON TABLE public.scada_projects TO " + projectOwner,
    "GRANT INSERT (tenant_id, project_id, head_revision, created_at, updated_at) ON TABLE public.scada_projects TO " + projectOwner,
    "GRANT INSERT (tenant_id, project_id, revision, snapshot, content_hash, created_by, created_at) ON TABLE public.scada_project_versions TO " + projectOwner,
    "GRANT INSERT (tenant_id, project_id, release_generation, updated_at) ON TABLE public.scada_project_release_state TO " + projectOwner,
    "GRANT INSERT (tenant_id, project_id, subject_id, permission) ON TABLE public.scada_project_grants TO " + projectOwner,
    "GRANT INSERT (event_id, tenant_id, project_id, revision, actor_id, action) ON TABLE public.scada_project_audit TO " + projectOwner,
  ];
  return routine(signature, projectOwner, sql, grants);
}

/** 仅根据已审阅的本机端口生成候选；端口合法不代表真实 Issuer 已核验。 */
export function buildScadaOidcCleanupRoutinePreview(port) {
  if (typeof port !== "string" || !/^[1-9][0-9]{0,4}$/u.test(port) || Number(port) > 65535) {
    throw new Error("OIDC 清理候选要求有效的固定本机端口");
  }
  // 与 Docker 正式 OIDC 传输边界保持同一回环地址及固定 Realm；端口白名单禁止 SQL 注入。
  const issuer = new URL("https://127.0.0.1:" + port).origin + "/realms/adui-scada";
  const signature = "public.scada_cleanup_expired_oidc()";
  const sql = `CREATE FUNCTION public.scada_cleanup_expired_oidc() RETURNS bigint
LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp SET row_security = on
AS $scada_cleanup$
WITH deleted AS (
  DELETE FROM public.scada_oidc_transactions t
  WHERE t.issuer = '${issuer}' AND t.expires_at <= CURRENT_TIMESTAMP
    AND t.state_hash IN (
      SELECT s.state_hash FROM public.scada_oidc_transactions s
      WHERE s.issuer = '${issuer}' AND s.expires_at <= CURRENT_TIMESTAMP
      ORDER BY s.expires_at ASC, s.state_hash ASC LIMIT ${cleanupBatchSize}
    ) RETURNING 1
)
SELECT count(*) FROM deleted
$scada_cleanup$`;
  const grants = [
    "GRANT USAGE ON SCHEMA public TO " + cleanupOwner,
    "GRANT SELECT (state_hash, issuer, expires_at) ON TABLE public.scada_oidc_transactions TO " + cleanupOwner,
    "GRANT DELETE ON TABLE public.scada_oidc_transactions TO " + cleanupOwner,
  ];
  const plan = { ...routine(signature, cleanupOwner, sql, grants), cleanupBatchSize, issuerBindingVerified: false };
  return { ...plan, planFingerprint: createHash("sha256").update(JSON.stringify(plan)).digest("hex") };
}

/** 默认评审不猜测真实端口；工程创建和清理采用两个独立的不可登录所有者候选。 */
export function buildScadaRestrictedWritePreview() {
  const plan = {
    projectCreate: projectCreatePreview(),
    oidcCleanup: { ownerRole: cleanupOwner, cleanupBatchSize, issuerBindingRequired: true, issuerBindingVerified: false },
    coveredOperations: ["INITIAL_PROJECT_GRANT", "INITIAL_RELEASE_STATE", "EXPIRED_OIDC_CLEANUP"],
    requiredDirectGrantExclusions: [{ table: "scada_projects", privilege: "INSERT" }],
    planOnly: true,
    rowAuthorizationVerified: false,
    definerSafetyVerified: false,
    businessAclApproved: false,
    admissionPassed: false,
    databaseWritten: false,
  };
  return {
    status: "SCADA_RESTRICTED_WRITE_PREVIEW_ONLY",
    ...plan,
    planFingerprint: createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
  };
}
