const hash = /^[a-f0-9]{64}$/u;

function fingerprint(value, name) {
  const prefix = "--" + name + "=";
  if (
    typeof value !== "string" ||
    !value.startsWith(prefix) ||
    !hash.test(value.slice(prefix.length))
  ) {
    throw new Error("B4 参数缺少独立确认指纹：" + name);
  }
  return value.slice(prefix.length);
}

function requireArgs(args, prefix, names) {
  if (
    args.length !== prefix.length + names.length ||
    !prefix.every((item, index) => args[index] === item)
  ) {
    throw new Error("B4 持久化或状态命令必须完整明确指定确认参数");
  }
  return Object.fromEntries(
    names.map(([name, field], index) => [field, fingerprint(args[prefix.length + index], name)]),
  );
}

/** 不支持自动推进、默认提交或任意参数拼接；既有演练入口不变。 */
export function parseB4PersistenceAction(args) {
  const isolation = ["isolation-fingerprint", "isolationFingerprint"];
  const scada = ["scada-catalog-fingerprint", "expectedScadaCatalogFingerprint"];
  const keycloak = ["keycloak-plan-fingerprint", "expectedKeycloakPlanFingerprint"];
  const projection = ["projection-fingerprint", "expectedKeycloakProjectionFingerprint"];
  if (args[0] === "--role-b4-apply") {
    return {
      action: "role-b4-apply",
      ...requireArgs(
        args,
        [
          "--role-b4-apply",
          "--confirm-apply-scada-b4",
          "--confirm-rehearsal-verified",
          "--confirm-rollback-business-fixtures",
        ],
        [
          ["plan-fingerprint", "expectedPlanFingerprint"],
          ["catalog-fingerprint", "expectedScadaCatalogFingerprint"],
          keycloak,
        ],
      ),
    };
  }
  if (args[0] === "--role-keycloak-apply") {
    return {
      action: "role-keycloak-apply",
      ...requireArgs(
        args,
        [
          "--role-keycloak-apply",
          "--confirm-apply-keycloak-ownership",
          "--confirm-rehearsal-verified",
          "--reviewed-keycloak-objects",
          "--confirm-keycloak-maintenance",
        ],
        [isolation, scada, keycloak, projection],
      ),
    };
  }
  const fixtureModes = {
    "--role-b4-fixture-preflight": {
      mode: "preflight",
      confirm: "--confirm-readonly-fixture-preflight",
    },
    "--role-b4-fixture-create": {
      mode: "create",
      confirm: "--confirm-create-isolated-fixture",
    },
    "--role-b4-fixture-cleanup": {
      mode: "cleanup",
      confirm: "--confirm-cleanup-isolated-fixture",
    },
  };
  if (Object.hasOwn(fixtureModes, args[0])) {
    const { mode, confirm } = fixtureModes[args[0]];
    const prefix = [args[0], confirm];
    if (mode !== "preflight") {
      prefix.push("--confirm-exclusive-maintenance", "--confirm-backup-restore-reviewed");
    }
    const names = [
      isolation,
      scada,
      keycloak,
      projection,
      ["dual-catalog-fingerprint", "expectedDualCatalogFingerprint"],
      ["schema-policy-fingerprint", "expectedSchemaPolicyFingerprint"],
    ];
    if (mode === "cleanup") names.push(["manifest-fingerprint", "manifestFingerprint"]);
    return {
      action: args[0].slice(2),
      fixtureMode: mode,
      ...requireArgs(args, prefix, names),
    };
  }
  if (args[0] === "--role-b4-lock-probe") {
    return {
      action: "role-b4-lock-probe",
      ...requireArgs(
        args,
        ["--role-b4-lock-probe", "--confirm-reviewed-existing-fixture"],
        [isolation, scada, keycloak, projection],
      ),
    };
  }
  if (args[0] === "--role-b4-status") {
    const phase =
      args[1] === "--phase=dual-installed"
        ? "dual-installed"
        : args[1] === "--phase=scada-installed"
          ? "scada-installed"
          : null;
    if (!phase) throw new Error("B4 状态命令必须指定明确安装阶段");
    return {
      action: "role-b4-status",
      phase,
      ...requireArgs(
        args,
        ["--role-b4-status", "--phase=" + phase],
        [isolation, scada, keycloak, ...(phase === "dual-installed" ? [projection] : [])],
      ),
    };
  }
  return null;
}
