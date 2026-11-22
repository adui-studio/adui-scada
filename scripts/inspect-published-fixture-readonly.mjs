import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import {
  classifyPublishedFixtureMetadata,
  parsePublishedFixtureMetadataArgs,
} from "./audit-published-fixture-metadata.mjs";
import { resolvePublishedRevocationPreflightTarget } from "./preflight-oidc-published-revocation.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const TENANT = "lab-tenant";
const SUBJECT = "lab-engineer";
const MIGRATIONS = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];
const METADATA_ERROR = "D5b7c 发布夹具只读数据库元数据或迁移不符合预期";
const SAFE_ERRORS = new Set([
  "D5b7b 仅允许显式指定独立已发布夹具 ID，禁止写入参数",
  METADATA_ERROR,
  "D5b7b 发布夹具只读元数据不完整或不一致",
  "D5b7c 只能连接可信本机 OIDC Lab",
]);

/** 固定错误类别；数据库错误、身份、SQL 与连接地址不得出现在诊断中。 */
export function describePublishedFixtureReadonlyFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return "D5b7c 数据库只读审查失败，内部诊断已脱敏";
}

/**
 * 从已有可信 Lab 连接中读取最小发布元数据。
 * 不查询 snapshot 正文，不允许任何工程写入或 ACL 更改。
 */
export async function inspectPublishedFixtureReadonly(client, target, projectId) {
  parsePublishedFixtureMetadataArgs(["--project-id", projectId]);
  if (!target || typeof target.issuer !== "string" || target.issuer.length === 0) {
    throw new Error(METADATA_ERROR);
  }
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const query = async (statement, parameters) => (await client.query(statement, parameters)).rows;
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
      new Set(migrations.map((entry) => entry.migration_name)).size !== MIGRATIONS.length ||
      MIGRATIONS.some((name) => !migrations.some((entry) => entry.migration_name === name)) ||
      unresolved.length !== 1 ||
      unresolved[0].count !== 0
    ) {
      throw new Error(METADATA_ERROR);
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
    if (identity.length !== 1 || external.length !== 1) throw new Error(METADATA_ERROR);
    const scope = [TENANT, projectId];
    const project = await query(
      "SELECT tenant_id, project_id, head_revision FROM public.scada_projects " +
        "WHERE tenant_id = $1 AND project_id = $2",
      scope,
    );
    const grants = await query(
      "SELECT subject_id, permission FROM public.scada_project_grants " +
        "WHERE tenant_id = $1 AND project_id = $2 AND subject_id = $3 " +
        "AND permission = 'release:read'",
      [...scope, SUBJECT],
    );

    const rows = {
      context: {
        database_name: database[0].database_name,
        database_user: database[0].database_user,
        tenant_id: TENANT,
        subject_id: SUBJECT,
        project_id: projectId,
        identity_count: identity.length,
        external_identity_count: external.length,
      },
      project,
      grants,
      releaseState: [],
      releasedVersion: [],
      lastEvent: [],
    };
    // 无权限时不再读取发布指针、事件和版本，避免任何间接披露。
    if (project.length === 1 && grants.length === 1) {
      rows.releaseState = await query(
        "SELECT release_generation, released_revision, released_content_hash, " +
          "last_release_event_id FROM public.scada_project_release_state " +
          "WHERE tenant_id = $1 AND project_id = $2",
        scope,
      );
      if (rows.releaseState.length === 1) {
        const state = rows.releaseState[0];
        if (state.released_revision !== null) {
          rows.releasedVersion = await query(
            "SELECT revision, content_hash FROM public.scada_project_versions " +
              "WHERE tenant_id = $1 AND project_id = $2 AND revision = $3",
            [...scope, state.released_revision],
          );
        }
        if (state.last_release_event_id !== null) {
          rows.lastEvent = await query(
            "SELECT event_id, tenant_id, project_id, generation, action, " +
              "to_revision, to_content_hash FROM public.scada_project_release_events " +
              "WHERE tenant_id = $1 AND project_id = $2 AND event_id = $3",
            [...scope, state.last_release_event_id],
          );
        }
      }
    }
    return classifyPublishedFixtureMetadata(rows, projectId);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function run() {
  const { projectId } = parsePublishedFixtureMetadataArgs(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b7c 只能连接可信本机 OIDC Lab");
  loadEnvFile(ROOT_ENV);
  let target;
  try {
    target = resolvePublishedRevocationPreflightTarget(process.env);
  } catch {
    throw new Error("D5b7c 只能连接可信本机 OIDC Lab");
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
    const result = await inspectPublishedFixtureReadonly(client, target, projectId);
    if (result.kind === "RELEASED_METADATA_ONLY") {
      process.stdout.write(
        "D5b7c 只读元数据一致：仍需独立核验真实发布快照及可信读取 API。\n",
      );
    } else if (result.kind === "UNRELEASED") {
      process.stderr.write("D5b7c 目标仍未发布，不能作为已发布夹具。\n");
      process.exitCode = 1;
    } else {
      process.stderr.write("D5b7c 工程不存在或缺少读取权限，不披露发布状态。\n");
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describePublishedFixtureReadonlyFailure(error) + "\n");
    process.exitCode = 1;
  });
}
