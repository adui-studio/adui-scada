import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildScadaB4InstallPreflight,
  DockerB4PreflightError,
  readScadaB4InstallPreflight,
  readScadaB4BusinessPreparation,
  verifyScadaB4NewOwnerRoles,
} from "./docker-db-role-b4-preflight.mjs";
import { scadaBusinessColumnInventory } from "./docker-db-role-business-acl.mjs";
import { buildScadaOidcCleanupRoutinePreview } from "./docker-db-role-restricted-writes.mjs";

function fixture() {
  return {
    managerVerified: true, hardenedRuntimeCount: 2, candidateOwnerCount: 0,
    membershipCount: 0, roleSettingCount: 0, trustedSchemaCount: 2,
    unexpectedSchemaCreatorCount: 0, publicSchemaCreateCount: 0, functionDefaultAclCount: 0,
    reservedRoutineCount: 0, publicRoutineCount: 0, publicOperatorCount: 0,
    userTriggerCount: 0, eventTriggerCount: 0, rlsRelationCount: 0, rlsPolicyCount: 0,
  };
}

function ownerFixture() {
  return ["adui_scada_lock_owner", "adui_scada_project_create_owner", "adui_scada_oidc_cleanup_owner"].map((role) => ({
    role, managerVerified: true, hardened: true, noMemberships: true, noSettings: true, noDependencies: true,
    noDatabaseAccess: true, noSchemaCreate: true, noTableOrColumnAccess: true, noSequenceAccess: true,
  }));
}

void test("固定前置基线仅生成三个角色候选且不批准安装", () => {
  const report = buildScadaB4InstallPreflight([fixture()]);
  assert.equal(report.preflightPassed, true);
  assert.equal(report.reservedRoutineCount, 11);
  assert.equal(report.roleCreationPreview.length, 3);
  assert.deepEqual(report.roleCreationPreview, ownerFixture().map(({ role }) =>
    "CREATE ROLE " + role + " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD NULL"));
  assert.match(report.planFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(report.installationAllowed, false);
  assert.equal(report.ownerRolesCreated, false);
  assert.equal(report.ownerRolePrivilegesVerified, false);
  assert.equal(report.definerSafetyVerified, false);
  assert.equal(report.issuerBindingVerified, false);
  assert.equal(report.businessAclApproved, false);
  assert.equal(report.admissionPassed, false);
  assert.equal(report.databaseWritten, false);
  const reordered = Object.fromEntries(Object.entries(fixture()).reverse());
  assert.deepEqual(buildScadaB4InstallPreflight([reordered]), report);
  report.roleCreationPreview.pop();
  assert.equal(buildScadaB4InstallPreflight([fixture()]).roleCreationPreview.length, 3);
});

void test("所有前置证据漂移和类型变化均拒绝", () => {
  const original = fixture();
  for (const [key, value] of Object.entries(original)) {
    const wrong = typeof value === "boolean" ? false : value + 1;
    assert.throws(() => buildScadaB4InstallPreflight([{ ...original, [key]: wrong }]), DockerB4PreflightError);
    assert.throws(() => buildScadaB4InstallPreflight([{ ...original, [key]: String(value) }]), DockerB4PreflightError);
  }
});

void test("缺失重复额外证据均拒绝且不回显原始值", () => {
  for (const rows of [undefined, [], [fixture(), fixture()], [{ ...fixture(), extra: "模拟敏感值" }], [null]]) {
    assert.throws(() => buildScadaB4InstallPreflight(rows), {
      name: "Error", message: "B4 安装前目录证据形状异常",
    });
  }
  const missing = fixture();
  delete missing.candidateOwnerCount;
  assert.throws(() => buildScadaB4InstallPreflight([missing]), { name: "Error", message: "B4 安装前目录证据形状异常" });
});

void test("安装前置只发送一条固定目录查询", async () => {
  let calls = 0;
  const report = await readScadaB4InstallPreflight(async (_step, sql) => {
    calls += 1;
    assert.match(sql, /^SELECT\s/u);
    assert.match(sql, /pg_catalog\.pg_authid r/u);
    assert.match(sql, /r\.rolpassword IS NULL/u);
    assert.match(sql, /pg_catalog\.pg_auth_members/u);
    assert.match(sql, /pg_catalog\.pg_db_role_setting/u);
    assert.match(sql, /pg_catalog\.has_schema_privilege\(r\.oid, n\.oid, 'CREATE'\)/u);
    assert.match(sql, /a\.grantee = 0 AND a\.privilege_type = 'CREATE'/u);
    assert.match(sql, /pg_catalog\.pg_default_acl/u);
    assert.match(sql, /d\.defaclnamespace = 0 OR d\.defaclnamespace IN/u);
    for (const name of ["scada_lock_identity", "scada_lock_session_identity", "scada_lock_project_grants",
      "scada_lock_project_version", "scada_lock_release_state_share", "scada_lock_release_state_update",
      "scada_lock_release_event", "scada_lock_release_request", "scada_lock_prior_publish",
      "scada_create_project", "scada_cleanup_expired_oidc"]) {
      assert.ok(sql.includes("'" + name + "'"));
    }
    assert.match(sql, /pg_catalog\.pg_operator/u);
    assert.match(sql, /NOT t\.tgisinternal/u);
    assert.match(sql, /pg_catalog\.pg_event_trigger/u);
    assert.match(sql, /c\.relrowsecurity OR c\.relforcerowsecurity/u);
    assert.match(sql, /pg_catalog\.pg_policy/u);
    assert.doesNotMatch(sql, /SELECT[^\n]*rolpassword\b|\b(?:GRANT|REVOKE|ALTER ROLE|CREATE ROLE|DELETE FROM)\b/u);
    return { rows: [fixture()] };
  });
  assert.equal(calls, 1);
  assert.equal(report.installationAllowed, false);
});

void test("新所有者核验覆盖全集群数据库及业务列权限", async () => {
  let calls = 0;
  const report = await verifyScadaB4NewOwnerRoles(async (_step, sql) => {
    calls += 1;
    assert.match(sql, /^SELECT /u);
    assert.match(sql, /pg_catalog\.pg_shdepend/u);
    assert.match(sql, /current_setting\('transaction_read_only'\) = 'off'/u);
    assert.match(sql, /pg_catalog\.has_database_privilege\(r\.oid, d\.oid, 'CONNECT,TEMPORARY,CREATE'\)/u);
    assert.match(sql, /CASE WHEN c\.relkind IN \('r','p','v','m','f'\) THEN/u);
    assert.match(sql, /CASE WHEN c\.relkind = 'S' THEN/u);
    return { rows: ownerFixture().reverse() };
  });
  assert.equal(calls, 1);
  assert.deepEqual(report, { ownerRoleCount: 3, ungrantedOwnerRolesVerified: true, installationAllowed: false, admissionPassed: false, databaseWritten: false });
});

void test("新所有者缺失重复及任一权限漂移均拒绝", async () => {
  const rows = ownerFixture();
  const flags = Object.keys(rows[0]).filter((key) => key !== "role");
  const invalid = [[], [rows[0], rows[0], rows[2]], [rows[0], rows[1], { ...rows[2], role: "模拟敏感值" }],
    ...flags.map((key) => [{ ...rows[0], [key]: false }, rows[1], rows[2]]),
    ...flags.map((key) => [{ ...rows[0], [key]: "true" }, rows[1], rows[2]]),
    [{ ...rows[0], extra: "模拟敏感值" }, rows[1], rows[2]]];
  for (const data of invalid) {
    await assert.rejects(() => verifyScadaB4NewOwnerRoles(async () => ({ rows: data })), {
      name: "Error", message: "B4 新所有者未授权基线不一致",
    });
  }
});

function businessFixture() {
  return scadaBusinessColumnInventory().flatMap(({ table, columns }) =>
    ["adui_scada_runtime", "adui_scada_keycloak_runtime"].flatMap((role) => columns.map((column) => ({
      role, table, column, kind: "r", owner: false, tableAccess: false,
      select: role === "adui_scada_runtime" && table === "scada_projects" &&
        ["tenant_id", "project_id", "head_revision"].includes(column),
      insert: false, update: false, references: false, grantable: false,
    }))),
  );
}

void test("业务准备按前置后权限顺序并精确对照真实候选名称", async () => {
  const calls = [];
  const report = await readScadaB4BusinessPreparation(async (_step, sql) => {
    calls.push(sql);
    return { rows: calls.length === 1 ? [fixture()] : businessFixture() };
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0], /"candidateOwnerCount"/u);
  assert.match(calls[1], /pg_catalog\.pg_attribute/u);
  assert.equal(report.businessAclPreview.grants.length, 21);
  assert.equal(report.businessAclPreview.admissionPassed, false);
  const locks = report.businessAclPreview.lockRoutinePreview;
  const writes = report.businessAclPreview.restrictedWritePreview;
  const routines = [...locks.definitions.map((item) => item.name),
    writes.projectCreate.signature.split("(")[0].slice("public.".length),
    buildScadaOidcCleanupRoutinePreview("18443").signature.split("(")[0].slice("public.".length)];
  assert.equal(report.ownerInstallPreflight.reservedRoutineCount, routines.length);
  const routineFilter = calls[0].match(/p\.proname IN \(([^)]+)\)/u)?.[1];
  assert.equal(routineFilter, routines.map((name) => "'" + name + "'").join(", "));
  const owners = [locks.ownerRole, writes.projectCreate.ownerRole, writes.oidcCleanup.ownerRole];
  assert.deepEqual(report.ownerInstallPreflight.roleCreationPreview.map((sql) => sql.split(" ")[2]), owners);
});

void test("前置拒绝时不再读取业务列权限", async () => {
  let calls = 0;
  await assert.rejects(() => readScadaB4BusinessPreparation(async () => {
    calls += 1;
    return { rows: [{ ...fixture(), candidateOwnerCount: 1 }] };
  }), { name: "Error", message: "候选所有者已存在，禁止重复安装" });
  assert.equal(calls, 1);
});
