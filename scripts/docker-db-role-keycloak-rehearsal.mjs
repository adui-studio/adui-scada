import { isDeepStrictEqual } from "node:util";
import {
  DockerKeycloakOwnershipError,
  readKeycloakOwnershipCandidate,
  verifyKeycloakOwnershipBaseline,
  verifyKeycloakOwnershipCatalog,
} from "./docker-db-role-keycloak-plan.mjs";

const confirmation = "--confirm-rehearse-keycloak-ownership";
const reviewed = "--reviewed-keycloak-objects";
const maintenance = "--confirm-keycloak-maintenance";
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const lockedSql = "SELECT pg_catalog.pg_try_advisory_xact_lock(839572941652::bigint) AS locked, current_setting('transaction_isolation') AS isolation";
const quietSql = "SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname = current_database() AND pid <> pg_catalog.pg_backend_pid()) AS quiet";

function requireMatch(condition, message) {
  if (!condition) throw new DockerKeycloakOwnershipError(message);
}

function checkContext(context) {
  requireMatch(context?.identity?.version === "190000" &&
    typeof context.identity.systemIdentifier === "string" && /^[1-9][0-9]{0,19}$/u.test(context.identity.systemIdentifier) &&
    hash(context.storageHash) && hash(context.isolationFingerprint), "Keycloak 演练集群、存储或隔离指纹无效");
}

function hostEvidence(context) {
  return {
    serverVersion: context.identity.version, systemIdentifier: context.identity.systemIdentifier,
    storageHash: context.storageHash, isolationFingerprint: context.isolationFingerprint,
    strictContractVerified: true, commentsVerified: true, catalogIsolationPersisted: true,
    keycloakStopped: true,
  };
}

// 只使用固定表所有权候选构造锁语句，不接受外部 SQL 或标识符。
function tableLockSql(candidate) {
  const names = candidate.inventory.filter((row) => row.kind === "table")
    .map((row) => row.name).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  requireMatch(names.length === 101 && new Set(names).size === names.length &&
    names.every((name) => /^[a-z_][a-z0-9_]{0,62}$/u.test(name)), "Keycloak 演练表锁候选无效");
  return 'LOCK TABLE ' + names.map((name) => 'ONLY public."' + name + '"').join(", ") + " IN ACCESS EXCLUSIVE MODE NOWAIT";
}

/** 只允许经独立确认的所有权回滚演练；不启动、停止服务或提交事务。 */
export async function runKeycloakOwnershipRollbackRehearsal(options) {
  return runKeycloakOwnershipTransaction(options, false);
}

/** 在独立维护窗口，仅凭已核验回滚投影及单独持久化确认执行固定所有权变更。 */
export async function runKeycloakOwnershipPersistence(options) {
  return runKeycloakOwnershipTransaction(options, true);
}

async function runKeycloakOwnershipTransaction({
  context, confirm, reviewedObjects, confirmMaintenance, confirmRehearsalVerified, expectedPlanFingerprint,
  expectedProjectionFingerprint, createClient, readHostBoundary, readInstalledState,
}, apply) {
  checkContext(context);
  requireMatch(confirm === (apply ? "--confirm-apply-keycloak-ownership" : confirmation) && reviewedObjects === reviewed && confirmMaintenance === maintenance &&
    hash(expectedPlanFingerprint) && (!apply || (confirmRehearsalVerified === "--confirm-rehearsal-verified" &&
      hash(expectedProjectionFingerprint) && typeof readInstalledState === "function")) &&
    typeof createClient === "function" && typeof readHostBoundary === "function",
  "Keycloak 演练或持久化缺少对象审阅、维护窗口或计划指纹确认");
  const checkHost = async () => {
    try {
      requireMatch(isDeepStrictEqual(await readHostBoundary(), hostEvidence(context)), "Keycloak 宿主证据不一致");
    } catch {
      throw new DockerKeycloakOwnershipError("Keycloak 演练宿主及维护窗口核验失败");
    }
  };
  const query = (client) => (_step, sql) => client.query(sql);
  const checkQuiet = async (client) => {
    requireMatch((await client.query("SELECT pg_catalog.pg_stat_clear_snapshot()")).command === "SELECT",
      "Keycloak 会话快照刷新未确认");
    requireMatch(isDeepStrictEqual((await client.query(quietSql)).rows, [{ quiet: true }]),
      "Keycloak 库仍存在其他会话");
  };
  const checkPlan = async (client, phase) => {
    const candidate = await readKeycloakOwnershipCandidate(query(client), context, phase);
    requireMatch(candidate.report.planFingerprint === expectedPlanFingerprint, "Keycloak 演练计划指纹不一致");
    return candidate;
  };
  await checkHost();
  let client;
  let attempted = false;
  let begun = false;
  let rolledBack = false;
  let closed = false;
  let commitAttempted = false;
  let committed = false;
  let stage = "连接";
  let failure;
  let baseline;
  let projected;
  let independentBaseline;
  let statementsExecuted = 0;
  try {
    client = createClient(false);
    await client.connect();
    stage = "事务启动";
    attempted = true;
    requireMatch((await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE")).command === "BEGIN",
      "Keycloak 演练事务未确认启动");
    begun = true;
    stage = "执行锁及会话隔离";
    requireMatch(isDeepStrictEqual((await client.query(lockedSql)).rows, [{ locked: true, isolation: "serializable" }]),
      "Keycloak 演练未获得执行锁");
    await checkQuiet(client);
    stage = "原始目录与计划";
    const candidate = await checkPlan(client, "rehearsal");
    baseline = await verifyKeycloakOwnershipBaseline(query(client), context, candidate, expectedPlanFingerprint, "rehearsal");
    stage = "全部目标表锁";
    requireMatch((await client.query(tableLockSql(candidate))).command === "LOCK", "Keycloak 全表锁未确认");
    await checkQuiet(client);
    stage = "逐表所有权转移";
    for (const sql of candidate.sqlPreview) {
      let result;
      try { result = await client.query(sql); }
      catch { throw new DockerKeycloakOwnershipError("Keycloak 第 " + (statementsExecuted + 1) + " 条所有权语句执行失败"); }
      requireMatch(result?.command === "ALTER", "Keycloak 第 " + (statementsExecuted + 1) + " 条所有权语句命令类型不一致");
      statementsExecuted++;
    }
    stage = "投影目录";
    projected = await verifyKeycloakOwnershipCatalog(query(client), context, candidate, expectedPlanFingerprint);
    requireMatch(statementsExecuted === candidate.report.statementCount && projected.ownerProjectionMatched === true &&
      projected.dependencyProjectionMatched === true && projected.rolePrivilegesMatched === true, "Keycloak 演练投影证据不一致");
    await checkQuiet(client);
    if (apply) {
      stage = "持久化前演练投影指纹";
      requireMatch(projected.catalogFingerprint === expectedProjectionFingerprint, "Keycloak 已核验演练投影指纹不一致");
      stage = "目录事务提交";
      commitAttempted = true;
      requireMatch((await client.query("COMMIT")).command === "COMMIT", "Keycloak 持久化提交标签异常");
      committed = true;
    }
  } catch (error) {
    failure = "Keycloak 演练" + stage + "失败，内部诊断已脱敏";
    if (error instanceof DockerKeycloakOwnershipError) failure += "；" + error.message;
  } finally {
    if (commitAttempted && !committed) failure = "Keycloak 持久化提交结果未知，禁止重试；必须先独立核查实际目录";
    if (attempted && !commitAttempted) {
      try {
        requireMatch((await client.query("ROLLBACK")).command === "ROLLBACK", "Keycloak 回滚标签异常");
        rolledBack = begun;
        if (!begun) failure = (failure ?? "Keycloak 演练") + "；事务启动状态未知，禁止重试";
      } catch { failure = (failure ?? "Keycloak 演练") + "；回滚未确认，禁止重试"; }
    }
    if (client) {
      try { await client.end(); closed = true; }
      catch { failure = (failure ?? "Keycloak 演练") + "；连接关闭失败，禁止重试"; }
    }
  }
  // 原连接明确关闭才允许独立复核；不能用原事务快照证明已回滚。
  if (rolledBack && closed) {
    let independent;
    let readAttempted = false;
    try {
      independent = createClient(true);
      requireMatch(independent !== client, "Keycloak 独立连接不能复用原客户端");
      await independent.connect();
      readAttempted = true;
      requireMatch((await independent.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")).command === "BEGIN",
        "Keycloak 独立事务未确认启动");
      await checkQuiet(independent);
      const candidate = await checkPlan(independent, "read-only");
      independentBaseline = await verifyKeycloakOwnershipBaseline(query(independent), context, candidate, expectedPlanFingerprint);
      requireMatch(independentBaseline.baselineCatalogMatched === true &&
        (!baseline || baseline.catalogFingerprint === independentBaseline.catalogFingerprint), "Keycloak 独立原始指纹不一致");
    } catch {
      failure = (failure ?? "Keycloak 演练") + "；独立基线核验失败，禁止重试";
    } finally {
      if (readAttempted) {
        try { requireMatch((await independent.query("ROLLBACK")).command === "ROLLBACK", "Keycloak 独立回滚标签异常"); }
        catch { failure = (failure ?? "Keycloak 演练") + "；独立回滚未确认，禁止重试"; }
      }
      if (independent && independent !== client) {
        try { await independent.end(); }
        catch { failure = (failure ?? "Keycloak 演练") + "；独立连接关闭失败，禁止重试"; }
      }
    }
    try { await checkHost(); }
    catch { failure = (failure ?? "Keycloak 演练") + "；独立宿主核验失败，禁止重试"; }
  }
  if (committed && closed && !failure) {
    try {
      const installed = await readInstalledState();
      requireMatch(installed?.phase === "dual-installed" && installed.isolationFingerprint === context.isolationFingerprint &&
        installed.keycloakPlanFingerprint === expectedPlanFingerprint && installed.keycloakCatalogFingerprint === expectedProjectionFingerprint &&
        installed.scadaCatalogMatched === true && installed.keycloakOwnerProjectionMatched === true &&
        installed.independentConnectionsClosed === true && installed.admissionPassed === false, "Keycloak 持久化独立状态证据不一致");
      return {
        status: "KEYCLOAK_OWNERSHIP_PERSISTED_STATE_VERIFIED", planFingerprint: expectedPlanFingerprint,
        baselineFingerprint: baseline.catalogFingerprint, projectionFingerprint: projected.catalogFingerprint,
        statementsExecuted, installed, transactionCatalogMatched: true, independentInstalledStateMatched: true,
        operatorObjectReviewConfirmed: true, operatorMaintenanceConfirmed: true, rolledBack: false,
        committed: true, databaseWritten: true, businessDataWritten: false, ownershipPersisted: true,
        runtimeLoginAllowed: false, schemaEvolutionVerified: false, businessAclApproved: false,
        admissionPassed: false, serviceSwitched: false,
      };
    } catch {
      failure = "Keycloak 目录事务已收到提交标签，但独立安装状态核验失败，禁止重试";
    }
  }
  if (failure) throw new DockerKeycloakOwnershipError(failure + (committed ? "；已收到目录事务提交标签" : rolledBack ? "；已收到目录事务回滚标签" : ""));
  requireMatch(!apply && rolledBack && closed && baseline && projected && independentBaseline, "Keycloak 演练缺少完整证据");
  return {
    status: "KEYCLOAK_OWNERSHIP_ROLLBACK_REHEARSED", planFingerprint: expectedPlanFingerprint,
    baselineFingerprint: baseline.catalogFingerprint, projectionFingerprint: projected.catalogFingerprint,
    statementsExecuted, transactionCatalogMatched: true, independentBaselineMatched: true,
    operatorObjectReviewConfirmed: true, operatorMaintenanceConfirmed: true,
    rolledBack: true, committed: false, databaseWritten: false, ownershipTransferAllowed: false,
    ownerProjectionVerified: false, schemaEvolutionVerified: false, runtimeLoginAllowed: false,
    businessAclApproved: false, admissionPassed: false, serviceSwitched: false,
  };
}
