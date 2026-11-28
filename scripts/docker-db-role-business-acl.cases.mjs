import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  buildScadaBusinessAclPreview,
  readScadaBusinessAclPreview,
  scadaBusinessColumnInventory,
} from "./docker-db-role-business-acl.mjs";

const runtime = "adui_scada_runtime";
const keycloak = "adui_scada_keycloak_runtime";
const startupColumns = ["tenant_id", "project_id", "head_revision"];

function fixture() {
  return scadaBusinessColumnInventory().flatMap((entry) =>
    [runtime, keycloak].flatMap((role) =>
      entry.columns.map((column) => ({
        role, table: entry.table, column, kind: "r",
        owner: false, tableAccess: false,
        select: role === runtime && entry.table === "scada_projects" && startupColumns.includes(column),
        insert: false, update: false, references: false, grantable: false,
      })),
    ),
  );
}

void test("十二张表的固定列清单精确匹配原生契约八十五个物理字段", () => {
  const source = readFileSync(new URL("../apps/server/prisma/contract.prisma", import.meta.url), "utf8");
  const models = [...source.matchAll(/^model \w+ \{\r?\n([\s\S]*?)^\}/gmu)];
  const physical = models.map((model) => {
    const body = model[1];
    const name = body.match(/@@map\("([^"]+)"\)/u)?.[1];
    const columns = body.split(/\r?\n/u).flatMap((line) => {
      const field = line.match(/^\s+(\w+)\s+(?:String|BigInt|Int|Uuid|DateTime|Json)\b/u);
      return field ? [line.match(/@map\("([^"]+)"\)/u)?.[1] ?? field[1]] : [];
    });
    return { table: name, columns };
  });
  assert.deepEqual(scadaBusinessColumnInventory(), physical);
  assert.equal(physical.length, 12);
  assert.equal(physical.reduce((total, entry) => total + entry.columns.length, 0), 85);
});

void test("完整基线产生确定性列级候选，排除既有三项启动读权", () => {
  const data = fixture();
  const result = buildScadaBusinessAclPreview(data);
  assert.deepEqual(result, buildScadaBusinessAclPreview([...data].reverse()));
  assert.equal(result.tableCount, 12);
  assert.equal(result.columnCount, 85);
  assert.equal(result.effectiveColumnCount, 170);
  assert.equal(result.baselineSelectCount, 3);
  assert.deepEqual(result.grants.find((grant) => grant.table === "scada_projects" && grant.privilege === "SELECT")?.columns,
    ["created_at", "updated_at"]);
  assert.match(result.planFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(result.planOnly, true);
  assert.equal(result.businessAclApproved, false);
  assert.equal(result.admissionPassed, false);
  assert.equal(result.databaseWritten, false);
});

void test("直接更新仅限四个业务列，禁止身份、权限、快照、审计及正式发布写入", () => {
  const { grants, blockedOperations } = buildScadaBusinessAclPreview(fixture());
  assert.deepEqual(grants.filter((grant) => grant.privilege === "UPDATE").map((grant) => [grant.table, grant.columns]), [
    ["scada_projects", ["head_revision", "updated_at"]],
    ["scada_auth_sessions", ["revoked_at"]],
    ["scada_oidc_transactions", ["consumed_at"]],
  ]);
  const protectedTables = ["scada_identities", "scada_external_identities", "scada_project_grants", "scada_project_release_state", "scada_project_release_events"];
  assert.ok(grants.filter((grant) => protectedTables.includes(grant.table)).every((grant) => grant.privilege === "SELECT"));
  assert.ok(grants.every((grant) => /^GRANT (SELECT|INSERT|UPDATE) \([a-z_, ]+\) ON TABLE public\.scada_[a-z_]+ TO adui_scada_runtime$/u.test(grant.sql)));
  assert.equal(blockedOperations.filter((operation) => operation.operation === "ROW_LOCK").length, 5);
  assert.equal(blockedOperations.filter((operation) => operation.operation !== "ROW_LOCK").length, 3);
});

void test("实际读取仅发送固定目录 SELECT，并保护类型专用权限函数", async () => {
  let calls = 0;
  const report = await readScadaBusinessAclPreview(async (_step, sql) => {
    calls += 1;
    assert.match(sql, /^SELECT /u);
    assert.match(sql, /pg_catalog\.pg_attribute/u);
    assert.match(sql, /r\.rolname IN \('adui_scada_runtime','adui_scada_keycloak_runtime'\)/u);
    assert.equal((sql.match(/CASE WHEN c\.relkind IN \('r','p'\) THEN pg_catalog\.has_(?:column|table)_privilege/gu) ?? []).length, 6);
    return { rows: fixture() };
  });
  assert.equal(calls, 1);
  assert.equal(report.rowLockVerified, false);
  assert.equal(report.rowAuthorizationVerified, false);
});

void test("缺行、重复、额外列、未知角色及任一权限漂移均拒绝且不回显目录值", () => {
  for (const change of [
    (rows) => rows.pop(),
    (rows) => { rows[1] = rows[0]; },
    (rows) => { rows[0].column = "模拟敏感列"; },
    (rows) => { rows[0].role = "模拟敏感角色"; },
    (rows) => { rows[0].select = false; },
    (rows) => { rows.find((row) => row.role === keycloak).select = true; },
    (rows) => { rows[0].owner = true; },
    (rows) => { rows[0].tableAccess = true; },
    (rows) => { rows[0].insert = true; },
    (rows) => { rows[0].update = true; },
    (rows) => { rows[0].references = true; },
    (rows) => { rows[0].grantable = true; },
    (rows) => { rows[0].kind = "p"; },
    (rows) => { rows[0].select = "true"; },
    (rows) => { rows[0].unexpected = "模拟敏感属性"; },
  ]) {
    const rows = fixture();
    change(rows);
    assert.throws(() => buildScadaBusinessAclPreview(rows), {
      name: "Error",
      message: "业务列权限与固定准备基线不一致，禁止生成授权候选",
    });
  }
});
