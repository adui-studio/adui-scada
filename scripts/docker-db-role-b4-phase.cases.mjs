import assert from "node:assert/strict";
import { test } from "node:test";
import { buildB4KeycloakDependencyScope, verifyB4KeycloakDependencyScope } from "./docker-db-role-b4-phase.mjs";

const ids = Array.from({ length: 101 }, (_, index) => String(10000 + index));
const systemIdentifier = "123456789";
const fixture = () => buildB4KeycloakDependencyScope(ids, systemIdentifier);

void test("跨阶段共享依赖仅限定固定 Keycloak 库、角色及已评审普通表标识", () => {
  const scope = fixture();
  assert.deepEqual(buildB4KeycloakDependencyScope([...ids].reverse(), systemIdentifier), scope);
  assert.equal(scope.expected.length, 101);
  assert.match(scope.allowedDependency, /r\.rolname = 'adui_scada_keycloak_runtime'/u);
  assert.match(scope.sql, /^SELECT /u);
  assert.match(scope.sql, /d\.dbid = \(SELECT oid FROM pg_catalog\.pg_database WHERE datname = 'adui_scada_keycloak'\)/u);
  assert.match(scope.sql, /d\.classid = 'pg_catalog\.pg_class'::regclass/u);
  assert.match(scope.sql, /d\.objsubid = 0 AND d\.deptype = 'o'/u);
  assert.equal([...scope.sql.matchAll(/\d+::oid/gu)].length, 101);
  assert.ok(ids.every((id) => scope.sql.includes(id + "::oid")));
  assert.doesNotMatch(scope.sql, /^(ALTER|GRANT|REVOKE|DELETE|UPDATE|INSERT) /u);
});

void test("拒绝数量、重复、非规范 OID、超范围 OID、注入及无效集群标识", () => {
  const sparse = ids.slice(1);
  sparse.length = 101;
  for (const invalid of [null, ids.slice(1), sparse, [...ids, "123"], [ids[1], ...ids.slice(1)],
    ...["0", "01", "-1", "4294967296", "1; SELECT 1", 123, null].map((id) => [id, ...ids.slice(1)])]) {
    assert.throws(() => buildB4KeycloakDependencyScope(invalid, systemIdentifier), { message: "B4 跨阶段所有权投影标识无效" });
  }
  for (const invalid of [null, "0", "01", "1; SELECT 1", "123456789012345678901"]) {
    assert.throws(() => buildB4KeycloakDependencyScope(ids, invalid), { message: "B4 跨阶段所有权投影标识无效" });
  }
});

void test("依赖读取顺序不影响核验，缺失重复、对象替换和集群漂移全部拒绝", () => {
  const scope = fixture();
  assert.doesNotThrow(() => verifyB4KeycloakDependencyScope([...scope.expected].reverse(), scope));
  for (const rows of [null, scope.expected.slice(1), [...scope.expected, scope.expected[0]],
    [scope.expected[1], ...scope.expected.slice(1)],
    [{ ...scope.expected[0], objectId: "999" }, ...scope.expected.slice(1)],
    [{ ...scope.expected[0], systemIdentifier: "987" }, ...scope.expected.slice(1)],
    [{ ...scope.expected[0], extra: true }, ...scope.expected.slice(1)]]) {
    assert.throws(() => verifyB4KeycloakDependencyScope(rows, scope), { message: "B4 跨阶段 Keycloak 共享所有权依赖不一致" });
  }
});
