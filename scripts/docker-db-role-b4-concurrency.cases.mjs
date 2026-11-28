import assert from "node:assert/strict";
import { test } from "node:test";
import { runB4LockConcurrency, validateB4LockFixture } from "./docker-db-role-b4-concurrency.mjs";

const fixture = { tenantId: "lab", projectId: "probe", subjectId: "active", otherSubjectId: "other" };
const identity = { version: "190000", systemIdentifier: "123456789" };
const state = { phase: "dual-installed", scadaCatalogMatched: true, keycloakOwnerProjectionMatched: true, independentConnectionsClosed: true, admissionPassed: false };
const permissions = [{ permission: "project:read" }, { permission: "version:append" }, { permission: "version:read" }];

function mock(fault = "") {
  const calls = [];
  let clients = 0;
  let hosts = 0;
  let holder = false;
  const createClient = () => {
    const number = ++clients;
    let role = "adui_scada";
    return {
      async connect() { calls.push([number, "connect"]); },
      async query(sql, values = []) {
        calls.push([number, sql]);
        if (sql.startsWith("BEGIN")) return { command: "BEGIN" };
        if (sql === "ROLLBACK") {
          if (fault === "rollback" && number === 1) throw new Error("secret");
          if (number === 1) holder = false;
          role = "adui_scada";
          return { command: "ROLLBACK" };
        }
        if (sql.startsWith("SET ")) {
          if (sql.includes("ROLE")) role = "adui_scada_runtime";
          return { command: "SET" };
        }
        if (sql.startsWith("SAVEPOINT")) return { command: "SAVEPOINT" };
        if (sql.startsWith("ROLLBACK TO")) return { command: "ROLLBACK" };
        if (sql.startsWith("RELEASE")) return { command: "RELEASE" };
        if (sql.includes("session_user")) return { command: "SELECT", rows: [{ role, sessionRole: "adui_scada", database: "adui_scada", version: "190000", read_only: "off", isolation: "read committed" }] };
        if (sql.includes("pg_control_system")) return { command: "SELECT", rows: [{ systemIdentifier: "123456789" }] };
        if (sql.includes("pg_try_advisory")) return { command: "SELECT", rows: [{ locked: true }] };
        if (number === 1 && sql.includes("public.scada_lock_identity")) holder = true;
        if (number === 2 && holder && sql.includes("FOR UPDATE NOWAIT") && fault !== "no-conflict") {
          throw Object.assign(new Error("secret"), { code: fault === "wrong-sqlstate" ? "42501" : "55P03" });
        }
        if (sql.includes("grants")) return { command: "SELECT", rows: values.at(-1) === "other" ? fault === "other-grant" ? permissions : [] : permissions };
        if (sql.includes("identity") || sql.includes("identities")) return { command: "SELECT", rows: fault === "missing" ? [] : [{ status: "active" }] };
        throw new Error("secret");
      },
      async end() { calls.push([number, "end"]); if (fault === "close" && number === 1) throw new Error("secret"); },
    };
  };
  return { calls, options: { fixture, identity, confirm: "--confirm-reviewed-existing-fixture", createClient,
    async readInstalledState() { hosts++; return { ...state, ...(fault === "drift" && hosts === 2 ? { isolationFingerprint: "changed" } : {}) }; } }, hosts: () => hosts };
}

void test("两个独立会话确认身份及授权行锁冲突和回滚释放，不写业务数据", async () => {
  const h = mock();
  const result = await runB4LockConcurrency(h.options);
  assert.equal(result.sharedLockConflictCount, 2);
  assert.equal(result.identityGrantLockConcurrencyVerified, true);
  assert.equal(result.rowAuthorizationVerified, false);
  assert.equal(result.businessDataWritten, false);
  assert.equal(h.hosts(), 2);
  assert.equal(h.calls.filter(([, sql]) => sql === "connect").length, 2);
  assert.equal(h.calls.filter(([, sql]) => sql === "ROLLBACK").length, 4);
  assert.equal(h.calls.filter(([, sql]) => sql === "end").length, 2);
  assert.ok(h.calls.every(([, sql]) => !/^(COMMIT|INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE)\b/u.test(sql)));
});

void test("缺失夹具、其他主体授权、错误 SQLSTATE、未冲突、漂移或资源关闭失败均拒绝", async () => {
  for (const fault of ["missing", "other-grant", "wrong-sqlstate", "no-conflict", "drift", "rollback", "close"]) {
    const h = mock(fault);
    await assert.rejects(() => runB4LockConcurrency(h.options), (error) => !error.message.includes("secret"));
    assert.ok(h.calls.every(([, sql]) => sql !== "COMMIT"));
  }
});

void test("没有明确审阅确认、重复主体及非法夹具不连接数据库", async () => {
  for (const change of [{ confirm: undefined }, { fixture: { ...fixture, otherSubjectId: "active" } }, { fixture: { ...fixture, tenantId: "' OR 1=1" } }, { fixture: { ...fixture, password: "secret" } }]) {
    const h = mock();
    await assert.rejects(() => runB4LockConcurrency({ ...h.options, ...change }));
    assert.deepEqual(h.calls, []);
    assert.equal(h.hosts(), 0);
  }
  assert.deepEqual(validateB4LockFixture(fixture), fixture);
});
