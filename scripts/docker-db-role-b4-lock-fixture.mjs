import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export class DockerB4LockFixtureError extends Error {}

const counts = Object.freeze({
  scada_projects: 1,
  scada_project_grants: 3,
  scada_project_versions: 1,
  scada_project_audit: 1,
  scada_project_release_state: 1,
  scada_project_release_events: 0,
  scada_identities: 2,
  scada_auth_sessions: 0,
  scada_external_identities: 0,
  scada_oidc_transactions: 0,
  scada_tag_history_batches: 0,
  scada_tag_history_records: 0,
});
export const b4FixtureTables = Object.freeze(Object.keys(counts));
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const fingerprintFields = ["isolationFingerprint", "expectedScadaCatalogFingerprint", "expectedKeycloakPlanFingerprint", "expectedKeycloakProjectionFingerprint", "expectedDualCatalogFingerprint", "expectedSchemaPolicyFingerprint"];
const confirmations = {
  preflight: "--confirm-readonly-fixture-preflight",
  create: "--confirm-create-isolated-fixture",
  cleanup: "--confirm-cleanup-isolated-fixture",
};
const countSql = "SELECT " + b4FixtureTables.map((table) => `(SELECT count(*)::text FROM public.${table}) AS ${table}`).join(", ");
const lockSql = "LOCK TABLE " + b4FixtureTables.map((table) => `public.${table}`).join(", ") + " IN SHARE ROW EXCLUSIVE MODE NOWAIT";
const identitySql = `SELECT current_user::text AS role, session_user::text AS "sessionRole", current_database() AS database,
  current_setting('server_version_num') AS version, current_setting('transaction_read_only') AS readonly,
  current_setting('transaction_isolation') AS isolation, pg_catalog.pg_is_in_recovery() AS recovery,
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier"`;
const quietSql = "SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname = current_database() AND pid <> pg_catalog.pg_backend_pid()) AS quiet";
const verifySql = `SELECT
  (SELECT count(*)::text FROM public.scada_projects WHERE tenant_id=$1 AND project_id=$2 AND head_revision=1 AND created_at=$5::timestamptz AND updated_at=$5::timestamptz) AS projects,
  (SELECT count(*)::text FROM public.scada_identities WHERE tenant_id=$1 AND subject_id IN ($3,$4) AND status='active' AND created_at=$5::timestamptz AND updated_at=$5::timestamptz) AS identities,
  (SELECT count(*)::text FROM public.scada_project_grants WHERE tenant_id=$1 AND project_id=$2 AND subject_id=$3 AND permission IN ('project:read','version:read','version:append')) AS grants,
  (SELECT count(*)::text FROM public.scada_project_versions WHERE tenant_id=$1 AND project_id=$2 AND revision=1 AND snapshot=$6::jsonb AND content_hash=$7 AND created_by=$3 AND created_at=$5::timestamptz) AS versions,
  (SELECT count(*)::text FROM public.scada_project_release_state WHERE tenant_id=$1 AND project_id=$2 AND release_generation=0 AND released_revision IS NULL AND released_content_hash IS NULL AND last_release_event_id IS NULL AND updated_at=$5::timestamptz) AS releases,
  (SELECT count(*)::text FROM public.scada_project_audit WHERE tenant_id=$1 AND project_id=$2 AND event_id=$8::uuid AND revision=1 AND actor_id=$3 AND action='version:append' AND created_at=$9::timestamptz) AS audits`;

function requireMatch(condition, message) {
  if (!condition) throw new DockerB4LockFixtureError(message);
}

function absent(path) {
  return lstatSync(path, { throwIfNoEntry: false }) === undefined;
}

/** 固定本机目录和两个证据文件，不创建目录、不覆盖、不自动删除文件。 */
export function openB4FixtureEvidence(root) {
  const local = join(root, ".local");
  const directory = join(local, "docker");
  const fixturePath = join(directory, "b4-lock-fixture.json");
  const manifestPath = join(directory, "b4-lock-fixture-manifest.json");
  const checkDirectory = () => {
    for (const path of [local, directory]) {
      const stat = lstatSync(path);
      requireMatch(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(path) === path, "B4 夹具证据目录不可信");
    }
  };
  const assertAbsent = () => {
    checkDirectory();
    requireMatch(absent(fixturePath) && absent(manifestPath), "B4 夹具或恢复清单已存在，保留现场");
  };
  const read = (path) => {
    checkDirectory();
    const stat = lstatSync(path);
    requireMatch(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size > 0 && stat.size <= 65536 && realpathSync(path) === path, "B4 夹具证据文件不可信");
    return readFileSync(path, "utf8");
  };
  const write = (path, content) => {
    checkDirectory();
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, content, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    requireMatch(read(path) === content, "B4 夹具证据文件写入后不一致");
  };
  const assertReserved = (manifestText) => {
    requireMatch(read(manifestPath) === manifestText && absent(fixturePath), "B4 夹具恢复清单发生变化");
  };
  return {
    assertAbsent,
    reserve(manifestText) {
      assertAbsent();
      write(manifestPath, manifestText);
    },
    assertReserved,
    publish(fixtureText, manifestText) {
      assertReserved(manifestText);
      write(fixturePath, fixtureText);
    },
    readExisting() {
      return { manifestText: read(manifestPath), fixtureText: read(fixturePath) };
    },
  };
}

function checkState(state, fingerprints) {
  requireMatch(
    state?.status === "B4_DUAL_INSTALLED_STATE_VERIFIED" && state.phase === "dual-installed" &&
      state.isolationFingerprint === fingerprints.isolationFingerprint &&
      state.scadaCatalogFingerprint === fingerprints.expectedScadaCatalogFingerprint &&
      state.keycloakPlanFingerprint === fingerprints.expectedKeycloakPlanFingerprint &&
      state.keycloakCatalogFingerprint === fingerprints.expectedKeycloakProjectionFingerprint &&
      state.dualCatalogFingerprint === fingerprints.expectedDualCatalogFingerprint &&
      state.keycloakSchemaPolicy?.status === "KEYCLOAK_SCHEMA_POLICY_REVIEW_ONLY" &&
      state.keycloakSchemaPolicy.planFingerprint === fingerprints.expectedSchemaPolicyFingerprint &&
      state.scadaCatalogMatched === true && state.keycloakOwnerProjectionMatched === true &&
      state.keycloakMaintenanceVerified === true && state.independentConnectionsClosed === true &&
      state.runtimeLoginAllowed === false && state.databaseWritten === false && state.businessDataWritten === false &&
      state.admissionPassed === false && state.serviceSwitched === false,
    "B4 夹具双库维护指纹或状态不一致",
  );
  return state;
}

function contextOf(identity, fingerprints) {
  return { version: identity.version, systemIdentifier: identity.systemIdentifier, ...Object.fromEntries(fingerprintFields.map((key) => [key, fingerprints[key]])) };
}

function fixtureTextOf(fixture) {
  return JSON.stringify(fixture, null, 2) + "\n";
}

function validateFixture(fixture) {
  requireMatch(fixture && Object.keys(fixture).length === 4 &&
    typeof fixture.tenantId === "string" && fixture.tenantId.startsWith("b4-lock-") && uuid(fixture.tenantId.slice(8)) &&
    typeof fixture.projectId === "string" && fixture.projectId.startsWith("b4-project-") && uuid(fixture.projectId.slice(11)) &&
    uuid(fixture.subjectId) && uuid(fixture.otherSubjectId) && fixture.subjectId !== fixture.otherSubjectId,
  "B4 专用合成夹具标识无效");
}

async function validateManifest(manifest, context, core) {
  requireMatch(manifest && Object.keys(manifest).length === 6 && manifest.formatVersion === 1 &&
    isDeepStrictEqual(manifest.context, context) && uuid(manifest.eventId) &&
    typeof manifest.auditCreatedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(manifest.auditCreatedAt),
  "B4 恢复清单上下文或格式不一致");
  validateFixture(manifest.fixture);
  const snapshot = await core.readProjectSnapshot(manifest.snapshot);
  requireMatch(isDeepStrictEqual(JSON.parse(JSON.stringify(snapshot)), JSON.parse(JSON.stringify(manifest.snapshot))) && snapshot.projectId === manifest.fixture.projectId &&
    snapshot.revision === 1 && hash(snapshot.contentHash) && snapshot.document.tags.length === 0 &&
    snapshot.document.pages.length === 1 && snapshot.document.pages[0].nodes.length === 0 &&
    isDeepStrictEqual(snapshot.document, { ...core.createBlankStudioDocument(manifest.fixture.projectId), projectName: "B4 并发锁测试工程" }),
  "B4 专用首版快照或摘要不一致");
  return manifest;
}

/** 夹具生命周期仅支持固定操作；预检只读，写入和清理须分别确认，不自动重试。 */
export async function runB4LockFixture({
  mode,
  confirm,
  confirmMaintenance,
  confirmBackup,
  identity,
  fingerprints,
  manifestFingerprint,
  core,
  evidence,
  createClient,
  readInstalledState,
}) {
  requireMatch(Object.hasOwn(confirmations, mode) && confirm === confirmations[mode] &&
    identity?.version === "190000" && typeof identity.systemIdentifier === "string" && /^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier) &&
    fingerprints && fingerprintFields.every((key) => hash(fingerprints[key])) &&
    (mode === "cleanup" ? hash(manifestFingerprint) : manifestFingerprint === undefined) &&
    (mode === "preflight" ? confirmMaintenance === undefined && confirmBackup === undefined :
      confirmMaintenance === "--confirm-exclusive-maintenance" && confirmBackup === "--confirm-backup-restore-reviewed") &&
    typeof core?.createBlankStudioDocument === "function" && typeof core?.createProjectSnapshot === "function" && typeof core?.readProjectSnapshot === "function" &&
    typeof createClient === "function" && typeof readInstalledState === "function",
  "B4 夹具缺少独立确认、固定集群或完整指纹");
  const context = contextOf(identity, fingerprints);
  const verifyState = async () => checkState(await readInstalledState(), fingerprints);
  let manifest;
  let manifestText;
  let fixtureText;
  if (mode === "cleanup") {
    ({ manifestText, fixtureText } = evidence.readExisting());
    requireMatch(digest(manifestText) === manifestFingerprint, "B4 恢复清单指纹不一致");
    manifest = await validateManifest(JSON.parse(manifestText), context, core);
    requireMatch(fixtureText === fixtureTextOf(manifest.fixture), "B4 四字段夹具与恢复清单不一致");
  } else {
    evidence.assertAbsent();
  }
  const initial = await verifyState();
  const checkFiles = () => {
    if (mode === "cleanup") {
      requireMatch(isDeepStrictEqual(evidence.readExisting(), { manifestText, fixtureText }), "B4 夹具文件发生变化");
    } else if (manifestText) {
      evidence.assertReserved(manifestText);
    } else {
      evidence.assertAbsent();
    }
  };
  const command = async (client, sql, tag, values = []) => {
    const result = await client.query(sql, values);
    requireMatch(result?.command === tag, "B4 夹具事务命令标签异常");
    return result;
  };
  const rows = async (client, sql, values, expected) => requireMatch(isDeepStrictEqual((await command(client, sql, "SELECT", values)).rows, expected), "B4 夹具查询证据不一致");
  const quiet = async (client) => {
    await command(client, "SELECT pg_catalog.pg_stat_clear_snapshot()", "SELECT");
    await rows(client, quietSql, [], [{ quiet: true }]);
  };
  const identify = (client, readonly) => rows(client, identitySql, [], [{ role: "adui_scada", sessionRole: "adui_scada", database: "adui_scada", version: identity.version, readonly: readonly ? "on" : "off", isolation: readonly ? "repeatable read" : "read committed", recovery: false, systemIdentifier: identity.systemIdentifier }]);
  const checkCounts = (client, populated) => rows(client, countSql, [], [Object.fromEntries(Object.entries(counts).map(([table, count]) => [table, populated ? String(count) : "0"]))]);
  const valuesOf = (item) => [item.fixture.tenantId, item.fixture.projectId, item.fixture.subjectId, item.fixture.otherSubjectId, item.snapshot.createdAt, JSON.stringify(item.snapshot), item.snapshot.contentHash, item.eventId, item.auditCreatedAt];
  const verifyRows = async (client, item) => {
    await checkCounts(client, true);
    await rows(client, verifySql, valuesOf(item), [{ projects: "1", identities: "2", grants: "3", versions: "1", releases: "1", audits: "1" }]);
  };
  const affected = async (client, sql, values, count, tag) => requireMatch((await command(client, sql, tag, values)).rowCount === count, "B4 夹具影响行数异常");
  const clients = new Set();
  const transaction = async (readonly, work, commit) => {
    let client;
    let begun = false;
    let commitAttempted = false;
    let commitConfirmed = false;
    let rollbackAttempted = false;
    let failure;
    let stage = "连接";
    try {
      const candidate = createClient(readonly);
      requireMatch(candidate && !clients.has(candidate), "B4 夹具必须使用独立连接");
      client = candidate;
      clients.add(client);
      await client.connect();
      stage = "事务启动与身份";
      begun = true;
      await command(client, readonly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE", "BEGIN");
      await command(client, "SET LOCAL statement_timeout = '5s'", "SET");
      await command(client, "SET LOCAL lock_timeout = '2s'", "SET");
      await command(client, "SET LOCAL idle_in_transaction_session_timeout = '30s'", "SET");
      await identify(client, readonly);
      stage = "隔离锁与会话";
      await rows(client, "SELECT pg_catalog.pg_try_advisory_xact_lock(839572941652::bigint) AS locked", [], [{ locked: true }]);
      if (!readonly) await command(client, lockSql, "LOCK");
      await quiet(client);
      stage = "业务空基线或夹具精确核验";
      checkFiles();
      await work(client);
      await identify(client, readonly);
      await quiet(client);
      checkFiles();
      if (commit) {
        stage = "提交";
        commitAttempted = true;
        await command(client, "COMMIT", "COMMIT");
        commitConfirmed = true;
        begun = false;
      } else {
        stage = "回滚";
        rollbackAttempted = true;
        await command(client, "ROLLBACK", "ROLLBACK");
        begun = false;
      }
    } catch (error) {
      failure = `B4 夹具${stage}失败，内部诊断已脱敏；保留现场，不自动重试`;
      if (error instanceof DockerB4LockFixtureError) failure += "；" + error.message;
      if (commitAttempted) failure += "；提交结果未知";
      if (rollbackAttempted) failure += "；回滚未确认";
    } finally {
      if (client) {
        if (begun && !commitAttempted && !rollbackAttempted) {
          try { await command(client, "ROLLBACK", "ROLLBACK"); } catch { failure = (failure ?? "B4 夹具") + "；回滚未确认"; }
        }
        try {
          await client.end();
        } catch {
          failure = (failure ?? (commitConfirmed ? "B4 夹具已收到提交标签" : "B4 夹具")) + "；连接关闭未确认，禁止重试";
        }
      }
    }
    if (failure) throw new DockerB4LockFixtureError(failure);
  };
  const buildCandidate = async (client) => {
    const fixture = {
      tenantId: "b4-lock-" + randomUUID(),
      projectId: "b4-project-" + randomUUID(),
      subjectId: randomUUID(),
      otherSubjectId: randomUUID(),
    };
    const eventId = randomUUID();
    const createdAt = new Date().toISOString();
    const snapshot = await core.createProjectSnapshot(
      { ...core.createBlankStudioDocument(fixture.projectId), projectName: "B4 并发锁测试工程" },
      { revision: 1, createdAt },
    );
    const audit = await command(client, `SELECT pg_catalog.to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "auditCreatedAt"`, "SELECT");
    requireMatch(audit.rows.length === 1, "B4 夹具审计时间证据异常");
    return validateManifest(
      { formatVersion: 1, context, fixture, eventId, snapshot, auditCreatedAt: audit.rows[0].auditCreatedAt },
      context,
      core,
    );
  };
  if (mode === "create") {
    await transaction(false, async (client) => {
      await checkCounts(client, false);
      manifest = await buildCandidate(client);
      const { fixture, eventId, snapshot } = manifest;
      const { createdAt } = snapshot;
      manifestText = JSON.stringify(manifest, null, 2) + "\n";
      fixtureText = fixtureTextOf(fixture);
      evidence.reserve(manifestText);
      await affected(client, "INSERT INTO public.scada_identities (tenant_id,subject_id,status,created_at,updated_at) VALUES ($1,$2,'active',$4::timestamptz,$4::timestamptz),($1,$3,'active',$4::timestamptz,$4::timestamptz)", [fixture.tenantId, fixture.subjectId, fixture.otherSubjectId, createdAt], 2, "INSERT");
      await command(client, "SET LOCAL ROLE adui_scada_runtime", "SET");
      await rows(client, "SELECT current_user::text AS role", [], [{ role: "adui_scada_runtime" }]);
      await rows(client, "SELECT public.scada_create_project($1::text,$2::text,$3::text,$4::jsonb,$5::text,$6::timestamptz,$7::uuid) AS result", [fixture.tenantId, fixture.projectId, fixture.subjectId, JSON.stringify(snapshot), snapshot.contentHash, createdAt, eventId], [{ result: "CREATED" }]);
      await command(client, "RESET ROLE", "RESET");
      await identify(client, false);
      await verifyRows(client, manifest);
    }, true);
  } else if (mode === "cleanup") {
    await transaction(false, async (client) => {
      await verifyRows(client, manifest);
      const { tenantId, projectId, subjectId, otherSubjectId } = manifest.fixture;
      const scope = [tenantId, projectId];
      await affected(client, "DELETE FROM public.scada_project_release_state WHERE tenant_id=$1 AND project_id=$2 AND release_generation=0", scope, 1, "DELETE");
      await affected(client, "DELETE FROM public.scada_project_audit WHERE tenant_id=$1 AND project_id=$2 AND event_id=$3::uuid AND revision=1", [...scope, manifest.eventId], 1, "DELETE");
      await affected(client, "DELETE FROM public.scada_project_grants WHERE tenant_id=$1 AND project_id=$2 AND subject_id=$3 AND permission IN ('project:read','version:read','version:append')", [...scope, subjectId], 3, "DELETE");
      await affected(client, "DELETE FROM public.scada_project_versions WHERE tenant_id=$1 AND project_id=$2 AND revision=1 AND content_hash=$3", [...scope, manifest.snapshot.contentHash], 1, "DELETE");
      await affected(client, "DELETE FROM public.scada_projects WHERE tenant_id=$1 AND project_id=$2 AND head_revision=1", scope, 1, "DELETE");
      await affected(client, "DELETE FROM public.scada_identities WHERE tenant_id=$1 AND subject_id IN ($2,$3) AND status='active'", [tenantId, subjectId, otherSubjectId], 2, "DELETE");
      await checkCounts(client, false);
    }, true);
  }
  try {
    await transaction(true, async (client) => {
      if (mode === "create") await verifyRows(client, manifest);
      else {
        await checkCounts(client, false);
        if (mode === "preflight") await buildCandidate(client);
      }
    }, false);
    requireMatch(isDeepStrictEqual(await verifyState(), initial), "B4 夹具前后目录证据漂移");
    checkFiles();
    if (mode === "create") evidence.publish(fixtureText, manifestText);
  } catch (error) {
    if (mode === "preflight" && error instanceof DockerB4LockFixtureError) throw error;
    const message = mode === "preflight"
      ? "B4 夹具只读预检失败；保留现场，不自动重试"
      : "B4 夹具已收到提交标签，但独立复验或证据发布失败；保留清单，不自动重试或逆向清理";
    throw new DockerB4LockFixtureError(message);
  }
  return {
    status: mode === "preflight" ? "B4_LOCK_FIXTURE_PREFLIGHT_VERIFIED" : mode === "create" ? "B4_LOCK_FIXTURE_CREATED_VERIFIED" : "B4_LOCK_FIXTURE_CLEANUP_VERIFIED",
    businessTableCount: b4FixtureTables.length,
    businessRowCount: mode === "create" ? 9 : 0,
    manifestFingerprint: manifestText ? digest(manifestText) : null,
    businessTablesEmpty: mode !== "create",
    coreSnapshotVerified: true,
    fixturePrepared: mode === "create",
    fixtureFilesRetained: mode !== "preflight",
    independentConnectionsClosed: true,
    dualCatalogMatched: true,
    businessDataWritten: mode !== "preflight",
    databaseWritten: mode !== "preflight",
    runtimeLoginAllowed: false,
    rowLockConcurrencyVerified: false,
    rowAuthorizationVerified: false,
    admissionPassed: false,
    serviceSwitched: false,
  };
}
