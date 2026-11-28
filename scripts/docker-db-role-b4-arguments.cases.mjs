import assert from "node:assert/strict";
import { test } from "node:test";
import { parseB4PersistenceAction } from "./docker-db-role-b4-arguments.mjs";

const a = "a".repeat(64);
const b = "b".repeat(64);
const c = "c".repeat(64);
const d = "d".repeat(64);
const scada = [
  "--role-b4-apply",
  "--confirm-apply-scada-b4",
  "--confirm-rehearsal-verified",
  "--confirm-rollback-business-fixtures",
  "--plan-fingerprint=" + a,
  "--catalog-fingerprint=" + b,
  "--keycloak-plan-fingerprint=" + c,
];
const shared = [
  "--isolation-fingerprint=" + a,
  "--scada-catalog-fingerprint=" + b,
  "--keycloak-plan-fingerprint=" + c,
];
const keycloak = [
  "--role-keycloak-apply",
  "--confirm-apply-keycloak-ownership",
  "--confirm-rehearsal-verified",
  "--reviewed-keycloak-objects",
  "--confirm-keycloak-maintenance",
  ...shared,
  "--projection-fingerprint=" + d,
];
const status = ["--role-b4-status", "--phase=scada-installed", ...shared];

void test("独立确认后解析 SCADA 与 Keycloak 固定持久化指纹", () => {
  assert.deepEqual(parseB4PersistenceAction(scada), {
    action: "role-b4-apply",
    expectedPlanFingerprint: a,
    expectedScadaCatalogFingerprint: b,
    expectedKeycloakPlanFingerprint: c,
  });
  assert.deepEqual(parseB4PersistenceAction(keycloak), {
    action: "role-keycloak-apply",
    isolationFingerprint: a,
    expectedScadaCatalogFingerprint: b,
    expectedKeycloakPlanFingerprint: c,
    expectedKeycloakProjectionFingerprint: d,
  });
});

void test("状态命令必须明确阶段并只接受对应的完整指纹", () => {
  assert.deepEqual(parseB4PersistenceAction(status), {
    action: "role-b4-status",
    phase: "scada-installed",
    isolationFingerprint: a,
    expectedScadaCatalogFingerprint: b,
    expectedKeycloakPlanFingerprint: c,
  });
  assert.deepEqual(
    parseB4PersistenceAction([
      "--role-b4-status",
      "--phase=dual-installed",
      ...shared,
      "--projection-fingerprint=" + d,
    ]),
    {
      action: "role-b4-status",
      phase: "dual-installed",
      isolationFingerprint: a,
      expectedScadaCatalogFingerprint: b,
      expectedKeycloakPlanFingerprint: c,
      expectedKeycloakProjectionFingerprint: d,
    },
  );
  for (const args of [
    ["--role-b4-status"],
    ["--role-b4-status", "--phase=auto", ...shared],
    [...status, "--projection-fingerprint=" + d],
    ["--role-b4-status", "--phase=dual-installed", ...shared],
  ])
    assert.throws(() => parseB4PersistenceAction(args));
});

void test("缺少任一确认、重复额外参数、错误顺序或非法指纹均拒绝", () => {
  for (const args of [scada, keycloak, status]) {
    for (let index = 1; index < args.length; index++)
      assert.throws(() => parseB4PersistenceAction(args.filter((_, offset) => offset !== index)));
    assert.throws(() => parseB4PersistenceAction([...args, args.at(-1)]));
    assert.throws(() =>
      parseB4PersistenceAction([...args.slice(0, -1), args.at(-1).slice(0, -1) + "G"]),
    );
    assert.throws(() => parseB4PersistenceAction([args[0], ...args.slice(1).reverse()]));
  }
});

void test("原有回滚演练和普通命令不进入持久化解析路径", () => {
  for (const args of [
    [],
    ["--role-b4-plan"],
    ["--role-b4-rehearse", "--confirm-rehearse-scada-b4"],
    ["--role-keycloak-rehearse"],
    ["--status"],
  ])
    assert.equal(parseB4PersistenceAction(args), null);
});

void test("并发探针需要独立现有夹具确认及全部双库指纹", () => {
  const args = [
    "--role-b4-lock-probe",
    "--confirm-reviewed-existing-fixture",
    ...shared,
    "--projection-fingerprint=" + d,
  ];
  assert.deepEqual(parseB4PersistenceAction(args), {
    action: "role-b4-lock-probe",
    isolationFingerprint: a,
    expectedScadaCatalogFingerprint: b,
    expectedKeycloakPlanFingerprint: c,
    expectedKeycloakProjectionFingerprint: d,
  });
  assert.throws(() => parseB4PersistenceAction(args.filter((_, index) => index !== 1)));
});

void test("专用夹具三种动作分别要求确认、六项双库指纹与清理清单指纹", () => {
  const e = "e".repeat(64);
  const f = "f".repeat(64);
  const fixture = [
    ...shared,
    "--projection-fingerprint=" + d,
    "--dual-catalog-fingerprint=" + e,
    "--schema-policy-fingerprint=" + f,
  ];
  const writeConfirm = ["--confirm-exclusive-maintenance", "--confirm-backup-restore-reviewed"];
  const cases = [
    { mode: "preflight", confirm: "--confirm-readonly-fixture-preflight", extra: [] },
    { mode: "create", confirm: "--confirm-create-isolated-fixture", extra: writeConfirm },
    { mode: "cleanup", confirm: "--confirm-cleanup-isolated-fixture", extra: writeConfirm },
  ];
  for (const { mode, confirm, extra } of cases) {
    const action = "role-b4-fixture-" + mode;
    const args = [
      "--" + action,
      confirm,
      ...extra,
      ...fixture,
      ...(mode === "cleanup" ? ["--manifest-fingerprint=" + a] : []),
    ];
    assert.deepEqual(parseB4PersistenceAction(args), {
      action,
      fixtureMode: mode,
      isolationFingerprint: a,
      expectedScadaCatalogFingerprint: b,
      expectedKeycloakPlanFingerprint: c,
      expectedKeycloakProjectionFingerprint: d,
      expectedDualCatalogFingerprint: e,
      expectedSchemaPolicyFingerprint: f,
      ...(mode === "cleanup" ? { manifestFingerprint: a } : {}),
    });
    for (let index = 1; index < args.length; index++) {
      assert.throws(() => parseB4PersistenceAction(args.filter((_, offset) => offset !== index)));
    }
    assert.throws(() => parseB4PersistenceAction([...args, "--commit"]));
    assert.throws(() => parseB4PersistenceAction([args[0], ...args.slice(1).reverse()]));
    assert.throws(() =>
      parseB4PersistenceAction([...args.slice(0, -1), "--manifest-fingerprint=bad"]),
    );
  }
});
