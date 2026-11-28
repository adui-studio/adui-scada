import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKeycloakOwnershipPlan,
  DockerKeycloakOwnershipError,
  readKeycloakOwnershipPreview,
  verifyKeycloakOwnershipProjection,
} from "./docker-db-role-keycloak-plan.mjs";

const context = { identity: { version: "190000", systemIdentifier: "123456789" }, storageHash: "a".repeat(64), isolationFingerprint: "b".repeat(64) };
const runtime = "adui_scada_keycloak_runtime";
const baselineRows = () => [{ managerVerified: true, rolesHardened: true, isolatedRuntime: true,
  schemaTrusted: true, noOtherSchemas: true, noUnexpectedObjects: true, keycloakDependencyMatched: true }];
function fixture() {
  const names = ["realm", "client", "user_entity", "databasechangelog", "databasechangeloglock",
    ...Array.from({ length: 96 }, (_, index) => "kc_fixture_" + index)];
  return { ...structuredClone(context), baselineRows: baselineRows(), objects: names.flatMap((name, index) => {
    const id = index * 10 + 1000;
    const row = (kind, offset, name, parent) => ({ kind, oid: String(id + offset), name, parent: parent === null ? null : String(id + parent), owner: "adui_scada", clean: true });
    return [row("table", 0, name, null), row("index", 1, name + "_idx", 0), row("rowType", 2, name, 0),
      row("arrayType", 3, "_" + name, 2), ...(index === 0 ? [row("toast", 4, "pg_toast_" + id, 0), row("toastIndex", 5, "pg_toast_" + id + "_index", 4)] : [])];
  }) };
}

void test("Keycloak 仅生成一百零一条精确表所有权候选", () => {
  const plan = buildKeycloakOwnershipPlan(fixture());
  assert.equal(plan.sqlPreview.length, 101);
  assert.equal(new Set(plan.sqlPreview).size, 101);
  assert.ok(plan.sqlPreview.every((sql) => /^ALTER TABLE ONLY public\."[a-z_][a-z0-9_]{0,62}" OWNER TO adui_scada_keycloak_runtime$/u.test(sql)));
  assert.ok(plan.sqlPreview.includes('ALTER TABLE ONLY public."databasechangelog" OWNER TO adui_scada_keycloak_runtime'));
  assert.deepEqual(plan.report.objectCounts, { table: 101, index: 101, toast: 1, toastIndex: 1, rowType: 101, arrayType: 101 });
  for (const key of ["objectIdentityReviewed", "ownershipTransferAllowed", "ownerProjectionVerified", "runtimeLoginAllowed", "businessAclApproved", "admissionPassed", "databaseWritten", "serviceSwitched"]) assert.equal(plan.report[key], false);
  assert.equal(plan.report.schemaCreateReviewRequired, true);
  assert.doesNotMatch(JSON.stringify(plan.report), /kc_fixture|databasechangelog|ALTER TABLE|1000/u);
});

void test("指纹绑定集群、存储、隔离及对象标识，不受读取顺序影响", () => {
  const input = fixture(); const original = buildKeycloakOwnershipPlan(input);
  assert.deepEqual(buildKeycloakOwnershipPlan({ ...input, objects: [...input.objects].reverse() }), original);
  for (const change of [{ identity: { ...context.identity, systemIdentifier: "987654321" } }, { storageHash: "c".repeat(64) }, { isolationFingerprint: "c".repeat(64) }]) {
    assert.notEqual(buildKeycloakOwnershipPlan({ ...input, ...change }).report.planFingerprint, original.report.planFingerprint);
  }
  const changed = fixture(); changed.objects.find((row) => row.kind === "index").oid = "999999";
  assert.notEqual(buildKeycloakOwnershipPlan(changed).report.planFingerprint, original.report.planFingerprint);
});

void test("所有前置证据及确认标识均须精确匹配", () => {
  for (const key of Object.keys(baselineRows()[0])) {
    const data = fixture(); data.baselineRows[0][key] = false;
    assert.throws(() => buildKeycloakOwnershipPlan(data), DockerKeycloakOwnershipError);
  }
  for (const change of [{ baselineRows: [] }, { baselineRows: [...baselineRows(), ...baselineRows()] }, { isolationFingerprint: "bad" }, { identity: { version: "190001", systemIdentifier: "1" } }, { storageHash: "bad" }]) {
    assert.throws(() => buildKeycloakOwnershipPlan({ ...fixture(), ...change }), DockerKeycloakOwnershipError);
  }
});

void test("多余表、非预期对象、权限漂移及注入字符一律拒绝", () => {
  for (const mutate of [
    (rows) => rows.pop(), (rows) => rows.push({ ...rows[0], oid: "900001", name: "extra" }),
    (rows) => { rows[0].kind = "sequence"; }, (rows) => { rows[0].name = 'realm"; DROP TABLE realm;--'; },
    (rows) => { rows[0].name = "scada_projects"; }, (rows) => { rows[0].name = "not_realm"; },
    (rows) => { rows[0].owner = runtime; }, (rows) => { rows[0].clean = false; },
    (rows) => { rows[1].oid = rows[0].oid; }, (rows) => { rows[2].parent = "999999"; },
    (rows) => { rows[3].parent = rows[0].oid; }, (rows) => { rows[4].parent = "999999"; },
    (rows) => { rows[0].extra = true; },
  ]) {
    const data = fixture(); mutate(data.objects);
    assert.throws(() => buildKeycloakOwnershipPlan(data), DockerKeycloakOwnershipError);
  }
});

void test("表、索引、行类型与 TOAST 所有权投影必须同时匹配", () => {
  const before = fixture().objects;
  const after = before.map((row) => ({ ...row, owner: runtime }));
  assert.deepEqual(verifyKeycloakOwnershipProjection(before, [...after].reverse()), { ownerProjectionMatched: true, ownershipTransferAllowed: false, admissionPassed: false });
  for (const kind of ["table", "index", "toast", "toastIndex", "rowType", "arrayType"]) {
    const changed = structuredClone(after); changed.find((row) => row.kind === kind).owner = "adui_scada";
    assert.throws(() => verifyKeycloakOwnershipProjection(before, changed), DockerKeycloakOwnershipError);
  }
  const changed = structuredClone(after); changed.find((row) => row.kind === "index").oid = "999999";
  assert.throws(() => verifyKeycloakOwnershipProjection(before, changed), DockerKeycloakOwnershipError);
});

void test("只读对象预览检查真正目录查询形状与脱敏报告", async () => {
  const data = fixture(); const calls = [];
  const result = await readKeycloakOwnershipPreview(async (_step, sql) => {
    calls.push(sql);
    return { rows: calls.length === 1 ? data.baselineRows : data.objects };
  }, context);
  assert.deepEqual(result, buildKeycloakOwnershipPlan(data).report);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((sql) => /^WITH /u.test(sql) && !/(?:^|[;\n])\s*(?:ALTER TABLE|GRANT|REVOKE|REASSIGN OWNED|DROP OWNED)\s/u.test(sql)));
  assert.match(calls[0], /current_database\(\) = 'adui_scada_keycloak'/u);
  assert.match(calls[0], /current_setting\('transaction_read_only'\) = 'on'/u);
  assert.match(calls[0], /actor\.oid <> n\.nspowner/u);
  assert.match(calls[0], /pg_catalog\.pg_shdepend/u);
  assert.match(calls[0], /pg_catalog\.pg_default_acl/u);
  assert.match(calls[1], /ELSE 'unsupported'/u);
  assert.match(calls[1], /pg_catalog\.pg_trigger/u);
  assert.match(calls[1], /pg_catalog\.pg_depend/u);
  assert.match(calls[1], /a\.attacl IS NOT NULL/u);
});

void test("前置失败不查询对象，未知查询异常不回显原始信息", async () => {
  let calls = 0;
  await assert.rejects(() => readKeycloakOwnershipPreview(async () => { calls++; return { rows: [] }; }, context), DockerKeycloakOwnershipError);
  assert.equal(calls, 1);
  await assert.rejects(() => readKeycloakOwnershipPreview(async () => { throw new Error("SENSITIVE"); }, context), (error) => {
    assert.ok(error instanceof DockerKeycloakOwnershipError); assert.doesNotMatch(error.message, /SENSITIVE/u); return true;
  });
});
