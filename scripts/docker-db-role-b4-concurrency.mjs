import { isDeepStrictEqual } from "node:util";

const manager = "adui_scada";
const runtime = "adui_scada_runtime";
const begin = "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE";
const identitySql = "SELECT current_user::text AS role, session_user::text AS \"sessionRole\", current_database() AS database, current_setting('server_version_num') AS version, current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation";
const identityLock = "SELECT status::text AS status FROM public.scada_identities WHERE tenant_id = $1 AND subject_id = $2 FOR UPDATE NOWAIT";
const grantLock = "SELECT permission::text AS permission FROM public.scada_project_grants WHERE tenant_id = $1 AND project_id = $2 AND subject_id = $3 ORDER BY permission COLLATE \"C\" FOR UPDATE NOWAIT";
const permissions = [{ permission: "project:read" }, { permission: "version:append" }, { permission: "version:read" }];
const active = [{ status: "active" }];

function requireMatch(condition, message) {
  if (!condition) throw new Error(message);
}

/** 只接受维护者审阅的现有本机测试夹具，不创建、提交或清理任何业务行。 */
export function validateB4LockFixture(fixture) {
  const keys = ["tenantId", "projectId", "subjectId", "otherSubjectId"];
  requireMatch(fixture && !Array.isArray(fixture) && Object.keys(fixture).length === keys.length &&
    keys.every((key) => typeof fixture[key] === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/u.test(fixture[key])) &&
    fixture.subjectId !== fixture.otherSubjectId, "B4 并发锁测试夹具标识无效");
  return Object.fromEntries(keys.map((key) => [key, fixture[key]]));
}

/** 两个独立会话验证真实共享锁与排他锁冲突；无任何 DML、提交或角色持久化。 */
export async function runB4LockConcurrency({ confirm, fixture, identity, readInstalledState, createClient }) {
  requireMatch(confirm === "--confirm-reviewed-existing-fixture" && identity?.version === "190000" &&
    typeof identity.systemIdentifier === "string" && /^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier) &&
    typeof readInstalledState === "function" && typeof createClient === "function", "B4 并发锁缺少独立夹具与宿主确认");
  const { tenantId, projectId, subjectId, otherSubjectId } = validateB4LockFixture(fixture);
  const id = [tenantId, subjectId];
  const grants = [tenantId, projectId, subjectId];
  const verifyState = async () => {
    const state = await readInstalledState();
    requireMatch(state?.phase === "dual-installed" && state.scadaCatalogMatched === true && state.keycloakOwnerProjectionMatched === true &&
      state.independentConnectionsClosed === true && state.admissionPassed === false, "B4 并发锁前后双库状态不一致");
    return state;
  };
  const original = await verifyState();
  const clients = [];
  let stage = "双连接";
  let failure;
  const command = async (client, sql, expected, values = []) => {
    const result = await client.query(sql, values);
    requireMatch(result?.command === expected, "B4 并发锁命令标签不一致");
    return result;
  };
  const rows = async (client, sql, values, expected) => requireMatch(isDeepStrictEqual((await command(client, sql, "SELECT", values)).rows, expected), "B4 并发锁夹具或返回值不一致");
  const identify = (client, role) => rows(client, identitySql, [], [{ role, sessionRole: manager, database: "adui_scada", version: identity.version, read_only: "off", isolation: "read committed" }]);
  const open = async () => {
    const client = createClient();
    requireMatch(client && !clients.some((entry) => entry.client === client), "B4 并发锁不能复用客户端");
    const entry = { client, attempted: false };
    clients.push(entry);
    await client.connect();
    return entry;
  };
  const start = async (entry) => {
    entry.attempted = true;
    await command(entry.client, begin, "BEGIN");
    await identify(entry.client, manager);
    await rows(entry.client, "SELECT system_identifier::text AS \"systemIdentifier\" FROM pg_catalog.pg_control_system()", [], [{ systemIdentifier: identity.systemIdentifier }]);
    await rows(entry.client, "SELECT pg_catalog.pg_try_advisory_xact_lock_shared(839572941652::bigint) AS locked", [], [{ locked: true }]);
    await command(entry.client, "SET LOCAL statement_timeout = '5s'", "SET");
    await command(entry.client, "SET LOCAL lock_timeout = '2s'", "SET");
  };
  const rollback = async (entry) => {
    await command(entry.client, "ROLLBACK", "ROLLBACK");
    entry.attempted = false;
  };
  const managerLocks = async (client) => {
    await rows(client, identityLock, id, active);
    await rows(client, grantLock, grants, permissions);
    await rows(client, "SELECT status::text AS status FROM public.scada_identities WHERE tenant_id = $1 AND subject_id = $2", [tenantId, otherSubjectId], active);
    await rows(client, "SELECT permission::text AS permission FROM public.scada_project_grants WHERE tenant_id = $1 AND project_id = $2 AND subject_id = $3", [tenantId, projectId, otherSubjectId], []);
  };
  const blocked = async (client, sql, values) => {
    await command(client, "SAVEPOINT scada_b4_lock", "SAVEPOINT");
    let denied = false;
    try { await client.query(sql, values); }
    catch (error) { denied = error?.code === "55P03"; }
    await command(client, "ROLLBACK TO SAVEPOINT scada_b4_lock", "ROLLBACK");
    await command(client, "RELEASE SAVEPOINT scada_b4_lock", "RELEASE");
    requireMatch(denied, "B4 并发锁未得到精确 SQLSTATE 55P03");
  };
  try {
    const first = await open();
    const second = await open();
    stage = "夹具未锁基线";
    await start(second);
    await managerLocks(second.client);
    await rollback(second);
    stage = "运行角色共享锁";
    await start(first);
    await command(first.client, "SET LOCAL ROLE adui_scada_runtime", "SET");
    await identify(first.client, runtime);
    await rows(first.client, "SELECT status FROM public.scada_lock_identity($1, $2)", id, active);
    await rows(first.client, "SELECT permission FROM public.scada_lock_project_grants($1, $2, $3) ORDER BY permission COLLATE \"C\"", grants, permissions);
    await rows(first.client, "SELECT permission FROM public.scada_lock_project_grants($1, $2, $3)", [tenantId, projectId, otherSubjectId], []);
    stage = "并发排他锁拒绝";
    await start(second);
    await blocked(second.client, identityLock, id);
    await blocked(second.client, grantLock, grants);
    await rollback(second);
    stage = "共享锁释放后排他锁成功";
    await rollback(first);
    await start(second);
    await managerLocks(second.client);
    await rollback(second);
  } catch {
    failure = "B4 并发锁" + stage + "失败，内部诊断已脱敏";
  } finally {
    for (const entry of clients.reverse()) {
      if (entry.attempted) {
        try { await rollback(entry); }
        catch { failure = (failure ?? "B4 并发锁") + "；回滚未确认，禁止重试"; }
      }
      try { await entry.client.end(); }
      catch { failure = (failure ?? "B4 并发锁") + "；连接关闭未确认，禁止重试"; }
    }
  }
  if (failure) throw new Error(failure);
  const after = await verifyState();
  requireMatch(isDeepStrictEqual(after, original), "B4 并发锁前后目录证据漂移");
  return { status: "B4_IDENTITY_GRANT_LOCK_CONCURRENCY_VERIFIED", sharedLockConflictCount: 2,
    lockReleaseVerified: true, authorizedGrantRowsMatched: true, otherSubjectGrantRowsEmpty: true,
    identityGrantLockConcurrencyVerified: true, rowLockConcurrencyVerified: false, rowAuthorizationVerified: false,
    businessDataWritten: false, databaseWritten: false, admissionPassed: false, serviceSwitched: false };
}
