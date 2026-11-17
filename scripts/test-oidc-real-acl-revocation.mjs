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

/** 等待 CDP 页面状态稳定；失败只输出已审核标签，不泄漏页面原始异常。 */
async function waitForValue(task, label) {
  for (let attempt = 0; attempt < 110; attempt += 1) {
    try {
      const value = await task();
      if (value) return value;
    } catch {
      // 页面加载时的临时上下文切换不应泄漏页面 URL 或浏览器异常。
    }
    await pause(200);
  }
  throw new Error(label);
}

async function openDedicatedStudioProject(session, origin, projectId) {
  await session.send("Page.navigate", { url: origin + "/" });
  await waitForValue(
    () =>
      session.evaluate(function (expectedOrigin) {
        return location.origin === expectedOrigin && document.readyState === "complete";
      }, origin),
    "真实撤权专项只允许本机可信 OIDC Lab",
  );
  assert.equal(await session.evaluate(enterStudioInPage), true);
  await session.evaluate(function () {
    const menu = document.querySelector(".studio-project-browser-menu");
    if (!menu) throw new Error("未找到工程管理入口");
    menu.open = true;
  });

  let page = await waitForValue(async () => {
    const result = await session.evaluate(pageStateInPage);
    return result && !result.busy && result.pageNumber === 1 && result.ids.length > 0
      ? result
      : null;
  }, "没有找到专用工程的授权列表入口");
  let found = false;
  for (let index = 0; index < 50; index += 1) {
    if (page.ids.includes(projectId)) {
      found = true;
      break;
    }
    if (!page.nextEnabled) break;
    const nextNumber = page.pageNumber + 1;
    assert.equal(await session.evaluate(clickBrowserControlInPage, "next"), true);
    page = await waitForValue(async () => {
      const result = await session.evaluate(pageStateInPage);
      return result && !result.busy && result.pageNumber === nextNumber && result.ids.length > 0
        ? result
        : null;
    }, "没有找到专用工程的授权列表入口");
  }
  if (!found) throw new Error("没有找到专用工程的授权列表入口");

  assert.equal(await session.evaluate(saveDraftInPage), true);
  const beforeLoad = await inspectStudioState(session);
  const loaded = await session.evaluate(openProjectInPage, projectId, 1, "confirm");
  assert.deepEqual(loaded, { confirmCount: 1, intercepted: 0, outcome: "confirm" });
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const beforeRevoke = await inspectStudioState(session);
  assert.deepEqual(beforeRevoke.drafts, beforeLoad.drafts);
  assert.ok(beforeRevoke.server.includes("CAS 基线：1"));
  return beforeRevoke;
}

async function verifyRevokedStudio(session, origin, projectId, before) {
  const codes = await session.evaluate(revokedResponsesInPage, origin, projectId);
  assert.deepEqual(codes, [404, 404, 404], "实际受控服务端必须按 404 隐藏已撤权工程");

  assert.equal(await session.evaluate(triggerAccessDenialInPage, "history"), true);
  await waitForValue(async () => {
    const state = await session.evaluate(accessDenialStateInPage);
    return state.baselineCleared &&
      state.headCleared &&
      state.serverRows === 0 &&
      state.browserRows === 0
      ? state
      : null;
  }, "真实撤权后客户端仍保留旧授权摘要");

  const after = await inspectStudioState(session);
  assert.equal(after.canvas, before.canvas, "真实撤权后本地 SVG 画布必须保持不变");
  assert.deepEqual(after.drafts, before.drafts, "真实撤权不能覆盖 IndexedDB 草稿");
  assert.equal(after.autoSave, before.autoSave, "真实撤权不能改变本地自动保存开关");

  assert.equal(await session.evaluate(triggerAccessDenialInPage, "detail"), true);
  await waitForValue(
    () =>
      session.evaluate(function () {
        const panel = document.querySelector('[aria-label="服务端工程版本"]');
        return panel?.querySelector('[role="alert"]')?.textContent?.includes("当前工程访问已失效");
      }),
    "真实撤权后旧工程不得触发新建或追加",
  );
  assert.equal(await session.evaluate(waitForStudioActionIdleInPage), true);
  const state = await session.evaluate(accessDenialStateInPage);
  if (state.writeAttempts !== 0) throw new Error("真实撤权后旧工程不得触发新建或追加");
  const preserved = await inspectStudioState(session);
  assert.equal(preserved.canvas, before.canvas);
  assert.deepEqual(preserved.drafts, before.drafts);
}

/** 默认双账号只读预检；写入仅限显式确认后的新建两份专用空白工程。 */
async function run() {
  if (!existsSync(ROOT_ENV)) throw new Error("真实撤权专项只允许本机可信 OIDC Lab");
  loadEnvFile(ROOT_ENV);
  const mode = resolveRevocationMode(process.argv.slice(2));
  const origins = resolveProjectBrowserLab(process.env);
  const target = resolveLabIdentityTarget(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("真实撤权专项缺少可用的本机浏览器");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (!response.ok || response.url !== origin + "/") {
      throw new Error("真实撤权专项只允许本机可信 OIDC Lab");
    }
  }

  const browsers = [];
  let client;
  try {
    const ownerBrowser = await startBrowser(executable);
    browsers.push(ownerBrowser);
    const owner = await waitForLogin(ownerBrowser, origins[0], "第一位主体");
    const guestBrowser = await startBrowser(executable);
    browsers.push(guestBrowser);
    process.stdout.write(
      "第二个隔离浏览器必须登录同一租户下另一位已预绑定的 Keycloak 普通测试用户。\n",
    );
    const guest = await waitForLogin(guestBrowser, origins[0], "第二位主体");
    requireDifferentSubjects(owner, guest);
    process.stdout.write("已确认真实双主体 BFF 会话属于同一租户且主体不同。\n");
    if (!mode.write) {
      process.stdout.write("真实撤权只读预检通过；未创建工程或修改 ACL。\n");
      return;
    }

    const serverRequire = createRequire(SERVER_PACKAGE);
    const { Client } = serverRequire("pg");
    client = new Client({
      connectionString: target.connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
    });
    await client.connect();
    // 仅测试用户的 UI 永久拦截工程写入；创建者使用正式接口创建新测试工程。
    await guestBrowser.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "(" + installAccessDenialFaultInPage.toString() + ")()",
    });

    for (const [index, origin] of origins.entries()) {
      const framework = index === 0 ? "React" : "Vue";
      const projectId = "b34-oidc-cas-" + randomUUID();
      assert.match(projectId, PROJECT_PATTERN, "专用工程名称不符合随机命名规则");
      await ownerBrowser.evaluate(createCasProjectInPage, origins[0], projectId);
      process.stdout.write(framework + "：已创建独立空白专用工程 " + projectId + "。\n");
      let granted = false;
      let revoked = false;
      try {
        await grantSecondSubject(client, projectId, owner, guest);
        granted = true;
        await guestBrowser.send("Page.navigate", { url: origin + "/" });
        const principal = await waitForValue(
          () => guestBrowser.evaluate(identityInPage, origin),
          "真实撤权专项只允许本机可信 OIDC Lab",
        );
        assert.deepEqual(principal, guest, "第二主体在 React/Vue Origin 必须一致");
        const firstRead = await ownerBrowser.evaluate(
          readCasProjectInPage,
          origins[0],
          projectId,
          1,
        );
        const secondRead = await guestBrowser.evaluate(readCasProjectInPage, origin, projectId, 1);
        assert.deepEqual(firstRead, secondRead, "双方读取首版数据必须一致");

        const before = await openDedicatedStudioProject(guestBrowser, origin, projectId);
        assert.equal(await revokeSecondSubject(client, projectId, owner, guest), true);
        revoked = true;
        assert.deepEqual(
          await guestBrowser.evaluate(identityInPage, origin),
          guest,
          "撤销工程 ACL 不能注销当前 Keycloak 会话",
        );
        await verifyRevokedProject(client, projectId, owner, guest);
        await verifyRevokedStudio(guestBrowser, origin, projectId, before);

        const ownerRead = await ownerBrowser.evaluate(
          readCasProjectInPage,
          origins[0],
          projectId,
          1,
        );
        assert.deepEqual(ownerRead, firstRead, "撤销第二主体不能影响创建者读取");
        await verifyRevokedProject(client, projectId, owner, guest);
        process.stdout.write(
          framework + "：真实 ACL 撤销、HTTP 404、CAS 失效、草稿保护与审计检查通过。\n",
        );
      } finally {
        // 任何失败都尽量回收本轮新工程授予第二主体的三项 ACL，不能碰旧工程。
        if (granted && !revoked) await revokeSecondSubject(client, projectId, owner, guest);
      }
    }
    process.stdout.write(
      "React/Vue 真实双主体 ACL 撤销浏览器专项通过；两份新建空白工程保留供复核。\n",
    );
  } finally {
    try {
      if (client) await client.end();
    } finally {
      for (const browser of browsers.reverse()) await browser.close();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeRevocationFailure(error) + "\n");
    process.exitCode = 1;
  });
}
