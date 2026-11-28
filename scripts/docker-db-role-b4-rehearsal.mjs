import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  buildScadaB4InstallPreflight,
  DockerB4PreflightError,
  readScadaB4BusinessPreparation,
  readScadaB4RehearsalPreparation,
  verifyScadaB4NewOwnerRoles,
} from "./docker-db-role-b4-preflight.mjs";
import {
  DockerBusinessAclPreviewError,
  scadaBusinessGrantCandidates,
} from "./docker-db-role-business-acl.mjs";
import { buildScadaLockRoutinePreview } from "./docker-db-role-lock-routines.mjs";
import {
  buildScadaOidcCleanupRoutinePreview,
  buildScadaRestrictedWritePreview,
} from "./docker-db-role-restricted-writes.mjs";
import {
  DockerB4PermissionReviewError,
  verifyScadaB4InstalledCatalog,
} from "./docker-db-role-b4-permission-review.mjs";
import { DockerB4RoutineReviewError } from "./docker-db-role-b4-routine-review.mjs";
import {
  DockerB4RuntimeProbeError,
  verifyScadaB4RuntimeProbe,
} from "./docker-db-role-b4-runtime-probe.mjs";

export class DockerB4RehearsalError extends Error {}

const lockedSql =
  "SELECT pg_catalog.pg_try_advisory_xact_lock(839572941652::bigint) AS locked, current_setting('transaction_isolation') AS isolation";
const hashPattern = /^[a-f0-9]{64}$/u;
const confirmation = "--confirm-rehearse-scada-b4";
const fixtureConfirmation = "--confirm-rollback-business-fixtures";

function requireMatch(condition, message) {
  if (!condition) throw new DockerB4RehearsalError(message);
}

function validHash(value) {
  return typeof value === "string" && hashPattern.test(value);
}

function requireIdentity(identity, storageHash, isolationFingerprint) {
  requireMatch(
    identity?.version === "190000" &&
      typeof identity.systemIdentifier === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier) &&
      validHash(storageHash) &&
      validHash(isolationFingerprint),
    "B4 演练集群、存储或隔离指纹无效",
  );
}

// SQL 仅来自仓库固定候选，禁止将外部报告中的 SQL 当作执行输入。
function fixedStatements(preparation, port) {
  requireMatch(preparation && typeof preparation === "object", "B4 演练准备报告无效");
  const preflight = buildScadaB4InstallPreflight([preparation.ownerInstallPreflight?.evidence]);
  requireMatch(
    isDeepStrictEqual(preflight, preparation.ownerInstallPreflight),
    "B4 角色创建候选漂移",
  );
  const locks = buildScadaLockRoutinePreview();
  const writes = buildScadaRestrictedWritePreview();
  const cleanup = buildScadaOidcCleanupRoutinePreview(port);
  const business = scadaBusinessGrantCandidates();
  const acl = preparation.businessAclPreview;
  requireMatch(
    acl?.planOnly === true &&
      acl.admissionPassed === false &&
      validHash(acl.planFingerprint) &&
      isDeepStrictEqual(acl.grants, business) &&
      isDeepStrictEqual(acl.lockRoutinePreview, locks) &&
      isDeepStrictEqual(acl.restrictedWritePreview, writes),
    "B4 业务权限候选漂移",
  );
  // pg.Result.command 仅返回 CREATE、ALTER 等命令类型，不返回完整服务器标签。
  const grant = (sql) => ({ sql, command: "GRANT" });
  const routine = (item) => [
    { sql: item.createSql, command: "CREATE" },
    { sql: item.revokePublicSql, command: "REVOKE" },
    { sql: item.ownerSql, command: "ALTER" },
    { sql: item.executeSql, command: "GRANT" },
  ];
  return {
    roles: preflight.roleCreationPreview.map((sql) => ({ sql, command: "CREATE" })),
    grantsAndRoutines: [
      ...locks.ownerGrants.map(grant),
      ...locks.definitions.flatMap(routine),
      ...writes.projectCreate.ownerGrants.map(grant),
      ...routine(writes.projectCreate),
      ...cleanup.ownerGrants.map(grant),
      ...routine(cleanup),
      ...business.map((item) => grant(item.sql)),
    ],
  };
}

/** 从已核验的目录报告构造只读演练预览；不批准执行或确认真实 Issuer。 */
export function buildScadaB4RehearsalPlan({
  identity,
  storageHash,
  isolationFingerprint,
  preparation,
  port,
}) {
  requireIdentity(identity, storageHash, isolationFingerprint);
  const statements = fixedStatements(preparation, port);
  const planFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        version: 2,
        runtimeProbeVersion: 1,
        serverVersion: identity.version,
        systemIdentifier: identity.systemIdentifier,
        storageHash,
        isolationFingerprint,
        port,
        preflightFingerprint: preparation.ownerInstallPreflight.planFingerprint,
        businessFingerprint: preparation.businessAclPreview.planFingerprint,
        statements,
      }),
    )
    .digest("hex");
  return {
    status: "SCADA_B4_REHEARSAL_PLAN_ONLY",
    planFingerprint,
    roleCount: statements.roles.length,
    statementCount: statements.roles.length + statements.grantsAndRoutines.length,
    businessFixtureRehearsalRequired: true,
    expectedPositiveCount: 36,
    expectedDeniedCount: 15,
    planOnly: true,
    installationAllowed: false,
    issuerBindingVerified: false,
    admissionPassed: false,
    databaseWritten: false,
  };
}

/**
 * 仅供未来受控宿主入口调用。宿主必须提供固定本机连接、真实 Issuer 与严格契约核验，
 * readHostBoundary 必须执行真实宿主严格契约、中文注释、集群及 OIDC 证据检查；
 * readIsolatedBaseline 必须在传入的同一事务内复核 B2/B3.3 并返回真实隔离指纹。
 * 回滚演练与持久化入口分别确认，任何目录证据均不等于正式业务准入。
 */
export async function runScadaB4RollbackRehearsal(options) {
  return runScadaB4Transaction(options, false);
}

/** 仅独立批准持久化且确认实际回滚演练指纹时允许提交固定目录事务。 */
export async function runScadaB4Persistence(options) {
  return runScadaB4Transaction(options, true);
}

async function runScadaB4Transaction(
  {
    confirm,
    confirmFixtures,
    confirmRehearsalVerified,
    identity,
    storageHash,
    isolationFingerprint,
    port,
    expectedPlanFingerprint,
    expectedCatalogFingerprint,
    createClient,
    readIsolatedBaseline,
    readHostBoundary,
    readInstalledState,
  },
  apply,
) {
  requireIdentity(identity, storageHash, isolationFingerprint);
  requireMatch(
    confirm === (apply ? "--confirm-apply-scada-b4" : confirmation) &&
      confirmFixtures === fixtureConfirmation &&
      validHash(expectedPlanFingerprint) &&
      (!apply ||
        (confirmRehearsalVerified === "--confirm-rehearsal-verified" &&
          validHash(expectedCatalogFingerprint) &&
          typeof readInstalledState === "function")) &&
      typeof createClient === "function" &&
      typeof readIsolatedBaseline === "function" &&
      typeof readHostBoundary === "function",
    "B4 演练或持久化缺少独立确认或受控宿主边界",
  );
  buildScadaOidcCleanupRoutinePreview(port);
  const expectedHost = {
    serverVersion: identity.version,
    systemIdentifier: identity.systemIdentifier,
    storageHash,
    issuer: new URL("https://127.0.0.1:" + port).origin + "/realms/adui-scada",
    strictContractVerified: true,
    commentsVerified: true,
    formalDiscoveryVerified: true,
  };
  const checkHost = async () => {
    try {
      requireMatch(
        isDeepStrictEqual(await readHostBoundary(), expectedHost),
        "B4 演练宿主证据不一致",
      );
    } catch {
      throw new DockerB4RehearsalError("B4 演练宿主严格契约、集群或 Issuer 核验失败");
    }
  };
  await checkHost();
  let client;
  let beginAttempted = false;
  let begun = false;
  let rolledBack = false;
  let closed = false;
  let commitAttempted = false;
  let committed = false;
  let stage = "连接";
  let failure;
  let plan;
  let catalog;
  let runtimeProbe;
  let statementsExecuted = 0;
  const checkBaseline = async (connection, readOnly) => {
    const baseline = await readIsolatedBaseline(connection, readOnly);
    requireMatch(
      isDeepStrictEqual(baseline, {
        planFingerprint: isolationFingerprint,
        catalogIsolationPersisted: true,
      }),
      "B4 演练隔离基线不一致",
    );
  };
  const checkPlan = (preparation) => {
    const current = buildScadaB4RehearsalPlan({
      identity,
      storageHash,
      isolationFingerprint,
      preparation,
      port,
    });
    requireMatch(current.planFingerprint === expectedPlanFingerprint, "B4 演练计划指纹不一致");
    return current;
  };
  const query = (connection) => async (_step, sql) => connection.query(sql);
  const execute = async (statements) => {
    for (const item of statements) {
      const label =
        "B4 演练第 " + (statementsExecuted + 1) + " 条固定目录语句（" + item.command + "）";
      let result;
      try {
        result = await client.query(item.sql);
      } catch {
        throw new DockerB4RehearsalError(label + "执行失败");
      }
      requireMatch(result?.command === item.command, label + "命令类型不一致");
      statementsExecuted++;
    }
  };
  try {
    client = createClient(false);
    await client.connect();
    stage = "事务启动";
    beginAttempted = true;
    requireMatch(
      (await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE")).command === "BEGIN",
      "B4 演练事务未确认启动",
    );
    begun = true;
    stage = "独立执行锁";
    requireMatch(
      isDeepStrictEqual((await client.query(lockedSql)).rows, [
        { locked: true, isolation: "serializable" },
      ]),
      "B4 演练未获得执行锁",
    );
    stage = "隔离基线";
    await checkBaseline(client, false);
    stage = "固定计划";
    const preparation = await readScadaB4RehearsalPreparation(query(client));
    plan = checkPlan(preparation);
    const statements = fixedStatements(preparation, port);
    stage = "函数校验设置";
    requireMatch(
      (await client.query("SET LOCAL check_function_bodies = on")).command === "SET",
      "B4 演练函数校验设置未确认",
    );
    stage = "创建三个专用角色";
    await execute(statements.roles);
    stage = "未授权所有者核验";
    await verifyScadaB4NewOwnerRoles(query(client));
    stage = "固定授权与例程安装";
    await execute(statements.grantsAndRoutines);
    stage = "安装后组合目录核验";
    catalog = await verifyScadaB4InstalledCatalog(query(client), port);
    requireMatch(
      catalog.installedCatalogMatched === true && statementsExecuted === plan.statementCount,
      "B4 演练后置目录证据不一致",
    );
    stage = "运行角色正反向业务夹具";
    runtimeProbe = await verifyScadaB4RuntimeProbe(client, port);
    requireMatch(
      runtimeProbe.runtimeStatementsVerified === true &&
        runtimeProbe.fixturesRolledBack === true &&
        runtimeProbe.positiveCount === plan.expectedPositiveCount &&
        runtimeProbe.deniedCount === plan.expectedDeniedCount,
      "B4 运行角色演练证据不一致",
    );
    if (apply) {
      stage = "持久化前演练目录指纹";
      requireMatch(
        catalog.catalogFingerprint === expectedCatalogFingerprint,
        "B4 已核验演练目录指纹不一致",
      );
      stage = "目录事务提交";
      commitAttempted = true;
      requireMatch((await client.query("COMMIT")).command === "COMMIT", "B4 持久化提交标签异常");
      committed = true;
    }
  } catch (error) {
    failure = "B4 演练" + stage + "失败，内部诊断已脱敏";
    if (
      error instanceof DockerB4RehearsalError ||
      error instanceof DockerB4PreflightError ||
      error instanceof DockerBusinessAclPreviewError ||
      error instanceof DockerB4PermissionReviewError ||
      error instanceof DockerB4RoutineReviewError ||
      error instanceof DockerB4RuntimeProbeError
    )
      failure += "；" + error.message;
  }
  if (commitAttempted && !committed)
    failure = "B4 持久化提交结果未知，禁止重试；必须先独立核查实际目录";
  if (beginAttempted && !commitAttempted) {
    try {
      requireMatch(
        (await client.query("ROLLBACK")).command === "ROLLBACK",
        "B4 演练未收到回滚标签",
      );
      rolledBack = begun;
      if (!begun) failure = (failure ?? "B4 演练") + "；事务启动状态未知，禁止重试";
    } catch {
      failure = (failure ?? "B4 演练") + "；回滚未确认，禁止重试";
    }
  }
  if (client) {
    try {
      await client.end();
      closed = true;
    } catch {
      failure = (failure ?? "B4 演练") + "；连接关闭失败，禁止重试";
    }
  }
  // 回滚标签及原连接关闭均已确认，才允许使用独立只读连接核对原始基线。
  if (rolledBack && closed) {
    let independent;
    let readAttempted = false;
    let checked = false;
    try {
      independent = createClient(true);
      requireMatch(independent !== client, "B4 演练独立连接复用原客户端");
      await independent.connect();
      readAttempted = true;
      requireMatch(
        (await independent.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")).command ===
          "BEGIN",
        "B4 演练独立事务未确认启动",
      );
      await checkBaseline(independent, true);
      checkPlan(await readScadaB4BusinessPreparation(query(independent)));
      checked = true;
    } catch {
      failure = (failure ?? "B4 演练已回滚") + "；独立基线核验失败，禁止重试";
    }
    if (readAttempted) {
      try {
        requireMatch(
          (await independent.query("ROLLBACK")).command === "ROLLBACK",
          "B4 演练独立回滚标签异常",
        );
      } catch {
        failure = (failure ?? "B4 演练已回滚") + "；独立只读回滚未确认，禁止重试";
      }
    }
    if (independent && independent !== client) {
      try {
        await independent.end();
      } catch {
        failure = (failure ?? "B4 演练已回滚") + "；独立连接关闭失败，禁止重试";
      }
    }
    if (!checked && !failure) failure = "B4 演练独立基线核验未确认，禁止重试";
    try {
      await checkHost();
    } catch {
      failure = (failure ?? "B4 演练已回滚") + "；独立宿主核验失败，禁止重试";
    }
  }
  if (committed && closed && !failure) {
    try {
      const installed = await readInstalledState();
      requireMatch(
        installed?.phase === "scada-installed" &&
          installed.isolationFingerprint === isolationFingerprint &&
          installed.scadaCatalogFingerprint === expectedCatalogFingerprint &&
          installed.scadaCatalogMatched === true &&
          installed.keycloakBaselineMatched === true &&
          installed.independentConnectionsClosed === true &&
          installed.admissionPassed === false,
        "B4 持久化独立状态证据不一致",
      );
      return {
        status: "SCADA_B4_PERSISTED_STATE_VERIFIED",
        planFingerprint: plan.planFingerprint,
        catalogFingerprint: catalog.catalogFingerprint,
        statementsExecuted,
        runtimeProbe,
        installed,
        transactionCatalogMatched: true,
        independentInstalledStateMatched: true,
        rolledBack: false,
        committed: true,
        databaseWritten: true,
        businessDataWritten: false,
        ownerRolesPersisted: true,
        runtimeLoginAllowed: false,
        businessAclApproved: false,
        admissionPassed: false,
        serviceSwitched: false,
      };
    } catch {
      failure = "B4 目录事务已收到提交标签，但独立安装状态核验失败，禁止重试";
    }
  }
  if (failure)
    throw new DockerB4RehearsalError(
      failure +
        (committed ? "；目录事务已收到提交标签" : rolledBack ? "；目录事务已收到回滚标签" : ""),
    );
  requireMatch(
    !apply && rolledBack && closed && plan && catalog && runtimeProbe,
    "B4 演练未取得完整证据",
  );
  return {
    status: "SCADA_B4_ROLLBACK_REHEARSED",
    planFingerprint: plan.planFingerprint,
    catalogFingerprint: catalog.catalogFingerprint,
    statementsExecuted,
    runtimeProbe,
    transactionCatalogMatched: true,
    independentBaselineMatched: true,
    rolledBack: true,
    committed: false,
    databaseWritten: false,
    businessDataWritten: false,
    ownerRolesPersisted: false,
    installationAllowed: false,
    issuerBindingVerified: false,
    definerSafetyVerified: false,
    rowLockVerified: false,
    rowAuthorizationVerified: false,
    businessAclApproved: false,
    admissionPassed: false,
    serviceSwitched: false,
  };
}
