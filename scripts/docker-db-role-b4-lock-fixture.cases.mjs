import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { b4FixtureTables, openB4FixtureEvidence, runB4LockFixture } from "./docker-db-role-b4-lock-fixture.mjs";

const fingerprints = {
  isolationFingerprint: "a".repeat(64),
  expectedScadaCatalogFingerprint: "b".repeat(64),
  expectedKeycloakPlanFingerprint: "c".repeat(64),
  expectedKeycloakProjectionFingerprint: "d".repeat(64),
  expectedDualCatalogFingerprint: "e".repeat(64),
  expectedSchemaPolicyFingerprint: "f".repeat(64),
};
const identity = { version: "190000", systemIdentifier: "123456789" };
const installed = {
  status: "B4_DUAL_INSTALLED_STATE_VERIFIED",
  phase: "dual-installed",
  isolationFingerprint: fingerprints.isolationFingerprint,
  scadaCatalogFingerprint: fingerprints.expectedScadaCatalogFingerprint,
  keycloakPlanFingerprint: fingerprints.expectedKeycloakPlanFingerprint,
  keycloakCatalogFingerprint: fingerprints.expectedKeycloakProjectionFingerprint,
  dualCatalogFingerprint: fingerprints.expectedDualCatalogFingerprint,
  keycloakSchemaPolicy: { status: "KEYCLOAK_SCHEMA_POLICY_REVIEW_ONLY", planFingerprint: fingerprints.expectedSchemaPolicyFingerprint },
  scadaCatalogMatched: true,
  keycloakOwnerProjectionMatched: true,
  keycloakMaintenanceVerified: true,
  independentConnectionsClosed: true,
  runtimeLoginAllowed: false,
  databaseWritten: false,
  businessDataWritten: false,
  admissionPassed: false,
  serviceSwitched: false,
};
const empty = () => Object.fromEntries(b4FixtureTables.map((table) => [table, 0]));
const populated = () => ({ ...empty(), scada_projects: 1, scada_project_grants: 3, scada_project_versions: 1, scada_project_audit: 1, scada_project_release_state: 1, scada_identities: 2 });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fixtureRows = [{ projects: "1", identities: "2", grants: "3", versions: "1", releases: "1", audits: "1" }];
// 仅模拟共享 Core 端口的返回值；真实 Core 快照须由维护者的只读 CLI 复验。
const core = {
  createBlankStudioDocument(projectId) { return { schemaVersion: "0.3.0", projectId, projectName: "未命名工程", tags: [], pages: [{ id: "main", name: "页面 1", size: { width: 1920, height: 1080 }, nodes: [] }] }; },
  async createProjectSnapshot(document, options) {
    return { formatVersion: 1, projectId: document.projectId, ...options, hashAlgorithm: "SHA-256", document, contentHash: digest(JSON.stringify(document)) };
  },
  async readProjectSnapshot(snapshot) {
    assert.equal(snapshot.contentHash, digest(JSON.stringify(snapshot.document)));
    return structuredClone(snapshot);
  },
};
const auditCreatedAt = "2026-11-28T09:00:00.123456Z";

function harness(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "adui-b4-fixture-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, ".local", "docker");
  mkdirSync(directory, { recursive: true });
  const manifestPath = join(directory, "b4-lock-fixture-manifest.json");
  const fixturePath = join(directory, "b4-lock-fixture.json");
  const evidence = openB4FixtureEvidence(root);
  const commands = [];
  const control = { committed: empty(), stateReads: 0, clients: 0, closed: 0, onQuery: (_query) => undefined, onState: () => structuredClone(installed), onEnd: () => {} };
  const createClient = (readonly) => {
    const id = ++control.clients;
    let working = { ...control.committed };
    let role = "adui_scada";
    const result = (command, rows = [], rowCount = rows.length) => ({ command, rows, rowCount });
    return {
      async connect() {},
      async end() { control.onEnd(id); control.closed++; },
      async query(sql, values = []) {
        commands.push({ sql, values, readonly, id });
        const override = control.onQuery({ sql, values, readonly, id });
        if (override !== undefined) return override;
        if (sql.startsWith("BEGIN")) return result("BEGIN");
        if (sql === "ROLLBACK") return result("ROLLBACK");
        if (sql === "COMMIT") { assert.equal(readonly, false); control.committed = { ...working }; return result("COMMIT"); }
        if (sql === "SET LOCAL ROLE adui_scada_runtime") { role = "adui_scada_runtime"; return result("SET"); }
        if (sql === "RESET ROLE") { role = "adui_scada"; return result("RESET"); }
        if (sql.startsWith("SET LOCAL")) return result("SET");
        if (sql.startsWith("LOCK TABLE")) { assert.equal(readonly, false); assert.match(sql, /IN SHARE ROW EXCLUSIVE MODE NOWAIT$/u); for (const table of b4FixtureTables) assert.ok(sql.includes("public." + table)); return result("LOCK"); }
        if (sql === "SELECT current_user::text AS role") return result("SELECT", [{ role }]);
        if (sql.startsWith("SELECT current_user::text AS role,")) return result("SELECT", [{ role, sessionRole: "adui_scada", database: "adui_scada", version: identity.version, readonly: readonly ? "on" : "off", isolation: readonly ? "repeatable read" : "read committed", recovery: false, systemIdentifier: identity.systemIdentifier }]);
        if (sql.includes("pg_try_advisory_xact_lock")) return result("SELECT", [{ locked: true }]);
        if (sql.includes("pg_stat_clear_snapshot")) return result("SELECT");
        if (sql.includes("pg_stat_activity")) return result("SELECT", [{ quiet: true }]);
        if (sql.startsWith("SELECT (SELECT count(*)::text FROM public.scada_projects)")) return result("SELECT", [Object.fromEntries(Object.entries(working).map(([key, count]) => [key, String(count)]))]);
        if (sql.startsWith("SELECT\n  (SELECT count(*)::text FROM public.scada_projects WHERE")) {
          assert.deepEqual(working, populated());
          const m = JSON.parse(readFileSync(manifestPath, "utf8"));
          assert.deepEqual(values, [m.fixture.tenantId, m.fixture.projectId, m.fixture.subjectId, m.fixture.otherSubjectId, m.snapshot.createdAt, JSON.stringify(m.snapshot), m.snapshot.contentHash, m.eventId, m.auditCreatedAt]);
          return result("SELECT", fixtureRows);
        }
        if (sql.includes("AS \"auditCreatedAt\"")) return result("SELECT", [{ auditCreatedAt }]);
        if (sql.startsWith("INSERT INTO public.scada_identities")) {
          assert.equal(readonly, false);
          assert.ok(existsSync(manifestPath));
          const m = JSON.parse(readFileSync(manifestPath, "utf8"));
          assert.deepEqual(values, [m.fixture.tenantId, m.fixture.subjectId, m.fixture.otherSubjectId, m.snapshot.createdAt]);
          working.scada_identities = 2;
          return result("INSERT", [], 2);
        }
        if (sql.startsWith("SELECT public.scada_create_project")) {
          assert.equal(role, "adui_scada_runtime");
          const m = JSON.parse(readFileSync(manifestPath, "utf8"));
          assert.deepEqual(values, [m.fixture.tenantId, m.fixture.projectId, m.fixture.subjectId, JSON.stringify(m.snapshot), m.snapshot.contentHash, m.snapshot.createdAt, m.eventId]);
          working = populated();
          return result("SELECT", [{ result: "CREATED" }]);
        }
        if (sql.startsWith("DELETE FROM public.")) {
          assert.equal(readonly, false);
          assert.equal(role, "adui_scada");
          const m = JSON.parse(readFileSync(manifestPath, "utf8"));
          assert.equal(values[0], m.fixture.tenantId);
          const table = sql.split(" ")[2].slice(7);
          assert.ok(b4FixtureTables.includes(table));
          assert.ok(sql.includes(" WHERE tenant_id=$1 AND "));
          const count = working[table];
          working[table] = 0;
          return result("DELETE", [], count);
        }
        throw new Error("测试收到非预期固定 SQL");
      },
    };
  };
  const options = { identity, fingerprints, core, evidence, createClient, readInstalledState: async () => { control.stateReads++; return control.onState(); } };
  const run = (mode, extra = {}) => runB4LockFixture({ ...options, mode, confirm: mode === "preflight" ? "--confirm-readonly-fixture-preflight" : mode === "create" ? "--confirm-create-isolated-fixture" : "--confirm-cleanup-isolated-fixture", ...(mode === "preflight" ? {} : { confirmMaintenance: "--confirm-exclusive-maintenance", confirmBackup: "--confirm-backup-restore-reviewed" }), ...extra });
  return { root, directory, manifestPath, fixturePath, evidence, control, commands, run };
}

void test("只读预检检查十二张表、真实身份边界和快照端口，不创建文件或提交", async (t) => {
  const h = harness(t);
  const report = await h.run("preflight");
  assert.equal(report.status, "B4_LOCK_FIXTURE_PREFLIGHT_VERIFIED");
  assert.equal(report.businessTableCount, 12);
  assert.equal(report.businessRowCount, 0);
  assert.equal(report.coreSnapshotVerified, true);
  assert.equal(report.databaseWritten, false);
  assert.equal(report.fixturePrepared, false);
  assert.equal(h.control.stateReads, 2);
  assert.equal(h.control.closed, 1);
  assert.ok(h.commands.every(({ readonly, sql }) => readonly && !/^(?:INSERT|DELETE|COMMIT|LOCK TABLE|SET LOCAL ROLE)/u.test(sql)));
  h.evidence.assertAbsent();
});

void test("创建九行夹具后独立复验，再以清单指纹精确清理并保留证据", async (t) => {
  const h = harness(t);
  const created = await h.run("create");
  assert.equal(created.status, "B4_LOCK_FIXTURE_CREATED_VERIFIED");
  assert.equal(created.businessRowCount, 9);
  assert.equal(created.databaseWritten, true);
  assert.equal(created.rowAuthorizationVerified, false);
  assert.equal(h.control.closed, 2);
  assert.equal(h.control.stateReads, 2);
  assert.equal(created.manifestFingerprint, digest(readFileSync(h.manifestPath, "utf8")));
  assert.deepEqual(JSON.parse(readFileSync(h.fixturePath, "utf8")), JSON.parse(readFileSync(h.manifestPath, "utf8")).fixture);
  assert.deepEqual(h.control.committed, populated());
  const cleaned = await h.run("cleanup", { manifestFingerprint: created.manifestFingerprint });
  assert.equal(cleaned.status, "B4_LOCK_FIXTURE_CLEANUP_VERIFIED");
  assert.equal(cleaned.businessRowCount, 0);
  assert.equal(cleaned.businessDataWritten, true);
  assert.equal(cleaned.fixtureFilesRetained, true);
  assert.deepEqual(h.control.committed, empty());
  assert.deepEqual(h.commands.filter(({ sql }) => sql.startsWith("DELETE FROM")).map(({ sql }) => sql.split(" ")[2]), ["public.scada_project_release_state", "public.scada_project_audit", "public.scada_project_grants", "public.scada_project_versions", "public.scada_projects", "public.scada_identities"]);
  assert.equal(h.commands.filter(({ sql }) => sql === "COMMIT").length, 2);
  assert.equal(h.control.closed, 4);
  assert.ok(existsSync(h.fixturePath) && existsSync(h.manifestPath));
});

void test("缺少确认、备份审阅或任一指纹时不建立连接", async (t) => {
  const h = harness(t);
  for (const extra of [{ confirm: "--commit" }, { confirmMaintenance: undefined }, { confirmBackup: undefined }, { fingerprints: { ...fingerprints, expectedDualCatalogFingerprint: "bad" } }]) await assert.rejects(h.run("create", extra), /缺少独立确认/u);
  assert.equal(h.control.clients, 0);
  assert.equal(h.control.stateReads, 0);
});

void test("双库指纹漂移或缺少维护状态时不建立夹具连接", async (t) => {
  const h = harness(t);
  for (const field of ["dualCatalogFingerprint", "keycloakMaintenanceVerified", "runtimeLoginAllowed", "independentConnectionsClosed"]) {
    h.control.onState = () => ({ ...installed, [field]: null });
    await assert.rejects(h.run("preflight"), /双库维护指纹或状态不一致/u);
  }
  h.control.onState = () => ({ ...installed, keycloakSchemaPolicy: { ...installed.keycloakSchemaPolicy, planFingerprint: "0".repeat(64) } });
  await assert.rejects(h.run("preflight"), /双库维护指纹或状态不一致/u);
  assert.equal(h.control.clients, 0);
});

void test("任一业务表非空时拒绝创建，不写入、不保存清单", async (t) => {
  const h = harness(t);
  for (const table of b4FixtureTables) {
    h.control.committed = { ...empty(), [table]: 1 };
    await assert.rejects(h.run("create"), /业务空基线或夹具精确核验失败/u);
  }
  assert.ok(h.commands.every(({ sql }) => !/^(?:INSERT|DELETE|COMMIT)/u.test(sql)));
  assert.equal(h.control.closed, 12);
  h.evidence.assertAbsent();
});

void test("其他会话、竞争锁和连接身份漂移均拒绝执行", async (t) => {
  const h = harness(t);
  for (const query of ["pg_stat_activity", "pg_try_advisory_xact_lock", "current_user::text AS role,"]) {
    h.control.onQuery = ({ sql }) => sql.includes(query) ? { command: "SELECT", rows: [] } : undefined;
    await assert.rejects(h.run("create"), /失败/u);
  }
  assert.equal(h.control.closed, 3);
  assert.ok(h.commands.every(({ sql }) => !/^(?:INSERT|DELETE|COMMIT)/u.test(sql)));
});

void test("已有本机清单或链接不得覆盖，且不读取链接目标", async (t) => {
  const h = harness(t);
  writeFileSync(h.manifestPath, "原有证据", "utf8");
  await assert.rejects(h.run("create"), /夹具或恢复清单已存在/u);
  assert.equal(readFileSync(h.manifestPath, "utf8"), "原有证据");
  rmSync(h.manifestPath);
  // Windows 创建符号链接可能需要开发者模式，因此这里只在非 Windows 模拟该攻击。
  if (process.platform !== "win32") {
    symlinkSync(join(h.root, "不存在的目标"), h.fixturePath);
    await assert.rejects(h.run("preflight"), /夹具或恢复清单已存在/u);
  }
  assert.equal(h.control.clients, 0);
});

void test("错误清单摘要、篡改四字段文件及额外业务记录阻断删除", async (t) => {
  const h = harness(t);
  const report = await h.run("create");
  const old = readFileSync(h.fixturePath, "utf8");
  await assert.rejects(h.run("cleanup", { manifestFingerprint: "0".repeat(64) }), /恢复清单指纹不一致/u);
  writeFileSync(h.fixturePath, old + "\n");
  await assert.rejects(h.run("cleanup", { manifestFingerprint: report.manifestFingerprint }), /四字段夹具与恢复清单不一致/u);
  writeFileSync(h.fixturePath, old);
  h.control.committed.scada_auth_sessions = 1;
  await assert.rejects(h.run("cleanup", { manifestFingerprint: report.manifestFingerprint }), /夹具精确核验失败/u);
  assert.equal(h.commands.filter(({ sql }) => sql.startsWith("DELETE FROM")).length, 0);
  assert.equal(h.control.committed.scada_auth_sessions, 1);
});

void test("夹具授权漂移或删除影响行数异常触发回滚，不提交清理", async (t) => {
  const h = harness(t);
  const report = await h.run("create");
  h.control.onQuery = ({ sql }) => sql.startsWith("SELECT\n  (SELECT count(*)::text FROM public.scada_projects WHERE") ? { command: "SELECT", rows: [{ ...fixtureRows[0], grants: "2" }] } : undefined;
  await assert.rejects(h.run("cleanup", { manifestFingerprint: report.manifestFingerprint }), /夹具精确核验失败/u);
  assert.equal(h.commands.filter(({ sql }) => sql.startsWith("DELETE FROM")).length, 0);
  h.control.onQuery = ({ sql }) => sql.startsWith("DELETE FROM public.scada_project_audit") ? { command: "DELETE", rowCount: 0 } : undefined;
  await assert.rejects(h.run("cleanup", { manifestFingerprint: report.manifestFingerprint }), /影响行数异常/u);
  assert.deepEqual(h.control.committed, populated());
  assert.equal(h.commands.filter(({ sql }) => sql === "COMMIT").length, 1);
});

void test("提交结果未知时保留恢复清单，不重复提交或自动反向清理", async (t) => {
  const h = harness(t);
  h.control.onQuery = ({ sql }) => { if (sql === "COMMIT") throw new Error("禁止泄漏的底层信息"); };
  await assert.rejects(h.run("create"), { message: /提交结果未知/u });
  assert.equal(h.control.clients, 1);
  assert.equal(h.control.stateReads, 1);
  assert.equal(h.commands.filter(({ sql }) => sql === "COMMIT").length, 1);
  assert.ok(existsSync(h.manifestPath));
  assert.equal(existsSync(h.fixturePath), false);
  assert.ok(h.commands.every(({ sql }) => !sql.startsWith("DELETE")));
});

void test("提交后连接关闭或独立复验失败均不发布夹具，不自动清理", async (t) => {
  const h = harness(t);
  h.control.onEnd = () => { throw new Error("模拟关闭失败"); };
  await assert.rejects(h.run("create"), /已收到提交标签.*连接关闭未确认/u);
  assert.equal(h.control.clients, 1);
  assert.ok(existsSync(h.manifestPath));
  assert.equal(existsSync(h.fixturePath), false);
  const another = harness(t);
  another.control.onState = () => another.control.stateReads === 1 ? structuredClone(installed) : { ...installed, dualCatalogFingerprint: "0".repeat(64) };
  await assert.rejects(another.run("create"), /已收到提交标签.*独立复验/u);
  assert.equal(another.control.clients, 2);
  assert.ok(existsSync(another.manifestPath));
  assert.equal(existsSync(another.fixturePath), false);
});

void test("快照校验失败与回滚标签失败不重试且不提交", async (t) => {
  const h = harness(t);
  await assert.rejects(h.run("create", { core: { ...core, async readProjectSnapshot() { throw new Error("模拟快照篡改"); } } }), /夹具精确核验失败/u);
  h.evidence.assertAbsent();
  h.control.onQuery = ({ sql }) => sql === "ROLLBACK" ? { command: "SELECT" } : undefined;
  await assert.rejects(h.run("preflight"), /回滚未确认/u);
  assert.equal(h.commands.filter(({ sql }) => sql === "ROLLBACK").length, 2);
  assert.equal(h.commands.filter(({ sql }) => sql === "COMMIT").length, 0);
});
