import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { parsePublishedFixtureMetadataArgs } from "./audit-published-fixture-metadata.mjs";
import {
  assertPublishedFixtureBaselineRows,
  BASELINE_ERROR,
  BASELINE_PROJECT,
} from "./assert-published-fixture-baseline.mjs";
import { inspectPublishedFixtureReadonly } from "./inspect-published-fixture-readonly.mjs";
import { resolvePublishedRevocationPreflightTarget } from "./preflight-oidc-published-revocation.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const TENANT = "lab-tenant";
const SUBJECT = "lab-engineer";
const PREFIX = "d5b7b-published-";
const MIGRATIONS = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];
const BAD_ARGS = "D5b7f 只读发现不接受工程 ID、写入选项或其他参数";
const BAD_LAB = "D5b7f 只能使用可信本机 OIDC Lab";
const BAD_EVIDENCE = "D5b7f 只读发现环境或候选元数据不符合预期";
const UNKNOWN_FAILURE = "D5b7f 只读发现失败，内部诊断已脱敏";

function rejectEvidence() {
  throw new Error(BAD_EVIDENCE);
}

/** 无 ID 发现没有可控搜索参数，禁止外部指定工程、前缀、库或身份。 */
export function parsePublishedFixtureDiscoveryArgs(args) {
  if (!Array.isArray(args) || args.length !== 0) throw new Error(BAD_ARGS);
  return { mode: "readonly" };
}

/** 失败时不输出数据库错误、工程 ID、查询参数、Token 或连接信息。 */
export function describePublishedFixtureDiscoveryFailure(error) {
  if (
    error instanceof Error &&
    [BAD_ARGS, BAD_LAB, BAD_EVIDENCE, BASELINE_ERROR].includes(error.message)
  ) {
    return error.message;
  }
  return UNKNOWN_FAILURE;
}

/** 最多两条候选：唯一合法候选才可进入第二次完整审查。 */
export function classifyPublishedFixtureDiscoveryRows(rows) {
  if (!Array.isArray(rows) || rows.length > 2) rejectEvidence();
  for (const row of rows) {
    if (
      row === null ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.getPrototypeOf(row) !== Object.prototype ||
      Object.keys(row).length !== 1 ||
      !Object.hasOwn(row, "project_id")
    ) {
      rejectEvidence();
    }
    try {
      parsePublishedFixtureMetadataArgs(["--project-id", row.project_id]);
    } catch {
      rejectEvidence();
    }
  }
  if (rows.length === 0) return { kind: "NOT_FOUND" };
  if (rows.length === 2) {
    if (rows[0].project_id === rows[1].project_id) rejectEvidence();
    return { kind: "AMBIGUOUS" };
  }
  return { kind: "SINGLE", projectId: rows[0].project_id };
}

/**
 * 仅在本机可信 Lab 与原 D5b1 基线均验证后，检索有独立读取权限的
 * 专用已发布候选。结果由 SQL 上限 2 和强制 UUIDv4 校验共同约束。
 * 只返回项目标识符，不读取快照正文、Cookie 或任意其他工程列表。
 */
export async function discoverPublishedFixtureCandidatesReadonly(client, target) {
  if (!target || typeof target.issuer !== "string" || target.issuer.length === 0) {
    rejectEvidence();
  }
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const query = async (sql, params) => (await client.query(sql, params)).rows;
    const database = await query(
      "SELECT current_database() AS database_name, current_user AS database_user",
    );
    const migrations = await query(
      'SELECT migration_name FROM public."_prisma_migrations" ' +
        "WHERE migration_name = ANY($1::text[]) AND finished_at IS NOT NULL " +
        "AND rolled_back_at IS NULL",
      [MIGRATIONS],
    );
    const unresolved = await query(
      'SELECT COUNT(*)::integer AS count FROM public."_prisma_migrations" ' +
        "WHERE finished_at IS NULL AND rolled_back_at IS NULL",
    );
    if (
      database.length !== 1 ||
      database[0].database_name !== "adui_scada" ||
      database[0].database_user !== "adui_scada" ||
      migrations.length !== MIGRATIONS.length ||
      new Set(migrations.map((row) => row.migration_name)).size !== MIGRATIONS.length ||
      MIGRATIONS.some((name) => !migrations.some((row) => row.migration_name === name)) ||
      unresolved.length !== 1 ||
      unresolved[0].count !== 0
    ) {
      rejectEvidence();
    }

    const identity = await query(
      "SELECT 1 FROM public.scada_identities " +
        "WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active'",
      [TENANT, SUBJECT],
    );
    const external = await query(
      "SELECT 1 FROM public.scada_external_identities " +
        "WHERE issuer = $1 AND tenant_id = $2 AND subject_id = $3",
      [target.issuer, TENANT, SUBJECT],
    );
    if (identity.length !== 1 || external.length !== 1) rejectEvidence();

    const scope = [TENANT, BASELINE_PROJECT];
    const baseline = {
      project: await query(
        "SELECT head_revision FROM public.scada_projects " +
          "WHERE tenant_id = $1 AND project_id = $2",
        scope,
      ),
      versions: await query(
        "SELECT revision, created_by FROM public.scada_project_versions " +
          "WHERE tenant_id = $1 AND project_id = $2",
        scope,
      ),
      audit: await query(
        "SELECT revision, actor_id, action FROM public.scada_project_audit " +
          "WHERE tenant_id = $1 AND project_id = $2",
        scope,
      ),
      state: await query(
        "SELECT release_generation, released_revision, released_content_hash, " +
          "last_release_event_id FROM public.scada_project_release_state " +
          "WHERE tenant_id = $1 AND project_id = $2",
        scope,
      ),
      events: await query(
        "SELECT COUNT(*)::integer AS count FROM public.scada_project_release_events " +
          "WHERE tenant_id = $1 AND project_id = $2",
        scope,
      ),
      grants: await query(
        "SELECT subject_id, permission FROM public.scada_project_grants " +
          "WHERE tenant_id = $1 AND project_id = $2",
        scope,
      ),
    };
    assertPublishedFixtureBaselineRows(baseline);

    const candidates = await query(
      "SELECT p.project_id FROM public.scada_projects AS p " +
        "JOIN public.scada_project_release_state AS r " +
        "ON r.tenant_id = p.tenant_id AND r.project_id = p.project_id " +
        "WHERE p.tenant_id = $1 AND p.project_id LIKE $2 " +
        "AND r.release_generation > 0 AND r.released_revision IS NOT NULL " +
        "AND r.released_content_hash IS NOT NULL AND r.last_release_event_id IS NOT NULL " +
        "AND EXISTS (SELECT 1 FROM public.scada_project_grants AS g " +
        "WHERE g.tenant_id = p.tenant_id AND g.project_id = p.project_id " +
        "AND g.subject_id = $3 AND g.permission = 'release:read') " +
        "ORDER BY p.project_id LIMIT 2",
      [TENANT, `${PREFIX}%`, SUBJECT],
    );
    return classifyPublishedFixtureDiscoveryRows(candidates);
  } finally {
    await client.query("ROLLBACK");
  }
}

/**
 * 二次审查使用独立的只读事务，重新验证身份、原工程基线、全量 ACL、
 * 发布指针、版本摘要和末次事件；只有通过时才允许显示唯一候选 ID。
 * 第二次事务保证发现后发生撤权或发布状态变化时仍默认拒绝。
 */
export async function discoverPublishedFixtureReadonly(
  client,
  target,
  inspect = inspectPublishedFixtureReadonly,
) {
  const result = await discoverPublishedFixtureCandidatesReadonly(client, target);
  if (result.kind !== "SINGLE") return result;
  const verifiedMetadata = await inspect(client, target, result.projectId);
  if (verifiedMetadata?.kind !== "RELEASED_METADATA_ONLY") {
    return { kind: "NOT_VERIFIED" };
  }
  return { kind: "RELEASED_METADATA_ONLY", projectId: result.projectId };
}

async function run() {
  parsePublishedFixtureDiscoveryArgs(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error(BAD_LAB);
  loadEnvFile(ROOT_ENV);
  let target;
  try {
    target = resolvePublishedRevocationPreflightTarget(process.env);
  } catch {
    throw new Error(BAD_LAB);
  }
  const requireServer = createRequire(SERVER_PACKAGE);
  const { Client } = requireServer("pg");
  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  try {
    await client.connect();
    const result = await discoverPublishedFixtureReadonly(client, target);
    if (result.kind === "RELEASED_METADATA_ONLY") {
      process.stdout.write("D5b7f 唯一候选仅通过只读元数据复核，不代表真实快照 verified。\n");
      process.stdout.write(`D5b7f 已授权候选工程 ID：${result.projectId}\n`);
      return;
    }
    const messages = {
      NOT_FOUND: "D5b7f 未发现符合命名空间、发布代次和读取权限的独立候选。\n",
      AMBIGUOUS: "D5b7f 发现多个候选，已拒绝选择和输出工程 ID。\n",
      NOT_VERIFIED: "D5b7f 候选未通过二次只读审查，已拒绝输出工程 ID。\n",
    };
    process.stderr.write(messages[result.kind] ?? UNKNOWN_FAILURE);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describePublishedFixtureDiscoveryFailure(error) + "\n");
    process.exitCode = 1;
  });
}
