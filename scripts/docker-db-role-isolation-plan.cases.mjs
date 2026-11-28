import assert from "node:assert/strict";
import { test } from "node:test";
import { runDockerRoleIsolationTransaction } from "./docker-db-role-isolation-transaction.mjs";
import { buildDockerRoleIsolationPlan, reviewDockerRoleIsolationInventory } from "./docker-db-role-isolation-plan.mjs";

const hash = "a".repeat(64);
const identity = { version: "190000", systemIdentifier: "123456789" };
const names = [
  "adui_scada",
  "adui_scada_runtime",
  "adui_scada_keycloak_runtime",
  "pg_database_owner",
];
const ids = [
  "10",
  "24592",
  "24593",
  "6171",
  "3373",
  "3374",
  "3375",
  "3377",
  "4200",
  "4544",
  "4550",
  "4569",
  "4570",
  "4571",
  "6181",
  "6182",
  "6304",
  "6337",
  "6392",
];
const expectedSql = [
  "REVOKE CONNECT, TEMPORARY ON DATABASE adui_scada FROM PUBLIC RESTRICT",
  "REVOKE CONNECT, TEMPORARY ON DATABASE adui_scada_keycloak FROM PUBLIC RESTRICT",
  "REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC RESTRICT",
  "REVOKE CONNECT ON DATABASE template0 FROM PUBLIC RESTRICT",
  "REVOKE CONNECT ON DATABASE template1 FROM PUBLIC RESTRICT",
];

function fixture() {
  const roles = ids.map((id, i) => ({
    oid: id,
    name: names[i] ?? null,
    login: i === 0,
    superuser: i === 0,
    inherit: i !== 1 && i !== 2,
  }));
  const databases = [
    {
      oid: "16384",
      name: "adui_scada",
      ownerOid: "10",
      allowConnections: true,
      template: false,
      connectionLimit: -1,
      defaultAcl: false,
      aclEntryCount: 6,
      publicConnect: true,
      publicTemporary: true,
      publicCreate: false,
    },
    {
      oid: "16385",
      name: "adui_scada_keycloak",
      ownerOid: "10",
      allowConnections: true,
      template: false,
      connectionLimit: -1,
      defaultAcl: false,
      aclEntryCount: 6,
      publicConnect: true,
      publicTemporary: true,
      publicCreate: false,
    },
    {
      oid: "5",
      name: "postgres",
      ownerOid: "10",
      allowConnections: true,
      template: false,
      connectionLimit: -1,
      defaultAcl: true,
      aclEntryCount: 5,
      publicConnect: true,
      publicTemporary: true,
      publicCreate: false,
    },
    {
      oid: "4",
      name: "template0",
      ownerOid: "10",
      allowConnections: false,
      template: true,
      connectionLimit: -1,
      defaultAcl: false,
      aclEntryCount: 4,
      publicConnect: true,
      publicTemporary: false,
      publicCreate: false,
    },
    {
      oid: "1",
      name: "template1",
      ownerOid: "10",
      allowConnections: true,
      template: true,
      connectionLimit: -1,
      defaultAcl: false,
      aclEntryCount: 4,
      publicConnect: true,
      publicTemporary: false,
      publicCreate: false,
    },
  ];
  const acl = [];
  for (const database of databases) {
    const row = (granteeOid, privilege) => ({
      databaseOid: database.oid,
      grantorOid: "10",
      granteeOid,
      privilege,
      grantable: false,
    });
    acl.push(
      row("10", "CONNECT"),
      row("10", "TEMPORARY"),
      row("10", "CREATE"),
      row("0", "CONNECT"),
    );
    if (database.publicTemporary) acl.push(row("0", "TEMPORARY"));
    if (database.name === "adui_scada") acl.push(row("24592", "CONNECT"));
    if (database.name === "adui_scada_keycloak") acl.push(row("24593", "CONNECT"));
  }
  return {
    status: "DOCKER_DB_ROLE_ISOLATION_INSPECT_READY",
    serverVersion: "190000",
    storageHash: hash,
    directoryReviewPassed: true,
    rolesPrepared: true,
    committed: false,
    rolledBack: true,
    catalogStatementsExecuted: false,
    databaseWritten: false,
    businessDataWritten: false,
    admissionPassed: false,
    serviceSwitched: false,
    publicConnectRetained: true,
    inventory: {
      databases,
      roles,
      acl,
      effective: databases.flatMap((db) =>
        ids.map((id) => ({
          databaseOid: db.oid,
          roleOid: id,
          connect: true,
          temporary: id === "10" || db.publicTemporary,
          create: id === "10",
        })),
      ),
      memberships: ["3374", "3375", "3377"].map((roleOid) => ({
        roleOid,
        memberOid: "3373",
        grantorOid: "10",
        admin: false,
        inherit: true,
        setRole: true,
      })),
      sessions: [
        { databaseOid: "16384", roleOid: "10", total: 2 },
        { databaseOid: "16385", roleOid: "10", total: 2 },
      ],
      unknownLoginRoleCount: 0,
      unknownDatabaseCount: 0,
      unresolvedSessionCount: 0,
      consumerReviewRequired: true,
      changeAllowed: false,
      isolationPassed: false,
    },
  };
}

void test("完整基线只生成分组预览，精确移除八项公共授权且保留十七项直接授权", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = buildDockerRoleIsolationPlan(input, identity, hash);
  assert.deepEqual(input, before);
  assert.equal(result.status, "DOCKER_DB_ROLE_ISOLATION_PLAN_READY");
  assert.equal(result.databaseCount, 5);
  assert.equal(result.roleCount, 19);
  assert.equal(result.aclEntryCount, 25);
  assert.equal(result.publicAclRemovalCount, 8);
  assert.equal(result.projectedAclEntryCount, 17);
  assert.equal(result.effectiveEntryCount, 95);
  assert.deepEqual(result.sqlPreview, expectedSql);
  assert.deepEqual(
    result.groups.map((group) => [
      group.scope,
      group.separateApprovalRequired,
      group.sqlPreview.length,
    ]),
    [
      ["BUSINESS", true, 2],
      ["MAINTENANCE", true, 1],
      ["TEMPLATE", true, 2],
    ],
  );
  assert.equal(result.planOnly, true);
  assert.equal(result.consumerReviewRequired, true);
  assert.equal(result.publicConnectRetained, true);
  assert.equal(result.rolledBack, true);
  assert.ok(
    [
      result.committed,
      result.catalogStatementsExecuted,
      result.databaseWritten,
      result.businessDataWritten,
      result.serviceSwitched,
      result.admissionPassed,
      result.isolationPassed,
      result.changeAllowed,
    ].every((flag) => flag === false),
  );
});

void test("预测两个运行角色只能连接各自数据库，管理身份及模板连接标志保持不变", () => {
  const result = buildDockerRoleIsolationPlan(fixture(), identity, hash);
  assert.deepEqual(
    result.projected.map((row) => row.namedRoles.map((role) => role.connect)),
    [
      [true, true, false],
      [true, false, true],
      [true, false, false],
      [true, false, false],
      [true, false, false],
    ],
  );
  assert.ok(
    result.projected.every((row) =>
      row.namedRoles.every((role, i) => role.temporary === (i === 0) && role.create === (i === 0)),
    ),
  );
  assert.deepEqual(
    result.projected.map((row) => [row.connectLostRoleCount, row.temporaryLostRoleCount]),
    [
      [17, 18],
      [17, 18],
      [18, 18],
      [18, 0],
      [18, 0],
    ],
  );
  assert.equal(result.projected[2].currentAclSource, "DEFAULT");
  assert.equal(result.projected[2].projectedAclSource, "EXPLICIT");
  assert.equal(result.projected[3].allowConnections, false);
});

void test("目录顺序和瞬时连接数量不改变指纹，集群及候选角色标识改变则改变指纹", () => {
  const input = fixture();
  const first = buildDockerRoleIsolationPlan(input, identity, hash);
  for (const rows of [
    input.inventory.databases,
    input.inventory.roles,
    input.inventory.acl,
    input.inventory.effective,
    input.inventory.memberships,
    input.inventory.sessions,
  ])
    rows.reverse();
  input.inventory.sessions[0].total = 7;
  const second = buildDockerRoleIsolationPlan(input, identity, hash);
  assert.match(first.planFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(first.planFingerprint, second.planFingerprint);
  assert.notEqual(
    first.planFingerprint,
    buildDockerRoleIsolationPlan(input, { ...identity, systemIdentifier: "123456790" }, hash)
      .planFingerprint,
  );
  const next = JSON.parse(JSON.stringify(input).replaceAll('"24592"', '"24594"'));
  assert.notEqual(
    first.planFingerprint,
    buildDockerRoleIsolationPlan(next, identity, hash).planFingerprint,
  );
});

void test("未知消费者、权限漂移、额外角色和数据库及目录引用异常一律拒绝", () => {
  for (const change of [
    (report) => {
      report.rolledBack = false;
    },
    (report) => {
      report.inventory.unknownLoginRoleCount = 1;
    },
    (report) => {
      report.inventory.unknownDatabaseCount = 1;
    },
    (report) => {
      report.inventory.unresolvedSessionCount = 1;
    },
    (report) => {
      report.inventory.roles[1].login = true;
    },
    (report) => {
      report.inventory.roles.push({ ...report.inventory.roles[4], oid: "90000" });
    },
    (report) => {
      report.inventory.databases.push({
        ...report.inventory.databases[0],
        oid: "90000",
        name: null,
      });
    },
    (report) => {
      report.inventory.databases[2].defaultAcl = false;
    },
    (report) => {
      report.inventory.databases[3].allowConnections = true;
    },
    (report) => {
      report.inventory.acl[0].grantable = true;
    },
    (report) => {
      report.inventory.acl.pop();
    },
    (report) => {
      report.inventory.effective[1].create = true;
    },
    (report) => {
      report.inventory.effective[0] = report.inventory.effective[1];
    },
    (report) => {
      report.inventory.memberships[0].memberOid = "24592";
    },
    (report) => {
      report.inventory.sessions[0].roleOid = "24592";
    },
    (report) => {
      report.inventory.sessions[0].databaseOid = "4";
    },
    (report) => {
      report.inventory.sessions[0].total = 0;
    },
    (report) => {
      report.inventory.sessions[0].query = "模拟敏感正文";
    },
  ]) {
    const input = fixture();
    change(input);
    assert.throws(
      () => buildDockerRoleIsolationPlan(input, identity, hash),
      (error) => {
        assert.match(error.message, /基线不一致，禁止生成隔离预览/u);
        assert.doesNotMatch(error.message, /模拟敏感正文/u);
        return true;
      },
    );
  }
});

void test("拒绝非固定服务器版本、错误存储标记及无效集群标识", () => {
  assert.throws(
    () => buildDockerRoleIsolationPlan(fixture(), { ...identity, version: "190001" }, hash),
    /只读报告及集群基线不一致/u,
  );
  assert.throws(
    () =>
      buildDockerRoleIsolationPlan(
        fixture(),
        { ...identity, systemIdentifier: "模拟敏感标识" },
        hash,
      ),
    /只读报告及集群基线不一致/u,
  );
  assert.throws(
    () => buildDockerRoleIsolationPlan(fixture(), identity, "b".repeat(64)),
    /只读报告及集群基线不一致/u,
  );
});

void test("完整隔离后精确复核十七项授权与九十五项有效权限，保留原指纹", () => {
  const input = fixture();
  const original = buildDockerRoleIsolationPlan(input, identity, hash);
  const inventory = input.inventory;
  inventory.acl = inventory.acl.filter((row) => row.granteeOid !== "0");
  for (const database of inventory.databases) {
    database.publicConnect = false;
    database.publicTemporary = false;
    database.defaultAcl = false;
    database.aclEntryCount = inventory.acl.filter((row) => row.databaseOid === database.oid).length;
  }
  for (const row of inventory.effective) {
    row.connect = row.roleOid === "10" || (row.roleOid === "24592" && row.databaseOid === "16384") || (row.roleOid === "24593" && row.databaseOid === "16385");
    row.temporary = row.roleOid === "10";
  }
  const result = reviewDockerRoleIsolationInventory(inventory, identity, hash, true);
  assert.equal(result.planFingerprint, original.planFingerprint);
  assert.throws(() => reviewDockerRoleIsolationInventory(inventory, identity, hash, false), /基线不一致/u);
  for (const change of [
    (value) => { value.databases[2].defaultAcl = true; },
    (value) => { value.effective[1].connect = false; },
    (value) => { value.effective[2].connect = true; },
    (value) => { value.roles[1].login = true; },
    (value) => { value.acl.pop(); },
  ]) {
    const drift = structuredClone(inventory);
    change(drift);
    assert.throws(() => reviewDockerRoleIsolationInventory(drift, identity, hash, true), /基线不一致/u);
  }
});

function transactionFixture(mode, fault = "") {
  const input = fixture();
  const original = input.inventory;
  const isolated = structuredClone(original);
  isolated.acl = isolated.acl.filter((row) => row.granteeOid !== "0");
  for (const database of isolated.databases) {
    database.defaultAcl = false;
    database.publicConnect = false;
    database.publicTemporary = false;
    database.aclEntryCount = isolated.acl.filter((row) => row.databaseOid === database.oid).length;
  }
  for (const row of isolated.effective) {
    row.connect = row.roleOid === "10" || (row.roleOid === "24592" && row.databaseOid === "16384") || (row.roleOid === "24593" && row.databaseOid === "16385");
    row.temporary = row.roleOid === "10";
  }
  const fingerprint = buildDockerRoleIsolationPlan(input, identity, hash).planFingerprint;
  let revoked = fault === "isolated" ? 5 : 0;
  const calls = [];
  const db = { owner: true, ownerPrivileges: true, connect: true, create: true, temporary: true, publicConnect: revoked === 0 };
  const schema = { owner: false, ownerPrivileges: true, usage: true, create: true, publicCreate: false };
  const tables = (total) => Object.fromEntries(["total", "owner", "ownerPrivileges", "select", "insert", "update", "delete", "truncate", "references", "trigger", "maintain", "anyColumnSelect", "anyColumnInsert", "anyColumnUpdate", "anyColumnReferences"].map((key) => [key, total]));
  const sequences = { total: 0, owner: 0, ownerPrivileges: 0, usage: 0, select: 0, update: 0 };
  const report = {
    ...input, status: "DOCKER_DB_ROLE_REVIEW_READY",
    tables: 12, columns: 85, checks: 36, indexes: 20, foreignKeys: 13, comments: 119,
    role: { superuser: true, createDatabase: true, createRole: true, replication: true, bypassRls: true, login: true, inherit: true,
      scadaRuntimeExists: true, keycloakRuntimeExists: true, directMemberships: 0, reachableMemberships: 0, inheritedMemberships: 0, setRoleMemberships: 0 },
    databases: { adui_scada: { ...db }, adui_scada_keycloak: { ...db } },
    scada: { schemas: { public: schema, prisma_contract: { ...schema, owner: true } }, otherSchemas: 0, tables: tables(12), sequences, marker: { markerSelect: true, clusterFunctionExecute: true } },
    keycloak: { schemas: { public: schema }, otherSchemas: 0, tables: tables(101), sequences },
  };
  const allowedColumns = ["public.scada_projects.tenant_id", "public.scada_projects.project_id", "public.scada_projects.head_revision", "prisma_contract.marker.space", "prisma_contract.marker.core_hash"];
  const grant = (role, kind, object, privilege) => ({ role, kind, object, privilege, grantable: false });
  const candidateNames = names.slice(1, 3);
  const directAcl = [
    grant(candidateNames[0], "database", "adui_scada", "CONNECT"),
    grant(candidateNames[1], "database", "adui_scada_keycloak", "CONNECT"),
    grant(candidateNames[0], "schema", "public", "USAGE"),
    grant(candidateNames[0], "schema", "prisma_contract", "USAGE"),
    ...allowedColumns.map((column) => grant(candidateNames[0], "column", column, "SELECT")),
    grant(candidateNames[0], "function", "pg_catalog.pg_control_system()", "EXECUTE"),
  ];
  const client = {
    async connect() { calls.push("连接"); },
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("BEGIN")) return { command: "BEGIN" };
      if (sql === "COMMIT") {
        if (fault === "commit") throw new Error("模拟敏感异常");
        return { command: "COMMIT" };
      }
      if (sql === "ROLLBACK") {
        if (fault === "rollback") throw new Error("模拟敏感异常");
        return { command: "ROLLBACK" };
      }
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: fault !== "lock", isolation: "serializable" }] };
      if (expectedSql.includes(sql)) {
        if (fault === "statement" && revoked === 2) throw Object.assign(new Error("模拟敏感异常"), { code: "42501" });
        revoked++;
        return { command: "REVOKE" };
      }
      if (sql.includes("pg_catalog.pg_authid r")) return { rows: candidateNames.map((role) => ({ role, hardened: true, noMemberships: true, noSettings: true, noUnexpectedDependencies: true })) };
      if (sql.includes("entries AS")) return { rows: directAcl };
      if (sql.includes("relations AS")) return { rows: candidateNames.map((role, index) => ({ role, noDatabaseCreate: true, noSchemaCreate: true, noTableOrColumnWrites: true, noSequencePrivileges: true, businessConnect: revoked !== 5 || index === 0, keycloakConnect: revoked !== 5 || index === 1 })) };
      if (sql.includes("has_column_privilege")) return { rows: allowedColumns.map((object) => ({ role: candidateNames[0], object })) };
      if (sql.startsWith("SET LOCAL ROLE")) return { command: "SET" };
      if (sql.includes("session_user::text")) return { rows: [{ role: candidateNames[0], sessionRole: names[0], database: "adui_scada", systemIdentifier: identity.systemIdentifier, storageHash: hash }] };
      if (sql.startsWith("SELECT tenant_id")) return { rows: [] };
      const current = revoked === 5 ? isolated : original;
      if (sql.startsWith("SELECT d.oid::text AS oid")) return { rows: current.databases.map(({ publicConnect, publicTemporary, publicCreate, ...row }) => row) };
      if (sql.startsWith("SELECT r.oid::text AS oid")) return { rows: current.roles };
      if (sql.includes("a.grantor::text AS")) return { rows: current.acl };
      if (sql.includes("CROSS JOIN pg_catalog.pg_roles")) return { rows: fault === "projection" && revoked === 5 ? current.effective.slice(1) : current.effective };
      if (sql.startsWith("SELECT m.roleid::text")) return { rows: current.memberships };
      if (sql.startsWith("SELECT a.datid::text")) return { rows: current.sessions };
      throw new Error("模拟未知查询");
    },
    async end() { calls.push("关闭"); if (fault === "close") throw new Error("模拟敏感异常"); },
  };
  const options = {
    mode, report, identity, storageHash: hash,
    expectedFingerprint: fault === "fingerprint" ? "b".repeat(64) : fingerprint,
    createClient: () => client,
    readDirectory: async () => ({
      role: report.role,
      databases: { adui_scada: { ...db, publicConnect: revoked !== 5 }, adui_scada_keycloak: { ...db, publicConnect: revoked !== 5 } },
      scada: report.scada,
    }),
  };
  return { options, calls };
}

void test("隔离演练和正式提交仅执行五条固定语句，并完整核验投影", async () => {
  for (const mode of ["rehearse", "apply"]) {
    const { options, calls } = transactionFixture(mode);
    const result = await runDockerRoleIsolationTransaction(options);
    assert.deepEqual(calls.filter((sql) => expectedSql.includes(sql)), expectedSql);
    assert.equal(result.catalogIsolationVerified, true);
    assert.equal(result.catalogIsolationPersisted, mode === "apply");
    assert.equal(result.committed, mode === "apply");
    assert.equal(result.rolledBack, mode === "rehearse");
    assert.equal(result.businessDataWritten, false);
    assert.equal(result.isolationPassed, false);
    assert.equal(result.admissionPassed, false);
    assert.deepEqual(calls.slice(-2), [mode === "apply" ? "COMMIT" : "ROLLBACK", "关闭"]);
  }
});

void test("独立状态查询只读识别完整隔离前后，绝不执行写入", async () => {
  for (const fault of ["", "isolated"]) {
    const { options, calls } = transactionFixture("status", fault);
    const result = await runDockerRoleIsolationTransaction(options);
    assert.equal(result.catalogIsolationPersisted, fault === "isolated");
    assert.equal(result.publicConnectRetained, fault !== "isolated");
    assert.equal(result.catalogStatementsExecuted, false);
    assert.equal(calls.some((sql) => expectedSql.includes(sql)), false);
    assert.ok(calls.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
  }
});

void test("锁、指纹、语句与投影失败均回滚且不提交", async () => {
  for (const fault of ["lock", "fingerprint", "statement", "projection"]) {
    const { options, calls } = transactionFixture("apply", fault);
    await assert.rejects(() => runDockerRoleIsolationTransaction(options), (error) => {
      assert.match(error.message, /事务已确认回滚/u);
      assert.doesNotMatch(error.message, /模拟敏感/u);
      return true;
    });
    assert.equal(calls.includes("COMMIT"), false);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
    if (fault === "lock" || fault === "fingerprint") assert.equal(calls.some((sql) => expectedSql.includes(sql)), false);
  }
});

void test("提交结果未知、回滚或关闭未确认禁止报告成功和自动重试", async () => {
  for (const fault of ["commit", "rollback", "close"]) {
    const { options, calls } = transactionFixture(fault === "commit" ? "apply" : "rehearse", fault);
    await assert.rejects(() => runDockerRoleIsolationTransaction(options), (error) => {
      assert.match(error.message, fault === "commit" ? /提交结果未知，禁止重试/u : fault === "rollback" ? /回滚未确认/u : /连接关闭失败/u);
      assert.doesNotMatch(error.message, /模拟敏感/u);
      return true;
    });
    if (fault === "commit") assert.equal(calls.includes("ROLLBACK"), false);
    assert.equal(calls.filter((sql) => sql === "COMMIT").length, fault === "commit" ? 1 : 0);
  }
});
