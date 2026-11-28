import assert from "node:assert/strict";
import { test } from "node:test";
import { readDockerRoleObjectInventory } from "./docker-db-role-object-review.mjs";

function fixture() {
  const roles = ["adui_scada", "adui_scada_runtime", "adui_scada_keycloak_runtime", "pg_database_owner"]
    .map((name, index) => ({
      name, oid: String(index + 10),
      login: index === 0, superuser: index === 0,
      createDatabase: index === 0, createRole: index === 0,
      replication: index === 0, bypassRls: index === 0, inherit: index !== 1 && index !== 2,
    }));
  const objects = [
    { kind: "schema", id: "100", owner: "13", evidence: ["public", null] },
    { kind: "relation", id: "101", owner: "10", evidence: ["public", "模拟内部对象", "r", null, false, false] },
    { kind: "columnAcl", id: "101:1", owner: "10", evidence: ["public", "模拟内部对象", "id", "模拟内部授权"] },
    { kind: "routine", id: "102", owner: "900", evidence: ["public", "模拟内部函数", "f", null, true, ["search_path=pg_catalog, public, pg_temp", "row_security=on"]] },
  ];
  const dependencies = [
    { databaseOid: "16384", databaseScope: "CURRENT_DATABASE", classOid: "1259", objectOid: "101", subId: 0, roleOid: "10", kind: "o" },
    { databaseOid: "0", databaseScope: "SHARED", classOid: "1260", objectOid: "10", subId: 0, roleOid: "10", kind: "a" },
  ];
  return [roles, objects, dependencies];
}

async function inspect(data) {
  let index = 0;
  const calls = [];
  const result = await readDockerRoleObjectInventory(async (_step, sql) => {
    calls.push(sql);
    return { rows: data[index++] };
  });
  assert.equal(index, 3);
  assert.ok(calls.every((sql) => /^(SELECT|WITH) /u.test(sql)));
  assert.ok(calls.every((sql) => !/rolpassword|subconninfo|srvoptions/u.test(sql)));
  return result;
}

void test("双库对象清单仅报告聚合所有权、依赖数量及指纹，不输出内部对象和授权", async () => {
  const report = await inspect(fixture());
  assert.equal(report.objectCount, 4);
  assert.equal(report.dependencyCount, 2);
  assert.equal(report.unknownOwnerCount, 1);
  assert.equal(report.unknownDependencyRoleCount, 0);
  assert.equal(report.securityDefinerRoutineCount, 1);
  assert.equal(report.definerConfigMatchedCount, 1);
  assert.equal(report.definerSafetyVerified, false);
  assert.equal(report.lockOwnerOwnedRoutineCount, 0);
  assert.equal(report.dependencyOwners.find((row) => row.role === "adui_scada")?.ownership, 1);
  assert.equal(report.dependencyOwners.find((row) => row.role === "adui_scada")?.shared, 1);
  assert.equal(report.ownershipTransferAllowed, false);
  assert.equal(report.businessAclApproved, false);
  assert.match(report.catalogFingerprint, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(report), /模拟内部/u);
});

void test("对象或授权漂移改变指纹，目录行顺序不改变指纹", async () => {
  const source = fixture();
  const original = await inspect(source);
  for (const rows of source) rows.reverse();
  assert.equal((await inspect(source)).catalogFingerprint, original.catalogFingerprint);
  source[1][1].evidence[3] = "模拟其他授权";
  assert.notEqual((await inspect(source)).catalogFingerprint, original.catalogFingerprint);
});

void test("未知对象类型、重复标识、缺少固定角色及不完整证据均拒绝", async () => {
  for (const change of [
    (rows) => { rows[0].pop(); },
    (rows) => { rows[1].push(rows[1][0]); },
    (rows) => { rows[1][1].kind = "unknown"; },
    (rows) => { rows[1][1].evidence.pop(); },
    (rows) => { rows[2].push(rows[2][0]); },
    (rows) => { rows[2][0].databaseOid = "0"; },
    (rows) => { rows[2][0].databaseScope = "SHARED"; },
  ]) {
    const data = fixture();
    change(data);
    await assert.rejects(() => inspect(data), /目录证据缺失或形状不一致/u);
  }
});

void test("空共享角色依赖清单可正常报告，但不构成权限审批", async () => {
  const data = fixture();
  data[2] = [];
  const report = await inspect(data);
  assert.equal(report.dependencyCount, 0);
  assert.equal(report.ownershipTransferAllowed, false);
  assert.equal(report.businessAclApproved, false);
});

void test("跨数据库及集群共享依赖均纳入同一指纹与角色汇总", async () => {
  const data = fixture();
  data[2] = [
    { databaseOid: "0", databaseScope: "SHARED", classOid: "1260", objectOid: "10", subId: 0, roleOid: "10", kind: "o" },
    { databaseOid: "16384", databaseScope: "CURRENT_DATABASE", classOid: "1259", objectOid: "101", subId: 0, roleOid: "10", kind: "a" },
    { databaseOid: "16385", databaseScope: "OTHER_DATABASE", classOid: "1259", objectOid: "201", subId: 0, roleOid: "10", kind: "i" },
  ];
  const report = await inspect(data);
  const admin = report.dependencyOwners.find((row) => row.role === "adui_scada");
  assert.equal(report.dependencyCount, 3);
  assert.equal(admin?.ownership, 1);
  assert.equal(admin?.acl, 1);
  assert.equal(admin?.initialAcl, 1);
  assert.equal(admin?.shared, 1);
  assert.equal(admin?.currentDatabase, 1);
  assert.equal(admin?.otherDatabases, 1);
  assert.doesNotMatch(JSON.stringify(report), /16384|16385|1259|1260/);
});

void test("已有锁角色必须以固定 NOLOGIN 属性显式呈现，异常属性不能隐藏", async () => {
  const data = fixture();
  data[0].push({
    oid: "14", name: "adui_scada_lock_owner", login: false, superuser: false,
    createDatabase: false, createRole: false, replication: false, bypassRls: false, inherit: false,
  });
  const report = await inspect(data);
  assert.equal(report.roles.find((row) => row.name === "adui_scada_lock_owner")?.login, false);
  const bad = fixture();
  bad[0].push({ ...data[0].at(-1), login: true });
  await assert.rejects(() => inspect(bad), /目录证据缺失或形状不一致/u);
});

void test("例程设置接受合法数组或空值，临时 Schema 未置末尾不能匹配安全配置", async () => {
  for (const setting of [null, ["search_path=pg_catalog, public", "row_security=on"], ["search_path=pg_catalog, public, pg_temp", "row_security=on", "statement_timeout=0"]]) {
    const data = fixture();
    data[1][3].evidence[5] = setting;
    const report = await inspect(data);
    assert.equal(report.definerConfigMatchedCount, 0);
    assert.equal(report.definerSafetyVerified, false);
  }
  const invalid = fixture();
  invalid[1][3].evidence[5] = [false];
  await assert.rejects(() => inspect(invalid), /目录证据缺失或形状不一致/u);
});
