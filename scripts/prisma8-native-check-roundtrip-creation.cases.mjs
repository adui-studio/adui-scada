import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  acceptedPlanFingerprint,
  roundTripTarget,
} from "./prisma8-native-check-roundtrip-execution.mjs";
import {
  buildRoundTripCreationPlan,
  creationConfirmation,
  creationPasswordVariable,
  reviewRoundTripCreationRequest,
} from "./prisma8-native-check-roundtrip-creation.mjs";

const permissionKeys = [
  "portReserved",
  "resourceCreationAllowed",
  "observationSourceAuthenticated",
  "databaseExecutionAllowed",
  "roundTripVerified",
  "historicalAdoptionVerified",
  "signingAllowed",
  "deploymentAllowed",
];

function fixture() {
  return {
    status: "NATIVE_CHECK_ROUNDTRIP_REFERENCE_REVIEW_REQUIRED",
    planFingerprint: acceptedPlanFingerprint,
    target: { ...roundTripTarget },
    hostPreflightPassed: true,
    portObservedUnused: true,
    ...Object.fromEntries(permissionKeys.map((key) => [key, false])),
    referenceCatalogObserved: true,
    observedDatabaseCount: 4,
    observedClusterCount: 2,
    allFrozenCollationsMatch: true,
    allFrozenCollationCatalogMetadataMatch: true,
    containerImageIdentityMatched: true,
    localeRuntimePathsObservedUnchanged: true,
    collationRuntimeIdentityVerified: false,
    referenceCollation: {
      encoding: "UTF8",
      provider: "c",
      collate: "en_US.utf8",
      ctype: "en_US.utf8",
      locale: null,
      version: null,
      actualVersion: null,
    },
    recordedCollationVersionAvailable: false,
    recordedCollationVersionMatches: null,
    recordedCollationVersionStatus: "UNAVAILABLE",
  };
}

function assertDenied(report) {
  for (const key of permissionKeys) assert.equal(report[key], false);
  assert.equal(report.creationAttemptClaimed, false);
  assert.equal(report.collationRuntimeIdentityVerified, false);
}

void test("第五座创建计划绑定真实参考元数据及固定独立资源", () => {
  const plan = buildRoundTripCreationPlan(fixture());
  assert.equal(plan.status, "NATIVE_CHECK_ROUNDTRIP_CREATION_REVIEW_REQUIRED");
  assert.equal(plan.roundTripPlanFingerprint, acceptedPlanFingerprint);
  assert.deepEqual(plan.target, roundTripTarget);
  assert.deepEqual(plan.resources, {
    scopeLabel: "org.adui.scope=prisma8-check-roundtrip",
    volume: { driver: "local", destination: "/var/lib/postgresql/data" },
    network: { driver: "bridge", exclusive: true },
    publishedPort: { host: "127.0.0.1", port: 15444, containerPort: 5432 },
    pullPolicy: "never",
    restartPolicy: "no",
    reuseExistingResources: false,
    preservePartialFailure: true,
  });
  assert.deepEqual(plan.referenceCollation, fixture().referenceCollation);
  assert.deepEqual(plan.requiredPostCreationChecks, [
    "CONTAINER_VOLUME_NETWORK_AND_PORT",
    "CONTAINER_AND_TCP_CLUSTER_IDENTITY",
    "FROZEN_CLUSTER_EXCLUSION",
    "ACTUAL_COLLATION_METADATA",
    "EMPTY_DATABASE_23_CATEGORIES",
    "NO_OTHER_SESSIONS",
  ]);
  assertDenied(plan);
});

void test("初始化使用明确 locale 与双向口令认证而不输出凭据", () => {
  const plan = buildRoundTripCreationPlan(fixture());
  assert.deepEqual(plan.initialization, {
    encoding: "UTF8",
    localeProvider: "libc",
    locale: "en_US.utf8",
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
  });
  assert.doesNotMatch(JSON.stringify(plan), /postgresql:\/\/|POSTGRES_PASSWORD=/u);
  assertDenied(plan);
});

void test("创建计划指纹独立于原往返计划且可确定性复算", () => {
  const plan = buildRoundTripCreationPlan(fixture());
  const { status, creationPlanFingerprint, ...payload } = plan;
  assert.equal(status, "NATIVE_CHECK_ROUNDTRIP_CREATION_REVIEW_REQUIRED");
  assert.equal(creationPlanFingerprint, createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
  assert.equal(creationPlanFingerprint, "69cd50940b9e3ff9752aa45eea3ff60bc34214ca7127908259a54897c6013dd7");
  assert.notEqual(creationPlanFingerprint, acceptedPlanFingerprint);
  plan.target.port = 15434;
  assert.equal(buildRoundTripCreationPlan(fixture()).target.port, 15444);
  assert.equal(buildRoundTripCreationPlan(fixture()).creationPlanFingerprint, creationPlanFingerprint);
});

void test("拒绝旧端口、外部主机、资源名、角色和镜像变化", () => {
  for (const target of [
    { port: 15434 },
    { host: "0.0.0.0" },
    { database: "adui_scada_test" },
    { role: "adui_scada" },
    { container: "adui-scada-prisma8-repro" },
    { volume: "adui-scada-prisma8-repro-data" },
    { network: "bridge" },
    { image: "postgres:latest" },
    { serverVersionNum: 170010 },
  ]) {
    assert.throws(
      () => buildRoundTripCreationPlan({ ...fixture(), target: { ...roundTripTarget, ...target } }),
      /参考观察与已验收边界不一致/u,
    );
  }
});

void test("拒绝预检失败、缺失字段、集群数量及虚构许可变化", () => {
  for (const changes of [
    { status: "NATIVE_CHECK_ROUNDTRIP_HOST_REVIEW_REQUIRED" },
    { planFingerprint: "0".repeat(64) },
    { hostPreflightPassed: false },
    { portObservedUnused: false },
    { referenceCatalogObserved: false },
    { observedDatabaseCount: 3 },
    { observedClusterCount: 1 },
    { allFrozenCollationsMatch: false },
    { allFrozenCollationCatalogMetadataMatch: false },
    { containerImageIdentityMatched: false },
    { localeRuntimePathsObservedUnchanged: false },
    { collationRuntimeIdentityVerified: true },
    { password: "secret" },
    ...permissionKeys.map((key) => ({ [key]: true })),
  ]) {
    assert.throws(() => buildRoundTripCreationPlan({ ...fixture(), ...changes }), {
      message: "第五座创建前参考观察与已验收边界不一致",
    });
  }
  const { recordedCollationVersionStatus, ...missing } = fixture();
  assert.equal(recordedCollationVersionStatus, "UNAVAILABLE");
  assert.throws(() => buildRoundTripCreationPlan(missing), /参考观察与已验收边界不一致/u);
});

void test("版本缺失不得冒充已核验，拒绝排序规则和版本漂移", () => {
  for (const changes of [
    { recordedCollationVersionMatches: true },
    { recordedCollationVersionAvailable: true },
    { recordedCollationVersionStatus: "MATCHED" },
    { referenceCollation: { ...fixture().referenceCollation, ctype: "C" } },
    { referenceCollation: { ...fixture().referenceCollation, actualVersion: "2.36" } },
    { referenceCollation: { ...fixture().referenceCollation, provider: "i", locale: "en-US" } },
  ]) {
    assert.throws(() => buildRoundTripCreationPlan({ ...fixture(), ...changes }), /参考观察与已验收边界不一致/u);
  }
});

void test("创建请求必须同时匹配专用确认参数与新计划指纹，仍不授予许可", () => {
  const reference = fixture();
  const plan = buildRoundTripCreationPlan(reference);
  const args = [creationConfirmation, plan.creationPlanFingerprint];
  const reviewed = reviewRoundTripCreationRequest(args, reference);
  assert.deepEqual(reviewed, { ...plan, creationRequestMatched: true });
  assertDenied(reviewed);
  for (const invalid of [[], [creationConfirmation], [creationConfirmation, acceptedPlanFingerprint], [plan.creationPlanFingerprint, creationConfirmation], [...args, "--extra"], ["--confirm-frozen-catalog-readonly", plan.creationPlanFingerprint]]) {
    assert.throws(() => reviewRoundTripCreationRequest(invalid, reference), /创建请求缺少明确确认或固定创建计划指纹/u);
  }
});

void test("已匹配的确认参数不能替代重新核对参考报告", () => {
  const plan = buildRoundTripCreationPlan(fixture());
  const args = [creationConfirmation, plan.creationPlanFingerprint];
  assert.throws(
    () => reviewRoundTripCreationRequest(args, { ...fixture(), portObservedUnused: false }),
    /参考观察与已验收边界不一致/u,
  );
});
