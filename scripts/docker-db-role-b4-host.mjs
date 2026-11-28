import { isDeepStrictEqual } from "node:util";
import { readScadaB4BusinessPreparation } from "./docker-db-role-b4-preflight.mjs";
import {
  buildScadaB4RehearsalPlan,
  DockerB4RehearsalError,
} from "./docker-db-role-b4-rehearsal.mjs";

function requireMatch(condition, message) {
  if (!condition) throw new DockerB4RehearsalError(message);
}

/** 将现有 B2/B3 核验器绑定到调用者的同一连接，不重新连接或启动事务。 */
export function createScadaB4IsolationReader({
  report,
  identity,
  storageHash,
  validateBootstrap,
  readDirectory,
  verifyPrepared,
  readIsolationDirectory,
  reviewIsolationInventory,
}) {
  const baseline = structuredClone(report);
  requireMatch(
    baseline?.role?.scadaRuntimeExists === true &&
      baseline.role.keycloakRuntimeExists === true &&
      baseline.databases?.adui_scada?.publicConnect === false &&
      baseline.databases?.adui_scada_keycloak?.publicConnect === false,
    "B4 要求 B3.3 已实际隔离",
  );
  validateBootstrap(
    {
      ...baseline,
      role: { ...baseline.role, scadaRuntimeExists: false, keycloakRuntimeExists: false },
    },
    storageHash,
    true,
  );
  const expected = { role: baseline.role, databases: baseline.databases, scada: baseline.scada };
  return async (client, readOnly) => {
    let stage = "管理身份及业务目录";
    try {
      requireMatch(
        typeof readOnly === "boolean" &&
          isDeepStrictEqual(await readDirectory(client, identity, storageHash, readOnly), expected),
        "B4 隔离前置目录不一致",
      );
      stage = "独立角色及启动授权";
      await verifyPrepared(client, identity, storageHash, true);
      stage = "全集群隔离目录";
      const inventory = await readIsolationDirectory((_step, sql) => client.query(sql));
      const plan = reviewIsolationInventory(inventory, identity, storageHash, true);
      requireMatch(
        typeof plan?.planFingerprint === "string" && /^[a-f0-9]{64}$/u.test(plan.planFingerprint),
        "B4 隔离指纹无效",
      );
      stage = "后置管理身份及业务目录";
      requireMatch(
        isDeepStrictEqual(await readDirectory(client, identity, storageHash, readOnly), expected),
        "B4 隔离后置目录不一致",
      );
      return { planFingerprint: plan.planFingerprint, catalogIsolationPersisted: true };
    } catch {
      throw new DockerB4RehearsalError("B4 同事务" + stage + "核验失败");
    }
  };
}

/** 将严格契约、注释及正式 Discovery 绑定到固定集群和部署 Issuer。 */
export function createScadaB4HostReader({
  identity,
  storageHash,
  port,
  inspectIdentity,
  verifyContract,
  verifyComments,
  verifyOidc,
}) {
  requireMatch(
    typeof port === "string" && /^[1-9][0-9]{0,4}$/u.test(port) && Number(port) <= 65535,
    "B4 宿主端口无效",
  );
  const issuer = new URL("https://127.0.0.1:" + port).origin + "/realms/adui-scada";
  return async () => {
    let stage = "前置集群身份";
    try {
      requireMatch(isDeepStrictEqual(await inspectIdentity(), identity), "B4 宿主集群不一致");
      stage = "官方严格契约";
      requireMatch((await verifyContract()) === true, "B4 宿主契约未确认");
      stage = "中文注释";
      requireMatch((await verifyComments()) === true, "B4 宿主注释未确认");
      stage = "正式 OIDC Discovery";
      requireMatch(
        isDeepStrictEqual(await verifyOidc(), { issuer, formalDiscoveryVerified: true }),
        "B4 宿主 Issuer 未确认",
      );
      stage = "后置集群身份";
      requireMatch(isDeepStrictEqual(await inspectIdentity(), identity), "B4 宿主集群不一致");
      return {
        serverVersion: identity.version,
        systemIdentifier: identity.systemIdentifier,
        storageHash,
        issuer,
        strictContractVerified: true,
        commentsVerified: true,
        formalDiscoveryVerified: true,
      };
    } catch {
      throw new DockerB4RehearsalError("B4 宿主" + stage + "核验失败");
    }
  };
}

/** 生成真实宿主只读计划；连接和回滚必须确认后才能返回指纹。 */
export async function readScadaB4HostPlan({
  identity,
  storageHash,
  port,
  createClient,
  readIsolatedBaseline,
  readHostBoundary,
}) {
  const before = await readHostBoundary();
  const expectedHost = {
    serverVersion: identity.version,
    systemIdentifier: identity.systemIdentifier,
    storageHash,
    issuer: new URL("https://127.0.0.1:" + port).origin + "/realms/adui-scada",
    strictContractVerified: true,
    commentsVerified: true,
    formalDiscoveryVerified: true,
  };
  requireMatch(isDeepStrictEqual(before, expectedHost), "B4 计划宿主证据不一致");
  let client;
  let beginAttempted = false;
  let result;
  let failure;
  try {
    client = createClient(true);
    await client.connect();
    beginAttempted = true;
    requireMatch(
      (await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")).command === "BEGIN",
      "B4 计划事务未确认启动",
    );
    const baseline = await readIsolatedBaseline(client, true);
    requireMatch(baseline?.catalogIsolationPersisted === true, "B4 计划隔离未确认");
    const preparation = await readScadaB4BusinessPreparation((_step, sql) => client.query(sql));
    requireMatch(
      isDeepStrictEqual(await readIsolatedBaseline(client, true), baseline),
      "B4 计划隔离基线发生变化",
    );
    result = {
      ...buildScadaB4RehearsalPlan({
        identity,
        storageHash,
        isolationFingerprint: baseline.planFingerprint,
        preparation,
        port,
      }),
      isolationFingerprint: baseline.planFingerprint,
    };
  } catch {
    failure = "B4 只读计划查询失败，内部诊断已脱敏";
  }
  if (beginAttempted) {
    try {
      requireMatch(
        (await client.query("ROLLBACK")).command === "ROLLBACK",
        "B4 计划回滚标签不一致",
      );
    } catch {
      failure = (failure ?? "B4 计划") + "；回滚未确认，禁止重试";
    }
  }
  if (client) {
    try {
      await client.end();
    } catch {
      failure = (failure ?? "B4 计划") + "；连接关闭失败，禁止重试";
    }
  }
  if (failure) throw new DockerB4RehearsalError(failure);
  requireMatch(isDeepStrictEqual(await readHostBoundary(), before), "B4 计划宿主证据发生变化");
  requireMatch(result, "B4 计划缺少完整证据");
  return { ...result, rolledBack: true, hostBoundaryVerified: true };
}
