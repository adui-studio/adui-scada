import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  acceptedPlanFingerprint,
  roundTripTarget,
} from "./prisma8-native-check-roundtrip-execution.mjs";

export const creationConfirmation = "--confirm-adui-scada-fresh-prisma8-roundtrip-create";
export const creationPasswordVariable = "SCADA_PRISMA8_NATIVE_ROUNDTRIP_PASSWORD";

const referenceCollation = Object.freeze({
  encoding: "UTF8",
  provider: "c",
  collate: "en_US.utf8",
  ctype: "en_US.utf8",
  locale: null,
  version: null,
  actualVersion: null,
});
const deniedPermissions = Object.freeze({
  portReserved: false,
  resourceCreationAllowed: false,
  observationSourceAuthenticated: false,
  databaseExecutionAllowed: false,
  roundTripVerified: false,
  historicalAdoptionVerified: false,
  signingAllowed: false,
  deploymentAllowed: false,
});

export class RoundTripCreationError extends Error {}

/** 只接受与已验收目录报告一致的完整观察，不认证调用者提供的报告来源。 */
function requireReference(report) {
  const expected = {
    status: "NATIVE_CHECK_ROUNDTRIP_REFERENCE_REVIEW_REQUIRED",
    planFingerprint: acceptedPlanFingerprint,
    target: roundTripTarget,
    hostPreflightPassed: true,
    portObservedUnused: true,
    ...deniedPermissions,
    referenceCatalogObserved: true,
    observedDatabaseCount: 4,
    observedClusterCount: 2,
    allFrozenCollationsMatch: true,
    allFrozenCollationCatalogMetadataMatch: true,
    containerImageIdentityMatched: true,
    localeRuntimePathsObservedUnchanged: true,
    collationRuntimeIdentityVerified: false,
    referenceCollation,
    recordedCollationVersionAvailable: false,
    recordedCollationVersionMatches: null,
    recordedCollationVersionStatus: "UNAVAILABLE",
  };
  if (!isDeepStrictEqual(report, expected)) {
    throw new RoundTripCreationError("第五座创建前参考观察与已验收边界不一致");
  }
}

/** 生成固定的待审批创建契约，不接受外部资源名、端口、镜像、环境或 SQL。 */
export function buildRoundTripCreationPlan(reference) {
  requireReference(reference);
  const payload = {
    scope: "NATIVE_CHECK_ROUNDTRIP_CREATION_PLAN_V1",
    roundTripPlanFingerprint: acceptedPlanFingerprint,
    target: { ...roundTripTarget },
    referenceCollation: { ...referenceCollation },
    collationRuntimeIdentityVerified: false,
    resources: {
      scopeLabel: "org.adui.scope=prisma8-check-roundtrip",
      volume: { driver: "local", destination: "/var/lib/postgresql/data" },
      network: { driver: "bridge", exclusive: true },
      publishedPort: { host: roundTripTarget.host, port: roundTripTarget.port, containerPort: 5432 },
      pullPolicy: "never",
      restartPolicy: "no",
      reuseExistingResources: false,
      preservePartialFailure: true,
    },
    initialization: {
      encoding: referenceCollation.encoding,
      localeProvider: "libc",
      locale: referenceCollation.collate,
      initdbArgs: [
        "--encoding=UTF8",
        "--locale-provider=libc",
        "--locale=en_US.utf8",
        "--auth-local=scram-sha-256",
        "--auth-host=scram-sha-256",
      ],
      hostAuthMethod: "scram-sha-256",
      passwordVariable: creationPasswordVariable,
      passwordRandomBytes: 32,
      passwordEncoding: "hex",
      bootstrapRoleIsSuperuser: true,
      readOnlySessionRequiredAfterInitialization: true,
    },
    requiredPostCreationChecks: [
      "CONTAINER_VOLUME_NETWORK_AND_PORT",
      "CONTAINER_AND_TCP_CLUSTER_IDENTITY",
      "FROZEN_CLUSTER_EXCLUSION",
      "ACTUAL_COLLATION_METADATA",
      "EMPTY_DATABASE_23_CATEGORIES",
      "NO_OTHER_SESSIONS",
    ],
    confirmation: creationConfirmation,
    ...deniedPermissions,
    creationAttemptClaimed: false,
  };
  const creationPlanFingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return {
    status: "NATIVE_CHECK_ROUNDTRIP_CREATION_REVIEW_REQUIRED",
    ...payload,
    creationPlanFingerprint,
  };
}

/** 只核对创建请求是否匹配刚复算的计划；不是认证、一次性消费或实际执行许可。 */
export function reviewRoundTripCreationRequest(args, freshReference) {
  const plan = buildRoundTripCreationPlan(freshReference);
  if (!isDeepStrictEqual(args, [creationConfirmation, plan.creationPlanFingerprint])) {
    throw new RoundTripCreationError("第五座创建请求缺少明确确认或固定创建计划指纹");
  }
  return { ...plan, creationRequestMatched: true };
}
