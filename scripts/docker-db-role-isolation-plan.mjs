import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { b4OwnerRoles } from "./docker-db-role-isolation.mjs";

export class DockerRoleIsolationPlanError extends Error {}

const admin = "adui_scada";
const scada = "adui_scada_runtime";
const keycloak = "adui_scada_keycloak_runtime";

// 固定 PG19.0 实机核查中已观察到的脱敏角色标识；不凭标识推断其用途。
const reviewedMaskedOids = [
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
const targets = [
  {
    name: "adui_scada",
    scope: "BUSINESS",
    runtime: scada,
    template: false,
    allowConnections: true,
    defaultAcl: false,
    publicTemporary: true,
    sql: "REVOKE CONNECT, TEMPORARY ON DATABASE adui_scada FROM PUBLIC RESTRICT",
  },
  {
    name: "adui_scada_keycloak",
    scope: "BUSINESS",
    runtime: keycloak,
    template: false,
    allowConnections: true,
    defaultAcl: false,
    publicTemporary: true,
    sql: "REVOKE CONNECT, TEMPORARY ON DATABASE adui_scada_keycloak FROM PUBLIC RESTRICT",
  },
  {
    name: "postgres",
    scope: "MAINTENANCE",
    runtime: null,
    template: false,
    allowConnections: true,
    defaultAcl: true,
    publicTemporary: true,
    sql: "REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC RESTRICT",
  },
  {
    name: "template0",
    scope: "TEMPLATE",
    runtime: null,
    template: true,
    allowConnections: false,
    defaultAcl: false,
    publicTemporary: false,
    sql: "REVOKE CONNECT ON DATABASE template0 FROM PUBLIC RESTRICT",
  },
  {
    name: "template1",
    scope: "TEMPLATE",
    runtime: null,
    template: true,
    allowConnections: true,
    defaultAcl: false,
    publicTemporary: false,
    sql: "REVOKE CONNECT ON DATABASE template1 FROM PUBLIC RESTRICT",
  },
];

function requirePlan(condition, step) {
  if (!condition) throw new DockerRoleIsolationPlanError(step + "基线不一致，禁止生成隔离预览");
}

function exactRows(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((item) => actual.some((row) => isDeepStrictEqual(row, item)))
  );
}

function oid(value) {
  return (
    typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 4294967295
  );
}

function matches(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.entries(expected).every(
      ([key, item]) => Object.hasOwn(value, key) && value[key] === item,
    )
  );
}

/** 从当前已确认回滚的只读报告生成固定候选；不调用数据库、不授权执行。 */
export function buildDockerRoleIsolationPlan(report, identity, expectedHash) {
  requirePlan(
    typeof expectedHash === "string" &&
      /^[a-f0-9]{64}$/u.test(expectedHash) &&
      identity?.version === "190000" &&
      typeof identity.systemIdentifier === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier) &&
      matches(report, {
        status: "DOCKER_DB_ROLE_ISOLATION_INSPECT_READY",
        serverVersion: identity.version,
        storageHash: expectedHash,
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
      }),
    "只读报告及集群",
  );
  return {
    status: "DOCKER_DB_ROLE_ISOLATION_PLAN_READY",
    planOnly: true,
    directoryReviewPassed: true,
    rolesPrepared: true,
    rolledBack: true,
    committed: false,
    catalogStatementsExecuted: false,
    databaseWritten: false,
    businessDataWritten: false,
    serviceSwitched: false,
    admissionPassed: false,
    publicConnectRetained: true,
    isolationPassed: false,
    changeAllowed: false,
    consumerReviewRequired: true,
    ...reviewDockerRoleIsolationInventory(report.inventory, identity, expectedHash, false),
    pendingGates: [
      "CONSUMER_REVIEW",
      "MAINTENANCE_AND_TEMPLATE_REVIEW",
      "ROLLBACK_REHEARSAL_APPROVAL",
      "PERSISTENT_CHANGE_APPROVAL",
      "LOGIN_AND_SERVICE_SWITCH_APPROVAL",
    ],
  };
}

/** 仅核对原基线或完整隔离投影，指纹始终绑定原方案，不伪造只读报告。 */
export function reviewDockerRoleIsolationInventory(inventory, identity, expectedHash, isolated) {
  requirePlan(
    typeof isolated === "boolean" &&
      typeof expectedHash === "string" &&
      /^[a-f0-9]{64}$/u.test(expectedHash) &&
      identity?.version === "190000" &&
      typeof identity.systemIdentifier === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier),
    "集群及状态",
  );
  requirePlan(
    matches(inventory, {
      unknownLoginRoleCount: 0,
      unknownDatabaseCount: 0,
      unresolvedSessionCount: 0,
      consumerReviewRequired: true,
      changeAllowed: false,
      isolationPassed: false,
    }) &&
      Array.isArray(inventory.roles) &&
      Array.isArray(inventory.databases),
    "消费者及目录",
  );
  const roleId = (name) => inventory.roles.find((row) => row?.name === name)?.oid;
  const runtimeIds = [roleId(scada), roleId(keycloak)];
  requirePlan(runtimeIds.every(oid), "运行角色标识");
  const roles = [
    { oid: "10", name: admin, login: true, superuser: true, inherit: true },
    { oid: runtimeIds[0], name: scada, login: false, superuser: false, inherit: false },
    { oid: runtimeIds[1], name: keycloak, login: false, superuser: false, inherit: false },
    { oid: "6171", name: "pg_database_owner", login: false, superuser: false, inherit: true },
    ...reviewedMaskedOids.map((id) => ({
      oid: id,
      name: null,
      login: false,
      superuser: false,
      inherit: true,
    })),
  ];
  requirePlan(
    new Set(roles.map((row) => row.oid)).size === roles.length && exactRows(inventory.roles, roles),
    "全集群角色",
  );
  const databases = targets.map((target) => {
    const id = inventory.databases.find((row) => row?.name === target.name)?.oid;
    requirePlan(oid(id), "固定数据库标识");
    return {
      oid: id,
      name: target.name,
      ownerOid: "10",
      allowConnections: target.allowConnections,
      template: target.template,
      connectionLimit: -1,
      defaultAcl: target.defaultAcl,
      aclEntryCount: 4 + Number(target.publicTemporary) + Number(target.runtime !== null),
      publicConnect: true,
      publicTemporary: target.publicTemporary,
      publicCreate: false,
    };
  });
  requirePlan(
    new Set(databases.map((row) => row.oid)).size === databases.length &&
      exactRows(
        inventory.databases,
        isolated
          ? databases.map((row, index) => ({
              ...row,
              defaultAcl: false,
              aclEntryCount: targets[index].runtime === null ? 3 : 4,
              publicConnect: false,
              publicTemporary: false,
            }))
          : databases,
      ),
    "全集群数据库",
  );
  const memberships = ["3374", "3375", "3377"].map((id) => ({
    roleOid: id,
    memberOid: "3373",
    grantorOid: "10",
    admin: false,
    inherit: true,
    setRole: true,
  }));
  requirePlan(exactRows(inventory.memberships, memberships), "角色成员关系");
  const grant = (databaseOid, granteeOid, privilege) => ({
    databaseOid,
    grantorOid: "10",
    granteeOid,
    privilege,
    grantable: false,
  });
  const acl = databases.flatMap((database, index) => {
    const runtime = targets[index].runtime;
    return [
      grant(database.oid, "0", "CONNECT"),
      ...(database.publicTemporary ? [grant(database.oid, "0", "TEMPORARY")] : []),
      ...["CONNECT", "CREATE", "TEMPORARY"].map((privilege) =>
        grant(database.oid, "10", privilege),
      ),
      ...(runtime === null ? [] : [grant(database.oid, roleId(runtime), "CONNECT")]),
    ];
  });
  requirePlan(
    exactRows(inventory.acl, isolated ? acl.filter((row) => row.granteeOid !== "0") : acl),
    "精确数据库 ACL",
  );
  const effective = databases.flatMap((database) =>
    roles.map((role) => ({
      databaseOid: database.oid,
      roleOid: role.oid,
      connect: true,
      temporary: role.superuser || database.publicTemporary,
      create: role.superuser,
    })),
  );
  const expectedEffective = isolated
    ? databases.flatMap((database, index) =>
        roles.map((role) => ({
          databaseOid: database.oid,
          roleOid: role.oid,
          connect:
            role.superuser ||
            (role.name === targets[index].runtime && targets[index].runtime !== null),
          temporary: role.superuser,
          create: role.superuser,
        })),
      )
    : effective;
  requirePlan(exactRows(inventory.effective, expectedEffective), "有效权限矩阵");
  requirePlan(
    Array.isArray(inventory.sessions) &&
      inventory.sessions.every(
        (row) =>
          row?.roleOid === "10" &&
          databases.some(
            (database) => database.oid === row.databaseOid && database.allowConnections,
          ) &&
          Number.isSafeInteger(row.total) &&
          row.total > 0 &&
          isDeepStrictEqual(row, { databaseOid: row.databaseOid, roleOid: "10", total: row.total }),
      ) &&
      new Set(inventory.sessions.map((row) => row.databaseOid)).size ===
        inventory.sessions.length &&
      inventory.sessions.some((row) => row.databaseOid === databases[0].oid),
    "当前客户端连接",
  );
  const groups = ["BUSINESS", "MAINTENANCE", "TEMPLATE"].map((scope) => ({
    scope,
    separateApprovalRequired: true,
    sqlPreview: targets.filter((target) => target.scope === scope).map((target) => target.sql),
  }));
  const sqlPreview = groups.flatMap((group) => group.sqlPreview);
  const planFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        formatVersion: 1,
        systemIdentifier: identity.systemIdentifier,
        storageHash: expectedHash,
        databases,
        roles,
        acl,
        memberships,
        effective,
        groups,
      }),
    )
    .digest("hex");
  const projected = targets.map((target, index) => ({
    database: target.name,
    allowConnections: target.allowConnections,
    currentAclSource: target.defaultAcl ? "DEFAULT" : "EXPLICIT",
    projectedAclSource: "EXPLICIT",
    publicPrivilegesRemoved: target.publicTemporary ? ["CONNECT", "TEMPORARY"] : ["CONNECT"],
    projectedAclEntryCount: target.runtime === null ? 3 : 4,
    connectLostRoleCount: roles.length - 1 - Number(target.runtime !== null),
    temporaryLostRoleCount: target.publicTemporary ? roles.length - 1 : 0,
    namedRoles: [admin, scada, keycloak].map((name) => ({
      role: name,
      connect: name === admin || name === target.runtime,
      temporary: name === admin,
      create: name === admin,
    })),
    observedSharedSessions:
      inventory.sessions.find((row) => row.databaseOid === databases[index].oid)?.total ?? 0,
  }));
  return {
    storageHash: expectedHash,
    serverVersion: identity.version,
    planFingerprint,
    databaseCount: databases.length,
    roleCount: roles.length,
    aclEntryCount: acl.length,
    publicAclRemovalCount: acl.filter((row) => row.granteeOid === "0").length,
    projectedAclEntryCount: acl.filter((row) => row.granteeOid !== "0").length,
    effectiveEntryCount: effective.length,
    groups,
    sqlPreview,
    projected,
  };
}

/** 安装后的三个固定所有者先逐项核验，再恢复原 B3.3 隔离指纹；未知角色不得被过滤。 */
export function reviewDockerB4IsolationInventory(inventory, identity, expectedHash) {
  requirePlan(
    inventory &&
      [
        inventory.roles,
        inventory.databases,
        inventory.acl,
        inventory.memberships,
        inventory.effective,
        inventory.sessions,
      ].every(Array.isArray),
    "B4 全集群目录",
  );
  const added = inventory.roles.filter((row) => b4OwnerRoles.includes(row?.name));
  const ids = new Set(added.map((row) => row.oid));
  requirePlan(
    added.length === b4OwnerRoles.length &&
      ids.size === added.length &&
      new Set(inventory.roles.map((row) => row.oid)).size === inventory.roles.length &&
      b4OwnerRoles.every((name) => added.filter((row) => row.name === name).length === 1) &&
      added.every(
        (row) =>
          oid(row.oid) &&
          isDeepStrictEqual(row, {
            oid: row.oid,
            name: row.name,
            login: false,
            superuser: false,
            inherit: false,
          }),
      ),
    "B4 专用所有者",
  );
  requirePlan(
    inventory.acl.every((row) => !ids.has(row.grantorOid) && !ids.has(row.granteeOid)) &&
      inventory.databases.every((row) => !ids.has(row.ownerOid)) &&
      inventory.memberships.every(
        (row) => !ids.has(row.roleOid) && !ids.has(row.memberOid) && !ids.has(row.grantorOid),
      ) &&
      inventory.sessions.every((row) => !ids.has(row.roleOid)),
    "B4 专用所有者隔离",
  );
  const expected = inventory.databases.flatMap((db) =>
    added.map((role) => ({
      databaseOid: db.oid,
      roleOid: role.oid,
      connect: false,
      temporary: false,
      create: false,
    })),
  );
  requirePlan(
    exactRows(
      inventory.effective.filter((row) => ids.has(row.roleOid)),
      expected,
    ),
    "B4 专用所有者数据库权限",
  );
  const original = reviewDockerRoleIsolationInventory(
    {
      ...inventory,
      roles: inventory.roles.filter((row) => !ids.has(row.oid)),
      effective: inventory.effective.filter((row) => !ids.has(row.roleOid)),
    },
    identity,
    expectedHash,
    true,
  );
  return { ...original, b4OwnerRoleCount: added.length, b4OwnerDatabasePermissionsDenied: true };
}
