import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKeycloakOwnershipPlan,
  DockerKeycloakOwnershipError,
  readKeycloakOwnershipPreview,
  readKeycloakOwnershipCandidate,
  verifyKeycloakOwnershipCatalog,
  verifyKeycloakOwnershipBaseline,
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

function projectedFixture() {
  const input = fixture();
  const candidate = buildKeycloakOwnershipPlan(input);
  const tables = candidate.inventory.filter((row) => row.kind === "table");
  const dependency = (kind, objectId) => ({ kind, objectId, directConnectMatched: true, systemIdentifier: context.identity.systemIdentifier });
  const table = ["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"];
  const column = ["INSERT", "REFERENCES", "SELECT", "UPDATE"];
  return { candidate, rows: [baselineRows(), candidate.inventory.map((row) => ({ ...row, owner: runtime })),
    [dependency("databaseConnect", "adui_scada_keycloak"), ...tables.map((row) => dependency("tableOwner", row.oid))],
    ["adui_scada_runtime", runtime].flatMap((role) => tables.map((row) => ({ role, objectId: row.oid,
      tablePrivileges: role === runtime ? [...table] : [], tableGrantOptions: role === runtime ? [...table] : [],
      columnPrivileges: role === runtime ? [...column] : [], schemaUsage: true, schemaElevated: false,
    })))], calls: [] };
}

function verifyProjected(data, fingerprint = data.candidate.report.planFingerprint) {
  return verifyKeycloakOwnershipCatalog(async (_step, sql) => {
    data.calls.push(sql);
    return { rows: data.rows[data.calls.length - 1] };
  }, context, data.candidate, fingerprint);
}

void test("可写演练前置仅允许固定事务模式，不改变只读计划指纹", async () => {
  const input = fixture();
  const calls = [];
  const plan = await readKeycloakOwnershipCandidate(async (_step, sql) => {
    calls.push(sql);
    return { rows: calls.length === 1 ? input.baselineRows : input.objects };
  }, context, "rehearsal");
  assert.deepEqual(plan, buildKeycloakOwnershipPlan(input));
  assert.match(calls[0], /current_setting\('transaction_read_only'\) = 'off'/u);
  assert.match(calls[0], /current_setting\('transaction_isolation'\) = 'serializable'/u);
  assert.match(calls[0], /pg_authid'::regclass\) = 1\s+AND EXISTS/u);
  await assert.rejects(() => readKeycloakOwnershipCandidate(async () => { throw new Error("不得查询"); }, context, "projected"), DockerKeycloakOwnershipError);
});

void test("后置目录核对一百零一张表、一百零二项依赖及两百零二项权限", async () => {
  const data = projectedFixture();
  const report = await verifyProjected(data);
  assert.equal(report.tableCount, 101);
  assert.equal(report.dependencyCount, 102);
  assert.equal(report.permissionCount, 202);
  assert.equal(report.ownerProjectionMatched, true);
  assert.equal(report.dependencyProjectionMatched, true);
  assert.equal(report.rolePrivilegesMatched, true);
  assert.match(report.catalogFingerprint, /^[a-f0-9]{64}$/u);
  for (const key of ["schemaCreateAllowed", "schemaEvolutionVerified", "objectIdentityReviewed", "ownershipTransferAllowed", "runtimeLoginAllowed", "admissionPassed", "businessAclApproved", "databaseWritten", "serviceSwitched"]) assert.equal(report[key], false);
  assert.equal(data.calls.length, 4);
  assert.match(data.calls[0], /current_setting\('transaction_read_only'\) = 'off'/u);
  assert.match(data.calls[0], /pg_authid'::regclass\) = 102\s+AND EXISTS/u);
  assert.match(data.calls[2], /d\.refclassid = 'pg_catalog\.pg_authid'::regclass/u);
  assert.match(data.calls[2], /d\.objsubid = 0 AND d\.deptype = 'o'/u);
  assert.match(data.calls[2], /ELSE 'unexpected'/u);
  assert.match(data.calls[2], /t\.oid IN \(a\.grantee, a\.grantor\)/u);
  assert.match(data.calls[2], /a\.privilege_type = 'CONNECT' AND NOT a\.is_grantable/u);
  assert.match(data.calls[3], /CASE WHEN c\.relkind = 'r'\s+THEN pg_catalog\.has_table_privilege/u);
  assert.match(data.calls[3], /pg_catalog\.has_any_column_privilege/u);
  assert.match(data.calls[3], /p\.name \|\| ' WITH GRANT OPTION'/u);
  assert.match(data.calls[3], /CREATE,USAGE WITH GRANT OPTION/u);
  assert.ok(data.calls.every((sql) => /^WITH /u.test(sql) && !/(?:^|[;\n])\s*(?:ALTER TABLE|GRANT|REVOKE|COMMIT)\s/u.test(sql)));
  assert.doesNotMatch(JSON.stringify(report), /kc_fixture|databasechangelog|123456789|ALTER TABLE/u);
  const reordered = projectedFixture();
  for (const rows of reordered.rows) rows.reverse();
  assert.deepEqual(await verifyProjected(reordered), report);
});

void test("候选指纹、SQL 或报告被替换时禁止查询后置目录", async () => {
  const changed = projectedFixture();
  await assert.rejects(() => verifyProjected(changed, "c".repeat(64)), DockerKeycloakOwnershipError);
  assert.deepEqual(changed.calls, []);
  for (const mutate of [(candidate) => { candidate.sqlPreview[0] = "模拟其他语句"; }, (candidate) => { candidate.report.objectIdentityReviewed = true; }, (candidate) => { candidate.inventory[0].owner = runtime; }]) {
    const data = projectedFixture(); mutate(data.candidate);
    await assert.rejects(() => verifyProjected(data), DockerKeycloakOwnershipError);
    assert.deepEqual(data.calls, []);
  }
});

void test("后置角色属性、Schema 或从属对象漂移立即拒绝", async () => {
  for (const key of Object.keys(baselineRows()[0])) {
    const data = projectedFixture(); data.rows[0][0][key] = false;
    await assert.rejects(() => verifyProjected(data), DockerKeycloakOwnershipError);
    assert.equal(data.calls.length, 1);
  }
  for (const kind of ["table", "index", "toast", "toastIndex", "rowType", "arrayType"]) {
    const data = projectedFixture(); data.rows[1].find((row) => row.kind === kind).owner = "adui_scada";
    await assert.rejects(() => verifyProjected(data), DockerKeycloakOwnershipError);
    assert.equal(data.calls.length, 2);
  }
});

void test("共享依赖及跨库直接 ACL 缺失重复或越权一律拒绝", async () => {
  for (const mutate of [
    (rows) => rows.pop(), (rows) => rows.push(rows[0]), (rows) => { rows[1] = rows[0]; },
    (rows) => { rows[1].kind = "unexpected"; }, (rows) => { rows[1].objectId = "999999"; },
    (rows) => { rows[0].directConnectMatched = false; }, (rows) => { rows[0].systemIdentifier = "987654321"; },
  ]) {
    const data = projectedFixture(); mutate(data.rows[2]);
    await assert.rejects(() => verifyProjected(data), DockerKeycloakOwnershipError);
    assert.equal(data.calls.length, 3);
  }
});

void test("任何有效表权限、列权限或 Schema 权限漂移不能通过后置门禁", async () => {
  for (const mutate of [
    (rows) => rows.pop(), (rows) => rows.push(rows[0]), (rows) => { rows[1] = rows[0]; },
    (rows) => { rows[0].tablePrivileges.push("SELECT"); }, (rows) => { rows[0].columnPrivileges.push("SELECT"); },
    (rows) => { rows[0].schemaElevated = true; }, (rows) => { rows[0].schemaUsage = false; },
    (rows) => { rows.find((row) => row.role === runtime).tableGrantOptions.pop(); },
    (rows) => { rows.find((row) => row.role === runtime).tablePrivileges.pop(); },
    (rows) => { rows.find((row) => row.role === runtime).columnPrivileges.pop(); },
  ]) {
    const data = projectedFixture(); mutate(data.rows[3]);
    await assert.rejects(() => verifyProjected(data), DockerKeycloakOwnershipError);
    assert.equal(data.calls.length, 4);
  }
  const data = projectedFixture();
  await assert.rejects(() => verifyKeycloakOwnershipCatalog(async () => { throw new Error("SENSITIVE"); }, context, data.candidate, data.candidate.report.planFingerprint), {
    name: "Error", message: "Keycloak 后置安全基线核验失败，内部诊断已脱敏",
  });
});

function baselineFixture() {
  const data = projectedFixture();
  data.rows[1] = structuredClone(data.candidate.inventory);
  data.rows[2] = data.rows[2].filter((row) => row.kind === "databaseConnect");
  data.rows[3] = data.rows[3].map((row) => ({ ...row, tablePrivileges: [], tableGrantOptions: [], columnPrivileges: [] }));
  return data;
}

function verifyBaseline(data, phase) {
  return verifyKeycloakOwnershipBaseline(async (_step, sql) => {
    data.calls.push(sql);
    return { rows: data.rows[data.calls.length - 1] };
  }, context, data.candidate, data.candidate.report.planFingerprint, phase);
}

void test("原始基线前后使用同一目录权限矩阵与指纹", async () => {
  const before = baselineFixture();
  const after = baselineFixture();
  const first = await verifyBaseline(before, "rehearsal");
  const second = await verifyBaseline(after, "read-only");
  assert.deepEqual(first, second);
  assert.equal(first.status, "KEYCLOAK_OWNERSHIP_BASELINE_MATCHED");
  assert.equal(first.baselineCatalogMatched, true);
  assert.equal(first.ownerProjectionMatched, false);
  assert.equal(first.dependencyProjectionMatched, false);
  assert.equal(first.dependencyCount, 1);
  assert.equal(first.permissionCount, 202);
  assert.match(before.calls[0], /current_setting\('transaction_read_only'\) = 'off'/u);
  assert.match(after.calls[0], /current_setting\('transaction_read_only'\) = 'on'/u);
  assert.notEqual(first.catalogFingerprint, (await verifyProjected(projectedFixture())).catalogFingerprint);
  const invalid = baselineFixture();
  await assert.rejects(() => verifyBaseline(invalid, "projected"), DockerKeycloakOwnershipError);
  assert.deepEqual(invalid.calls, []);
});

void test("回滚后剩余所有权、额外依赖或权限不得通过原始基线", async () => {
  for (const [index, mutate] of [
    [1, (rows) => { rows[0].owner = runtime; }],
    [2, (rows) => rows.push({ ...rows[0], kind: "tableOwner", objectId: "1000" })],
    [3, (rows) => { rows.find((row) => row.role === runtime).tablePrivileges.push("SELECT"); }],
  ]) {
    const data = baselineFixture(); mutate(data.rows[index]);
    await assert.rejects(() => verifyBaseline(data, "read-only"), DockerKeycloakOwnershipError);
    assert.equal(data.calls.length, index + 1);
  }
});
