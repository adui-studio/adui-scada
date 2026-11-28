import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKeycloakOwnershipPlan,
  DockerKeycloakOwnershipError,
  readKeycloakOwnershipPreview,
  readKeycloakOwnershipCandidate,
  readKeycloakInstalledOwnership,
  verifyKeycloakOwnershipCatalog,
  verifyKeycloakOwnershipBaseline,
  verifyKeycloakOwnershipProjection,
} from "./docker-db-role-keycloak-plan.mjs";
import {
  runKeycloakOwnershipRollbackRehearsal,
  runKeycloakOwnershipPersistence,
} from "./docker-db-role-keycloak-rehearsal.mjs";
import {
  buildScadaB4PermissionExpectations,
  verifyScadaB4CompletedCatalog,
  verifyScadaB4InstalledCatalog,
} from "./docker-db-role-b4-permission-review.mjs";
import { buildScadaB4RoutineExpectations } from "./docker-db-role-b4-routine-review.mjs";

const context = {
  identity: { version: "190000", systemIdentifier: "123456789" },
  storageHash: "a".repeat(64),
  isolationFingerprint: "b".repeat(64),
};
const runtime = "adui_scada_keycloak_runtime";
const baselineRows = () => [
  {
    managerVerified: true,
    rolesHardened: true,
    isolatedRuntime: true,
    schemaTrusted: true,
    noOtherSchemas: true,
    noUnexpectedObjects: true,
    keycloakDependencyMatched: true,
  },
];
function fixture() {
  const names = [
    "realm",
    "client",
    "user_entity",
    "databasechangelog",
    "databasechangeloglock",
    ...Array.from({ length: 96 }, (_, index) => "kc_fixture_" + index),
  ];
  return {
    ...structuredClone(context),
    baselineRows: baselineRows(),
    objects: names.flatMap((name, index) => {
      const id = index * 10 + 1000;
      const row = (kind, offset, name, parent) => ({
        kind,
        oid: String(id + offset),
        name,
        parent: parent === null ? null : String(id + parent),
        owner: "adui_scada",
        clean: true,
      });
      return [
        row("table", 0, name, null),
        row("index", 1, name + "_idx", 0),
        row("rowType", 2, name, 0),
        row("arrayType", 3, "_" + name, 2),
        ...(index === 0
          ? [
              row("toast", 4, "pg_toast_" + id, 0),
              row("toastIndex", 5, "pg_toast_" + id + "_index", 4),
            ]
          : []),
      ];
    }),
  };
}

void test("Keycloak 仅生成一百零一条精确表所有权候选", () => {
  const plan = buildKeycloakOwnershipPlan(fixture());
  assert.equal(plan.sqlPreview.length, 101);
  assert.equal(new Set(plan.sqlPreview).size, 101);
  assert.ok(
    plan.sqlPreview.every((sql) =>
      /^ALTER TABLE ONLY public\."[a-z_][a-z0-9_]{0,62}" OWNER TO adui_scada_keycloak_runtime$/u.test(
        sql,
      ),
    ),
  );
  assert.ok(
    plan.sqlPreview.includes(
      'ALTER TABLE ONLY public."databasechangelog" OWNER TO adui_scada_keycloak_runtime',
    ),
  );
  assert.deepEqual(plan.report.objectCounts, {
    table: 101,
    index: 101,
    toast: 1,
    toastIndex: 1,
    rowType: 101,
    arrayType: 101,
  });
  for (const key of [
    "objectIdentityReviewed",
    "ownershipTransferAllowed",
    "ownerProjectionVerified",
    "runtimeLoginAllowed",
    "businessAclApproved",
    "admissionPassed",
    "databaseWritten",
    "serviceSwitched",
  ])
    assert.equal(plan.report[key], false);
  assert.equal(plan.report.schemaCreateReviewRequired, true);
  assert.doesNotMatch(
    JSON.stringify(plan.report),
    /kc_fixture|databasechangelog|ALTER TABLE|1000/u,
  );
});

void test("普通索引原始名称只作为目录证据且不进入所有权语句和公开报告", () => {
  const data = fixture();
  const original = buildKeycloakOwnershipPlan(data);
  const indexes = data.objects.filter((row) => row.kind === "index");
  const names = [
    "IDX_REALM",
    "Idx_Client",
    "IDX_USER",
    "idx-legacy",
    'idx"; DROP TABLE realm;--',
    "索".repeat(21),
  ];
  for (const [index, name] of names.entries()) indexes[index].name = name;
  const candidate = buildKeycloakOwnershipPlan(data);
  assert.deepEqual(candidate.sqlPreview, original.sqlPreview);
  assert.notEqual(candidate.report.planFingerprint, original.report.planFingerprint);
  assert.deepEqual(candidate.report.objectCounts, original.report.objectCounts);
  for (const name of names) {
    assert.ok(candidate.inventory.some((row) => row.kind === "index" && row.name === name));
    assert.ok(!JSON.stringify(candidate.report).includes(name));
  }
  assert.equal(candidate.report.objectIdentityReviewed, false);
  assert.equal(candidate.report.ownershipTransferAllowed, false);
});

void test("索引名称必须是非空合法 UTF-8 目录标识且普通表仍使用严格命名规则", () => {
  for (const name of ["", "\0", "x".repeat(64), "索".repeat(22), "\ud800"]) {
    const data = fixture();
    data.objects.find((row) => row.kind === "index").name = name;
    assert.throws(() => buildKeycloakOwnershipPlan(data), DockerKeycloakOwnershipError);
  }
  for (const kind of ["table", "toast", "toastIndex", "rowType", "arrayType"]) {
    const data = fixture();
    data.objects.find((row) => row.kind === kind).name = "Mixed-Name";
    assert.throws(() => buildKeycloakOwnershipPlan(data), DockerKeycloakOwnershipError);
  }
});

void test("索引名称保留大小写且所有者权限与父对象漂移仍被拒绝", () => {
  const data = fixture();
  const index = data.objects.find((row) => row.kind === "index");
  index.name = "Idx-Realm";
  const before = buildKeycloakOwnershipPlan(data);
  const after = data.objects.map((row) => ({ ...row, owner: runtime }));
  assert.equal(verifyKeycloakOwnershipProjection(data.objects, after).ownerProjectionMatched, true);
  const changed = structuredClone(after);
  changed.find((row) => row.kind === "index").name = "idx-realm";
  assert.throws(
    () => verifyKeycloakOwnershipProjection(data.objects, changed),
    DockerKeycloakOwnershipError,
  );
  const renamed = structuredClone(data);
  renamed.objects.find((row) => row.kind === "index").name = "idx-realm";
  assert.notEqual(
    buildKeycloakOwnershipPlan(renamed).report.planFingerprint,
    before.report.planFingerprint,
  );
  for (const patch of [{ owner: runtime }, { clean: false }, { parent: "999999" }]) {
    const invalid = structuredClone(data);
    Object.assign(
      invalid.objects.find((row) => row.kind === "index"),
      patch,
    );
    assert.throws(() => buildKeycloakOwnershipPlan(invalid), DockerKeycloakOwnershipError);
  }
});

void test("指纹绑定集群、存储、隔离及对象标识，不受读取顺序影响", () => {
  const input = fixture();
  const original = buildKeycloakOwnershipPlan(input);
  assert.deepEqual(
    buildKeycloakOwnershipPlan({ ...input, objects: [...input.objects].reverse() }),
    original,
  );
  for (const change of [
    { identity: { ...context.identity, systemIdentifier: "987654321" } },
    { storageHash: "c".repeat(64) },
    { isolationFingerprint: "c".repeat(64) },
  ]) {
    assert.notEqual(
      buildKeycloakOwnershipPlan({ ...input, ...change }).report.planFingerprint,
      original.report.planFingerprint,
    );
  }
  const changed = fixture();
  changed.objects.find((row) => row.kind === "index").oid = "999999";
  assert.notEqual(
    buildKeycloakOwnershipPlan(changed).report.planFingerprint,
    original.report.planFingerprint,
  );
});

void test("所有前置证据及确认标识均须精确匹配", () => {
  for (const key of Object.keys(baselineRows()[0])) {
    const data = fixture();
    data.baselineRows[0][key] = false;
    assert.throws(() => buildKeycloakOwnershipPlan(data), DockerKeycloakOwnershipError);
  }
  for (const change of [
    { baselineRows: [] },
    { baselineRows: [...baselineRows(), ...baselineRows()] },
    { isolationFingerprint: "bad" },
    { identity: { version: "190001", systemIdentifier: "1" } },
    { storageHash: "bad" },
  ]) {
    assert.throws(
      () => buildKeycloakOwnershipPlan({ ...fixture(), ...change }),
      DockerKeycloakOwnershipError,
    );
  }
});

void test("多余表、非预期对象、权限漂移及注入字符一律拒绝", () => {
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => rows.push({ ...rows[0], oid: "900001", name: "extra" }),
    (rows) => {
      rows[0].kind = "sequence";
    },
    (rows) => {
      rows[0].name = 'realm"; DROP TABLE realm;--';
    },
    (rows) => {
      rows[0].name = "scada_projects";
    },
    (rows) => {
      rows[0].name = "not_realm";
    },
    (rows) => {
      rows[0].owner = runtime;
    },
    (rows) => {
      rows[0].clean = false;
    },
    (rows) => {
      rows[1].oid = rows[0].oid;
    },
    (rows) => {
      rows[2].parent = "999999";
    },
    (rows) => {
      rows[3].parent = rows[0].oid;
    },
    (rows) => {
      rows[4].parent = "999999";
    },
    (rows) => {
      rows[0].extra = true;
    },
  ]) {
    const data = fixture();
    mutate(data.objects);
    assert.throws(() => buildKeycloakOwnershipPlan(data), DockerKeycloakOwnershipError);
  }
});

void test("表、索引、行类型与 TOAST 所有权投影必须同时匹配", () => {
  const before = fixture().objects;
  const after = before.map((row) => ({ ...row, owner: runtime }));
  assert.deepEqual(verifyKeycloakOwnershipProjection(before, [...after].reverse()), {
    ownerProjectionMatched: true,
    ownershipTransferAllowed: false,
    admissionPassed: false,
  });
  for (const kind of ["table", "index", "toast", "toastIndex", "rowType", "arrayType"]) {
    const changed = structuredClone(after);
    changed.find((row) => row.kind === kind).owner = "adui_scada";
    assert.throws(
      () => verifyKeycloakOwnershipProjection(before, changed),
      DockerKeycloakOwnershipError,
    );
  }
  const changed = structuredClone(after);
  changed.find((row) => row.kind === "index").oid = "999999";
  assert.throws(
    () => verifyKeycloakOwnershipProjection(before, changed),
    DockerKeycloakOwnershipError,
  );
});

void test("只读对象预览检查真正目录查询形状与脱敏报告", async () => {
  const data = fixture();
  const calls = [];
  const result = await readKeycloakOwnershipPreview(async (_step, sql) => {
    calls.push(sql);
    return { rows: calls.length === 1 ? data.baselineRows : data.objects };
  }, context);
  assert.deepEqual(result, buildKeycloakOwnershipPlan(data).report);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (sql) =>
        sql.startsWith("WITH ") &&
        !/(?:^|[;\n])\s*(?:ALTER TABLE|GRANT|REVOKE|REASSIGN OWNED|DROP OWNED)\s/u.test(sql),
    ),
  );
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
  await assert.rejects(
    () =>
      readKeycloakOwnershipPreview(async () => {
        calls++;
        return { rows: [] };
      }, context),
    DockerKeycloakOwnershipError,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      readKeycloakOwnershipPreview(async () => {
        throw new Error("SENSITIVE");
      }, context),
    (error) => {
      assert.ok(error instanceof DockerKeycloakOwnershipError);
      assert.doesNotMatch(error.message, /SENSITIVE/u);
      return true;
    },
  );
});

function projectedFixture() {
  const input = fixture();
  const candidate = buildKeycloakOwnershipPlan(input);
  const tables = candidate.inventory.filter((row) => row.kind === "table");
  const dependency = (kind, objectId) => ({
    kind,
    objectId,
    directConnectMatched: true,
    systemIdentifier: context.identity.systemIdentifier,
  });
  const table = [
    "DELETE",
    "INSERT",
    "MAINTAIN",
    "REFERENCES",
    "SELECT",
    "TRIGGER",
    "TRUNCATE",
    "UPDATE",
  ];
  const column = ["INSERT", "REFERENCES", "SELECT", "UPDATE"];
  return {
    candidate,
    rows: [
      baselineRows(),
      candidate.inventory.map((row) => ({ ...row, owner: runtime })),
      [
        dependency("databaseConnect", "adui_scada_keycloak"),
        ...tables.map((row) => dependency("tableOwner", row.oid)),
      ],
      ["adui_scada_runtime", runtime].flatMap((role) =>
        tables.map((row) => ({
          role,
          objectId: row.oid,
          tablePrivileges: role === runtime ? [...table] : [],
          tableGrantOptions: role === runtime ? [...table] : [],
          columnPrivileges: role === runtime ? [...column] : [],
          schemaUsage: true,
          schemaElevated: false,
        })),
      ),
    ],
    calls: [],
  };
}

function verifyProjected(data, fingerprint = data.candidate.report.planFingerprint) {
  return verifyKeycloakOwnershipCatalog(
    async (_step, sql) => {
      data.calls.push(sql);
      return { rows: data.rows[data.calls.length - 1] };
    },
    context,
    data.candidate,
    fingerprint,
  );
}

void test("可写演练前置仅允许固定事务模式，不改变只读计划指纹", async () => {
  const input = fixture();
  const calls = [];
  const plan = await readKeycloakOwnershipCandidate(
    async (_step, sql) => {
      calls.push(sql);
      return { rows: calls.length === 1 ? input.baselineRows : input.objects };
    },
    context,
    "rehearsal",
  );
  assert.deepEqual(plan, buildKeycloakOwnershipPlan(input));
  assert.match(calls[0], /current_setting\('transaction_read_only'\) = 'off'/u);
  assert.match(calls[0], /current_setting\('transaction_isolation'\) = 'serializable'/u);
  assert.match(calls[0], /pg_authid'::regclass\) = 1\s+AND EXISTS/u);
  await assert.rejects(
    () =>
      readKeycloakOwnershipCandidate(
        async () => {
          throw new Error("不得查询");
        },
        context,
        "projected",
      ),
    DockerKeycloakOwnershipError,
  );
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
  for (const key of [
    "schemaCreateAllowed",
    "schemaEvolutionVerified",
    "objectIdentityReviewed",
    "ownershipTransferAllowed",
    "runtimeLoginAllowed",
    "admissionPassed",
    "businessAclApproved",
    "databaseWritten",
    "serviceSwitched",
  ])
    assert.equal(report[key], false);
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
  assert.ok(
    data.calls.every(
      (sql) =>
        sql.startsWith("WITH ") &&
        !/(?:^|[;\n])\s*(?:ALTER TABLE|GRANT|REVOKE|COMMIT)\s/u.test(sql),
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(report),
    /kc_fixture|databasechangelog|123456789|ALTER TABLE/u,
  );
  const reordered = projectedFixture();
  for (const rows of reordered.rows) rows.reverse();
  assert.deepEqual(await verifyProjected(reordered), report);
});

void test("候选指纹、SQL 或报告被替换时禁止查询后置目录", async () => {
  const changed = projectedFixture();
  await assert.rejects(
    () => verifyProjected(changed, "c".repeat(64)),
    DockerKeycloakOwnershipError,
  );
  assert.deepEqual(changed.calls, []);
  for (const mutate of [
    (candidate) => {
      candidate.sqlPreview[0] = "模拟其他语句";
    },
    (candidate) => {
      candidate.report.objectIdentityReviewed = true;
    },
    (candidate) => {
      candidate.inventory[0].owner = runtime;
    },
  ]) {
    const data = projectedFixture();
    mutate(data.candidate);
    await assert.rejects(() => verifyProjected(data), DockerKeycloakOwnershipError);
    assert.deepEqual(data.calls, []);
  }
});

void test("后置角色属性、Schema 或从属对象漂移立即拒绝", async () => {
  for (const key of Object.keys(baselineRows()[0])) {
    const data = projectedFixture();
    data.rows[0][0][key] = false;
    await assert.rejects(() => verifyProjected(data), DockerKeycloakOwnershipError);
    assert.equal(data.calls.length, 1);
  }
  for (const kind of ["table", "index", "toast", "toastIndex", "rowType", "arrayType"]) {
    const data = projectedFixture();
    data.rows[1].find((row) => row.kind === kind).owner = "adui_scada";
    await assert.rejects(() => verifyProjected(data), DockerKeycloakOwnershipError);
    assert.equal(data.calls.length, 2);
  }
});

void test("共享依赖及跨库直接 ACL 缺失重复或越权一律拒绝", async () => {
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => rows.push(rows[0]),
    (rows) => {
      rows[1] = rows[0];
    },
    (rows) => {
      rows[1].kind = "unexpected";
    },
    (rows) => {
      rows[1].objectId = "999999";
    },
    (rows) => {
      rows[0].directConnectMatched = false;
    },
    (rows) => {
      rows[0].systemIdentifier = "987654321";
    },
  ]) {
    const data = projectedFixture();
    mutate(data.rows[2]);
    await assert.rejects(() => verifyProjected(data), DockerKeycloakOwnershipError);
    assert.equal(data.calls.length, 3);
  }
});

void test("任何有效表权限、列权限或 Schema 权限漂移不能通过后置门禁", async () => {
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => rows.push(rows[0]),
    (rows) => {
      rows[1] = rows[0];
    },
    (rows) => {
      rows[0].tablePrivileges.push("SELECT");
    },
    (rows) => {
      rows[0].columnPrivileges.push("SELECT");
    },
    (rows) => {
      rows[0].schemaElevated = true;
    },
    (rows) => {
      rows[0].schemaUsage = false;
    },
    (rows) => {
      rows.find((row) => row.role === runtime).tableGrantOptions.pop();
    },
    (rows) => {
      rows.find((row) => row.role === runtime).tablePrivileges.pop();
    },
    (rows) => {
      rows.find((row) => row.role === runtime).columnPrivileges.pop();
    },
  ]) {
    const data = projectedFixture();
    mutate(data.rows[3]);
    await assert.rejects(() => verifyProjected(data), DockerKeycloakOwnershipError);
    assert.equal(data.calls.length, 4);
  }
  const data = projectedFixture();
  await assert.rejects(
    () =>
      verifyKeycloakOwnershipCatalog(
        async () => {
          throw new Error("SENSITIVE");
        },
        context,
        data.candidate,
        data.candidate.report.planFingerprint,
      ),
    {
      name: "Error",
      message: "Keycloak 后置安全基线核验失败，内部诊断已脱敏",
    },
  );
});

function baselineFixture() {
  const data = projectedFixture();
  data.rows[1] = structuredClone(data.candidate.inventory);
  data.rows[2] = data.rows[2].filter((row) => row.kind === "databaseConnect");
  data.rows[3] = data.rows[3].map((row) => ({
    ...row,
    tablePrivileges: [],
    tableGrantOptions: [],
    columnPrivileges: [],
  }));
  return data;
}

function verifyBaseline(data, phase) {
  return verifyKeycloakOwnershipBaseline(
    async (_step, sql) => {
      data.calls.push(sql);
      return { rows: data.rows[data.calls.length - 1] };
    },
    context,
    data.candidate,
    data.candidate.report.planFingerprint,
    phase,
  );
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
  assert.notEqual(
    first.catalogFingerprint,
    (await verifyProjected(projectedFixture())).catalogFingerprint,
  );
  const invalid = baselineFixture();
  await assert.rejects(() => verifyBaseline(invalid, "projected"), DockerKeycloakOwnershipError);
  assert.deepEqual(invalid.calls, []);
});

void test("回滚后剩余所有权、额外依赖或权限不得通过原始基线", async () => {
  for (const [index, mutate] of [
    [
      1,
      (rows) => {
        rows[0].owner = runtime;
      },
    ],
    [2, (rows) => rows.push({ ...rows[0], kind: "tableOwner", objectId: "1000" })],
    [
      3,
      (rows) => {
        rows.find((row) => row.role === runtime).tablePrivileges.push("SELECT");
      },
    ],
  ]) {
    const data = baselineFixture();
    mutate(data.rows[index]);
    await assert.rejects(() => verifyBaseline(data, "read-only"), DockerKeycloakOwnershipError);
    assert.equal(data.calls.length, index + 1);
  }
});

function rehearsalFixture(fault = "") {
  const before = baselineFixture();
  const after = projectedFixture();
  const calls = [];
  let alters = 0;
  let hosts = 0;
  let clients = 0;
  let first;
  const makeClient = (readOnly) => {
    clients++;
    const label = readOnly ? "read" : "write";
    const client = {
      async connect() {
        calls.push([label, "connect"]);
      },
      async query(sql) {
        calls.push([label, sql]);
        if (sql.startsWith("BEGIN"))
          return { command: fault === "begin" && !readOnly ? "SELECT" : "BEGIN" };
        if (sql === "COMMIT") {
          if (fault === "commit") throw new Error("SENSITIVE");
          return { command: "COMMIT" };
        }
        if (sql === "ROLLBACK") {
          if (fault === "rollback" && !readOnly) throw new Error("SENSITIVE");
          return { command: fault === "read-rollback" && readOnly ? "SELECT" : "ROLLBACK" };
        }
        if (sql.includes("pg_try_advisory_xact_lock"))
          return { rows: [{ locked: fault !== "lock", isolation: "serializable" }] };
        if (sql.includes("pg_stat_clear_snapshot")) return { command: "SELECT" };
        if (sql.includes("pg_stat_activity"))
          return {
            rows: [
              {
                quiet: fault !== "busy" && !(fault === "late-busy" && alters === 101 && !readOnly),
              },
            ],
          };
        if (sql.startsWith("LOCK TABLE")) {
          assert.equal(readOnly, false);
          assert.equal((sql.match(/ONLY public\."/gu) ?? []).length, 101);
          assert.match(sql, / IN ACCESS EXCLUSIVE MODE NOWAIT$/u);
          return { command: fault === "table-lock" ? "SELECT" : "LOCK" };
        }
        if (sql.startsWith("ALTER TABLE")) {
          assert.equal(readOnly, false);
          alters++;
          if (fault === "ddl" && alters === 3) throw new Error("SENSITIVE");
          return { command: fault === "ddl-tag" && alters === 3 ? "SELECT" : "ALTER" };
        }
        const rows = !readOnly && alters === 101 ? after.rows : before.rows;
        let index;
        if (sql.includes('AS "managerVerified"')) index = 0;
        else if (sql.includes("FROM objects")) index = 1;
        else if (sql.includes('AS "directConnectMatched"')) index = 2;
        else if (sql.includes('AS "tablePrivileges"')) index = 3;
        else throw new Error("SENSITIVE");
        const result = structuredClone(rows[index]);
        if (
          (fault === "post" && !readOnly && alters === 101 && index === 2) ||
          (fault === "independent" && readOnly && index === 3)
        )
          result.pop();
        return { rows: result };
      },
      async end() {
        calls.push([label, "end"]);
        if ((fault === "close" && !readOnly) || (fault === "read-close" && readOnly))
          throw new Error("SENSITIVE");
      },
    };
    if (!readOnly) first = client;
    return fault === "reuse" && readOnly ? first : client;
  };
  return {
    calls,
    clientCount: () => clients,
    hostCount: () => hosts,
    options: {
      context,
      confirm: "--confirm-rehearse-keycloak-ownership",
      reviewedObjects: "--reviewed-keycloak-objects",
      confirmMaintenance: "--confirm-keycloak-maintenance",
      expectedPlanFingerprint: before.candidate.report.planFingerprint,
      createClient: makeClient,
      async readHostBoundary() {
        hosts++;
        return {
          serverVersion: context.identity.version,
          systemIdentifier: context.identity.systemIdentifier,
          storageHash: context.storageHash,
          isolationFingerprint: context.isolationFingerprint,
          strictContractVerified: true,
          commentsVerified: true,
          catalogIsolationPersisted: true,
          keycloakStopped: fault !== "host" && !(fault === "host-after" && hosts === 2),
        };
      },
    },
  };
}

void test("所有权演练锁定全部表并强制回滚独立复核", async () => {
  const { calls, clientCount, hostCount, options } = rehearsalFixture();
  const result = await runKeycloakOwnershipRollbackRehearsal(options);
  assert.equal(result.statementsExecuted, 101);
  assert.deepEqual(
    calls.filter(([, sql]) => sql.startsWith("ALTER TABLE")).map(([, sql]) => sql),
    buildKeycloakOwnershipPlan(fixture()).sqlPreview,
  );
  assert.equal(clientCount(), 2);
  assert.equal(hostCount(), 2);
  assert.equal(calls.filter(([, sql]) => sql === "ROLLBACK").length, 2);
  assert.equal(calls.filter(([, sql]) => sql.includes("pg_stat_activity")).length, 4);
  assert.equal(
    calls.some(([, sql]) => sql.startsWith("COMMIT")),
    false,
  );
  const independent = calls.findIndex(([label]) => label === "read");
  assert.deepEqual(calls.slice(independent - 2, independent + 2), [
    ["write", "ROLLBACK"],
    ["write", "end"],
    ["read", "connect"],
    ["read", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"],
  ]);
  assert.equal(result.rolledBack, true);
  assert.equal(result.independentBaselineMatched, true);
  assert.notEqual(result.baselineFingerprint, result.projectionFingerprint);
  for (const flag of [
    "committed",
    "databaseWritten",
    "ownershipTransferAllowed",
    "ownerProjectionVerified",
    "schemaEvolutionVerified",
    "runtimeLoginAllowed",
    "businessAclApproved",
    "admissionPassed",
    "serviceSwitched",
  ])
    assert.equal(result[flag], false);
});

void test("缺少独立确认或宿主证据时不创建连接", async () => {
  for (const change of [
    { confirm: "--apply" },
    { reviewedObjects: undefined },
    { confirmMaintenance: undefined },
    { expectedPlanFingerprint: "bad" },
    { context: { ...context, storageHash: "bad" } },
  ]) {
    const { options, calls, hostCount } = rehearsalFixture();
    await assert.rejects(
      () => runKeycloakOwnershipRollbackRehearsal({ ...options, ...change }),
      DockerKeycloakOwnershipError,
    );
    assert.deepEqual(calls, []);
    assert.equal(hostCount(), 0);
  }
  const { options, calls } = rehearsalFixture("host");
  await assert.rejects(
    () => runKeycloakOwnershipRollbackRehearsal(options),
    DockerKeycloakOwnershipError,
  );
  assert.deepEqual(calls, []);
});

void test("任何前置锁会话或指纹错误禁止所有权变更", async () => {
  for (const fault of ["lock", "busy", "table-lock", "fingerprint"]) {
    const { options, calls } = rehearsalFixture(fault);
    if (fault === "fingerprint") options.expectedPlanFingerprint = "c".repeat(64);
    await assert.rejects(
      () => runKeycloakOwnershipRollbackRehearsal(options),
      DockerKeycloakOwnershipError,
    );
    assert.equal(calls.filter(([, sql]) => sql.startsWith("ALTER TABLE")).length, 0);
    assert.equal(
      calls.some(([, sql]) => sql === "COMMIT"),
      false,
    );
    assert.equal(
      calls.some(([label, sql]) => label === "write" && sql === "ROLLBACK"),
      true,
    );
  }
});

void test("变更失败或投影漂移后回滚并独立复核", async () => {
  for (const [fault, count] of [
    ["ddl", 3],
    ["ddl-tag", 3],
    ["post", 101],
    ["late-busy", 101],
  ]) {
    const { options, calls, clientCount } = rehearsalFixture(fault);
    await assert.rejects(
      () => runKeycloakOwnershipRollbackRehearsal(options),
      (error) => {
        assert.ok(error instanceof DockerKeycloakOwnershipError);
        assert.doesNotMatch(error.message, /SENSITIVE/u);
        return true;
      },
    );
    assert.equal(calls.filter(([, sql]) => sql.startsWith("ALTER TABLE")).length, count);
    assert.equal(clientCount(), 2);
    assert.equal(
      calls.some(([, sql]) => sql === "COMMIT"),
      false,
    );
  }
});

void test("回滚或连接状态未知以及独立基线漂移均拒绝成功", async () => {
  for (const fault of [
    "begin",
    "rollback",
    "close",
    "reuse",
    "independent",
    "read-rollback",
    "read-close",
    "host-after",
  ]) {
    const { options, calls, clientCount } = rehearsalFixture(fault);
    await assert.rejects(
      () => runKeycloakOwnershipRollbackRehearsal(options),
      (error) => {
        assert.ok(error instanceof DockerKeycloakOwnershipError);
        assert.doesNotMatch(error.message, /SENSITIVE/u);
        assert.match(error.message, /禁止重试/u);
        return true;
      },
    );
    if (["begin", "rollback", "close"].includes(fault)) assert.equal(clientCount(), 1);
    assert.equal(
      calls.some(([, sql]) => sql === "COMMIT"),
      false,
    );
  }
});

void test("已转移 Keycloak 目录只能在独立只读事务中恢复原始确认指纹", async () => {
  const data = projectedFixture();
  const query = async (_step, sql) => ({ rows: data.rows[data.calls.push(sql) - 1] });
  const result = await readKeycloakInstalledOwnership(
    query,
    context,
    data.candidate.report.planFingerprint,
  );
  assert.deepEqual(result.report, await verifyProjected(projectedFixture()));
  assert.deepEqual(
    result.tableOids,
    data.candidate.inventory.filter((row) => row.kind === "table").map((row) => row.oid),
  );
  assert.equal(data.calls.length, 4);
  assert.match(data.calls[0], /current_setting\('transaction_read_only'\) = 'on'/u);
  assert.match(data.calls[0], /current_setting\('transaction_isolation'\) = 'repeatable read'/u);
  assert.match(data.calls[0], /pg_authid'::regclass\) = 102\s+AND EXISTS/u);
});

function dualCatalogFixture() {
  const data = projectedFixture();
  const port = "18443";
  const permissions = buildScadaB4PermissionExpectations(port);
  const dependencies = data.candidate.inventory
    .filter((row) => row.kind === "table")
    .map((row) => ({ objectId: row.oid, systemIdentifier: context.identity.systemIdentifier }));
  const rows = [
    dependencies,
    permissions.roles,
    permissions.databases,
    permissions.acl,
    permissions.relations,
    permissions.columns,
    buildScadaB4RoutineExpectations(port),
  ];
  const scadaCalls = [];
  return {
    data,
    rows,
    scadaCalls,
    options: {
      scadaQuery: async (_step, sql) => ({ rows: rows[scadaCalls.push(sql) - 1] }),
      keycloakQuery: async (_step, sql) => ({ rows: data.rows[data.calls.push(sql) - 1] }),
      context,
      port,
      expectedKeycloakPlanFingerprint: data.candidate.report.planFingerprint,
    },
  };
}

void test("双库只读投影仅接受经 Keycloak 完整目录恢复的精确共享依赖", async () => {
  const h = dualCatalogFixture();
  const result = await verifyScadaB4CompletedCatalog(h.options);
  assert.equal(result.catalogProjectionMatched, true);
  assert.equal(result.keycloakSharedDependencyCount, 101);
  assert.equal(h.data.calls.length, 4);
  assert.equal(h.scadaCalls.length, 7);
  assert.match(h.scadaCalls[0], /current_setting\('transaction_read_only'\) = 'on'/u);
  assert.match(
    h.scadaCalls[1],
    /OR \(r\.rolname = 'adui_scada_keycloak_runtime' AND d\.dbid = \(SELECT oid FROM pg_catalog\.pg_database WHERE datname = 'adui_scada_keycloak'\)/u,
  );
  assert.match(h.scadaCalls[1], /d\.objsubid = 0 AND d\.deptype = 'o'/u);
  assert.equal([...h.scadaCalls[1].matchAll(/\d+::oid/gu)].length, 101);
  for (const flag of [
    "crossDatabaseAtomicSnapshotVerified",
    "installationAllowed",
    "ownershipTransferAllowed",
    "schemaEvolutionVerified",
    "runtimeLoginAllowed",
    "businessAclApproved",
    "admissionPassed",
    "databaseWritten",
    "serviceSwitched",
  ])
    assert.equal(result[flag], false);
  assert.equal(result.keycloak.objectIdentityReviewed, false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /kc_fixture|databasechangelog|\bobjectId\b|ALTER TABLE/u,
  );
  const originalCalls = [];
  await verifyScadaB4InstalledCatalog(
    async (_step, sql) => ({ rows: h.rows[originalCalls.push(sql)] }),
    h.options.port,
  );
  assert.equal(originalCalls.length, 6);
  assert.doesNotMatch(originalCalls[0], /d\.objid IN \(\d+::oid/u);
});

void test("指纹错误、半完成状态、共享依赖或其他角色漂移均不通过双库投影", async () => {
  for (const fault of [
    "fingerprint",
    "keycloak-owner",
    "keycloak-acl",
    "scada-dependency",
    "scada-role",
  ]) {
    const h = dualCatalogFixture();
    if (fault === "fingerprint") h.options.expectedKeycloakPlanFingerprint = "c".repeat(64);
    if (fault === "keycloak-owner") h.data.rows[1][0].owner = "adui_scada";
    if (fault === "keycloak-acl") h.data.rows[3][0].schemaElevated = true;
    if (fault === "scada-dependency") h.rows[0][0].systemIdentifier = "987";
    if (fault === "scada-role") h.rows[1][0].hardened = false;
    await assert.rejects(() => verifyScadaB4CompletedCatalog(h.options));
    assert.equal(
      h.scadaCalls.length,
      fault === "scada-dependency" ? 1 : fault === "scada-role" ? 2 : 0,
    );
  }
  const h = dualCatalogFixture();
  await assert.rejects(
    () => verifyScadaB4CompletedCatalog({ ...h.options, scadaQuery: h.options.keycloakQuery }),
    /双库独立查询/u,
  );
  assert.equal(h.data.calls.length, 0);
});

void test("Keycloak 持久化凭演练投影指纹提交且独立复核双库完成态", async () => {
  const rehearsal = await runKeycloakOwnershipRollbackRehearsal(rehearsalFixture().options);
  const h = rehearsalFixture();
  const options = {
    ...h.options,
    confirm: "--confirm-apply-keycloak-ownership",
    confirmRehearsalVerified: "--confirm-rehearsal-verified",
    expectedProjectionFingerprint: rehearsal.projectionFingerprint,
    async readInstalledState() {
      assert.deepEqual(h.calls.at(-1), ["write", "end"]);
      return {
        phase: "dual-installed",
        isolationFingerprint: context.isolationFingerprint,
        keycloakPlanFingerprint: rehearsal.planFingerprint,
        keycloakCatalogFingerprint: rehearsal.projectionFingerprint,
        scadaCatalogMatched: true,
        keycloakOwnerProjectionMatched: true,
        independentConnectionsClosed: true,
        admissionPassed: false,
      };
    },
  };
  const result = await runKeycloakOwnershipPersistence(options);
  assert.equal(result.committed, true);
  assert.equal(result.runtimeLoginAllowed, false);
  assert.equal(result.schemaEvolutionVerified, false);
  assert.equal(h.calls.filter(([, sql]) => sql === "COMMIT").length, 1);
  assert.equal(
    h.calls.some(([, sql]) => sql === "ROLLBACK"),
    false,
  );
  assert.equal(h.clientCount(), 1);
  await assert.rejects(
    () => runKeycloakOwnershipRollbackRehearsal(options),
    DockerKeycloakOwnershipError,
  );
});

void test("Keycloak 错误投影、未知提交、连接关闭或独立核验失败均禁止重试", async () => {
  const rehearsal = await runKeycloakOwnershipRollbackRehearsal(rehearsalFixture().options);
  for (const fault of ["fingerprint", "commit", "close", "independent"]) {
    const h = rehearsalFixture(fault === "fingerprint" || fault === "independent" ? "" : fault);
    let checks = 0;
    await assert.rejects(
      () =>
        runKeycloakOwnershipPersistence({
          ...h.options,
          confirm: "--confirm-apply-keycloak-ownership",
          confirmRehearsalVerified: "--confirm-rehearsal-verified",
          expectedProjectionFingerprint:
            fault === "fingerprint" ? "f".repeat(64) : rehearsal.projectionFingerprint,
          async readInstalledState() {
            checks++;
            throw new Error("SENSITIVE");
          },
        }),
      (error) => !error.message.includes("SENSITIVE"),
    );
    assert.equal(
      h.calls.filter(([, sql]) => sql === "COMMIT").length,
      fault === "fingerprint" ? 0 : 1,
    );
    assert.equal(
      h.calls.some(([, sql]) => sql === "ROLLBACK"),
      fault === "fingerprint",
    );
    assert.equal(checks, fault === "independent" ? 1 : 0);
  }
});
