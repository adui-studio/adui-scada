import { isDeepStrictEqual } from "node:util";
import { readDockerIsolationDirectory } from "./docker-db-role-isolation.mjs";
import { reviewDockerB4IsolationInventory } from "./docker-db-role-isolation-plan.mjs";
import {
  readDockerBusinessRoleDirectory,
  verifyDockerRoleObjectIdentity,
} from "./docker-db-role-review.mjs";
import {
  verifyScadaB4CompletedCatalog,
  verifyScadaB4InstalledCatalog,
} from "./docker-db-role-b4-permission-review.mjs";
import {
  readKeycloakOwnershipCandidate,
  verifyKeycloakOwnershipBaseline,
} from "./docker-db-role-keycloak-plan.mjs";

export class DockerB4InstalledStateError extends Error {}

const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const begin = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const sharedLock =
  "SELECT pg_catalog.pg_try_advisory_xact_lock_shared(839572941652::bigint) AS locked, current_setting('transaction_isolation') AS isolation";
const quietSql =
  "SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname = current_database() AND pid <> pg_catalog.pg_backend_pid()) AS quiet";

function requireMatch(condition, message) {
  if (!condition) throw new DockerB4InstalledStateError(message);
}

/** 已持久化状态必须由调用者明确指定，不自动猜测半完成状态或补执行。 */
export async function readB4InstalledState({
  phase,
  context,
  port,
  expectedScadaCatalogFingerprint,
  expectedKeycloakPlanFingerprint,
  expectedKeycloakProjectionFingerprint,
  requireMaintenance = phase === "dual-installed",
  createClient,
  readHostBoundary,
}) {
  const dual = phase === "dual-installed";
  requireMatch(
    (dual || phase === "scada-installed") &&
      typeof requireMaintenance === "boolean" &&
      (!dual || requireMaintenance) &&
      context?.identity?.version === "190000" &&
      typeof context.identity.systemIdentifier === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(context.identity.systemIdentifier) &&
      hash(context.storageHash) &&
      hash(context.isolationFingerprint) &&
      hash(expectedScadaCatalogFingerprint) &&
      hash(expectedKeycloakPlanFingerprint) &&
      (dual
        ? hash(expectedKeycloakProjectionFingerprint)
        : expectedKeycloakProjectionFingerprint === undefined) &&
      typeof port === "string" &&
      /^[1-9][0-9]{0,4}$/u.test(port) &&
      Number(port) <= 65535 &&
      typeof createClient === "function" &&
      typeof readHostBoundary === "function",
    "B4 安装状态缺少明确阶段、指纹或受控宿主",
  );
  const { identity, storageHash, isolationFingerprint } = context;
  const expectedHost = {
    serverVersion: identity.version,
    systemIdentifier: identity.systemIdentifier,
    storageHash,
    strictContractVerified: true,
    commentsVerified: true,
    keycloakMaintenanceVerified: requireMaintenance,
  };
  const clients = [];
  let stage = "宿主前置";
  let failure;
  let scada;
  let keycloak;
  let isolation;
  let result;
  const checkHost = async () =>
    requireMatch(
      isDeepStrictEqual(await readHostBoundary(), expectedHost),
      "B4 安装状态宿主证据不一致",
    );
  const checkQuiet = async (client) => {
    requireMatch(
      (await client.query("SELECT pg_catalog.pg_stat_clear_snapshot()")).command === "SELECT",
      "Keycloak 会话快照刷新未确认",
    );
    requireMatch(
      isDeepStrictEqual((await client.query(quietSql)).rows, [{ quiet: true }]),
      "Keycloak 库仍存在其他会话",
    );
  };
  const query = (client) => (_step, sql) => client.query(sql);
  const open = async (database) => {
    const client = createClient(database);
    requireMatch(
      client && !clients.some((entry) => entry.client === client),
      "B4 安装状态必须使用双库独立连接",
    );
    const entry = { client, attempted: false };
    clients.push(entry);
    await client.connect();
    entry.attempted = true;
    requireMatch((await client.query(begin)).command === "BEGIN", "B4 安装状态只读事务未确认启动");
    await verifyDockerRoleObjectIdentity(client, database, identity);
    requireMatch(
      isDeepStrictEqual((await client.query(sharedLock)).rows, [
        { locked: true, isolation: "repeatable read" },
      ]),
      "B4 安装状态未获得共享核验锁",
    );
    return client;
  };
  try {
    await checkHost();
    stage = "双库独立只读事务";
    const scadaClient = await open("adui_scada");
    const keycloakClient = await open("adui_scada_keycloak");
    if (requireMaintenance) await checkQuiet(keycloakClient);
    stage = "B3.3 隔离指纹恢复";
    await readDockerBusinessRoleDirectory(scadaClient, identity, storageHash, true);
    isolation = reviewDockerB4IsolationInventory(
      await readDockerIsolationDirectory(query(scadaClient), "b4-installed"),
      identity,
      storageHash,
    );
    requireMatch(isolation.planFingerprint === isolationFingerprint, "B4 安装状态隔离指纹不一致");
    stage = "双库精确权限与所有权目录";
    if (dual) {
      result = await verifyScadaB4CompletedCatalog({
        scadaQuery: query(scadaClient),
        keycloakQuery: query(keycloakClient),
        context,
        port,
        expectedKeycloakPlanFingerprint,
      });
      scada = result.scada;
      keycloak = result.keycloak;
      requireMatch(
        keycloak.catalogFingerprint === expectedKeycloakProjectionFingerprint,
        "Keycloak 已提交投影指纹不一致",
      );
    } else {
      const candidate = await readKeycloakOwnershipCandidate(query(keycloakClient), context);
      keycloak = await verifyKeycloakOwnershipBaseline(
        query(keycloakClient),
        context,
        candidate,
        expectedKeycloakPlanFingerprint,
      );
      scada = await verifyScadaB4InstalledCatalog(query(scadaClient), port);
    }
    requireMatch(
      scada.baseCatalogFingerprint === expectedScadaCatalogFingerprint &&
        scada.installedCatalogMatched === true &&
        (dual
          ? keycloak.ownerProjectionMatched === true
          : keycloak.baselineCatalogMatched === true),
      "B4 安装状态阶段或 SCADA 目录指纹不一致",
    );
    if (requireMaintenance) await checkQuiet(keycloakClient);
    await verifyDockerRoleObjectIdentity(scadaClient, "adui_scada", identity);
    await verifyDockerRoleObjectIdentity(keycloakClient, "adui_scada_keycloak", identity);
  } catch (error) {
    failure = "B4 安装状态" + stage + "失败，内部诊断已脱敏";
    if (error instanceof DockerB4InstalledStateError) failure += "；" + error.message;
  } finally {
    for (const { client, attempted } of clients.reverse()) {
      if (attempted) {
        try {
          requireMatch(
            (await client.query("ROLLBACK")).command === "ROLLBACK",
            "B4 安装状态回滚标签异常",
          );
        } catch {
          failure = (failure ?? "B4 安装状态") + "；只读事务回滚未确认，禁止重试";
        }
      }
      try {
        await client.end();
      } catch {
        failure = (failure ?? "B4 安装状态") + "；连接关闭失败，禁止重试";
      }
    }
  }
  if (failure) throw new DockerB4InstalledStateError(failure);
  await checkHost();
  return {
    status: dual ? "B4_DUAL_INSTALLED_STATE_VERIFIED" : "B4_SCADA_INSTALLED_STATE_VERIFIED",
    phase,
    isolationFingerprint,
    scadaCatalogFingerprint: scada.baseCatalogFingerprint,
    keycloakPlanFingerprint: expectedKeycloakPlanFingerprint,
    keycloakCatalogFingerprint: keycloak.catalogFingerprint,
    dualCatalogFingerprint: result?.catalogFingerprint ?? null,
    b4OwnerRoleCount: isolation.b4OwnerRoleCount,
    b4OwnerDatabasePermissionsDenied: true,
    catalogIsolationPersisted: true,
    scadaCatalogMatched: true,
    keycloakOwnerProjectionMatched: dual,
    keycloakBaselineMatched: !dual,
    keycloakMaintenanceVerified: requireMaintenance,
    crossDatabaseAtomicSnapshotVerified: false,
    independentConnectionsClosed: true,
    databaseWritten: false,
    businessDataWritten: false,
    runtimeLoginAllowed: false,
    schemaEvolutionVerified: false,
    rowLockConcurrencyVerified: false,
    rowAuthorizationVerified: false,
    admissionPassed: false,
    serviceSwitched: false,
  };
}
