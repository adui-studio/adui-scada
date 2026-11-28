import { randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export class DockerB4RuntimeProbeError extends Error {}

const manager = "adui_scada";
const runtime = "adui_scada_runtime";
const keycloak = "adui_scada_keycloak_runtime";
const identitySql = "SELECT current_user::text AS role, session_user::text AS \"sessionRole\", current_database() AS database, current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation";
const denialSql = [
  "SELECT status FROM public.scada_identities WHERE false FOR SHARE",
  "UPDATE public.scada_identities SET status = 'disabled' WHERE false",
  "INSERT INTO public.scada_projects (tenant_id) SELECT 'probe' WHERE false",
  "INSERT INTO public.scada_project_grants (tenant_id) SELECT 'probe' WHERE false",
  "UPDATE public.scada_project_versions SET snapshot = '{}'::jsonb WHERE false",
  "DELETE FROM public.scada_project_audit WHERE false",
  "UPDATE public.scada_auth_sessions SET subject_id = 'probe' WHERE false",
  "UPDATE public.scada_tag_history_records SET payload = 'probe' WHERE false",
  "DELETE FROM public.scada_tag_history_batches WHERE false",
  "UPDATE public.scada_project_release_state SET release_generation = 0 WHERE false",
  "INSERT INTO public.scada_project_release_events (event_id) SELECT NULL::uuid WHERE false",
  "DELETE FROM public.scada_oidc_transactions WHERE false",
  "CREATE TABLE public.scada_b4_forbidden_probe (id integer)",
];

function requireMatch(condition, message) {
  if (!condition) throw new DockerB4RuntimeProbeError(message);
}

const digest = () => randomBytes(32).toString("hex");
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** 仅在已安装候选的同一隔离事务内运行；合成夹具全部回滚，不接受外部 SQL。 */
export async function verifyScadaB4RuntimeProbe(client, port) {
  requireMatch(typeof port === "string" && /^[1-9][0-9]{0,4}$/u.test(port) && Number(port) <= 65535,
    "B4 权限探针端口无效");
  const issuer = new URL("https://127.0.0.1:" + port).origin + "/realms/adui-scada";
  const tenant = "b4-probe-" + randomUUID();
  const subject = "active";
  const other = "other";
  const project = "probe";
  const session = randomUUID();
  const hash = digest();
  const createdAt = new Date().toISOString();
  const snapshot = JSON.stringify({ projectId: project, revision: 1, contentHash: hash, createdAt });
  const event = randomUUID();
  const states = [digest(), digest(), digest()];
  let positiveCount = 0;
  let deniedCount = 0;
  let stage = "管理身份";
  let savepoint = false;
  let failure;

  const command = async (sql, expected, values = []) => {
    const result = await client.query(sql, values);
    requireMatch(result?.command === expected, "B4 权限探针命令标签不一致");
    return result;
  };
  const rows = async (sql, values, expected) => {
    const result = await command(sql, "SELECT", values);
    requireMatch(isDeepStrictEqual(result.rows, expected), "B4 权限探针返回行不一致");
    positiveCount++;
  };
  const identify = async (role) => rows(identitySql, [], [{
    role, sessionRole: manager, database: "adui_scada", read_only: "off", isolation: "serializable",
  }]);
  const count = async (sql, values, expected, tag) => {
    const result = await command(sql, tag, values);
    requireMatch(result.rowCount === expected, "B4 权限探针影响行数不一致");
    positiveCount++;
  };
  const deny = async (sql, values = []) => {
    await command("SAVEPOINT scada_b4_denial", "SAVEPOINT");
    let rejected = false;
    try { await client.query(sql, values); }
    catch (error) { rejected = error?.code === "42501"; }
    await command("ROLLBACK TO SAVEPOINT scada_b4_denial", "ROLLBACK");
    await command("RELEASE SAVEPOINT scada_b4_denial", "RELEASE");
    requireMatch(rejected, "B4 禁止操作未得到精确权限拒绝");
    deniedCount++;
  };
  const createProject = (actor, projectId, eventId, expected) => rows(
    "SELECT public.scada_create_project($1::text, $2::text, $3::text, $4::jsonb, $5::text, $6::timestamptz, $7::uuid) AS result",
    [tenant, projectId, actor, projectId === project ? snapshot : JSON.stringify({ projectId, revision: 1, contentHash: hash, createdAt }), hash, createdAt, eventId],
    [{ result: expected }],
  );
  try {
    await identify(manager);
    await command("SAVEPOINT scada_b4_runtime_probe", "SAVEPOINT");
    savepoint = true;
    stage = "OIDC 清理隔离";
    // 禁止清理任何既有记录；短时锁与空候选证据只覆盖本次回滚夹具。
    await command("LOCK TABLE public.scada_oidc_transactions IN SHARE ROW EXCLUSIVE MODE NOWAIT", "LOCK");
    await rows("SELECT NOT EXISTS (SELECT 1 FROM public.scada_oidc_transactions WHERE issuer = $1 AND expires_at <= CURRENT_TIMESTAMP) AS clean",
      [issuer], [{ clean: true }]);
    stage = "合成身份夹具";
    await count("INSERT INTO public.scada_identities (tenant_id, subject_id, status, created_at, updated_at) VALUES ($1, $2, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), ($1, $3, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), ($1, 'disabled', 'disabled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
      [tenant, subject, other], 3, "INSERT");
    stage = "运行角色与工程初始化";
    await command("SET LOCAL ROLE adui_scada_runtime", "SET");
    await identify(runtime);
    await rows("SELECT status FROM public.scada_lock_identity($1, $2)", [tenant, subject], [{ status: "active" }]);
    await createProject(subject, project, event, "CREATED");
    await createProject(other, project, randomUUID(), "EXISTS");
    await createProject("disabled", "denied", randomUUID(), "DENIED");
    await rows("SELECT permission FROM public.scada_lock_project_grants($1, $2, $3) ORDER BY permission COLLATE \"C\"",
      [tenant, project, subject], [{ permission: "project:read" }, { permission: "version:append" }, { permission: "version:read" }]);
    await rows("SELECT permission FROM public.scada_lock_project_grants($1, $2, $3)", [tenant, project, other], []);
    await rows("SELECT content_hash FROM public.scada_lock_project_version($1, $2, 1)", [tenant, project], [{ content_hash: hash }]);
    await rows("SELECT generation FROM public.scada_lock_release_state_share($1, $2)", [tenant, project], [{ generation: "0" }]);
    await rows("SELECT generation FROM public.scada_lock_release_state_update($1, $2)", [tenant, project], [{ generation: "0" }]);
    await rows("SELECT event_id FROM public.scada_lock_release_event($1, $2, $3::uuid)", [tenant, project, event], []);
    await rows("SELECT event_id FROM public.scada_lock_release_request($1, $2, $3, 'PUBLISH', 'probe')", [tenant, project, subject], []);
    await rows("SELECT event_id FROM public.scada_lock_prior_publish($1, $2, 1, 2)", [tenant, project], []);
    await rows("SELECT action FROM public.scada_project_audit WHERE tenant_id = $1 AND project_id = $2", [tenant, project], [{ action: "version:append" }]);
    stage = "版本追加与历史归档";
    const nextHash = digest();
    const nextSnapshot = JSON.stringify({ projectId: project, revision: 2, contentHash: nextHash, createdAt });
    await count("INSERT INTO public.scada_project_versions (tenant_id, project_id, revision, snapshot, content_hash, created_by, created_at) VALUES ($1, $2, 2, $3::jsonb, $4, $5, $6::timestamptz)",
      [tenant, project, nextSnapshot, nextHash, subject, createdAt], 1, "INSERT");
    await count("UPDATE public.scada_projects SET head_revision = 2, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND project_id = $2 AND head_revision = 1", [tenant, project], 1, "UPDATE");
    await count("INSERT INTO public.scada_project_audit (event_id, tenant_id, project_id, revision, actor_id, action) VALUES ($1::uuid, $2, $3, 2, $4, 'version:append')", [randomUUID(), tenant, project, subject], 1, "INSERT");
    await rows("SELECT head_revision::text AS revision FROM public.scada_projects WHERE tenant_id = $1 AND project_id = $2", [tenant, project], [{ revision: "2" }]);
    await count("INSERT INTO public.scada_tag_history_batches (tenant_id, project_id, stream_id, batch_sequence, format_version, record_count) VALUES ($1, $2, 'probe', 1, 1, 1)", [tenant, project], 1, "INSERT");
    await count("INSERT INTO public.scada_tag_history_records (tenant_id, project_id, stream_id, batch_sequence, ordinal, tag_id, timestamp_ms, payload) VALUES ($1, $2, 'probe', 1, 0, 'probe', 0, 'probe')", [tenant, project], 1, "INSERT");
    await rows("SELECT payload FROM public.scada_tag_history_records WHERE tenant_id = $1 AND project_id = $2 AND stream_id = 'probe' AND batch_sequence = 1", [tenant, project], [{ payload: "probe" }]);
    stage = "会话签发与撤销";
    await count("INSERT INTO public.scada_auth_sessions (session_id, tenant_id, subject_id, token_hash, issued_at, expires_at) VALUES ($1::uuid, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '5 minutes')",
      [session, tenant, subject, digest()], 1, "INSERT");
    await rows("SELECT session_id FROM public.scada_lock_session_identity($1, $2, $3::uuid)", [tenant, subject, session], [{ session_id: session }]);
    await count("UPDATE public.scada_auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_id = $1::uuid AND tenant_id = $2", [session, tenant], 1, "UPDATE");
    await rows("SELECT session_id FROM public.scada_lock_session_identity($1, $2, $3::uuid)", [tenant, subject, session], []);
    stage = "固定 Issuer 清理";
    await count("INSERT INTO public.scada_oidc_transactions (state_hash, issuer, nonce, verifier_ciphertext, browser_binding_hash, return_path, created_at, expires_at) VALUES ($1, $4, 'probe', 'probe', $5, '/', CURRENT_TIMESTAMP - interval '2 minutes', CURRENT_TIMESTAMP - interval '1 minute'), ($2, $4, 'probe', 'probe', $5, '/', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '5 minutes'), ($3, $6, 'probe', 'probe', $5, '/', CURRENT_TIMESTAMP - interval '2 minutes', CURRENT_TIMESTAMP - interval '1 minute')",
      [...states, issuer, digest(), issuer + "/probe-other"], 3, "INSERT");
    await rows("SELECT public.scada_cleanup_expired_oidc()::text AS deleted", [], [{ deleted: "1" }]);
    await rows("SELECT state_hash FROM public.scada_oidc_transactions WHERE state_hash = ANY($1::text[]) ORDER BY state_hash COLLATE \"C\"",
      [states], states.slice(1).sort(compare).map((state_hash) => ({ state_hash })));
    await count("UPDATE public.scada_oidc_transactions SET consumed_at = CURRENT_TIMESTAMP WHERE state_hash = $1 AND consumed_at IS NULL", [states[1]], 1, "UPDATE");
    await rows("SELECT consumed_at IS NOT NULL AS consumed FROM public.scada_oidc_transactions WHERE state_hash = $1", [states[1]], [{ consumed: true }]);
    stage = "运行角色越权拒绝";
    for (const sql of denialSql) await deny(sql);
    stage = "Keycloak 跨业务权限拒绝";
    await command("RESET ROLE", "RESET");
    await command("SET LOCAL ROLE adui_scada_keycloak_runtime", "SET");
    await identify(keycloak);
    await deny("SELECT tenant_id FROM public.scada_projects WHERE false");
    await deny("SELECT status FROM public.scada_lock_identity($1, $2)", [tenant, subject]);
  } catch (error) {
    failure = "B4 权限探针" + stage + "失败，内部诊断已脱敏";
    if (error instanceof DockerB4RuntimeProbeError) failure += "；" + error.message;
  } finally {
    if (savepoint) {
      try {
        await command("ROLLBACK TO SAVEPOINT scada_b4_runtime_probe", "ROLLBACK");
        await command("RELEASE SAVEPOINT scada_b4_runtime_probe", "RELEASE");
        await identify(manager);
        const fixtureTables = ["scada_identities", "scada_projects", "scada_project_grants", "scada_project_versions", "scada_project_release_state", "scada_project_audit", "scada_auth_sessions", "scada_tag_history_batches", "scada_tag_history_records"];
        await rows("SELECT " + fixtureTables.map((table) => "NOT EXISTS (SELECT 1 FROM public." + table + " WHERE tenant_id = $1)").join(" AND ") +
          " AND NOT EXISTS (SELECT 1 FROM public.scada_oidc_transactions WHERE state_hash = ANY($2::text[])) AS absent", [tenant, states], [{ absent: true }]);
      } catch { failure = (failure ?? "B4 权限探针") + "；夹具回滚或管理身份恢复未确认"; }
    }
  }
  if (failure) throw new DockerB4RuntimeProbeError(failure);
  requireMatch(savepoint && positiveCount === 36 && deniedCount === denialSql.length + 2, "B4 权限探针证据不完整");
  return { status: "SCADA_B4_RUNTIME_STATEMENTS_MATCHED", positiveCount, deniedCount,
    fixturesRolledBack: true, runtimeStatementsVerified: true, rowLockConcurrencyVerified: false,
    rowAuthorizationVerified: false, businessDataWritten: false, admissionPassed: false };
}
