import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildScadaB4PermissionExpectations,
  DockerB4PermissionReviewError,
  verifyScadaB4InstalledPermissions,
  verifyScadaB4InstalledCatalog,
} from "./docker-db-role-b4-permission-review.mjs";
import { scadaBusinessGrantCandidates } from "./docker-db-role-business-acl.mjs";
import { buildScadaB4RoutineExpectations } from "./docker-db-role-b4-routine-review.mjs";

const port = "18443";
const runtime = "adui_scada_runtime";
const keycloak = "adui_scada_keycloak_runtime";
const lockOwner = "adui_scada_lock_owner";
const projectOwner = "adui_scada_project_create_owner";
const cleanupOwner = "adui_scada_oidc_cleanup_owner";
const fixture = () => buildScadaB4PermissionExpectations(port);

async function inspect(evidence, calls = []) {
  const groups = [
    evidence.roles,
    evidence.databases,
    evidence.acl,
    evidence.relations,
    evidence.columns,
  ];
  return verifyScadaB4InstalledPermissions(async (step, sql) => {
    calls.push({ step, sql });
    return { rows: groups[calls.length - 1] };
  }, port);
}

void test("五个角色覆盖五库、十二张业务表及八十五个物理列，保留启动标记读权", () => {
  const evidence = fixture();
  assert.deepEqual(
    evidence.roles.map(({ role }) => role),
    [runtime, keycloak, lockOwner, projectOwner, cleanupOwner],
  );
  assert.equal(evidence.databases.length, 25);
  assert.equal(evidence.relations.length, 60);
  assert.equal(evidence.columns.length, 427);
  assert.equal(evidence.columns.filter((row) => row.schema === "public").length, 425);
  assert.deepEqual(
    evidence.columns
      .filter((row) => row.schema !== "public")
      .map(({ role, table, column, privileges }) => [role, table, column, privileges]),
    [
      [runtime, "marker", "space", ["SELECT"]],
      [runtime, "marker", "core_hash", ["SELECT"]],
    ],
  );
  assert.deepEqual(
    evidence.databases.filter((row) => row.connect).map(({ role, database }) => [role, database]),
    [
      [runtime, "adui_scada"],
      [keycloak, "adui_scada_keycloak"],
    ],
  );
  assert.ok(evidence.databases.every((row) => !row.create && !row.temporary && !row.grantable));
  assert.equal(evidence.acl.length, 205);
  assert.deepEqual(
    evidence.roles.map(({ role }) => evidence.acl.filter((row) => row.role === role).length),
    [127, 1, 43, 29, 5],
  );
  assert.ok(evidence.acl.every((row) => row.ownerGrant && !row.grantable));
});

void test("实际授权候选与预期列权一一对应，专用角色不能扩大职责", () => {
  const { acl, columns, relations } = fixture();
  assert.equal(scadaBusinessGrantCandidates().length, 21);
  const runtimePublic = acl.filter(
    (row) => row.role === runtime && row.kind === "column" && row.object.startsWith("public."),
  );
  for (const item of scadaBusinessGrantCandidates()) {
    for (const column of item.columns) {
      assert.ok(
        runtimePublic.some(
          (row) =>
            row.object === "public." + item.table + "." + column &&
            row.privilege === item.privilege,
        ),
      );
    }
  }
  assert.equal(runtimePublic.filter((row) => row.privilege === "SELECT").length, 75);
  assert.equal(runtimePublic.filter((row) => row.privilege === "INSERT").length, 42);
  assert.deepEqual(
    runtimePublic.filter((row) => row.privilege === "UPDATE").map((row) => row.object),
    [
      "public.scada_projects.head_revision",
      "public.scada_projects.updated_at",
      "public.scada_auth_sessions.revoked_at",
      "public.scada_oidc_transactions.consumed_at",
    ],
  );
  assert.equal(acl.filter((row) => row.role === lockOwner && row.privilege === "UPDATE").length, 6);
  assert.equal(
    acl.filter((row) => row.role === projectOwner && row.privilege === "INSERT").length,
    26,
  );
  assert.ok(
    acl
      .filter((row) => row.role === lockOwner)
      .every((row) => ["USAGE", "SELECT", "UPDATE"].includes(row.privilege)),
  );
  assert.ok(
    acl
      .filter((row) => row.role === projectOwner)
      .every((row) => ["USAGE", "SELECT", "INSERT"].includes(row.privilege)),
  );
  assert.deepEqual(
    relations.filter((row) => row.privileges.length > 0),
    [
      {
        role: cleanupOwner,
        schema: "public",
        table: "scada_oidc_transactions",
        kind: "r",
        owner: false,
        privileges: ["DELETE"],
        grantable: false,
      },
    ],
  );
  assert.deepEqual(
    columns
      .filter((row) => row.role === cleanupOwner && row.privileges.length > 0)
      .map(({ table, column, privileges }) => [table, column, privileges]),
    [
      ["scada_oidc_transactions", "state_hash", ["SELECT"]],
      ["scada_oidc_transactions", "issuer", ["SELECT"]],
      ["scada_oidc_transactions", "expires_at", ["SELECT"]],
    ],
  );
  assert.ok(
    columns.filter((row) => row.role === keycloak).every((row) => row.privileges.length === 0),
  );
});

void test("精确矩阵与读取顺序无关且结果保持未准入", async () => {
  const first = fixture();
  const report = await inspect(first);
  for (const rows of Object.values(first)) rows.reverse();
  assert.deepEqual(await inspect(first), report);
  assert.equal(report.roleCount, 5);
  assert.equal(report.directAclCount, 205);
  assert.equal(report.columnPermissionCount, 427);
  assert.equal(report.permissionCatalogMatched, true);
  assert.match(report.catalogFingerprint, /^[a-f0-9]{64}$/u);
  for (const flag of [
    "businessAclApproved",
    "definerSafetyVerified",
    "rowAuthorizationVerified",
    "admissionPassed",
    "databaseWritten",
  ]) {
    assert.equal(report[flag], false);
  }
  assert.doesNotMatch(JSON.stringify(report), /adui_scada|scada_projects|SELECT /u);
  first.acl.pop();
  assert.equal(fixture().acl.length, 205);
});

void test("角色属性、成员、对象依赖及模式信任任一漂移立即拒绝", async () => {
  const flags = Object.keys(fixture().roles[0]).filter((key) => key !== "role");
  for (const flag of flags) {
    const evidence = fixture();
    evidence.roles[0][flag] = !evidence.roles[0][flag];
    const calls = [];
    await assert.rejects(() => inspect(evidence, calls), {
      name: "Error",
      message: "B4 安装后专用角色属性及依赖不一致；" + runtime + "：" + flag,
    });
    assert.equal(calls.length, 1);
  }
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => {
      rows[1] = rows[0];
    },
    (rows) => {
      rows[0].role = "模拟敏感角色";
    },
    (rows) => {
      rows[0].hardened = "true";
    },
    (rows) => {
      rows[0].extra = true;
    },
  ]) {
    const evidence = fixture();
    mutate(evidence.roles);
    await assert.rejects(() => inspect(evidence), DockerB4PermissionReviewError);
  }
});

void test("角色差异诊断仅输出固定角色和字段，未知目录值始终脱敏", async () => {
  const evidence = fixture();
  evidence.roles[0].noUnexpectedDependencies = false;
  evidence.roles[0].markerUsage = "模拟敏感值";
  delete evidence.roles[2].hardened;
  evidence.roles[2]["模拟敏感字段"] = "模拟敏感值";
  evidence.roles[3].role = "模拟敏感角色";
  evidence.roles.push(evidence.roles[4]);
  const calls = [];
  await assert.rejects(() => inspect(evidence, calls), {
    message:
      "B4 安装后专用角色属性及依赖不一致；" +
      runtime +
      "：noUnexpectedDependencies、markerUsage；" +
      lockOwner +
      "：hardened、额外字段；" +
      projectOwner +
      "：角色行缺失或重复；" +
      cleanupOwner +
      "：角色行缺失或重复；存在未知或无效角色行",
  });
  assert.equal(calls.length, 1);
  for (const rows of [null, {}, [null, ...fixture().roles]]) {
    const invalid = fixture();
    invalid.roles = rows;
    await assert.rejects(
      () => inspect(invalid),
      /B4 安装后专用角色属性及依赖不一致；(?:目录行结构无效|存在未知或无效角色行)/u,
    );
  }
});

void test("跨库连接、额外数据库及数据库创建临时权限均拒绝", async () => {
  for (const mutate of [
    (rows) => {
      rows.find((row) => row.role === runtime && row.database === "adui_scada_keycloak").connect =
        true;
    },
    (rows) => {
      rows.find((row) => row.role === lockOwner).connect = true;
    },
    (rows) => {
      rows[0].connect = false;
    },
    (rows) => {
      rows[0].temporary = true;
    },
    (rows) => {
      rows[0].create = true;
    },
    (rows) => {
      rows[0].grantable = true;
    },
    (rows) => rows.push({ ...rows[0], database: "模拟其他数据库" }),
    (rows) => rows.pop(),
  ]) {
    const evidence = fixture();
    mutate(evidence.databases);
    const calls = [];
    await assert.rejects(() => inspect(evidence, calls), {
      name: "Error",
      message: "B4 安装后全集群有效数据库权限不一致",
    });
    assert.equal(calls.length, 2);
  }
});

void test("直接授权缺失重复、额外对象、非所有者授权与授权选项均拒绝", async () => {
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => rows.push(rows[0]),
    (rows) => {
      rows[1] = rows[0];
    },
    (rows) => {
      rows[0].grantable = true;
    },
    (rows) => {
      rows[0].ownerGrant = false;
    },
    (rows) => {
      rows[0].role = "PUBLIC";
    },
    (rows) => {
      rows[0].object = "模拟内部对象";
    },
    (rows) => {
      rows[0].privilege = "CREATE";
    },
    (rows) =>
      rows.push({
        role: runtime,
        kind: "relation",
        object: "public.scada_projects",
        privilege: "INSERT",
        ownerGrant: true,
        grantable: false,
      }),
  ]) {
    const evidence = fixture();
    mutate(evidence.acl);
    const calls = [];
    await assert.rejects(() => inspect(evidence, calls), {
      name: "Error",
      message: "B4 安装后精确直接授权不一致",
    });
    assert.equal(calls.length, 3);
  }
});

void test("表级和列级有效权限分别拒绝越权、额外关系与标记写入", async () => {
  for (const mutate of [
    (rows) => rows[0].privileges.push("UPDATE"),
    (rows) => {
      rows[0].owner = true;
    },
    (rows) => {
      rows[0].grantable = true;
    },
    (rows) => {
      rows[0].kind = "p";
    },
    (rows) => rows.push({ ...rows[0], schema: "other", table: "unexpected" }),
    (rows) => {
      rows.find((row) => row.role === cleanupOwner && row.privileges.length > 0).privileges = [];
    },
  ]) {
    const evidence = fixture();
    mutate(evidence.relations);
    const calls = [];
    await assert.rejects(() => inspect(evidence, calls), {
      name: "Error",
      message: "B4 安装后有效关系权限不一致",
    });
    assert.equal(calls.length, 4);
  }
  for (const mutate of [
    (rows) => rows[0].privileges.push("INSERT"),
    (rows) => {
      rows[0].grantable = true;
    },
    (rows) => rows.at(-1).privileges.push("UPDATE"),
    (rows) => rows.pop(),
    (rows) => {
      rows[1] = rows[0];
    },
    (rows) => {
      rows[0].column = "模拟其他字段";
    },
    (rows) => {
      rows.find((row) => row.role === keycloak).privileges = ["SELECT"];
    },
    (rows) => {
      rows
        .find(
          (row) =>
            row.role === runtime && row.table === "scada_identities" && row.column === "status",
        )
        .privileges.push("UPDATE");
    },
  ]) {
    const evidence = fixture();
    mutate(evidence.columns);
    await assert.rejects(() => inspect(evidence), {
      name: "Error",
      message: "B4 安装后有效列权限不一致",
    });
  }
});

void test("只读查询覆盖全集群、直接授权与类型保护，不输出底层异常", async () => {
  const calls = [];
  await inspect(fixture(), calls);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(({ sql }) => /^(SELECT|WITH) /u.test(sql)));
  const [roles, databases, acl, relations, columns] = calls.map(({ sql }) => sql);
  assert.match(roles, /pg_catalog\.pg_auth_members/u);
  assert.match(roles, /r\.rolpassword IS NULL/u);
  assert.match(roles, /pg_catalog\.pg_shdepend/u);
  assert.match(roles, /d\.dbid = 0/u);
  assert.match(roles, /noUnexpectedSchemaCreators/u);
  assert.match(roles, /count\(\*\) = 2 AND count\(DISTINCT a\.grantee\) = 2/u);
  assert.match(roles, /rolname = 'adui_scada_runtime'\)\)/u);
  assert.match(roles, /p\.proacl IS NOT NULL\) AS "clusterFunctionAclMatched"/u);
  assert.doesNotMatch(roles, /rolname = 'adui_scada_runtime'\), 0\)/u);
  assert.match(roles, /a\.grantee = 0 AND a\.privilege_type = 'CREATE'/u);
  assert.match(roles, /CASE WHEN c\.relkind = 'S' THEN\s+pg_catalog\.has_sequence_privilege/u);
  assert.match(databases, /CROSS JOIN pg_catalog\.pg_database d$/u);
  assert.match(
    acl,
    /e\.grantee IN \(SELECT oid FROM candidates\) OR e\.grantor IN \(SELECT oid FROM candidates\)/u,
  );
  assert.match(acl, /e\.grantor = e\.owner/u);
  assert.match(acl, /aclexplode\(f\.attacl\)/u);
  assert.match(
    relations,
    /CASE WHEN c\.relkind IN \('r','p','v','m','f'\) THEN CASE WHEN pg_catalog\.has_table_privilege/u,
  );
  assert.match(
    columns,
    /CASE WHEN c\.relkind IN \('r','p','v','m','f'\) THEN CASE WHEN pg_catalog\.has_column_privilege/u,
  );
  assert.match(columns, /schema = 'public' OR cardinality\(privileges\) > 0 OR grantable/u);
  assert.ok(
    calls.every(({ sql }) => !/CREATE ROLE|GRANT SELECT|ALTER TABLE|DELETE FROM/u.test(sql)),
  );
  await assert.rejects(
    () =>
      verifyScadaB4InstalledPermissions(async () => {
        throw new Error("模拟敏感错误");
      }, port),
    {
      name: "Error",
      message: "B4 安装后专用角色属性及依赖查询失败，内部诊断已脱敏",
    },
  );
  let queried = false;
  await assert.rejects(
    () =>
      verifyScadaB4InstalledPermissions(async () => {
        queried = true;
        return { rows: [] };
      }, "18443;"),
    /OIDC 清理候选要求有效的固定本机端口/u,
  );
  assert.equal(queried, false);
});

void test("组合后置门禁先核对角色权限再核对例程，任一步漂移均无成功报告", async () => {
  const expected = fixture();
  const groups = [
    expected.roles,
    expected.databases,
    expected.acl,
    expected.relations,
    expected.columns,
    buildScadaB4RoutineExpectations(port),
  ];
  let calls = 0;
  const result = await verifyScadaB4InstalledCatalog(async () => ({ rows: groups[calls++] }), port);
  assert.equal(calls, 6);
  assert.equal(result.permissions.directAclCount, 205);
  assert.equal(result.routines.directExecuteAclCount, 23);
  assert.equal(result.installedCatalogMatched, true);
  assert.match(result.catalogFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(result.definerSafetyVerified, false);
  assert.equal(result.rowLockVerified, false);
  assert.equal(result.issuerBindingVerified, false);
  assert.equal(result.admissionPassed, false);
  for (let failure = 0; failure < groups.length; failure += 1) {
    calls = 0;
    await assert.rejects(
      () =>
        verifyScadaB4InstalledCatalog(async () => {
          const index = calls++;
          return { rows: index === failure ? [] : groups[index] };
        }, port),
      /B4 (安装后|例程数量不一致)/u,
    );
    assert.equal(calls, failure + 1);
  }
});
