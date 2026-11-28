import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import { createDockerDatabaseUrl } from "../../scripts/init-docker-db.mjs";
import {
  DockerRoleBootstrapError,
  runDockerRoleBootstrap,
} from "../../scripts/docker-db-role-bootstrap.mjs";
import {
  buildDockerRoleBootstrapPlan,
  DockerRolePlanError,
} from "../../scripts/docker-db-role-bootstrap-plan.mjs";
import {
  DockerRoleReviewError,
  readDockerBusinessRoleDirectory,
  reviewDockerDatabaseRoles,
} from "../../scripts/docker-db-role-review.mjs";
import { offlineEnvironment, resolveFreshCli } from "../../scripts/prisma8-fresh-cli-support.mjs";
import {
  inspectFreshDockerEmptyDatabase,
  NativePreflightError,
} from "../../scripts/prisma8-fresh-empty-preflight.mjs";
import {
  FreshInstallError,
  freshAction,
  freshConnection,
  freshConnectionVariable,
  freshDiagnosticCodes,
  freshStorageHash,
  requireFreshIdentity,
  requireFreshVerification,
  reviewFreshContract,
  reviewFreshUpdate,
} from "../../scripts/prisma8-fresh-install.mjs";
import {
  requireDeclarationHashes,
  reviewFreshRuntimeTypes,
} from "../../scripts/prisma8-fresh-runtime-review.mjs";
import {
  FreshRuntimeProbeError,
  probeFreshRuntime,
} from "../../scripts/prisma8-fresh-runtime-probe.mjs";

const root = realpathSync(resolve(import.meta.dirname, "../.."));
const source = join(root, "apps", "server", "prisma", "contract.prisma");
const commentsPath = join(root, "apps", "server", "prisma", "initial-comments.sql");
const identitySql =
  'SELECT current_database() AS database, current_user::text AS role, session_user::text AS "sessionRole", current_setting(\'server_version_num\') AS version, (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier", (SELECT datdba = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) FROM pg_catalog.pg_database WHERE datname = current_database()) AS owner, pg_catalog.pg_is_in_recovery() AS recovery';
const commentSql =
  "SELECT input.key, CASE WHEN input.kind = 'COLUMN' THEN pg_catalog.col_description(c.oid, a.attnum) ELSE pg_catalog.obj_description(c.oid, 'pg_class') END AS comment FROM pg_catalog.jsonb_to_recordset($1::jsonb) AS input(key text, kind text, relation text, \"column\" text) LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public' LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = input.relation AND ((input.kind = 'INDEX' AND c.relkind IN ('i', 'I')) OR (input.kind IN ('TABLE', 'COLUMN') AND c.relkind IN ('r', 'p'))) LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = input.\"column\" AND a.attnum > 0 AND NOT a.attisdropped";
const environment = offlineEnvironment(process.env);
let stage = "全新安装参数检查";

function requireMatch(condition, message) {
  if (!condition) throw new FreshInstallError(message);
}

function run(executable, args, env, description) {
  const child = spawnSync(executable, args, {
    cwd: root,
    env,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error || child.status !== 0 || child.signal !== null) {
    const codes = freshDiagnosticCodes(child.stdout, child.stderr);
    throw new FreshInstallError(
      description + "失败，官方诊断码：" + (codes.join("、") || "未取得"),
    );
  }
  return child.stdout.trim();
}

function ensureOutput(directories) {
  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
    requireMatch(
      lstatSync(directory).isDirectory() && realpathSync(directory) === directory,
      "全新生成目录不能包含链接",
    );
  }
}

/** 固定本机 Docker 端点，核对全新 Compose 容器、持久卷及回环端口。 */
function inspectDocker(requireNoOldProjects = false) {
  requireMatch(process.platform === "win32", "当前全新安装只允许 Windows 本机 Docker Desktop");
  requireMatch(
    !Object.entries(process.env).some(
      ([key, value]) =>
        [
          "DOCKER_HOST",
          "DOCKER_CONTEXT",
          "DOCKER_CONFIG",
          "DOCKER_TLS",
          "DOCKER_TLS_VERIFY",
          "DOCKER_CERT_PATH",
        ].includes(key.toUpperCase()) && value,
    ),
    "存在 Docker 环境覆盖，禁止全新安装",
  );
  const docker = (args) => run("docker", args, environment, "本机 Docker 核验");
  const context = docker(["context", "show"]);
  requireMatch(/^[a-zA-Z0-9_.-]+$/u.test(context), "Docker 上下文名称无效");
  const endpoint = docker([
    "context",
    "inspect",
    context,
    "--format",
    "{{.Endpoints.docker.Host}}",
  ]);
  requireMatch(
    ["npipe:////./pipe/dockerDesktopLinuxEngine", "npipe:////./pipe/docker_engine"].includes(
      endpoint,
    ),
    "Docker 不是本机命名管道",
  );
  const local = (args) => docker(["--host", endpoint, ...args]);
  requireMatch(
    local(["info", "--format", "{{.OSType}}"]) === "linux",
    "Docker 不是 Linux 容器引擎",
  );
  if (requireNoOldProjects) {
    for (const project of [
      "adui-scada-v01-demo",
      "adui-scada-postgres-dev",
      "adui-scada-oidc-lab",
    ]) {
      requireMatch(
        local([
          "ps",
          "-a",
          "--filter",
          "label=com.docker.compose.project=" + project,
          "--format",
          "{{.ID}}",
        ]) === "",
        "仍检测到旧项目容器，禁止角色核查或自动清理",
      );
    }
  }
  const fields = [
    ".Id",
    ".State.Running",
    ".Config.Image",
    ".Config.Labels",
    ".Mounts",
    ".NetworkSettings.Ports",
  ];
  const format = "[" + fields.map((field) => "{{json " + field + "}}").join(",") + "]";
  const [id, running, image, labels, mounts, ports] = JSON.parse(
    local(["container", "inspect", "--format", format, "adui-scada-postgres-1"]),
  );
  requireMatch(
    /^[a-f0-9]{64}$/u.test(id) &&
      running === true &&
      image === "postgres:latest" &&
      labels?.["com.docker.compose.project"] === "adui-scada" &&
      labels?.["com.docker.compose.service"] === "postgres" &&
      Array.isArray(mounts) &&
      mounts.length === 2 &&
      mounts.some(
        (mount) =>
          mount.Type === "volume" &&
          mount.Name === "adui-scada_postgres-data" &&
          mount.Destination === "/var/lib/postgresql" &&
          mount.RW === true,
      ) &&
      mounts.some(
        (mount) =>
          mount.Type === "bind" &&
          mount.Destination === "/docker-entrypoint-initdb.d/01-keycloak.sql" &&
          mount.RW === false,
      ) &&
      isDeepStrictEqual(ports, { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "15432" }] }),
    "全新 PostgreSQL 容器、镜像、数据卷或端口不符合本机 Compose",
  );
  const identityParts = local([
    "exec",
    "--user",
    "postgres",
    id,
    "env",
    "-i",
    "PATH=/usr/local/bin:/usr/bin:/bin",
    "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000",
    "psql",
    "-X",
    "-w",
    "-q",
    "-A",
    "-t",
    "-h",
    "/var/run/postgresql",
    "-p",
    "5432",
    "-U",
    "adui_scada",
    "-d",
    "adui_scada",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "SELECT system_identifier::text || '|' || current_setting('server_version_num') FROM pg_catalog.pg_control_system()",
  ]).split("|");
  const [systemIdentifier, version] = identityParts;
  requireMatch(
    identityParts.length === 2 &&
      /^[1-9][0-9]{0,19}$/u.test(systemIdentifier) &&
      /^19[0-9]{4}$/u.test(version),
    "容器 PostgreSQL 19 实际集群标识或版本无效",
  );
  return { systemIdentifier, version };
}

function databaseClient(connectionString) {
  return new Client({
    connectionString,
    ssl: false,
    replication: "false",
    client_encoding: "UTF8",
    connectionTimeoutMillis: 5000,
    query_timeout: 35000,
    application_name: "adui_scada_prisma8_fresh",
  });
}

/** 注释与目录复验单独使用事务，发生失败不清理已初始化结构。 */
async function checkComments(connection, expectedIdentity, contract, commentText, write) {
  const client = databaseClient(connection);
  let begun = false;
  let failure;
  try {
    await client.connect();
    await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    begun = true;
    const identity = await client.query(identitySql);
    requireMatch(identity.rows.length === 1, "业务库身份查询数量异常");
    requireFreshIdentity(identity.rows[0], expectedIdentity);
    if (write) await client.query(commentText);
    const actual = (await client.query(commentSql, [JSON.stringify(contract.comments)])).rows;
    const expected = new Map(contract.comments.map(({ key, comment }) => [key, comment]));
    requireMatch(
      actual.length === expected.size &&
        actual.every(
          ({ key, comment }) =>
            expected.has(key) && expected.get(key) === comment && expected.delete(key),
        ) &&
        expected.size === 0,
      "业务表、字段或索引中文注释实际核验失败",
    );
    await client.query(write ? "COMMIT" : "ROLLBACK");
    begun = false;
  } catch (error) {
    if (begun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // 保留原错误，不重试数据库写入。
      }
    }
    failure = error;
  } finally {
    try {
      await client.end();
    } catch {
      failure ??= new FreshInstallError("关闭业务库连接失败，保留现场");
    }
  }
  if (failure) throw failure;
}

async function main() {
  const action = freshAction(process.argv.slice(2));
  stage = "原生契约发射与固定依赖检查";
  const runtimeEmit = action === "runtime-emit";
  const server = join(root, "apps", "server");
  const config = join(
    server,
    runtimeEmit ? "prisma8-runtime.config.ts" : "prisma8-fresh.config.ts",
  );
  const output = runtimeEmit
    ? join(server, "src", "generated", "prisma8-runtime")
    : join(root, ".artifacts", "prisma8-fresh");
  ensureOutput(
    runtimeEmit
      ? [join(root, "apps"), server, join(server, "src"), join(server, "src", "generated"), output]
      : [join(root, ".artifacts"), output],
  );
  for (const file of ["contract.json", "contract.d.ts"]) {
    const path = join(output, file);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    requireMatch(
      !stat || (stat.isFile() && realpathSync(path) === path),
      "生成契约文件不能包含链接",
    );
  }
  const entry = resolveFreshCli(root);
  const invoke = (args, connection) =>
    run(
      process.execPath,
      [entry, ...args, "--config", config],
      connection ? { ...environment, [freshConnectionVariable]: connection } : environment,
      stage,
    );
  const sourceText = readFileSync(source, "utf8");
  invoke(["contract", "emit"]);
  requireMatch(readFileSync(source, "utf8") === sourceText, "官方发射改写了受 Git 管理的契约源");
  const emittedText = readFileSync(join(output, "contract.json"), "utf8");
  const emitted = JSON.parse(emittedText);
  const commentText = readFileSync(commentsPath, "utf8");
  const contract = reviewFreshContract(emitted, commentText);
  const declaration = readFileSync(join(output, "contract.d.ts"), "utf8");
  requireDeclarationHashes(declaration, emitted);
  const report = {
    storageHash: freshStorageHash,
    tables: contract.tables,
    columns: contract.columns,
    checks: contract.checks,
    indexes: contract.indexes,
    foreignKeys: contract.foreignKeys,
    comments: contract.comments.length,
  };
  if (action === "emit")
    return { status: "FRESH_CONTRACT_EMITTED", ...report, databaseInitialized: false };
  if (runtimeEmit)
    return {
      status: "FRESH_RUNTIME_CONTRACT_EMITTED",
      ...report,
      databaseAccessed: false,
    };
  if (action === "runtime-review") {
    stage = "正式候选原生契约离线类型检查";
    reviewFreshRuntimeTypes(root, emittedText, declaration);
  }
  stage = "全新业务库 Docker 身份与连接检查";
  const base = createDockerDatabaseUrl(
    readFileSync(join(root, ".env"), "utf8"),
    readFileSync(join(root, ".local", "docker", "secrets.env"), "utf8"),
  );
  const readOnly = freshConnection(base, true);
  const writable = freshConnection(base, false);
  const bootstrapMode =
    action === "role-rehearse"
      ? "rehearse"
      : action === "role-create"
        ? "create"
        : action === "role-bootstrap-status"
          ? "status"
          : action === "role-isolation-inspect"
            ? "isolation-inspect"
            : null;
  const reviewRoles = action === "role-review" || action === "role-plan" || bootstrapMode !== null;
  const identity = inspectDocker(reviewRoles);
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      const results = text.split(/\r?\n/u).flatMap((line) => {
        try {
          const document = JSON.parse(line);
          return document?.kind === "result" ? [document] : [];
        } catch {
          return [];
        }
      });
      requireMatch(results.length === 1, "未取得唯一 Prisma 8 官方机器结果");
      return results[0];
    }
  };
  if (
    action === "status" ||
    action === "runtime-review" ||
    action === "provider-smoke" ||
    reviewRoles
  ) {
    stage = "官方严格结构与标记验证";
    requireFreshVerification(parse(invoke(["db", "verify", "--strict", "--json"], readOnly)));
    stage = "真实中文注释核验";
    await checkComments(readOnly, identity, contract, commentText, false);
    if (reviewRoles) {
      const loadDirectoryReport = async () => {
        stage = "双库角色及有效权限只读核查";
        const roleReport = await reviewDockerDatabaseRoles(
          (database) => {
            const target = new URL(readOnly);
            target.pathname = database === "adui_scada" ? "/adui_scada" : "/adui_scada_keycloak";
            return databaseClient(target.toString());
          },
          identity,
          freshStorageHash,
        );
        requireMatch(
          isDeepStrictEqual(inspectDocker(true), identity),
          "角色核查后本机 Docker 集群发生变化",
        );
        return { ...roleReport, ...report, serverVersion: identity.version };
      };
      const directoryReport = await loadDirectoryReport();
      if (action === "role-plan") {
        stage = "固定角色准备预览";
        return buildDockerRoleBootstrapPlan(directoryReport, freshStorageHash);
      }
      if (bootstrapMode !== null) {
        stage = "独立角色准备事务";
        const execute = (mode, currentReport) =>
          runDockerRoleBootstrap({
            mode,
            report: currentReport,
            identity,
            storageHash: freshStorageHash,
            createClient: () => databaseClient(mode === "create" || mode === "rehearse" ? writable : readOnly),
            readDirectory: readDockerBusinessRoleDirectory,
          });
        const result = await execute(bootstrapMode, directoryReport);
        if (bootstrapMode === "isolation-inspect") {
          requireMatch(isDeepStrictEqual(inspectDocker(true), identity), "全集群核查后本机 Docker 集群发生变化");
          return { ...result, directoryReviewPassed: true, serverVersion: identity.version };
        }
        if (bootstrapMode === "status") {
          return { ...result, directoryReviewPassed: true, serverVersion: identity.version };
        }
        try {
          stage = "角色事务后置严格结构与注释核验";
          requireFreshVerification(parse(invoke(["db", "verify", "--strict", "--json"], readOnly)));
          await checkComments(readOnly, identity, contract, commentText, false);
          const current = await loadDirectoryReport();
          const expected = {
            ...directoryReport,
            role: {
              ...directoryReport.role,
              scadaRuntimeExists: result.committed,
              keycloakRuntimeExists: result.committed,
            },
          };
          requireMatch(isDeepStrictEqual(current, expected), "角色事务后置双库目录发生漂移");
          const status = await execute("status", current);
          requireMatch(status.rolesPrepared === result.committed, "角色事务后置状态不一致");
        } catch {
          throw new DockerRoleBootstrapError(
            result.committed
              ? "角色事务已提交，但后置严格核查失败，保留现场，禁止重试"
              : "角色演练已回滚，但后置严格核查失败，保留现场，禁止重试",
          );
        }
        return {
          ...result,
          directoryReviewPassed: true,
          postVerificationPassed: true,
          serverVersion: identity.version,
        };
      }
      return directoryReport;
    }
    if (action === "provider-smoke") {
      stage = "原生 NestJS 数据库提供方只读烟测";
      const { verifyPrisma8Provider } = await import("./prisma8-provider-smoke.mjs");
      const probe = await verifyPrisma8Provider(base, identity.systemIdentifier, freshStorageHash);
      return {
        status: "FRESH_PROVIDER_SMOKE_READY",
        ...report,
        serverVersion: identity.version,
        databaseInitialized: true,
        ...probe,
      };
    }
    if (action === "runtime-review") {
      stage = "已初始化业务库原生运行时只读核验";
      const { default: postgres } = await import("@prisma/orm-postgres/runtime");
      const { contractFromJson } = await import("@prisma/orm-postgres/static");
      const runtimeContract = contractFromJson(emitted);
      const probe = await probeFreshRuntime(
        databaseClient(readOnly),
        (client) => postgres({ contract: runtimeContract, pg: client }),
        async (client) => {
          const actual = await client.query(identitySql);
          requireMatch(actual.rows.length === 1, "运行时业务库身份查询数量异常");
          requireFreshIdentity(actual.rows[0], identity);
          const boundary = await client.query(
            "SELECT current_setting('transaction_read_only') AS read_only, current_setting('default_transaction_read_only') AS default_read_only, current_schema()::text AS schema_name",
          );
          requireMatch(
            isDeepStrictEqual(boundary.rows, [
              { read_only: "on", default_read_only: "on", schema_name: "public" },
            ]),
            "运行时连接不是受控只读业务库",
          );
        },
      );
      return {
        status: "FRESH_RUNTIME_REVIEW_READY",
        ...report,
        serverVersion: identity.version,
        databaseInitialized: true,
        nativeRuntimeTypesVerified: true,
        ...probe,
        providerSwitched: false,
      };
    }
    return {
      status: "FRESH_DATABASE_VERIFIED",
      ...report,
      serverVersion: identity.version,
      systemIdentifier: identity.systemIdentifier,
      databaseInitialized: true,
    };
  }
  stage = "二十三类空库只读核验";
  const empty = await inspectFreshDockerEmptyDatabase(
    databaseClient(readOnly),
    identity.systemIdentifier,
    identity.version,
  );
  stage = "官方只读全新初始化预览";
  const ids = reviewFreshUpdate(
    parse(invoke(["db", "update", "--dry-run", "--json"], readOnly)),
    contract.ids,
    "plan",
  );
  if (action === "preview") {
    return {
      status: "FRESH_DATABASE_PREVIEW_READY",
      ...report,
      serverVersion: empty.serverVersion,
      checkedEmptyCategories: empty.checkedEmptyCategories,
      additiveOperations: ids.length,
      databaseInitialized: false,
    };
  }
  stage = "首次初始化前再次确认空库";
  const latest = inspectDocker();
  requireMatch(isDeepStrictEqual(latest, identity), "首次初始化前 Docker 集群发生变化");
  await inspectFreshDockerEmptyDatabase(
    databaseClient(readOnly),
    identity.systemIdentifier,
    identity.version,
  );
  stage = "官方首次原生结构初始化";
  reviewFreshUpdate(
    parse(invoke(["db", "update", "--json"], writable)),
    contract.ids,
    "apply",
    ids,
  );
  stage = "首次中文注释写入及核验";
  await checkComments(writable, identity, contract, commentText, true);
  stage = "官方最终严格结构与标记验证";
  requireFreshVerification(parse(invoke(["db", "verify", "--strict", "--json"], readOnly)));
  return {
    status: "FRESH_DATABASE_INITIALIZED",
    ...report,
    serverVersion: identity.version,
    additiveOperations: ids.length,
    databaseInitialized: true,
  };
}

void main()
  .then((report) => process.stdout.write(JSON.stringify(report, null, 2) + "\n"))
  .catch((error) => {
    console.error(
      error instanceof FreshInstallError ||
        error instanceof NativePreflightError ||
        error instanceof DockerRoleReviewError ||
        error instanceof DockerRolePlanError ||
        error instanceof DockerRoleBootstrapError ||
        error instanceof FreshRuntimeProbeError
        ? error.message
        : stage + "失败，内部诊断已脱敏；保留现场，不自动重试",
    );
    process.exitCode = 1;
  });
