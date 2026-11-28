import assert from "node:assert/strict";
import { test } from "node:test";
import { readDockerIsolationDirectory, b4OwnerRoles } from "./docker-db-role-isolation.mjs";

function fixture() {
  const db = ["adui_scada", "adui_scada_keycloak", "postgres", "template0", "template1", null].map(
    (name, index) => ({
      oid: String(index + 1),
      name,
      ownerOid: "10",
      allowConnections: index !== 3,
      template: index === 3 || index === 4,
      connectionLimit: -1,
      defaultAcl: index > 1,
      aclEntryCount: 2,
    }),
  );
  const roles = [
    "adui_scada",
    "adui_scada_runtime",
    "adui_scada_keycloak_runtime",
    "pg_database_owner",
    null,
  ].map((name, index) => ({
    oid: String(index + 10),
    name,
    login: index === 0 || index === 4,
    superuser: index === 0,
    inherit: index === 0,
  }));
  const acl = db.flatMap((row) =>
    ["CONNECT", "TEMPORARY"].map((privilege) => ({
      databaseOid: row.oid,
      grantorOid: "10",
      granteeOid: "0",
      privilege,
      grantable: false,
    })),
  );
  const effective = db.flatMap((row) =>
    roles.map((role) => ({
      databaseOid: row.oid,
      roleOid: role.oid,
      connect: true,
      temporary: true,
      create: role.superuser,
    })),
  );
  const memberships = [
    {
      roleOid: "14",
      memberOid: "10",
      grantorOid: "10",
      admin: false,
      inherit: true,
      setRole: false,
    },
  ];
  const sessions = [
    { databaseOid: "1", roleOid: "10", total: 2 },
    { databaseOid: "6", roleOid: "14", total: 1 },
  ];
  return [db, roles, acl, effective, memberships, sessions];
}

function mock(rows) {
  const calls = [];
  return {
    calls,
    query: async (step, sql) => {
      calls.push({ step, sql });
      return { rows: rows[calls.length - 1] };
    },
  };
}

void test("全集群核查保留模板库、禁止连接库、未知库和所有角色权限", async () => {
  const { calls, query } = mock(fixture());
  const report = await readDockerIsolationDirectory(query);
  assert.equal(report.databases.length, 6);
  assert.equal(report.databases.find((row) => row.name === "template0").allowConnections, false);
  assert.equal(report.databases.find((row) => row.name === "postgres").defaultAcl, true);
  assert.equal(report.databases[0].defaultAcl, false);
  assert.ok(
    report.databases.every((row) => row.publicConnect && row.publicTemporary && !row.publicCreate),
  );
  assert.equal(report.effective.length, 30);
  assert.equal(report.unknownLoginRoleCount, 1);
  assert.equal(report.unknownDatabaseCount, 1);
  assert.equal(report.unresolvedSessionCount, 1);
  assert.equal(report.consumerReviewRequired, true);
  assert.equal(report.changeAllowed, false);
  assert.equal(report.isolationPassed, false);
  assert.equal(calls.length, 6);
  assert.ok(calls.every(({ sql }) => sql.startsWith("SELECT ")));
  assert.match(
    calls[2].sql,
    /aclexplode\(coalesce\(d\.datacl, pg_catalog\.acldefault\('d', d\.datdba\)\)\)/u,
  );
  assert.match(calls[3].sql, /CROSS JOIN pg_catalog\.pg_roles/u);
  assert.doesNotMatch(calls[5].sql, /client_addr|application_name|a\.query/u);
});

void test("缺失固定对象、重复标识、外部所有者和不完整矩阵均拒绝", async () => {
  for (const change of [
    (rows) => rows[0].shift(),
    (rows) => rows[1].push(rows[1][0]),
    (rows) => {
      rows[0][0].ownerOid = "999";
    },
    (rows) => rows[2].pop(),
    (rows) => rows[3].pop(),
    (rows) => {
      rows[3][0] = rows[3][1];
    },
    (rows) => {
      rows[2][0].granteeOid = "999";
    },
    (rows) => {
      rows[4][0].memberOid = "999";
    },
  ]) {
    const rows = fixture();
    change(rows);
    await assert.rejects(readDockerIsolationDirectory(mock(rows).query), /目录证据不完整或不一致/u);
  }
});

void test("未知名称、额外字段和非布尔权限不得进入报告或异常正文", async () => {
  for (const change of [
    (rows) => {
      rows[0][5].name = "模拟敏感名称";
    },
    (rows) => {
      rows[1][4].name = "模拟敏感名称";
    },
    (rows) => {
      rows[5][0].query = "模拟敏感正文";
    },
    (rows) => {
      rows[3][0].connect = "true";
    },
  ]) {
    const rows = fixture();
    change(rows);
    await assert.rejects(readDockerIsolationDirectory(mock(rows).query), (error) => {
      assert.match(error.message, /目录证据不完整或不一致/u);
      assert.doesNotMatch(error.message, /模拟敏感/u);
      return true;
    });
  }
});

void test("显式空 ACL 不按默认授权处理，无法归属的会话计入待核查", async () => {
  const rows = fixture();
  rows[2] = rows[2].filter((row) => row.databaseOid !== "1");
  rows[0][0].aclEntryCount = 0;
  rows[5].push({ databaseOid: null, roleOid: null, total: 3 });
  const report = await readDockerIsolationDirectory(mock(rows).query);
  assert.equal(report.databases[0].defaultAcl, false);
  assert.equal(report.databases[0].publicConnect, false);
  assert.equal(report.databases[0].publicTemporary, false);
  assert.equal(report.unresolvedSessionCount, 4);
  assert.equal(report.changeAllowed, false);
});

void test("安装后读取仅新增三个固定所有者的标签，原读取仍拒绝额外已命名角色", async () => {
  const rows = fixture();
  const added = b4OwnerRoles.map((name, index) => ({ oid: String(90000 + index), name, login: false, superuser: false, inherit: false }));
  rows[1].push(...added);
  rows[3].push(...rows[0].flatMap((db) => added.map((role) => ({
    databaseOid: db.oid, roleOid: role.oid, connect: false, temporary: false, create: false,
  }))));
  const h = mock(rows);
  const report = await readDockerIsolationDirectory(h.query, "b4-installed");
  assert.equal(report.roles.length, 8);
  assert.ok(b4OwnerRoles.every((name) => h.calls[1].sql.includes("'" + name + "'")));
  await assert.rejects(readDockerIsolationDirectory(mock(rows).query), /目录证据不完整或不一致/u);
  await assert.rejects(readDockerIsolationDirectory(mock(rows).query, "unknown"), /目录阶段/u);
});
