import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  readDockerBusinessRoleDirectory,
  reviewDockerDatabaseRoles,
} from "./docker-db-role-review.mjs";

const expected = { version: "190000", systemIdentifier: "123456789" };
const hash = "a".repeat(64);
const tables = [
  "scada_projects",
  "scada_project_grants",
  "scada_project_versions",
  "scada_project_audit",
  "scada_project_release_state",
  "scada_project_release_events",
  "scada_identities",
  "scada_auth_sessions",
  "scada_external_identities",
  "scada_oidc_transactions",
  "scada_tag_history_batches",
  "scada_tag_history_records",
];
const role = {
  superuser: true,
  createDatabase: true,
  createRole: true,
  replication: true,
  bypassRls: true,
  login: true,
  inherit: true,
  scadaRuntimeExists: false,
  keycloakRuntimeExists: false,
  directMemberships: 1,
  reachableMemberships: 2,
  inheritedMemberships: 2,
  setRoleMemberships: 2,
};
const db = {
  owner: true,
  ownerPrivileges: true,
  connect: true,
  create: true,
  temporary: true,
  publicConnect: true,
};
const schema = {
  owner: false,
  ownerPrivileges: true,
  usage: true,
  create: true,
  publicCreate: false,
};
const table = {
  owner: true,
  ownerPrivileges: true,
  select: true,
  insert: true,
  update: true,
  delete: true,
  truncate: true,
  references: true,
  trigger: true,
  maintain: true,
  anyColumnSelect: true,
  anyColumnInsert: true,
  anyColumnUpdate: true,
  anyColumnReferences: true,
};

/** 仅模拟固定目录响应，不连接数据库，不替代真实 PostgreSQL 语义。 */
function fixture(options = {}) {
  const calls = [];
  const create = (database) => {
    const business = database === "adui_scada";
    let checks = 0;
    calls.push([database, "创建"]);
    return {
      connect() {
        calls.push([database, "连接"]);
        if (!business && options.connectionFailed) throw new Error("模拟敏感连接信息");
        return Promise.resolve();
      },
      query(sql, parameters) {
        calls.push([database, sql]);
        if (sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" || sql === "ROLLBACK") {
          return Promise.resolve({ rows: [] });
        }
        assert.match(sql, /^(SELECT|WITH RECURSIVE)/u);
        let rows;
        if (sql.includes("current_database()")) {
          checks += 1;
          rows = [
            {
              database,
              role: "adui_scada",
              sessionRole: "adui_scada",
              schema: "public",
              ...expected,
              readOnly: options.writable ? "off" : "on",
              defaultReadOnly: options.defaultWritable ? "off" : "on",
              recovery: false,
            },
          ];
          if (options.drift && checks === 2) rows[0].systemIdentifier = "999";
        } else if (sql.includes("WITH RECURSIVE memberships")) {
          rows = [
            {
              ...role,
              ...options.role,
              ...(!business && options.roleDrift ? { createRole: false } : {}),
            },
          ];
        } else if (sql.includes("FROM pg_catalog.pg_database d")) {
          rows = [
            { name: "adui_scada", ...db },
            { name: "adui_scada_keycloak", ...db },
          ];
        } else if (sql.includes("has_schema_privilege")) {
          assert.deepEqual(parameters, [business ? ["public", "prisma_contract"] : ["public"]]);
          rows = parameters[0].map((name) => ({ name, ...schema }));
        } else if (sql.includes("count(*)::int AS total")) {
          rows = [{ total: 0 }];
        } else if (sql.includes("has_table_privilege(c.oid")) {
          rows = (business ? tables : ["模拟敏感表名"]).map((name) => ({ name, ...table }));
          if (options.missingTable && business) rows.pop();
          if (options.unknownPrivilege) delete rows[0].select;
        } else if (sql.includes("has_sequence_privilege")) {
          rows = [
            {
              name: "模拟敏感序列名",
              owner: true,
              ownerPrivileges: true,
              usage: true,
              select: true,
              update: true,
            },
          ];
        } else if (sql.includes("FROM prisma_contract.marker")) {
          assert.equal(business, true);
          rows = [
            {
              storageHash: options.wrongHash ? "b".repeat(64) : hash,
              markerSelect: true,
              clusterFunctionExecute: true,
            },
          ];
        } else {
          throw new Error("模拟未授权 SQL");
        }
        return Promise.resolve({ rows });
      },
      end() {
        calls.push([database, "关闭"]);
        if (options.closeFailed) throw new Error("模拟敏感关闭异常");
        return Promise.resolve();
      },
    };
  };
  return { create, calls };
}

void describe("Docker 数据库角色只读核查", () => {
  void it("共享高权限身份只能完成目录核查而不能通过业务准入", async () => {
    const { create, calls } = fixture();
    const report = await reviewDockerDatabaseRoles(create, expected, hash);
    assert.equal(report.status, "DOCKER_DB_ROLE_REVIEW_READY");
    assert.equal(report.directoryReviewPassed, true);
    assert.equal(report.admissionPassed, false);
    assert.equal(report.databaseWritten, false);
    assert.equal(report.role.superuser, true);
    assert.equal(report.role.setRoleMemberships, 2);
    assert.equal(report.databases.adui_scada_keycloak.publicConnect, true);
    assert.equal(report.scada.tables.total, 12);
    assert.equal(report.scada.tableMatrix.scada_projects.update, true);
    assert.equal(report.keycloak.tables.total, 1);
    assert.doesNotMatch(JSON.stringify(report), /模拟敏感/u);
    for (const database of ["adui_scada", "adui_scada_keycloak"]) {
      const steps = calls.filter(([name]) => name === database).map(([, step]) => step);
      assert.deepEqual(steps.slice(0, 3), [
        "创建",
        "连接",
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      ]);
      assert.deepEqual(steps.slice(-2), ["ROLLBACK", "关闭"]);
      assert.equal(steps.filter((step) => step.includes("current_database()")).length, 2);
    }
  });
  void it("即使当前权限标志收窄也不能将共享身份认定为正式角色", async () => {
    const { create } = fixture({
      role: {
        superuser: false,
        createDatabase: false,
        createRole: false,
        replication: false,
        bypassRls: false,
      },
    });
    assert.equal((await reviewDockerDatabaseRoles(create, expected, hash)).admissionPassed, false);
  });
  void it("拒绝非法集群或指纹且不构造连接", async () => {
    const { create, calls } = fixture();
    await assert.rejects(
      reviewDockerDatabaseRoles(create, { ...expected, systemIdentifier: "0" }, hash),
      /身份不一致/u,
    );
    await assert.rejects(reviewDockerDatabaseRoles(create, expected, "invalid"), /身份不一致/u);
    assert.deepEqual(calls, []);
  });
  void it("拒绝非严格只读和后置集群漂移并关闭连接", async () => {
    for (const options of [{ writable: true }, { drift: true }]) {
      const { create, calls } = fixture(options);
      await assert.rejects(reviewDockerDatabaseRoles(create, expected, hash), /身份核验失败/u);
      assert.deepEqual(
        calls.slice(-2).map(([, step]) => step),
        ["ROLLBACK", "关闭"],
      );
      assert.equal(
        calls.some(([name]) => name === "adui_scada_keycloak"),
        false,
      );
    }
  });
  void it("缺少业务表、权限字段或标记漂移均不能返回成功", async () => {
    for (const options of [
      { missingTable: true },
      { unknownPrivilege: true },
      { wrongHash: true },
    ]) {
      const { create } = fixture(options);
      await assert.rejects(
        reviewDockerDatabaseRoles(create, expected, hash),
        /角色及目录核验失败/u,
      );
    }
  });
  void it("拒绝两库角色权限结果不一致", async () => {
    const { create } = fixture({ roleDrift: true });
    await assert.rejects(reviewDockerDatabaseRoles(create, expected, hash), /身份不一致/u);
  });
  void it("Keycloak 独立连接失败须脱敏且不返回部分报告", async () => {
    const { create, calls } = fixture({ connectionFailed: true });
    await assert.rejects(reviewDockerDatabaseRoles(create, expected, hash), {
      name: "Error",
      message: "Keycloak 库连接失败，内部诊断已脱敏，保留现场",
    });
    assert.deepEqual(calls.at(-1), ["adui_scada_keycloak", "关闭"]);
  });
  void it("连接关闭失败不能冒充目录核查成功", async () => {
    const { create } = fixture({ closeFailed: true });
    await assert.rejects(reviewDockerDatabaseRoles(create, expected, hash), {
      name: "Error",
      message: "业务库连接关闭失败，保留现场",
    });
  });
});

void describe("业务事务内角色目录核查", () => {
  void it("读写事务必须同时核对两种只读标志且不管理外部事务", async () => {
    const { create, calls } = fixture({ writable: true, defaultWritable: true });
    const report = await readDockerBusinessRoleDirectory(create("adui_scada"), expected, hash, false);
    assert.equal(report.scada.tables.total, 12);
    assert.equal(report.role.scadaRuntimeExists, false);
    assert.equal(report.scada.marker.clusterFunctionExecute, true);
    const sql = calls.map(([, step]) => step);
    assert.equal(sql.filter((step) => step.includes("current_database()")).length, 2);
    assert.equal(sql.some((step) => /^(BEGIN|COMMIT|ROLLBACK)/u.test(step)), false);
    assert.equal(sql.includes("关闭"), false);
  });
  void it("拒绝事务模式不匹配、默认只读及后置身份漂移", async () => {
    for (const options of [
      {},
      { writable: true },
      { writable: true, defaultWritable: true, drift: true },
    ]) {
      const { create } = fixture(options);
      await assert.rejects(
        readDockerBusinessRoleDirectory(create("adui_scada"), expected, hash, false),
        /身份不一致/u,
      );
    }
    const { create } = fixture({ writable: true, defaultWritable: true });
    await assert.rejects(
      readDockerBusinessRoleDirectory(create("adui_scada"), expected, hash, true),
      /身份不一致/u,
    );
  });
});
