import { isDeepStrictEqual } from "node:util";
import { buildDockerRoleBootstrapPlan } from "./docker-db-role-bootstrap-plan.mjs";
import {
  RoleVerificationError,
  safeSqlState,
  verifyPrepared,
} from "./docker-db-role-bootstrap.mjs";
import {
  DockerRoleIsolationError,
  readDockerIsolationDirectory,
} from "./docker-db-role-isolation.mjs";
import {
  DockerRoleIsolationPlanError,
  reviewDockerRoleIsolationInventory,
} from "./docker-db-role-isolation-plan.mjs";

export class DockerRoleIsolationTransactionError extends Error {}

const lockedSql =
  "SELECT pg_catalog.pg_try_advisory_xact_lock(839572941652::bigint) AS locked, current_setting('transaction_isolation') AS isolation";

function requireMatch(condition) {
  if (!condition) throw new DockerRoleIsolationTransactionError("隔离事务证据不一致");
}

function businessView(report, isolated) {
  return {
    role: report.role,
    databases: {
      adui_scada: { ...report.databases.adui_scada, publicConnect: !isolated },
      adui_scada_keycloak: { ...report.databases.adui_scada_keycloak, publicConnect: !isolated },
    },
    scada: report.scada,
  };
}

/** 只执行固定隔离方案；独立状态核查兼容完整前后状态，混合状态拒绝。 */
export async function runDockerRoleIsolationTransaction({
  mode,
  report,
  identity,
  storageHash,
  createClient,
  readDirectory,
  expectedFingerprint = "",
}) {
  requireMatch(["status", "rehearse", "apply"].includes(mode));
  const statusOnly = mode === "status";
  requireMatch(
    identity?.version === "190000" &&
      typeof identity.systemIdentifier === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier) &&
      report?.role?.scadaRuntimeExists === true &&
      report.role.keycloakRuntimeExists === true &&
      (statusOnly
        ? expectedFingerprint === "" || /^[a-f0-9]{64}$/u.test(expectedFingerprint)
        : /^[a-f0-9]{64}$/u.test(expectedFingerprint)),
  );
  const isolatedBefore = statusOnly && report.databases?.adui_scada?.publicConnect === false;
  buildDockerRoleBootstrapPlan(
    {
      ...report,
      role: { ...report.role, scadaRuntimeExists: false, keycloakRuntimeExists: false },
    },
    storageHash,
    isolatedBefore,
  );

  let client;
  let begun = false;
  let commitAttempted = false;
  let committed = false;
  let stage = "连接";
  let fingerprint = "";
  let failure;
  const checkFingerprint = (actual) =>
    requireMatch(expectedFingerprint === "" || actual === expectedFingerprint);
  const checkDirectory = async (isolated) => {
    requireMatch(
      isDeepStrictEqual(
        await readDirectory(client, identity, storageHash, statusOnly),
        businessView(report, isolated),
      ),
    );
  };
  const inspect = async (isolated) => {
    const inventory = await readDockerIsolationDirectory(async (step, sql) => {
      try {
        return await client.query(sql);
      } catch (error) {
        throw new DockerRoleIsolationTransactionError(
          step + "查询失败（SQLSTATE=" + safeSqlState(error) + "）",
        );
      }
    });
    return reviewDockerRoleIsolationInventory(inventory, identity, storageHash, isolated);
  };
  try {
    client = createClient();
    await client.connect();
    stage = "事务启动";
    requireMatch(
      (
        await client.query(
          statusOnly
            ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
            : "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE",
        )
      ).command === "BEGIN",
    );
    begun = true;
    if (!statusOnly) {
      stage = "独立执行锁";
      requireMatch(
        isDeepStrictEqual((await client.query(lockedSql)).rows, [
          { locked: true, isolation: "serializable" },
        ]),
      );
    }
    stage = "前置业务目录与角色核验";
    await checkDirectory(isolatedBefore);
    await verifyPrepared(client, identity, storageHash, isolatedBefore);
    stage = "全集群精确基线与指纹核验";
    const plan = await inspect(isolatedBefore);
    fingerprint = plan.planFingerprint;
    checkFingerprint(fingerprint);

    if (!statusOnly) {
      stage = "五条固定隔离语句";
      for (const sql of plan.sqlPreview) {
        requireMatch((await client.query(sql)).command === "REVOKE");
      }
      stage = "后置角色及全集群精确权限核验";
      await verifyPrepared(client, identity, storageHash, true);
      requireMatch((await inspect(true)).planFingerprint === fingerprint);
    }
    stage = "后置业务目录与身份核验";
    await checkDirectory(isolatedBefore || !statusOnly);
    if (mode === "apply") {
      stage = "事务提交";
      commitAttempted = true;
      requireMatch((await client.query("COMMIT")).command === "COMMIT");
      committed = true;
    } else {
      stage = "事务回滚";
      requireMatch((await client.query("ROLLBACK")).command === "ROLLBACK");
    }
    begun = false;
  } catch (error) {
    failure = commitAttempted
      ? "隔离事务提交结果未知，禁止重试，请先独立核查状态"
      : "隔离事务" + stage + "失败，SQLSTATE=" + safeSqlState(error) + "，保留现场";
    if (
      !commitAttempted &&
      (error instanceof RoleVerificationError ||
        error instanceof DockerRoleIsolationError ||
        error instanceof DockerRoleIsolationPlanError ||
        error instanceof DockerRoleIsolationTransactionError)
    )
      failure += "；" + error.message;
  }
  if (begun && !commitAttempted) {
    try {
      requireMatch((await client.query("ROLLBACK")).command === "ROLLBACK");
      failure = (failure ?? "隔离事务失败") + "；事务已确认回滚";
    } catch {
      failure = (failure ?? "隔离事务失败") + "；回滚未确认，禁止重试";
    }
  }
  if (client) {
    try {
      await client.end();
    } catch {
      failure =
        (failure ?? (committed ? "隔离事务已提交" : "隔离事务")) + "；连接关闭失败，保留现场";
    }
  }
  if (failure) throw new DockerRoleIsolationTransactionError(failure);
  return {
    status: statusOnly
      ? "DOCKER_DB_ROLE_ISOLATION_STATUS_READY"
      : committed
        ? "DOCKER_DB_ROLE_ISOLATION_APPLIED"
        : "DOCKER_DB_ROLE_ISOLATION_REHEARSED",
    planFingerprint: fingerprint,
    storageHash,
    serverVersion: identity.version,
    rolesPrepared: true,
    directoryReviewPassed: true,
    catalogStatementsExecuted: !statusOnly,
    catalogIsolationVerified: isolatedBefore || !statusOnly,
    catalogIsolationPersisted: isolatedBefore || committed,
    publicConnectRetained: !(isolatedBefore || committed),
    committed,
    rolledBack: !committed,
    databaseWritten: committed,
    businessDataWritten: false,
    serviceSwitched: false,
    admissionPassed: false,
    isolationPassed: false,
  };
}
