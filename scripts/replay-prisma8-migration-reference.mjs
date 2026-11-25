import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  requirePrisma8ReadOnlyReferenceUrl,
  requirePrisma8ReadOnlyTestUrl,
} from "../apps/server/src/database/prisma8-readonly-target.ts";
import {
  compareMigrationDatabases,
  inspectMigrationDatabase,
  loadMigrationBaseline,
  PreflightError,
  validateMigrationLedger,
} from "./inspect-prisma8-migration-readiness.mjs";
import { resolvePrisma7Cli } from "./prisma7-cli.mjs";

const referenceName = "adui_scada_fresh_prisma8_ref";
const confirmation = "--confirm-adui-scada-fresh-prisma8-ref";
// 固定本阶段已经两次验收的证据；结构或契约变化必须重新评审。
const reviewedFingerprint = "73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52";
const reviewedContract = "054113c40b1e6f3b7609641e09868e45c0e969d8035e6e1376d10ac3e5148424";
const readOnlyOptions =
  "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c search_path=public";

function requireCondition(condition, message) {
  if (!condition) throw new PreflightError(message);
}

/** 必须同时给出固定确认参数和独立参考库地址，禁止回退或推导业务库。 */
export function requireReferenceReplayTarget(input, args) {
  requireCondition(
    isDeepStrictEqual(args, [confirmation]),
    "必须显式确认独立参考库历史重放，且不得附加其他参数",
  );
  const url = new URL(requirePrisma8ReadOnlyReferenceUrl(input));
  requireCondition(url.hostname === "127.0.0.1", "独立参考库重放仅允许显式 IPv4 回环地址");
  return url.toString();
}

const boundarySql = `SELECT current_database()::text AS database_name,
    current_schema()::text AS schema_name,
    current_setting('transaction_read_only') AS read_only,
    current_setting('transaction_isolation') AS isolation,
    pg_is_in_recovery() AS in_recovery`;
const emptySql = `SELECT
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg_%') AS extra_schema,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public') AS relations,
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS routines,
    EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public') AS types,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql') AS extensions,
    EXISTS (SELECT 1 FROM pg_event_trigger) AS event_triggers,
    EXISTS (SELECT 1 FROM pg_publication) AS publications,
    EXISTS (SELECT 1 FROM pg_foreign_server) AS foreign_servers,
    EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()) AS other_sessions`;
const ledgerSql = `SELECT id, migration_name, checksum, started_at::text AS started_at_text,
    finished_at IS NOT NULL AS finished, finished_at::text AS finished_at_text,
    rolled_back_at IS NOT NULL AS rolled_back, rolled_back_at::text AS rolled_back_at_text,
    applied_steps_count FROM public._prisma_migrations ORDER BY migration_name, id LIMIT $1::integer`;

/** 每次先检查实际参考库边界，只读查询完成或失败后均回滚并关闭。 */
async function readReferenceSnapshot(client, inspect) {
  let begun = false;
  let result;
  const failures = [];
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    begun = true;
    const { rows } = await client.query(boundarySql);
    const row = rows[0];
    requireCondition(
      rows.length === 1 &&
        row?.database_name === referenceName &&
        row.schema_name === "public" &&
        row.read_only === "on" &&
        row.isolation === "repeatable read" &&
        row.in_recovery === false,
      "实际参考库或只读事务边界不符合预期",
    );
    result = await inspect(client);
  } catch (error) {
    failures.push(error instanceof PreflightError ? error.message : "参考库只读检查失败");
  } finally {
    if (begun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        failures.push("参考库只读事务回滚失败");
      }
    }
    try {
      await client.end();
    } catch {
      failures.push("参考库连接关闭失败");
    }
  }
  requireCondition(failures.length === 0, failures.join("；"));
  return result;
}

/** 仅检查已存在的专用库，不创建数据库，也不清理任何已有对象。 */
export async function inspectEmptyReferenceDatabase(client) {
  return readReferenceSnapshot(client, async (connection) => {
    const { rows } = await connection.query(emptySql);
    const row = rows[0];
    requireCondition(
      rows.length === 1 &&
        row?.extra_schema === false &&
        row.relations === false &&
        row.routines === false &&
        row.types === false &&
        row.extensions === false &&
        row.event_triggers === false &&
        row.publications === false &&
        row.foreign_servers === false &&
        row.other_sessions === false,
      "参考库不是独立空库或存在其他连接，禁止重放",
    );
    return true;
  });
}

/** 比较两次部署的迁移登记，不读取业务行或可能含敏感信息的迁移日志。 */
async function inspectReferenceLedger(client, baseline) {
  return readReferenceSnapshot(client, async (connection) => {
    const { rows } = await connection.query(ledgerSql, [baseline.migrations.length + 1]);
    validateMigrationLedger(baseline, rows);
    return rows;
  });
}

function requireReviewedComparison(report) {
  requireCondition(
    report.status === "MATCHED_REVIEW_REQUIRED" &&
      report.signingAllowed === false &&
      report.contractHash === reviewedContract &&
      report.catalogFingerprint === reviewedFingerprint &&
      report.referenceFingerprint === reviewedFingerprint,
    "双库目录与已验收指纹不一致，停止后续操作",
  );
}

/** 任何步骤失败即停止，不自动重试、恢复、清理或扩大迁移范围。 */
export async function runReferenceReplay(steps) {
  const initial = await steps.inspectTest();
  requireCondition(
    initial.status === "REVIEW_REQUIRED" &&
      initial.signingAllowed === false &&
      initial.marker === "ABSENT" &&
      initial.timezoneUtc === true &&
      initial.contractHash === reviewedContract &&
      initial.catalogFingerprint === reviewedFingerprint,
    "验收库与已审查指纹不一致，禁止重放",
  );
  requireCondition(await steps.inspectEmpty() === true, "参考库空库检查未通过");
  steps.runPrisma("deploy");
  steps.runPrisma("status");
  const first = await steps.compare();
  requireReviewedComparison(first);
  const firstLedger = await steps.inspectLedger();

  steps.runPrisma("deploy");
  steps.runPrisma("status");
  const second = await steps.compare();
  requireReviewedComparison(second);
  const secondLedger = await steps.inspectLedger();
  requireCondition(isDeepStrictEqual(firstLedger, secondLedger), "二次部署改变了迁移登记");
  return second;
}

function runPrisma7(server, cli, action, referenceUrl) {
  requireCondition(action === "deploy" || action === "status", "不支持的参考库迁移命令");
  const result = spawnSync(
    process.execPath,
    [cli, "migrate", action, "--config", "prisma7-reference.config.ts"],
    {
      cwd: server,
      env: {
        ...process.env,
        SCADA_MIGRATION_REFERENCE_DATABASE_URL: referenceUrl,
        SCADA_MIGRATION_REFERENCE_REPLAY_CONFIRMATION: referenceName,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    },
  );
  requireCondition(!result.error && result.status === 0, "参考库 Prisma 7 执行失败或超时：" + action);
  console.info("参考库 Prisma 7 命令通过：" + action);
}

async function main() {
  let testUrl;
  let referenceUrl;
  try {
    testUrl = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
    referenceUrl = requireReferenceReplayTarget(
      process.env.SCADA_MIGRATION_REFERENCE_DATABASE_URL,
      process.argv.slice(2),
    );
  } catch {
    throw new PreflightError("必须显式指定两个隔离库连接并确认独立参考库重放");
  }
  const baseline = loadMigrationBaseline();
  requireCondition(
    baseline.migrations.length === 8 && baseline.contractHash === reviewedContract,
    "历史迁移数量或契约发生变化，禁止重放",
  );
  const server = resolve(import.meta.dirname, "../apps/server");
  const prisma7 = resolvePrisma7Cli(server);
  const manifest = JSON.parse(
    readFileSync(join(server, "node_modules", "@prisma", "prisma7", "package.json"), "utf8"),
  );
  requireCondition(manifest.version === "7.10.1", "参考库重放必须使用已验收的 Prisma 7.10.1");
  const serverRequire = createRequire(join(server, "package.json"));
  const { Client } = serverRequire("pg");
  const client = (connectionString) =>
    new Client({ connectionString, connectionTimeoutMillis: 5000, options: readOnlyOptions });
  const result = await runReferenceReplay({
    inspectTest: () => inspectMigrationDatabase(client(testUrl), baseline),
    inspectEmpty: () => inspectEmptyReferenceDatabase(client(referenceUrl)),
    runPrisma: (action) => runPrisma7(server, prisma7, action, referenceUrl),
    compare: () => compareMigrationDatabases(client(testUrl), client(referenceUrl), baseline),
    inspectLedger: () => inspectReferenceLedger(client(referenceUrl), baseline),
  });
  console.info("独立参考库八项历史迁移重放及二次部署验证通过");
  console.info("验收库目录指纹：" + result.catalogFingerprint);
  console.info("参考库目录指纹：" + result.referenceFingerprint);
  console.info("对照状态：MATCHED_REVIEW_REQUIRED；签名许可：否");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof PreflightError ? error.message : "参考库重放初始化失败";
    console.error(message);
    process.exitCode = 1;
  });
}
