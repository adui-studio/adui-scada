import { createHash } from "node:crypto";

/** 仅绑定实际本机镜像及双库状态，生成后续正常启动与迁移维护候选，不执行启动或 DDL。 */
export function buildKeycloakSchemaPolicy(imageId, installed) {
  const fingerprints = [
    "isolationFingerprint",
    "scadaCatalogFingerprint",
    "keycloakPlanFingerprint",
    "keycloakCatalogFingerprint",
    "dualCatalogFingerprint",
  ];
  if (
    typeof imageId !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(imageId) ||
    installed?.phase !== "dual-installed" ||
    installed.keycloakOwnerProjectionMatched !== true ||
    installed.scadaCatalogMatched !== true ||
    installed.keycloakMaintenanceVerified !== true ||
    installed.admissionPassed !== false ||
    !fingerprints.every(
      (key) => typeof installed[key] === "string" && /^[a-f0-9]{64}$/u.test(installed[key]),
    )
  ) {
    throw new Error("Keycloak Schema 演进候选缺少固定镜像或完整双库维护证据");
  }
  const normalStartupArgs = [
    "--spi-connections-jpa--quarkus--migration-strategy=validate",
    "--spi-connections-jpa--quarkus--initialize-empty=false",
    "--spi-connections-jpa--quarkus--auto-create-missing-indexes=false",
  ];
  const maintenanceExportArgs = [
    "--spi-connections-jpa--quarkus--migration-strategy=manual",
    "--spi-connections-jpa--quarkus--initialize-empty=false",
    "--spi-connections-jpa--quarkus--auto-create-missing-indexes=false",
  ];
  const planFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        formatVersion: 1,
        imageId,
        installed: Object.fromEntries(fingerprints.map((key) => [key, installed[key]])),
        normalStartupArgs,
        maintenanceExportArgs,
      }),
    )
    .digest("hex");
  return {
    status: "KEYCLOAK_SCHEMA_POLICY_REVIEW_ONLY",
    imageId,
    planFingerprint,
    normalStartupArgs,
    maintenanceExportArgs,
    runtimeSchemaCreateAllowed: false,
    ownerAlterDropCapabilityRetained: true,
    automaticMigrationAllowed: false,
    migrationApprovalRequired: true,
    backupRestoreReviewRequired: true,
    pinnedDeploymentImageRequired: true,
    isolatedStartupValidationRequired: true,
    schemaEvolutionVerified: false,
    admissionPassed: false,
    databaseWritten: false,
    serviceSwitched: false,
  };
}
