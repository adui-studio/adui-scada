import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  freshAction,
  freshConfirmation,
  freshConnection,
  freshDiagnosticCodes,
  freshStorageHash,
  requireFreshIdentity,
  requireFreshVerification,
  requireKeycloakMaintenanceContainer,
  reviewFreshContract,
  reviewFreshUpdate,
} from "./prisma8-fresh-install.mjs";

const password = "a".repeat(43);
const base = "postgresql://adui_scada:" + password + "@127.0.0.1:15432/adui_scada?schema=public";
const ids = ["foreignKey.scada_a.fk", "index.scada_a.idx", "table.scada_a"];
function envelope(commandId, result) {
  return {
    kind: "result",
    commandId,
    envelope: {
      commandId,
      ok: true,
      exitCode: 0,
      diagnostics: [],
      result: { ok: true, ...result },
    },
  };
}
function plan(extra = {}) {
  return envelope("db.update", {
    mode: "plan",
    plan: {
      targetId: "postgres",
      destination: { storageHash: freshStorageHash },
      operations: ids.map((id) => ({ id, operationClass: "additive" })),
    },
    appliedStatements: [],
    temporaryValues: [],
    dataLoss: [],
    accessChanges: [],
    ...extra,
  });
}

void test("全新入口仅接受明确白名单操作，裸命令不能写入", () => {
  assert.equal(freshAction(["--emit"]), "emit");
  assert.equal(freshAction(["--preview"]), "preview");
  assert.equal(freshAction([freshConfirmation]), "initialize");
  assert.equal(freshAction(["--status"]), "status");
  assert.equal(freshAction(["--role-review"]), "role-review");
  assert.equal(freshAction(["--role-plan"]), "role-plan");
  assert.equal(freshAction(["--role-bootstrap-status"]), "role-bootstrap-status");
  assert.equal(freshAction(["--role-isolation-inspect"]), "role-isolation-inspect");
  assert.equal(freshAction(["--role-isolation-plan"]), "role-isolation-plan");
  assert.throws(() => freshAction(["--role-isolation-plan", "--apply"]), /必须明确指定/u);
  assert.throws(() => freshAction(["--role-isolation-plan", freshConfirmation]), /必须明确指定/u);
  assert.throws(() => freshAction(["--role-isolation-inspect", "--apply"]), /必须明确指定/u);
  assert.throws(
    () => freshAction(["--role-isolation-inspect", freshConfirmation]),
    /必须明确指定/u,
  );
  assert.equal(
    freshAction(["--role-bootstrap", "--confirm-rehearse-docker-roles"]),
    "role-rehearse",
  );
  assert.equal(freshAction(["--role-bootstrap", "--confirm-create-docker-roles"]), "role-create");
  for (const args of [
    ["--role-bootstrap"],
    ["--confirm-rehearse-docker-roles"],
    ["--confirm-create-docker-roles"],
    ["--role-bootstrap", "--apply"],
    ["--role-bootstrap", "--confirm-rehearse-docker-roles", "--confirm-create-docker-roles"],
    ["--role-bootstrap", "--confirm-create-docker-roles", freshConfirmation],
    ["--role-bootstrap-status", "--confirm-create-docker-roles"],
  ]) {
    assert.throws(() => freshAction(args), /必须明确指定/u);
  }
  assert.equal(freshAction(["--runtime-review"]), "runtime-review");
  assert.equal(freshAction(["--runtime-emit"]), "runtime-emit");
  assert.equal(freshAction(["--provider-smoke"]), "provider-smoke");
  assert.throws(() => freshAction(["--provider-smoke", freshConfirmation]), /必须明确指定/u);
  assert.throws(() => freshAction(["--role-review", freshConfirmation]), /必须明确指定/u);
  assert.throws(() => freshAction(["--role-review", "--status"]), /必须明确指定/u);
  assert.throws(() => freshAction(["--role-plan", freshConfirmation]), /必须明确指定/u);
  assert.throws(() => freshAction(["--role-plan", "--role-review"]), /必须明确指定/u);
  assert.throws(() => freshAction(["--role-plan", "--apply"]), /必须明确指定/u);
  assert.throws(() => freshAction(["--runtime-review", freshConfirmation]), /必须明确指定/u);
  for (const args of [[], ["migrate"], ["--reset"], [freshConfirmation, "--force"]]) {
    assert.throws(() => freshAction(args), /必须明确指定/u);
  }
});

void test("本机业务库连接移除旧 schema 参数并强制预览只读", () => {
  const read = new URL(freshConnection(base, true));
  const write = new URL(freshConnection(base, false));
  assert.deepEqual([...read.searchParams.keys()], ["options"]);
  assert.match(read.searchParams.get("options") ?? "", /default_transaction_read_only=on/u);
  assert.doesNotMatch(write.searchParams.get("options") ?? "", /default_transaction_read_only/u);
  assert.equal(read.password, password);
  assert.equal(read.pathname, "/adui_scada");
});

void test("拒绝其他项目、Keycloak、历史库、旧端口与不安全参数", () => {
  for (const input of [
    "invalid",
    base.replace("127.0.0.1", "remote.example"),
    base.replace("15432", "15434"),
    base.replace("/adui_scada?", "/adui_scada_keycloak?"),
    base.replace("/adui_scada?", "/adui_scada_test?"),
    base.replace("adui_scada:", "postgres:"),
    base + "&options=bad",
    base.replace(password, "short"),
  ]) {
    assert.throws(() => freshConnection(input, true), /全新/u);
  }
});

void test("全新原生源保留十二模型三十六约束与原始中文注释", () => {
  const source = readFileSync(
    new URL("../apps/server/prisma/contract.prisma", import.meta.url),
    "utf8",
  );
  const comments = readFileSync(
    new URL("../apps/server/prisma/initial-comments.sql", import.meta.url),
    "utf8",
  );
  assert.ok(source.startsWith("// use prisma-8\n"));
  assert.equal((source.match(/^model /gm) ?? []).length, 12);
  assert.equal((source.match(/^  @@check\(/gm) ?? []).length, 36);
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "e35bc6e946220df310ce39bdc61e3072ac00630c76efdbb449770e6606e8d61b",
  );
  assert.equal((comments.match(/^COMMENT ON /gm) ?? []).length, 119);
  assert.equal(
    createHash("sha256").update(comments).digest("hex"),
    "06a47418f3477c263cb19c7a3550a6be3810a4ffd9c22afada7ecd28f6322fb7",
  );
});

void test("拒绝缺失原生契约、错误存储标识和非当前表清单", () => {
  for (const contract of [
    {},
    { targetFamily: "sql", target: "postgres" },
    {
      targetFamily: "sql",
      target: "postgres",
      storage: { storageHash: freshStorageHash, namespaces: {} },
    },
  ]) {
    assert.throws(() => reviewFreshContract(contract, ""), /原生契约存储标识或表清单/u);
  }
});

void test("只读官方预览仅接受完整新增操作和可选 public 命名空间", () => {
  assert.deepEqual(reviewFreshUpdate(plan(), ids, "plan"), ids);
  const document = plan();
  document.envelope.result.plan.operations.push({
    id: "schema.public",
    operationClass: "additive",
  });
  assert.deepEqual(reviewFreshUpdate(document, ids, "plan"), [
    "foreignKey.scada_a.fk",
    "index.scada_a.idx",
    "schema.public",
    "table.scada_a",
  ]);
});

void test("拒绝数据丢失、访问变化、未知命令、缺失或重复对象", () => {
  for (const extra of [
    { dataLoss: [{}] },
    { accessChanges: [{}] },
    { appliedStatements: ["delete"] },
    { temporaryValues: [{}] },
    { execution: {} },
    { marker: {} },
  ])
    assert.throws(() => reviewFreshUpdate(plan(extra), ids, "plan"));
  for (const changed of [
    [{ id: ids[0], operationClass: "destructive" }],
    [{ id: ids[0], operationClass: "additive" }],
    [...ids, ids[0]].map((id) => ({ id, operationClass: "additive" })),
    [...ids, "table.other"].map((id) => ({ id, operationClass: "additive" })),
  ]) {
    const document = plan();
    document.envelope.result.plan.operations = changed;
    assert.throws(() => reviewFreshUpdate(document, ids, "plan"));
  }
  const unknown = plan();
  unknown.envelope.commandId = "db.migrate";
  assert.throws(() => reviewFreshUpdate(unknown, ids, "plan"), /官方机器结果/u);
});

void test("首次实际初始化必须与预览相同且写入正确原生标记", () => {
  const applied = plan({
    mode: "apply",
    marker: { storageHash: freshStorageHash },
    execution: { operationsPlanned: ids.length, operationsExecuted: ids.length },
  });
  assert.deepEqual(reviewFreshUpdate(applied, ids, "apply", ids), ids);
  assert.throws(() => reviewFreshUpdate(applied, ids, "apply", []), /实际初始化结果/u);
  applied.envelope.result.marker.storageHash = "0".repeat(64);
  assert.throws(() => reviewFreshUpdate(applied, ids, "apply", ids), /实际初始化结果/u);
});

void test("只接受官方严格验证成功且拒绝错误诊断", () => {
  const document = envelope("db.verify", {});
  requireFreshVerification(document);
  document.envelope.diagnostics.push({ severity: "error" });
  assert.throws(() => requireFreshVerification(document), /官方机器结果/u);
});

void test("容器与 TCP 必须是同一 PostgreSQL 19 业务库及所有者", () => {
  const identity = { version: "190000", systemIdentifier: "1234567890123456789" };
  const row = {
    ...identity,
    database: "adui_scada",
    role: "adui_scada",
    sessionRole: "adui_scada",
    owner: true,
    recovery: false,
  };
  requireFreshIdentity(row, identity);
  for (const changes of [
    { database: "adui_scada_keycloak" },
    { role: "postgres" },
    { sessionRole: "postgres" },
    { version: "170011" },
    { systemIdentifier: "2234567890123456789" },
    { owner: false },
    { recovery: true },
  ])
    assert.throws(() => requireFreshIdentity({ ...row, ...changes }, identity), /实际身份/u);
});

void test("官方诊断仅保留白名单格式错误码，不回显凭据或原始正文", () => {
  const pretty = JSON.stringify(
    { envelope: { error: { code: "MIGRATION.SCHEMA_VERIFY_FAILED", message: base } } },
    null,
    2,
  );
  const lines =
    JSON.stringify({ code: "CLI.INVALID_ARGUMENTS", message: base }) +
    "\n" +
    JSON.stringify({ code: base }) +
    "\ninvalid";
  assert.deepEqual(freshDiagnosticCodes(pretty, lines), [
    "CLI.INVALID_ARGUMENTS",
    "MIGRATION.SCHEMA_VERIFY_FAILED",
  ]);
});

void test("原生规划按固定码元顺序比较数字与下划线且不修改输入", () => {
  const expected = [
    "foreignKey.scada_a.fk",
    "index.scada_a.idx0",
    "index.scada_a.idx_10",
    "index.scada_a.idx_2",
    "index.scada_a.idx_a",
    "table.scada_a",
  ];
  const shuffled = [...expected, "schema.public"].reverse();
  const document = plan();
  document.envelope.result.plan.operations = shuffled.map((id) => ({
    id,
    operationClass: "additive",
  }));
  assert.deepEqual(reviewFreshUpdate(document, expected, "plan"), [
    ...expected.slice(0, -1),
    "schema.public",
    "table.scada_a",
  ]);
  assert.deepEqual(
    document.envelope.result.plan.operations.map((operation) => operation.id),
    shuffled,
  );
  assert.equal(expected.length, 6);
});

void test("官方诊断码保持固定码元顺序并去重", () => {
  const input = ["CLI.A_2", "CLI.A_10", "CLI.A0", "CLI.A_2", "CLI.A_A"];
  assert.deepEqual(freshDiagnosticCodes(input.map((code) => JSON.stringify({ code })).join("\n")), [
    "CLI.A0",
    "CLI.A_10",
    "CLI.A_2",
    "CLI.A_A",
  ]);
});

void test("隔离事务必须精确确认三组消费者、指纹及独立持久化许可", () => {
  const fingerprint = "--plan-fingerprint=" + "a".repeat(64);
  const approvals = ["--reviewed-business-consumers", "--reviewed-maintenance-consumers", "--reviewed-template-consumers"];
  assert.equal(freshAction(["--role-isolation-status"]), "role-isolation-status");
  assert.equal(freshAction(["--role-object-review"]), "role-object-review");
  assert.throws(() => freshAction(["--role-object-review", "--apply"]), /必须明确指定/u);
  assert.equal(freshAction(["--role-isolation-execute", "--confirm-rehearse-isolation", ...approvals, fingerprint]), "role-isolation-rehearse");
  assert.equal(freshAction(["--role-isolation-execute", "--confirm-apply-isolation", "--confirm-rehearsal-verified", ...approvals, fingerprint]), "role-isolation-apply");
  for (const args of [
    ["--role-isolation-execute"],
    ["--role-isolation-execute", "--confirm-apply-isolation", ...approvals, fingerprint],
    ["--role-isolation-execute", "--confirm-rehearse-isolation", ...approvals.slice(0, 2), fingerprint],
    ["--role-isolation-execute", "--confirm-rehearse-isolation", ...approvals, "--plan-fingerprint=bad"],
    ["--role-isolation-status", "--confirm-apply-isolation"],
  ]) assert.throws(() => freshAction(args), /必须明确指定/u);
});

void test("B4 只读计划与回滚演练必须独立确认，禁止混用持久化参数", () => {
  const fingerprint = "--plan-fingerprint=" + "a".repeat(64);
  const confirm = "--confirm-rehearse-scada-b4";
  const confirmFixtures = "--confirm-rollback-business-fixtures";
  assert.equal(freshAction(["--role-b4-plan"]), "role-b4-plan");
  assert.equal(
    freshAction(["--role-b4-rehearse", confirm, confirmFixtures, fingerprint]),
    "role-b4-rehearse",
  );
  for (const args of [
    ["--role-b4-rehearse"],
    ["--role-b4-rehearse", confirm],
    ["--role-b4-rehearse", confirm, fingerprint],
    ["--role-b4-rehearse", confirm, "--apply", fingerprint],
    ["--role-b4-rehearse", fingerprint, confirm],
    ["--role-b4-rehearse", confirm, "--plan-fingerprint=bad"],
    ["--role-b4-plan", confirm],
    ["--role-b4-rehearse", "--apply", fingerprint],
    ["--role-b4-rehearse", confirm, confirmFixtures, fingerprint, "--commit"],
  ]) {
    assert.throws(() => freshAction(args), /必须明确指定/u);
  }
  assert.throws(() => freshAction(["--role-b4-apply", confirm, fingerprint]), {
    message: "B4 持久化或状态命令必须完整明确指定确认参数",
  });
});

void test("Keycloak 所有权预览与回滚演练必须独立确认，禁止混用持久化参数", () => {
  const fingerprint = "--plan-fingerprint=" + "a".repeat(64);
  const approval = [
    "--confirm-rehearse-keycloak-ownership",
    "--reviewed-keycloak-objects",
    "--confirm-keycloak-maintenance",
  ];
  assert.equal(freshAction(["--role-keycloak-plan"]), "role-keycloak-plan");
  assert.equal(
    freshAction(["--role-keycloak-rehearse", ...approval, fingerprint]),
    "role-keycloak-rehearse",
  );
  for (const args of [
    ["--role-keycloak-plan", "--apply"],
    ["--role-keycloak-rehearse"],
    ["--role-keycloak-plan", fingerprint],
    ["--role-keycloak-rehearse", ...approval.slice(0, 2), fingerprint],
    ["--role-keycloak-rehearse", ...approval, "--plan-fingerprint=bad"],
    ["--role-keycloak-rehearse", ...approval, fingerprint, "--commit"],
  ]) {
    assert.throws(() => freshAction(args), /必须明确指定/u);
  }
  assert.throws(() => freshAction(["--role-keycloak-apply"]), {
    message: "B4 持久化或状态命令必须完整明确指定确认参数",
  });
});

void test("全新入口仅分派独立确认的 B4 持久化、阶段状态及并发探针", () => {
  const isolation = "--isolation-fingerprint=" + "a".repeat(64);
  const scada = "--scada-catalog-fingerprint=" + "b".repeat(64);
  const keycloak = "--keycloak-plan-fingerprint=" + "c".repeat(64);
  const projection = "--projection-fingerprint=" + "d".repeat(64);
  const shared = [isolation, scada, keycloak];
  const cases = [
    {
      action: "role-b4-apply",
      args: [
        "--role-b4-apply",
        "--confirm-apply-scada-b4",
        "--confirm-rehearsal-verified",
        "--confirm-rollback-business-fixtures",
        "--plan-fingerprint=" + "e".repeat(64),
        "--catalog-fingerprint=" + "b".repeat(64),
        keycloak,
      ],
    },
    {
      action: "role-keycloak-apply",
      args: [
        "--role-keycloak-apply",
        "--confirm-apply-keycloak-ownership",
        "--confirm-rehearsal-verified",
        "--reviewed-keycloak-objects",
        "--confirm-keycloak-maintenance",
        ...shared,
        projection,
      ],
    },
    {
      action: "role-b4-status",
      args: ["--role-b4-status", "--phase=scada-installed", ...shared],
    },
    {
      action: "role-b4-status",
      args: ["--role-b4-status", "--phase=dual-installed", ...shared, projection],
    },
    {
      action: "role-b4-lock-probe",
      args: ["--role-b4-lock-probe", "--confirm-reviewed-existing-fixture", ...shared, projection],
    },
  ];
  for (const { args, action } of cases) {
    assert.equal(freshAction(args), action);
    for (let index = 1; index < args.length; index++) {
      assert.throws(() => freshAction(args.filter((_, offset) => offset !== index)), {
        name: "Error",
        message: index === 1 && action === "role-b4-status"
          ? "B4 状态命令必须指定明确安装阶段"
          : "B4 持久化或状态命令必须完整明确指定确认参数",
      });
    }
    assert.throws(() => freshAction([...args, "--commit"]), {
      message: "B4 持久化或状态命令必须完整明确指定确认参数",
    });
  }
  assert.throws(() => freshAction(["--role-b4-status", "--phase=auto", ...shared]), {
    message: "B4 状态命令必须指定明确安装阶段",
  });
  assert.throws(() => freshAction([
    "--role-b4-status",
    "--phase=dual-installed",
    ...shared,
    "--projection-fingerprint=bad",
  ]), {
    message: "B4 参数缺少独立确认指纹：projection-fingerprint",
  });
});

void test("Keycloak 维护窗口要求唯一固定容器已明确退出且不自动重启", () => {
  const id = "a".repeat(64);
  const details = [id, "exited", false, false, false, "quay.io/keycloak/keycloak:latest",
    { "com.docker.compose.project": "adui-scada", "com.docker.compose.service": "keycloak" }, "no"];
  assert.equal(requireKeycloakMaintenanceContainer(id, details), id);
  for (const ids of ["", id + "\n" + "b".repeat(64), "short"]) {
    assert.throws(() => requireKeycloakMaintenanceContainer(ids, details), /容器标识不一致/u);
  }
  for (const [index, value] of [[0, "b".repeat(64)], [1, "running"], [2, true], [3, true], [4, true],
    [5, "other"], [6, {}], [7, "always"]]) {
    const changed = [...details]; changed[index] = value;
    assert.throws(() => requireKeycloakMaintenanceContainer(id, changed), /明确停止/u);
  }
});
