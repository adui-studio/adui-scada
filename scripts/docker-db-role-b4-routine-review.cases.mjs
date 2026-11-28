import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildScadaB4RoutineExpectations,
  DockerB4RoutineReviewError,
  verifyScadaB4InstalledRoutines,
} from "./docker-db-role-b4-routine-review.mjs";
import { buildScadaLockRoutinePreview } from "./docker-db-role-lock-routines.mjs";
import {
  buildScadaRestrictedWritePreview,
  buildScadaOidcCleanupRoutinePreview,
} from "./docker-db-role-restricted-writes.mjs";

const port = "18443";
const fixture = () => buildScadaB4RoutineExpectations(port);
const review = (rows, verifiedPort = port) =>
  verifyScadaB4InstalledRoutines(async () => ({ rows }), verifiedPort);

void test("固定十一个例程签名、返回类型与真实候选一致", () => {
  const rows = fixture();
  assert.deepEqual(
    rows.map((row) => row.identity),
    [
      "public.scada_lock_identity(text, text)",
      "public.scada_lock_session_identity(text, text, uuid)",
      "public.scada_lock_project_grants(text, text, text)",
      "public.scada_lock_project_version(text, text, bigint)",
      "public.scada_lock_release_state_share(text, text)",
      "public.scada_lock_release_state_update(text, text)",
      "public.scada_lock_release_event(text, text, uuid)",
      "public.scada_lock_release_request(text, text, text, text, text)",
      "public.scada_lock_prior_publish(text, text, bigint, bigint)",
      "public.scada_create_project(text, text, text, jsonb, text, timestamp with time zone, uuid)",
      "public.scada_cleanup_expired_oidc()",
    ],
  );
  assert.equal(rows[0].result, "TABLE(status text)");
  assert.equal(rows[3].result, "TABLE(snapshot_data text, content_hash text, created_at text)");
  assert.equal(rows[9].result, "text");
  assert.equal(rows[10].result, "bigint");
  assert.equal(rows[9].language, "plpgsql");
  assert.equal(rows[10].strict, false);
  assert.equal(rows.filter((row) => row.returnsSet).length, 9);
  const locks = buildScadaLockRoutinePreview();
  assert.deepEqual(
    rows.slice(0, 9).map((row) => row.body),
    locks.definitions.map((item) => "\n" + item.selectSql + "\n"),
  );
  assert.equal(
    rows[9].body,
    buildScadaRestrictedWritePreview().projectCreate.createSql.split("$scada_create$")[1],
  );
  assert.equal(
    rows[10].body,
    buildScadaOidcCleanupRoutinePreview(port).createSql.split("$scada_cleanup$")[1],
  );
});

void test("所有者及运行角色执行权限精确限定", () => {
  const rows = fixture();
  assert.equal(
    rows.reduce((total, row) => total + row.acl.length, 0),
    23,
  );
  assert.deepEqual(rows[0].effectiveExecute, [
    "adui_scada_lock_owner",
    "adui_scada_project_create_owner",
    "adui_scada_runtime",
  ]);
  assert.deepEqual(rows[1].effectiveExecute, ["adui_scada_lock_owner", "adui_scada_runtime"]);
  assert.deepEqual(rows[9].effectiveExecute, [
    "adui_scada_project_create_owner",
    "adui_scada_runtime",
  ]);
  assert.deepEqual(rows[10].effectiveExecute, [
    "adui_scada_oidc_cleanup_owner",
    "adui_scada_runtime",
  ]);
  assert.ok(
    rows.every((row) =>
      row.acl.every(
        (acl) => acl.grantor === row.owner && acl.privilege === "EXECUTE" && !acl.grantable,
      ),
    ),
  );
});

void test("目录行及 ACL 顺序不影响结果，报告不回显正文", async () => {
  const rows = fixture();
  const report = await review(rows);
  for (const row of rows) {
    row.acl.reverse();
    row.config.reverse();
    row.effectiveExecute.reverse();
  }
  assert.deepEqual(await review(rows.reverse()), report);
  assert.equal(report.routineCount, 11);
  assert.equal(report.directExecuteAclCount, 23);
  assert.match(report.catalogFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(report.routineCatalogMatched, true);
  for (const flag of [
    "definerSafetyVerified",
    "rowLockVerified",
    "rowAuthorizationVerified",
    "issuerBindingVerified",
    "businessAclApproved",
    "admissionPassed",
    "databaseWritten",
  ]) {
    assert.equal(report[flag], false);
  }
  assert.doesNotMatch(JSON.stringify(report), /SELECT |adui_scada_lock_owner|127\.0\.0\.1/u);
});

void test("参数、正文、所有者、配置及安全标志漂移均拒绝", async () => {
  const changes = [
    { managerVerified: false },
    { schema: "other" },
    { name: "unknown" },
    { argumentsText: "p_tenant_id text" },
    { result: "TABLE(status bigint)" },
    { owner: "adui_scada" },
    { language: "plpgsql" },
    { kind: "p" },
    { strict: false },
    { securityDefiner: false },
    { returnsSet: false },
    { volatility: "s" },
    { parallel: "s" },
    { leakproof: true },
    { noVariadic: false },
    { noDefaults: false },
    { noSupport: false },
    { noParsedBody: false },
    { noBinary: false },
    { noTransforms: false },
    { body: "SELECT 'SENSITIVE'" },
    { explicitAcl: false },
    { config: ["row_security=on", "search_path=public, pg_catalog, pg_temp"] },
    { config: null },
    {
      config: ["row_security=on", "search_path=pg_catalog, public, pg_temp", "statement_timeout=0"],
    },
    { extra: "SENSITIVE" },
  ];
  for (const change of changes) {
    const rows = fixture();
    Object.assign(rows[0], change);
    await assert.rejects(() => review(rows), {
      name: "Error",
      message: "B4 例程签名、正文或授权不一致：scada_lock_identity",
    });
  }
});

void test("PUBLIC、授权选项、其他角色或缺少权限均拒绝", async () => {
  for (const change of [
    (row) => row.acl.push({ ...row.acl[0], grantee: "PUBLIC" }),
    (row) => {
      row.acl[0].grantable = true;
    },
    (row) => {
      row.acl[0].grantor = "adui_scada";
    },
    (row) => row.acl.pop(),
    (row) => row.acl.push(row.acl[0]),
    (row) => row.effectiveExecute.push("adui_scada_keycloak_runtime"),
    (row) => row.effectiveExecute.pop(),
    (row) => row.effectiveExecute.push(row.effectiveExecute[0]),
    (row) => {
      row.acl = null;
    },
    (row) => {
      row.effectiveExecute = [null];
    },
  ]) {
    const rows = fixture();
    change(rows[0]);
    await assert.rejects(() => review(rows), DockerB4RoutineReviewError);
  }
});

void test("缺失、重复、重载、额外例程及清理 Issuer 不一致均拒绝", async () => {
  const rows = fixture();
  for (const invalid of [
    undefined,
    [],
    rows.slice(1),
    [...rows, rows[0]],
    [rows[1], ...rows.slice(1)],
    [{ ...rows[0], identity: "public.scada_lock_identity(text)" }, ...rows.slice(1)],
  ]) {
    await assert.rejects(() => review(invalid), DockerB4RoutineReviewError);
  }
  await assert.rejects(() => review(rows, "18444"), {
    name: "Error",
    message: "B4 例程签名、正文或授权不一致：scada_cleanup_expired_oidc",
  });
  assert.notEqual(
    (await review(rows)).catalogFingerprint,
    (await review(buildScadaB4RoutineExpectations("18444"), "18444")).catalogFingerprint,
  );
});

void test("只发送固定目录查询，不隐藏额外授权或回显底层异常", async () => {
  let calls = 0;
  const report = await verifyScadaB4InstalledRoutines(async (_step, sql) => {
    calls += 1;
    assert.match(sql, /^SELECT /u);
    assert.match(sql, /current_database\(\) = 'adui_scada'/u);
    assert.match(sql, /pg_catalog\.pg_get_function_arguments\(p\.oid\)/u);
    assert.match(sql, /pg_catalog\.pg_get_function_result\(p\.oid\)/u);
    assert.match(sql, /p\.prosrc AS body/u);
    assert.match(sql, /aclexplode\(p\.proacl\)/u);
    assert.match(sql, /WHEN a\.grantee = 0 THEN 'PUBLIC'/u);
    assert.match(sql, /WHERE NOT actor\.rolsuper/u);
    assert.match(sql, /CASE WHEN p\.prokind = 'f' THEN pg_catalog\.has_function_privilege/u);
    assert.match(sql, /WHERE n\.nspname = 'public' OR p\.proname IN/u);
    assert.doesNotMatch(sql, /CREATE FUNCTION|GRANT EXECUTE|DELETE FROM/u);
    return { rows: fixture() };
  }, port);
  assert.equal(calls, 1);
  assert.equal(report.routineCatalogMatched, true);
  await assert.rejects(
    () =>
      verifyScadaB4InstalledRoutines(async () => {
        throw new Error("SENSITIVE");
      }, port),
    {
      name: "Error",
      message: "B4 例程目录查询失败，内部诊断已脱敏",
    },
  );
});
