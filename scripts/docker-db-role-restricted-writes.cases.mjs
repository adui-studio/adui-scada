import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildScadaOidcCleanupRoutinePreview,
  buildScadaRestrictedWritePreview,
} from "./docker-db-role-restricted-writes.mjs";

void test("初始工程仅在锁定活动身份且成功插入新工程后写入其余四表", () => {
  const { projectCreate } = buildScadaRestrictedWritePreview();
  const sql = projectCreate.createSql;
  assert.match(sql, /public\.scada_lock_identity\(p_tenant_id, p_subject_id\)/u);
  assert.match(sql, /IS DISTINCT FROM 'active' THEN\s+RETURN 'DENIED'/u);
  assert.match(
    sql,
    /ON CONFLICT \(tenant_id, project_id\) DO NOTHING;\s+GET DIAGNOSTICS affected = ROW_COUNT;\s+IF affected = 0 THEN RETURN 'EXISTS'; END IF;/u,
  );
  const inserts = [...sql.matchAll(/INSERT INTO public\.(scada_[a-z_]+)/gu)].map(
    (match) => match[1],
  );
  assert.deepEqual(inserts, [
    "scada_projects",
    "scada_project_versions",
    "scada_project_release_state",
    "scada_project_grants",
    "scada_project_audit",
  ]);
  assert.match(sql, /VALUES \(p_tenant_id, p_project_id, 1, p_created_at, p_created_at\)/u);
  assert.match(sql, /VALUES \(p_tenant_id, p_project_id, 0, p_created_at\)/u);
  assert.equal((sql.match(/GET DIAGNOSTICS affected = ROW_COUNT/gu) ?? []).length, 5);
  assert.match(sql, /IF affected <> 3 THEN/u);
  assert.match(sql, /RETURN 'CREATED';\s+END;/u);
});

void test("初始授权固定三项且快照元数据不一致拒绝，不生成发布权限或更新删除语句", () => {
  const { projectCreate } = buildScadaRestrictedWritePreview();
  const sql = projectCreate.createSql;
  assert.match(sql, /p_snapshot->>'projectId' IS DISTINCT FROM p_project_id/u);
  assert.match(sql, /p_snapshot->'revision' IS DISTINCT FROM '1'::jsonb/u);
  assert.match(sql, /p_snapshot->>'contentHash' IS DISTINCT FROM p_content_hash/u);
  assert.match(sql, /\(p_snapshot->>'createdAt'\)::timestamptz IS DISTINCT FROM p_created_at/u);
  assert.match(
    sql,
    /p_subject_id, 'project:read'\),\s+\(p_tenant_id, p_project_id, p_subject_id, 'version:read'\),\s+\(p_tenant_id, p_project_id, p_subject_id, 'version:append'\)/u,
  );
  assert.doesNotMatch(
    sql,
    /release:(?:publish|rollback|read)|\b(?:UPDATE|DELETE|TRUNCATE|COMMIT|ROLLBACK)\s+public\./u,
  );
  assert.equal(
    projectCreate.ownerGrants.filter((grant) => grant.startsWith("GRANT INSERT (")).length,
    5,
  );
  assert.ok(
    projectCreate.ownerGrants.every((grant) =>
      grant.endsWith(" TO adui_scada_project_create_owner"),
    ),
  );
  assert.ok(
    projectCreate.ownerGrants.every(
      (grant) => !/GRANT ALL|WITH GRANT OPTION|GRANT UPDATE|GRANT DELETE/u.test(grant),
    ),
  );
});

void test("清理例程无调用参数，只使用固定 Issuer 和数据库当前时刻，最多删除一百二十八行", () => {
  const plan = buildScadaOidcCleanupRoutinePreview("18443");
  assert.equal(plan.signature, "public.scada_cleanup_expired_oidc()");
  const sql = plan.createSql;
  assert.equal((sql.match(/https:\/\/127\.0\.0\.1:18443\/realms\/adui-scada/gu) ?? []).length, 2);
  assert.equal((sql.match(/expires_at <= CURRENT_TIMESTAMP/gu) ?? []).length, 2);
  assert.match(sql, /ORDER BY s\.expires_at ASC, s\.state_hash ASC LIMIT 128/u);
  assert.match(sql, /SELECT count\(\*\) FROM deleted/u);
  assert.equal(plan.cleanupBatchSize, 128);
  assert.equal(plan.ownerGrants.filter((grant) => grant.startsWith("GRANT DELETE")).length, 1);
  assert.ok(plan.ownerGrants.every((grant) => grant.endsWith(" TO adui_scada_oidc_cleanup_owner")));
  assert.doesNotMatch(
    plan.ownerGrants.join("\n"),
    /verifier_ciphertext|nonce|GRANT ALL|WITH GRANT OPTION/u,
  );
  assert.equal(plan.issuerBindingVerified, false);
});

void test("清理端口拒绝注入、越界、前导零及非字符串，合法不同端口改变指纹", () => {
  for (const port of [
    undefined,
    18443,
    "",
    "0",
    "65536",
    "018443",
    "18443;",
    "18443/realms/other",
  ]) {
    assert.throws(() => buildScadaOidcCleanupRoutinePreview(port), /要求有效的固定本机端口/u);
  }
  assert.notEqual(
    buildScadaOidcCleanupRoutinePreview("18443").planFingerprint,
    buildScadaOidcCleanupRoutinePreview("18444").planFingerprint,
  );
  assert.match(
    buildScadaOidcCleanupRoutinePreview("443").createSql,
    /https:\/\/127\.0\.0\.1\/realms\/adui-scada/u,
  );
});

void test("只读报告不猜测实际 Issuer 或允许直接工程插入，专用所有者相互独立", () => {
  const plan = buildScadaRestrictedWritePreview();
  assert.deepEqual(plan, buildScadaRestrictedWritePreview());
  assert.equal(plan.coveredOperations.length, 3);
  assert.deepEqual(plan.requiredDirectGrantExclusions, [
    { table: "scada_projects", privilege: "INSERT" },
  ]);
  assert.equal(plan.oidcCleanup.issuerBindingRequired, true);
  assert.equal(Object.hasOwn(plan.oidcCleanup, "createSql"), false);
  assert.notEqual(plan.projectCreate.ownerRole, plan.oidcCleanup.ownerRole);
  for (const item of [plan.projectCreate, buildScadaOidcCleanupRoutinePreview("18443")]) {
    assert.match(
      item.createSql,
      /SECURITY DEFINER\nSET search_path = pg_catalog, public, pg_temp SET row_security = on/u,
    );
    assert.equal(item.revokePublicSql, "REVOKE ALL ON FUNCTION " + item.signature + " FROM PUBLIC");
    assert.equal(
      item.executeSql,
      "GRANT EXECUTE ON FUNCTION " + item.signature + " TO adui_scada_runtime",
    );
    assert.equal(item.admissionPassed, false);
  }
  assert.equal(plan.planOnly, true);
  assert.equal(plan.rowAuthorizationVerified, false);
  assert.equal(plan.businessAclApproved, false);
  assert.equal(plan.admissionPassed, false);
  assert.equal(plan.databaseWritten, false);
});
