import assert from "node:assert/strict";
import { test } from "node:test";
import { readDockerRoleObjectInventory } from "./docker-db-role-object-review.mjs";

function fixture() {
  const roles = ["adui_scada", "adui_scada_runtime", "adui_scada_keycloak_runtime", "pg_database_owner"]
    .map((name, index) => ({ name, oid: String(index + 10) }));
  const objects = [
    { kind: "schema", id: "100", owner: "13", evidence: ["public", null] },
    { kind: "relation", id: "101", owner: "10", evidence: ["public", "模拟内部对象", "r", null, false, false] },
    { kind: "columnAcl", id: "101:1", owner: "10", evidence: ["public", "模拟内部对象", "id", "模拟内部授权"] },
    { kind: "routine", id: "102", owner: "900", evidence: ["public", "模拟内部函数", "f", null, true] },
  ];
  const dependencies = [
    { classOid: "1259", objectOid: "101", subId: 0, roleOid: "10", kind: "o" },
    { classOid: "1255", objectOid: "102", subId: 0, roleOid: "900", kind: "o" },
  ];
  return [roles, objects, dependencies];
}

async function inspect(data) {
  let index = 0;
  const calls = [];
  const result = await readDockerRoleObjectInventory(async (step, sql) => {
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
  assert.equal(report.unknownDependencyRoleCount, 1);
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
  ]) {
    const data = fixture();
    change(data);
    await assert.rejects(() => inspect(data), /目录证据缺失或形状不一致/u);
  }
});
