import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScadaLockRoutinePreview } from "./docker-db-role-lock-routines.mjs";

void test("五张受保护表和原会话联合锁生成九条固定锁例程候选", () => {
  const plan = buildScadaLockRoutinePreview();
  assert.deepEqual(plan, buildScadaLockRoutinePreview());
  assert.equal(plan.protectedTableCount, 5);
  assert.equal(plan.lockedTableCount, 6);
  assert.equal(plan.routineCount, 9);
  assert.equal(new Set(plan.definitions.map((item) => item.signature)).size, 9);
  assert.deepEqual(
    [...new Set(plan.definitions.flatMap((item) => item.tables))].sort((left, right) =>
      left.localeCompare(right),
    ),
    [
      "scada_auth_sessions",
      "scada_identities",
      "scada_project_grants",
      "scada_project_release_events",
      "scada_project_release_state",
      "scada_project_versions",
    ],
  );
  assert.match(plan.planFingerprint, /^[a-f0-9]{64}$/u);
});

void test("锁所有者只获得固定列权限且运行角色不获得保护表更新权限", () => {
  const { ownerGrants, definitions } = buildScadaLockRoutinePreview();
  assert.equal(ownerGrants.length, 13);
  assert.equal(ownerGrants.filter((sql) => sql.startsWith("GRANT UPDATE (")).length, 6);
  assert.ok(ownerGrants.every((sql) => sql.endsWith(" TO adui_scada_lock_owner")));
  assert.ok(
    ownerGrants.every(
      (sql) => !/GRANT ALL|WITH GRANT OPTION|CREATE ON SCHEMA|INSERT|DELETE/u.test(sql),
    ),
  );
  assert.ok(
    definitions.every(
      (item) =>
        item.executeSql ===
        "GRANT EXECUTE ON FUNCTION " + item.signature + " TO adui_scada_runtime",
    ),
  );
});

void test("所有例程只有固定 SELECT 和行锁且逐个撤销 PUBLIC 执行权限", () => {
  const { definitions } = buildScadaLockRoutinePreview();
  for (const item of definitions) {
    assert.match(item.selectSql, /^SELECT /u);
    assert.match(item.selectSql, /FOR (SHARE|UPDATE)( OF s, i)?$/u);
    assert.doesNotMatch(
      item.selectSql,
      /\b(INSERT|DELETE|TRUNCATE|EXECUTE|ALTER|DROP)\b|;|\bUPDATE\s+public\./u,
    );
    assert.match(item.createSql, /^CREATE FUNCTION public\.scada_lock_/u);
    assert.match(item.createSql, /VOLATILE STRICT PARALLEL UNSAFE SECURITY DEFINER/u);
    assert.match(
      item.createSql,
      /SET search_path = pg_catalog, public, pg_temp SET row_security = on/u,
    );
    assert.ok(item.createSql.includes(item.selectSql));
    assert.equal(item.revokePublicSql, "REVOKE ALL ON FUNCTION " + item.signature + " FROM PUBLIC");
    assert.equal(
      item.ownerSql,
      "ALTER FUNCTION " + item.signature + " OWNER TO adui_scada_lock_owner",
    );
  }
});

void test("保留联合会话锁、发布代次、幂等键、历史发布及读写锁强度", () => {
  const { definitions } = buildScadaLockRoutinePreview();
  const sql = (name) => definitions.find((item) => item.name === name)?.selectSql ?? "";
  assert.match(
    sql("scada_lock_session_identity"),
    /s\.session_id = p_session_id AND s\.tenant_id = p_tenant_id AND s\.subject_id = p_subject_id/u,
  );
  assert.match(
    sql("scada_lock_session_identity"),
    /s\.revoked_at IS NULL AND s\.issued_at <= CURRENT_TIMESTAMP\s+AND s\.expires_at > CURRENT_TIMESTAMP AND i\.status = 'active'\s+FOR SHARE OF s, i$/u,
  );
  assert.match(
    sql("scada_lock_project_grants"),
    /t\.tenant_id = p_tenant_id AND t\.project_id = p_project_id AND t\.subject_id = p_subject_id FOR SHARE$/u,
  );
  assert.match(sql("scada_lock_project_version"), /t\.revision = p_revision FOR SHARE$/u);
  assert.equal(
    sql("scada_lock_release_state_share").replace(/FOR SHARE$/u, "FOR UPDATE"),
    sql("scada_lock_release_state_update"),
  );
  assert.match(sql("scada_lock_release_event"), /t\.event_id = p_event_id FOR SHARE$/u);
  assert.match(
    sql("scada_lock_release_request"),
    /t\.actor_id = p_subject_id\s+AND t\.action = p_action AND t\.idempotency_key = p_idempotency_key FOR SHARE$/u,
  );
  assert.match(
    sql("scada_lock_prior_publish"),
    /t\.action = 'PUBLISH' AND t\.to_revision = p_revision\s+AND t\.generation < p_generation ORDER BY t\.generation DESC LIMIT 1 FOR SHARE$/u,
  );
});

void test("候选结果不可变更下一次预览且始终保持真实权限和准入未验证", () => {
  const plan = buildScadaLockRoutinePreview();
  plan.definitions[0].tables.push("模拟额外表");
  plan.ownerGrants.pop();
  plan.prerequisites.pop();
  const next = buildScadaLockRoutinePreview();
  assert.equal(next.definitions[0].tables.length, 1);
  assert.equal(next.ownerGrants.length, 13);
  assert.equal(next.prerequisites.length, 7);
  assert.equal(next.planOnly, true);
  assert.equal(next.rowLockVerified, false);
  assert.equal(next.definerSafetyVerified, false);
  assert.equal(next.rowAuthorizationVerified, false);
  assert.equal(next.businessAclApproved, false);
  assert.equal(next.databaseWritten, false);
  assert.equal(next.admissionPassed, false);
});
