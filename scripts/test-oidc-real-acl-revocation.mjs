import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  createCasProjectInPage,
  executablePath,
  grantSecondSubject,
  identityInPage,
  readCasProjectInPage,
  requireDifferentSubjects,
  startBrowser,
  waitForLogin,
} from "./test-oidc-dual-cas.mjs";
import { resolveLabIdentityTarget } from "./oidc-lab-identity.mjs";
import {
  accessDenialStateInPage,
  clickBrowserControlInPage,
  enterStudioInPage,
  inspectStudioState,
  installAccessDenialFaultInPage,
  openProjectInPage,
  pageStateInPage,
  resolveProjectBrowserLab,
  saveDraftInPage,
  triggerAccessDenialInPage,
  waitForStudioActionIdleInPage,
} from "./test-project-browser-oidc.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const PROJECT_PATTERN =
  /^b34-oidc-cas-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PERMISSIONS = ["project:read", "version:read", "version:append"];
const SAFE_ERRORS = new Set([
  "真实撤权专项仅允许只读预检或显式确认的本机 Lab 专用工程验收",
  "真实撤权专项只允许本机可信 OIDC Lab",
  "专用工程权限撤销失败，必须核对定向 ACL",
  "专用工程历史或权限校验失败",
  "没有找到专用工程的授权列表入口",
  "真实撤权后客户端仍保留旧授权摘要",
  "真实撤权后旧工程不得触发新建或追加",
  "真实撤权专项缺少可用的本机浏览器",
]);

export function resolveRevocationMode(args) {
  if (args.length === 0) return { write: false };
  if (
    args.length === 3 &&
    args[0] === "--run-revoke" &&
    args[1] === "--confirm-lab" &&
    args[2] === "adui_scada"
  ) {
    return { write: true };
  }
  throw new Error("真实撤权专项仅允许只读预检或显式确认的本机 Lab 专用工程验收");
}

export function describeRevocationFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return "真实双主体工程撤权专项未通过，内部细节已脱敏";
}

/** 只允许本次专用项目且保持首版，第二主体三项 ACL 删除后重复调用幂等。 */
export async function revokeSecondSubject(client, projectId, first, second) {
  requireDifferentSubjects(first, second);
  if (!PROJECT_PATTERN.test(projectId)) {
    throw new Error("专用工程权限撤销失败，必须核对定向 ACL");
  }
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const args = [first.tenantId, projectId];
    const project = await client.query(
      "SELECT head_revision FROM public.scada_projects " +
        "WHERE tenant_id = $1 AND project_id = $2 FOR UPDATE",
      args,
    );
    const versions = await client.query(
      "SELECT revision, created_by FROM public.scada_project_versions " +
        "WHERE tenant_id = $1 AND project_id = $2 ORDER BY revision",
      args,
    );
    const grants = await client.query(
      "SELECT subject_id, permission FROM public.scada_project_grants " +
        "WHERE tenant_id = $1 AND project_id = $2",
      args,
    );
    const owner = grants.rows.filter((row) => row.subject_id === first.subjectId);
    const guest = grants.rows.filter((row) => row.subject_id === second.subjectId);
    const exactlyThree = (rows) =>
      rows.length === 3 &&
      PERMISSIONS.every(
        (permission) => rows.filter((row) => row.permission === permission).length === 1,
      );
    if (
      project.rows.length !== 1 ||
      String(project.rows[0].head_revision) !== "1" ||
      versions.rows.length !== 1 ||
      String(versions.rows[0].revision) !== "1" ||
      versions.rows[0].created_by !== first.subjectId ||
      !exactlyThree(owner) ||
      ![0, 3].includes(guest.length) ||
      (guest.length === 3 && !exactlyThree(guest)) ||
      grants.rows.length !== owner.length + guest.length
    ) {
      throw new Error("专用工程权限撤销失败，必须核对定向 ACL");
    }
    if (guest.length === 3) {
      const deleted = await client.query(
        "DELETE FROM public.scada_project_grants " +
          "WHERE tenant_id = $1 AND project_id = $2 AND subject_id = $3 " +
          "AND permission IN ('project:read', 'version:read', 'version:append') " +
          "RETURNING permission",
        [first.tenantId, projectId, second.subjectId],
      );
      if (!exactlyThree(deleted.rows)) {
        throw new Error("专用工程权限撤销失败，必须核对定向 ACL");
      }
    }
    await client.query("COMMIT");
    return guest.length === 3;
  } catch {
    await client.query("ROLLBACK");
    throw new Error("专用工程权限撤销失败，必须核对定向 ACL");
  }
}

/** 核验只剩创建者三项权限、初始版本与单条审计；不执行数据库写入。 */
export async function verifyRevokedProject(client, projectId, first, second) {
  requireDifferentSubjects(first, second);
  if (!PROJECT_PATTERN.test(projectId)) throw new Error("专用工程历史或权限校验失败");
  const args = [first.tenantId, projectId];
  const head = await client.query(
    "SELECT head_revision FROM public.scada_projects WHERE tenant_id = $1 AND project_id = $2",
    args,
  );
  const versions = await client.query(
    "SELECT revision, created_by FROM public.scada_project_versions " +
      "WHERE tenant_id = $1 AND project_id = $2 ORDER BY revision",
    args,
  );
  const audits = await client.query(
    "SELECT revision, actor_id FROM public.scada_project_audit " +
      "WHERE tenant_id = $1 AND project_id = $2 ORDER BY revision",
    args,
  );
  const grants = await client.query(
    "SELECT subject_id, permission FROM public.scada_project_grants " +
      "WHERE tenant_id = $1 AND project_id = $2",
    args,
  );
  if (
    head.rows.length !== 1 ||
    String(head.rows[0].head_revision) !== "1" ||
    versions.rows.length !== 1 ||
    String(versions.rows[0].revision) !== "1" ||
    versions.rows[0].created_by !== first.subjectId ||
    audits.rows.length !== 1 ||
    String(audits.rows[0].revision) !== "1" ||
    audits.rows[0].actor_id !== first.subjectId ||
    grants.rows.length !== 3 ||
    grants.rows.some((row) => row.subject_id !== first.subjectId) ||
    PERMISSIONS.some(
      (permission) => grants.rows.filter((row) => row.permission === permission).length !== 1,
    )
  ) {
    throw new Error("专用工程历史或权限校验失败");
  }
  return true;
}

/** 独立浏览器仅返回真实 HTTP 状态码，不读取响应正文与用户 Cookie。 */
export async function revokedResponsesInPage(origin, projectId, runtime = globalThis) {
  if (
    runtime.location.origin !== origin ||
    !/^b34-oidc-cas-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(projectId)
  ) {
    throw new Error("专用工程历史或权限校验失败");
  }
  const path = "/api/v1/projects/" + encodeURIComponent(projectId);
  const codes = [];
  for (const resource of [path, path + "/versions?limit=10", path + "/versions/1"]) {
    const response = await runtime.fetch(resource, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    codes.push(response.status);
  }
  return codes;
}
