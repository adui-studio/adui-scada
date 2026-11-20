import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import {
  inspectPublishedRevocationReadiness,
  resolvePublishedRevocationPreflightTarget,
} from "./preflight-oidc-published-revocation.mjs";
import { resolveProjectBrowserLab } from "./test-project-browser-oidc.mjs";
import { executablePath, startBrowser, waitForLogin } from "./test-oidc-dual-cas.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const BASELINE_PROJECT = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
const PROJECT_PATTERN =
  /^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OWNER_PERMISSIONS = ["project:read", "version:read", "version:append"];
const ALL_PERMISSIONS = [...OWNER_PERMISSIONS, "release:read"];
const SAFE_ERRORS = new Set([
  "D5b4b 专用工程准备参数不合法",
  "D5b4b 只能访问受控本机可信 Lab",
  "D5b4b 独立浏览器不可用",
  "D5b4b 真实登录主体不符合预绑定身份",
  "D5b4b 新工程创建未通过正式 API 验证",
  "D5b4b 新工程初始版本、发布状态或 ACL 不符合预期",
  "D5b4b 独立 release:read 授权写入失败，必须人工复核新工程",
  "D5b4b 新工程只读 HTTP 200 验证失败",
]);

/** 无参仅预检；创建专用工程必须单独授权并使用精确确认参数。 */
export function parsePublishedRevokeFixtureMode(args) {
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
  throw new Error("D5b4b 专用工程准备参数不合法");
}

export function describePublishedRevokeFixtureFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return "D5b4b 专用工程准备失败，内部细节已脱敏";
}

/** 只允许一次正式同源工程创建，不携带可控的租户、身份或附加授权。 */
export async function createPublishedRevokeFixtureInPage(origin, projectId, runtime = globalThis) {
  if (
    runtime.location?.origin !== origin ||
    !/^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      projectId,
    )
  ) {
    throw new Error("D5b4b 新工程创建未通过正式 API 验证");
  }
  const cookies = runtime.document.cookie
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.startsWith("__Host-adui-scada-csrf="));
  const csrf = cookies.length === 1 ? cookies[0].slice("__Host-adui-scada-csrf=".length) : "";
  if (!/^scada_csrf_[A-Za-z0-9_-]{43}$/.test(csrf)) {
    throw new Error("D5b4b 新工程创建未通过正式 API 验证");
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
            name: "D5b4 真实授权撤销隔离验收",
            size: { width: 1920, height: 1080 },
            nodes: [],
          },
        ],
      },
    }),
  });
  if (response.status !== 201) {
    throw new Error("D5b4b 新工程创建未通过正式 API 验证");
  }
  const summary = await response.json();
  if (summary.projectId !== projectId || summary.headRevision !== 1) {
    throw new Error("D5b4b 新工程创建未通过正式 API 验证");
  }
  return true;
}

/**
 * 只允许新建的 D5b4 专用工程新增一条 release:read。
 * 原 D5b1 工程只做同事务 SELECT 复核，不能被本操作写入。
 */
export async function grantPublishedRevokeFixtureRead(client, projectId, principal) {
  if (
    !PROJECT_PATTERN.test(projectId) ||
    principal?.tenantId !== "lab-tenant" ||
    principal?.subjectId !== "lab-engineer"
  ) {
    throw new Error("D5b4b 新工程初始版本、发布状态或 ACL 不符合预期");
  }

  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const scope = [principal.tenantId, projectId];
    const project = await client.query(
      "SELECT head_revision FROM public.scada_projects " +
        "WHERE tenant_id = $1 AND project_id = $2 FOR UPDATE",
      scope,
    );
    const versions = await client.query(
      "SELECT revision, created_by FROM public.scada_project_versions " +
        "WHERE tenant_id = $1 AND project_id = $2",
      scope,
    );
    const audit = await client.query(
      "SELECT revision, actor_id, action FROM public.scada_project_audit " +
        "WHERE tenant_id = $1 AND project_id = $2",
      scope,
    );
    const state = await client.query(
      "SELECT release_generation, released_revision, released_content_hash, " +
        "last_release_event_id FROM public.scada_project_release_state " +
        "WHERE tenant_id = $1 AND project_id = $2",
      scope,
    );
    const events = await client.query(
      "SELECT 1 FROM public.scada_project_release_events " +
        "WHERE tenant_id = $1 AND project_id = $2 LIMIT 1",
      scope,
    );
    const grants = await client.query(
      "SELECT subject_id, permission FROM public.scada_project_grants " +
        "WHERE tenant_id = $1 AND project_id = $2",
      scope,
    );
    const baselineGrants = await client.query(
      "SELECT subject_id, permission FROM public.scada_project_grants " +
        "WHERE tenant_id = $1 AND project_id = $2",
      [principal.tenantId, BASELINE_PROJECT],
    );
    const validGrants = (rows, permissions) =>
      rows.length === permissions.length &&
      permissions.every(
        (permission) =>
          rows.filter(
            (row) => row.subject_id === principal.subjectId && row.permission === permission,
          ).length === 1,
      );
    if (
      project.rows.length !== 1 ||
      String(project.rows[0].head_revision) !== "1" ||
      versions.rows.length !== 1 ||
      String(versions.rows[0].revision) !== "1" ||
      versions.rows[0].created_by !== principal.subjectId ||
      audit.rows.length !== 1 ||
      String(audit.rows[0].revision) !== "1" ||
      audit.rows[0].actor_id !== principal.subjectId ||
      audit.rows[0].action !== "version:append" ||
      state.rows.length !== 1 ||
      String(state.rows[0].release_generation) !== "0" ||
      state.rows[0].released_revision !== null ||
      state.rows[0].released_content_hash !== null ||
      state.rows[0].last_release_event_id !== null ||
      events.rows.length !== 0 ||
      !validGrants(grants.rows, OWNER_PERMISSIONS) ||
      !validGrants(baselineGrants.rows, ALL_PERMISSIONS)
    ) {
      throw new Error("D5b4b 新工程初始版本、发布状态或 ACL 不符合预期");
    }

    await client.query(
      "INSERT INTO public.scada_project_grants " +
        "(tenant_id, project_id, subject_id, permission) VALUES ($1, $2, $3, 'release:read')",
      [principal.tenantId, projectId, principal.subjectId],
    );
    const finalGrants = await client.query(
      "SELECT subject_id, permission FROM public.scada_project_grants " +
        "WHERE tenant_id = $1 AND project_id = $2",
      scope,
    );
    if (!validGrants(finalGrants.rows, ALL_PERMISSIONS)) {
      throw new Error("D5b4b 独立 release:read 授权写入失败，必须人工复核新工程");
    }
    await client.query("COMMIT");
    return true;
  } catch {
    await client.query("ROLLBACK");
    throw new Error("D5b4b 独立 release:read 授权写入失败，必须人工复核新工程");
  }
}

/** 只读取发布状态摘要；禁止把编辑 head 或工程正文当作发布快照。 */
export async function verifyPublishedRevokeFixtureInPage(origin, projectId, runtime = globalThis) {
  if (
    runtime.location?.origin !== origin ||
    !/^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      projectId,
    )
  ) {
    throw new Error("D5b4b 新工程只读 HTTP 200 验证失败");
  }
  const response = await runtime.fetch(
    "/api/v1/projects/" + projectId + "/releases/current",
    { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" },
  );
  if (response.status !== 200 || response.headers?.get("cache-control") !== "no-store") {
    throw new Error("D5b4b 新工程只读 HTTP 200 验证失败");
  }
  const payload = await response.json();
  if (
    !payload ||
    payload.status !== "UNRELEASED" ||
    payload.projectId !== projectId ||
    payload.releaseGeneration !== 0 ||
    Object.keys(payload).length !== 3
  ) {
    throw new Error("D5b4b 新工程只读 HTTP 200 验证失败");
  }
  return true;
}

async function run() {
  const mode = parsePublishedRevokeFixtureMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b4b 只能访问受控本机可信 Lab");
  loadEnvFile(ROOT_ENV);
  let target;
  try {
    target = resolvePublishedRevocationPreflightTarget(process.env);
  } catch {
    throw new Error("D5b4b 只能访问受控本机可信 Lab");
  }
  const requireServer = createRequire(SERVER_PACKAGE);
  const { Client } = requireServer("pg");
  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  let browser;
  let createdProjectId = null;
  try {
    await client.connect();
    await inspectPublishedRevocationReadiness(client, target);
    process.stdout.write("D5b4b 只读预检通过：原工程授权完整且无 D5b4 专用工程。\n");
    if (!mode.apply) {
      process.stdout.write("未执行数据库写入；创建须另行授权并显式确认本机 Lab。\n");
      return;
    }

    const origins = resolveProjectBrowserLab(process.env);
    const executable = executablePath();
    if (!executable) throw new Error("D5b4b 独立浏览器不可用");
    browser = await startBrowser(executable);
    const principal = await waitForLogin(browser, origins[0], "D5b4b 专用撤权工程准备");
    if (principal?.tenantId !== "lab-tenant" || principal?.subjectId !== "lab-engineer") {
      throw new Error("D5b4b 真实登录主体不符合预绑定身份");
    }
    const projectId = "d5b4-revoke-" + randomUUID();
    assert.match(projectId, PROJECT_PATTERN);
    await browser.evaluate(createPublishedRevokeFixtureInPage, origins[0], projectId);
    createdProjectId = projectId;
    process.stdout.write("已使用正式工程 API 创建独立 D5b4 工程：" + projectId + "\n");
    await grantPublishedRevokeFixtureRead(client, projectId, principal);
    await browser.evaluate(verifyPublishedRevokeFixtureInPage, origins[0], projectId);
    process.stdout.write("D5b4b 专用工程创建和 release:read 验证通过。\n");
    process.stdout.write("专用工程 ID：" + projectId + "\n");
  } catch (error) {
    if (createdProjectId) {
      process.stderr.write(
        "独立 D5b4 工程已创建但后续验证未完成，禁止自动删除，请人工核查：" +
          createdProjectId +
          "\n",
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
    process.stderr.write("错误：" + describePublishedRevokeFixtureFailure(error) + "\n");
    process.exitCode = 1;
  });
}
