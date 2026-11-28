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

void test("全新入口仅接受明确九种操作，裸命令不能写入", () => {
  assert.equal(freshAction(["--emit"]), "emit");
  assert.equal(freshAction(["--preview"]), "preview");
  assert.equal(freshAction([freshConfirmation]), "initialize");
  assert.equal(freshAction(["--status"]), "status");
  assert.equal(freshAction(["--role-review"]), "role-review");
  assert.equal(freshAction(["--role-plan"]), "role-plan");
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
