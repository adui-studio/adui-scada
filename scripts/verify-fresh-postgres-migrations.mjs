import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "apps", "server");
const migrationDir = join(server, "prisma", "migrations");
const freshNamePattern = /^adui_scada_fresh_[a-z0-9_]{1,24}$/;
const expectedTables = [
  "scada_projects",
  "scada_project_grants",
  "scada_project_versions",
  "scada_project_audit",
  "scada_identities",
  "scada_auth_sessions",
  "scada_external_identities",
  "scada_oidc_transactions",
];

/** 只接受仓库本机开发库派生的全新隔离库，拒绝真实开发库和现有测试库。 */
export function buildFreshDatabaseUrl(source, databaseName, configuredPort) {
  if (typeof databaseName !== "string" || !freshNamePattern.test(databaseName)) {
    throw new Error("数据库名称必须为 adui_scada_fresh_ 开头的受控测试名称");
  }

  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("根目录数据库连接配置格式无效");
  }

  const port = url.port ? Number(url.port) : 5432;
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/adui_scada" ||
    !url.username ||
    !Number.isInteger(port) ||
    port <= 0 ||
    (configuredPort !== undefined && port !== Number(configuredPort)) ||
    url.hash ||
    [...url.searchParams].some(([key, value]) => key !== "schema" || value !== "public")
  ) {
    throw new Error("只允许从根目录配置的本机 adui_scada 开发库生成隔离连接");
  }

  url.pathname = "/" + databaseName;
  return url.toString();
}

/** 连接前先核对是否真为空库，绝不使用重置或清库命令。 */
async function inspectEmptyDatabase(Client, connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows } = await client.query(`
      SELECT c.relname
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_%'
      LIMIT 1
    `);
    const schemas = await client.query(`
      SELECT nspname FROM pg_namespace
      WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema')
        AND nspname NOT LIKE 'pg_%'
      LIMIT 1
    `);
    if (rows.length > 0 || schemas.rows.length > 0) {
      throw new Error("目标数据库存在用户对象，不是全新空库；已拒绝迁移");
    }
  } finally {
    await client.end();
  }
}

function runPrismaCommand(command, connectionString) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(executable, ["--filter", "@adui/scada-server", "run", command], {
    cwd: root,
    env: { ...process.env, SCADA_DATABASE_URL: connectionString },
    stdio: "inherit",
    shell: process.platform === "win32",
    timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    throw new Error("隔离库执行 " + command + " 失败或超时，未通过验收");
  }
}

async function readMigrationState(Client, connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows } = await client.query(`
      SELECT migration_name, checksum,
             finished_at::text AS finished_at,
             rolled_back_at::text AS rolled_back_at
      FROM _prisma_migrations
      ORDER BY migration_name
    `);
    const tables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
    `);
    return {
      migrations: rows,
      tables: tables.rows.map((row) => row.tablename),
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const name = process.argv[2];
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) {
    throw new Error("仓库根目录 .env 不存在，不能推导受控测试库连接");
  }
  loadEnvFile(envPath);
  const connectionString = buildFreshDatabaseUrl(
    process.env.SCADA_DATABASE_URL,
    name,
    process.env.SCADA_DB_PORT,
  );

  const serverRequire = createRequire(join(server, "package.json"));
  const { Client } = serverRequire("pg");
  const expectedMigrations = readdirSync(migrationDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(migrationDir, entry.name, "migration.sql")),
    )
    .map((entry) => entry.name)
    .sort();
  if (expectedMigrations.length === 0) {
    throw new Error("未找到任何 Prisma 迁移，停止空库验收");
  }

  await inspectEmptyDatabase(Client, connectionString);
  console.log("已确认全新隔离空库：" + name);
  console.log("正在首次部署现有 " + expectedMigrations.length + " 项 Prisma 迁移");
  runPrismaCommand("db:migrate:deploy", connectionString);
  const first = await readMigrationState(Client, connectionString);
  const appliedNames = first.migrations.map((row) => row.migration_name).sort();
  if (
    JSON.stringify(appliedNames) !== JSON.stringify(expectedMigrations) ||
    first.migrations.some((row) => !row.finished_at || row.rolled_back_at) ||
    expectedTables.some((table) => !first.tables.includes(table))
  ) {
    throw new Error("首次迁移未完整创建预期版本记录或业务表");
  }

  console.log("正在第二次执行 migrate deploy，验证不会重复迁移");
  runPrismaCommand("db:migrate:deploy", connectionString);
  runPrismaCommand("db:migrate:status", connectionString);
  const second = await readMigrationState(Client, connectionString);
  if (JSON.stringify(first.migrations) !== JSON.stringify(second.migrations)) {
    throw new Error("重复部署后迁移元数据发生变化，幂等性未通过");
  }
  console.log("全新隔离库迁移及二次部署验证通过：" + expectedMigrations.length + " 项迁移");
  console.log("测试库已保留用于核对；脚本未执行删除、重置或清理操作");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    // 避免将数据库连接串、凭据与第三方异常堆栈写入输出。
    const message = error instanceof Error ? error.message : "未知异常";
    console.error("全新空库迁移验证失败：" + message);
    process.exitCode = 1;
  });
}
