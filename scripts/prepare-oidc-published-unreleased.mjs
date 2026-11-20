import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolveLabIdentityTarget } from "./oidc-lab-identity.mjs";
import { resolveProjectBrowserLab } from "./test-project-browser-oidc.mjs";
import {
  executablePath,
  startBrowser,
  waitForLogin,
} from "./test-oidc-dual-cas.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const PROJECT_PATTERN =
  /^d5b-unreleased-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OWNER_PERMISSIONS = ["project:read", "version:read", "version:append"];
const MIGRATION_NAMES = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];
const SAFE_ERRORS = new Set([
  "D5b1 夹具参数不合法",
  "D5b1 只能访问已确认的本机可信 Lab",
  "D5b1 迁移未完成或数据库状态异常",
  "D5b1 测试身份不存在或未绑定可信 Keycloak",
  "D5b1 当前已存在专用夹具，拒绝重复创建",
  "D5b1 真实登录主体与授权主体不一致",
  "D5b1 工程创建被拒绝",
  "D5b1 新工程初始版本或 ACL 状态不一致",
  "D5b1 专用工程 ACL 写入失败，需检查已创建工程",
  "D5b1 发布状态只读确认失败",
  "D5b1 本机浏览器不可用",
]);

/** 无参只读预检；写入必须双参数显式确认，不提供删除、发布或恢复模式。 */
export function parsePublishedFixtureMode(args) {
  if (Array.isArray(args) && args.length === 0) return { apply: false };
  if (
    Array.isArray(args) &&
    args.length === 3 &&
    args[0] === "--apply" &&
    args[1] === "--confirm-lab" &&
    args[2] === "adui_scada"
  ) {
    return { apply: true };
  }
  throw new Error("D5b1 夹具参数不合法");
}

export function describePublishedFixtureError(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return "D5b1 夹具准备失败，详细错误已脱敏";
}

/** 从既有 OIDC Lab 严格校验器获取连接地址，绝不接受远程或测试库替换。 */
export function resolvePublishedFixtureTarget(env) {
  try {
    const target = resolveLabIdentityTarget(env);
    resolveProjectBrowserLab(env);
    return target;
  } catch {
    throw new Error("D5b1 只能访问已确认的本机可信 Lab");
  }
}

/** 默认只读预检；明确确认已完成的三条发布迁移、预绑定主体和零专用工程。 */
export async function preflightPublishedFixture(client, target) {
  const migrations = await client.query(
    'SELECT migration_name FROM public."_prisma_migrations" ' +
      "WHERE migration_name = ANY($1::text[]) AND finished_at IS NOT NULL " +
      "AND rolled_back_at IS NULL",
    [MIGRATION_NAMES],
  );
  const unresolved = await client.query(
    'SELECT COUNT(*)::integer AS count FROM public."_prisma_migrations" ' +
      "WHERE finished_at IS NULL AND rolled_back_at IS NULL",
  );
  if (
    migrations.rows.length !== 3 ||
    new Set(migrations.rows.map((row) => row.migration_name)).size !== 3 ||
    Number(unresolved.rows[0]?.count) !== 0
  ) {
    throw new Error("D5b1 迁移未完成或数据库状态异常");
  }

  const active = await client.query(
    "SELECT 1 FROM public.scada_identities " +
      "WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active'",
    ["lab-tenant", "lab-engineer"],
  );
  const external = await client.query(
    "SELECT 1 FROM public.scada_external_identities " +
      "WHERE issuer = $1 AND tenant_id = $2 AND subject_id = $3",
    [target.issuer, "lab-tenant", "lab-engineer"],
  );
  if (active.rows.length !== 1 || external.rows.length !== 1) {
    throw new Error("D5b1 测试身份不存在或未绑定可信 Keycloak");
  }

  const projects = await client.query(
    "SELECT 1 FROM public.scada_projects " +
      "WHERE tenant_id = $1 AND project_id LIKE 'd5b-unreleased-%' LIMIT 1",
    ["lab-tenant"],
  );
  if (projects.rows.length !== 0) {
    throw new Error("D5b1 当前已存在专用夹具，拒绝重复创建");
  }
  return true;
}

/** 使用正式受控工程 API，服务端负责首版快照、审计与初始未发布状态。 */
export async function createPublishedFixtureInPage(origin, projectId, runtime = globalThis) {
  if (
    runtime.location.origin !== origin ||
    !/^d5b-unreleased-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      projectId,
    )
  ) {
    throw new Error("D5b1 工程创建被拒绝");
  }
  const matches = runtime.document.cookie
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.startsWith("__Host-adui-scada-csrf="));
  const csrf = matches.length === 1 ? matches[0].slice("__Host-adui-scada-csrf=".length) : "";
  if (!/^scada_csrf_[A-Za-z0-9_-]{43}$/.test(csrf)) {
    throw new Error("D5b1 工程创建被拒绝");
  }
  const response = await runtime.fetch("/api/v1/projects", {
    method: "POST",
    credentials: "same-origin",
    mode: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-SCADA-CSRF": csrf,
    },
    body: JSON.stringify({
      document: {
        schemaVersion: "0.3.0",
        projectId,
        tags: [],
        pages: [
          {
            id: "page-main",
            name: "D5b1 未发布只读验收",
            size: { width: 1920, height: 1080 },
            nodes: [],
          },
        ],
      },
    }),
  });
  if (response.status !== 201) throw new Error("D5b1 工程创建被拒绝");
  const summary = await response.json();
  if (summary.projectId !== projectId || summary.headRevision !== 1) {
    throw new Error("D5b1 工程创建被拒绝");
  }
  return true;
}

/** 唯一允许新增的 ACL：新建专用工程 + 已绑定主体 + release:read。 */
export async function grantPublishedFixtureRead(client, projectId, principal) {
  if (
    !PROJECT_PATTERN.test(projectId) ||
    principal?.tenantId !== "lab-tenant" ||
    principal?.subjectId !== "lab-engineer"
  ) {
    throw new Error("D5b1 新工程初始版本或 ACL 状态不一致");
  }
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const params = [principal.tenantId, projectId];
    const project = await client.query(
      "SELECT head_revision FROM public.scada_projects " +
        "WHERE tenant_id = $1 AND project_id = $2 FOR UPDATE",
      params,
    );
    const versions = await client.query(
      "SELECT revision, created_by FROM public.scada_project_versions " +
        "WHERE tenant_id = $1 AND project_id = $2",
      params,
    );
    const audits = await client.query(
      "SELECT revision, actor_id, action FROM public.scada_project_audit " +
        "WHERE tenant_id = $1 AND project_id = $2",
      params,
    );
    const states = await client.query(
      "SELECT release_generation, released_revision, released_content_hash, last_release_event_id " +
        "FROM public.scada_project_release_state " +
        "WHERE tenant_id = $1 AND project_id = $2",
      params,
    );
    const events = await client.query(
      "SELECT 1 FROM public.scada_project_release_events " +
        "WHERE tenant_id = $1 AND project_id = $2 LIMIT 1",
      params,
    );
    const grants = await client.query(
      "SELECT subject_id, permission FROM public.scada_project_grants " +
        "WHERE tenant_id = $1 AND project_id = $2",
      params,
    );
    const ownerValid =
      grants.rows.length === 3 &&
      OWNER_PERMISSIONS.every(
        (permission) =>
          grants.rows.filter(
            (row) => row.subject_id === principal.subjectId && row.permission === permission,
          ).length === 1,
      );
    if (
      project.rows.length !== 1 ||
      String(project.rows[0].head_revision) !== "1" ||
      versions.rows.length !== 1 ||
      String(versions.rows[0].revision) !== "1" ||
      versions.rows[0].created_by !== principal.subjectId ||
      audits.rows.length !== 1 ||
      String(audits.rows[0].revision) !== "1" ||
      audits.rows[0].actor_id !== principal.subjectId ||
      audits.rows[0].action !== "version:append" ||
      states.rows.length !== 1 ||
      String(states.rows[0].release_generation) !== "0" ||
      states.rows[0].released_revision !== null ||
      states.rows[0].released_content_hash !== null ||
      states.rows[0].last_release_event_id !== null ||
      events.rows.length !== 0 ||
      !ownerValid
    ) {
      throw new Error("D5b1 新工程初始版本或 ACL 状态不一致");
    }
    await client.query(
      "INSERT INTO public.scada_project_grants " +
        "(tenant_id, project_id, subject_id, permission) VALUES ($1, $2, $3, 'release:read')",
      [principal.tenantId, projectId, principal.subjectId],
    );
    const result = await client.query(
      "SELECT permission FROM public.scada_project_grants " +
        "WHERE tenant_id = $1 AND project_id = $2 AND subject_id = $3",
      [principal.tenantId, projectId, principal.subjectId],
    );
    if (
      result.rows.length !== 4 ||
      ![...OWNER_PERMISSIONS, "release:read"].every(
        (permission) => result.rows.filter((row) => row.permission === permission).length === 1,
      )
    ) {
      throw new Error("D5b1 专用工程 ACL 写入失败，需检查已创建工程");
    }
    await client.query("COMMIT");
    return true;
  } catch {
    await client.query("ROLLBACK");
    throw new Error("D5b1 专用工程 ACL 写入失败，需检查已创建工程");
  }
}

/** 成功响应仅检查状态和代次，不返回 JSON 工程正文。 */
export async function verifyPublishedFixtureInPage(origin, projectId, runtime = globalThis) {
  if (
    runtime.location.origin !== origin ||
    !/^d5b-unreleased-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      projectId,
    )
  ) {
    throw new Error("D5b1 发布状态只读确认失败");
  }
  const response = await runtime.fetch(
    "/api/v1/projects/" + projectId + "/releases/current",
    { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" },
  );
  if (response.status !== 200) throw new Error("D5b1 发布状态只读确认失败");
  const result = await response.json();
  if (
    result.status !== "UNRELEASED" ||
    result.projectId !== projectId ||
    result.releaseGeneration !== 0 ||
    "snapshot" in result
  ) {
    throw new Error("D5b1 发布状态只读确认失败");
  }
  return true;
}

async function run() {
  const mode = parsePublishedFixtureMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b1 只能访问已确认的本机可信 Lab");
  loadEnvFile(ROOT_ENV);
  const target = resolvePublishedFixtureTarget(process.env);
  const serverRequire = createRequire(SERVER_PACKAGE);
  const { Client } = serverRequire("pg");
  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  let browser;
  let createdProjectId = null;
  try {
    await client.connect();
    await preflightPublishedFixture(client, target);
    process.stdout.write("D5b1 只读预检通过：本机 Lab 发布迁移、可信身份和零专用工程已确认。\n");
    if (!mode.apply) {
      process.stdout.write("未创建工程或修改 ACL。执行写入需显式 --apply --confirm-lab adui_scada。\n");
      return;
    }

    const origins = resolveProjectBrowserLab(process.env);
    const executable = executablePath();
    if (!executable) throw new Error("D5b1 本机浏览器不可用");
    browser = await startBrowser(executable);
    const principal = await waitForLogin(browser, origins[0], "D5b1 专用工程准备");
    if (principal?.tenantId !== "lab-tenant" || principal?.subjectId !== "lab-engineer") {
      throw new Error("D5b1 真实登录主体与授权主体不一致");
    }
    const projectId = "d5b-unreleased-" + randomUUID();
    assert.match(projectId, PROJECT_PATTERN);
    await browser.evaluate(createPublishedFixtureInPage, origins[0], projectId);
    createdProjectId = projectId;
    process.stdout.write("已通过正式工程 API 创建专用工程：" + projectId + "\n");
    await grantPublishedFixtureRead(client, projectId, principal);
    await browser.evaluate(verifyPublishedFixtureInPage, origins[0], projectId);
    process.stdout.write("D5b1 测试夹具准备完成，独立 release:read 与只读 HTTP 200 均通过。\n");
    process.stdout.write("工程 ID：" + projectId + "\n");
  } catch (error) {
    if (createdProjectId) {
      process.stderr.write(
        "专用工程已创建但后续验收未完成，请保留并单独核查工程：" +
          createdProjectId + "\n",
      );
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describePublishedFixtureError(error) + "\n");
    process.exitCode = 1;
  });
}
