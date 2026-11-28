import assert from "node:assert/strict";
import { test } from "node:test";
import { buildKeycloakSchemaPolicy } from "./docker-db-role-keycloak-schema-policy.mjs";

const image = "sha256:" + "a".repeat(64);
const state = {
  phase: "dual-installed",
  keycloakOwnerProjectionMatched: true,
  scadaCatalogMatched: true,
  keycloakMaintenanceVerified: true,
  admissionPassed: false,
  isolationFingerprint: "b".repeat(64),
  scadaCatalogFingerprint: "c".repeat(64),
  keycloakPlanFingerprint: "d".repeat(64),
  keycloakCatalogFingerprint: "e".repeat(64),
  dualCatalogFingerprint: "f".repeat(64),
};

void test("固定已维护镜像的正常启动仅验证 Schema，手工迁移候选不自动执行", () => {
  const policy = buildKeycloakSchemaPolicy(image, state);
  assert.deepEqual(policy.normalStartupArgs, [
    "--spi-connections-jpa--quarkus--migration-strategy=validate",
    "--spi-connections-jpa--quarkus--initialize-empty=false",
    "--spi-connections-jpa--quarkus--auto-create-missing-indexes=false",
  ]);
  assert.equal(
    policy.maintenanceExportArgs[0],
    "--spi-connections-jpa--quarkus--migration-strategy=manual",
  );
  assert.equal(policy.ownerAlterDropCapabilityRetained, true);
  assert.equal(policy.schemaEvolutionVerified, false);
  assert.equal(policy.admissionPassed, false);
  assert.notEqual(
    buildKeycloakSchemaPolicy("sha256:" + "b".repeat(64), state).planFingerprint,
    policy.planFingerprint,
  );
  assert.notEqual(
    buildKeycloakSchemaPolicy(image, { ...state, keycloakCatalogFingerprint: "a".repeat(64) })
      .planFingerprint,
    policy.planFingerprint,
  );
});

void test("拒绝可变标签、缺失维护、阶段错误及目录指纹异常", () => {
  for (const [id, evidence] of [
    ["latest", state],
    [image, { ...state, keycloakMaintenanceVerified: false }],
    [image, { ...state, phase: "scada-installed" }],
    [image, { ...state, dualCatalogFingerprint: null }],
    [image, { ...state, admissionPassed: true }],
  ]) {
    assert.throws(() => buildKeycloakSchemaPolicy(id, evidence));
  }
});
