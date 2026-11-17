import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  describeBrowserPageException,
  resolveProjectBrowserLab,
} from "./test-project-browser-oidc.mjs";
import { resolveLabIdentityTarget } from "./oidc-lab-identity.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const LOOPBACK = "127.0.0.1";
const PROJECT_PREFIX = "b34-oidc-cas-";
const PROJECT_NAME = "双主体 CAS 验收";
const CSRF_NAME = "__Host-adui-scada-csrf";
const CSRF_PATTERN = /^scada_csrf_[A-Za-z0-9_-]{43}$/;
const PRINCIPAL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const PROJECT_PATTERN = /^b34-oidc-cas-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SAFE_ERRORS = new Set([
  "双身份专项只支持只读预检或显式确认的本机 CAS 验收",
  "双身份专项仅允许可信本机 OIDC Lab",
  "未找到本机 Chrome/Edge 浏览器",
  "本机可信 HTTPS Web 服务未就绪",
  "隔离浏览器调试端口未就绪",
  "隔离浏览器调试标签页创建失败",
  "隔离浏览器调试连接失败",
  "隔离浏览器页面执行失败",
  "登录超时，请检查第二个 Keycloak 测试主体是否已预绑定",
  "两次登录必须属于同一可信租户的不同主体",
  "真实身份响应格式不正确",
  "双会话专项缺少有效 CSRF Cookie",
  "专用工程创建失败，禁止修改其他工程",
  "专用工程读取或首版契约不正确",
  "专用工程 ACL 准备失败，请检查隔离 Lab 身份绑定",
  "双会话 HTTP CAS 结果不是一次 201 与一次 409",
  "双会话 HTTP CAS 事务历史或审计不一致",
]);

export function parseDualOidcMode(args) {
  if (args.length === 0) return { write: false };
  if (
    args.length === 3 &&
    args[0] === "--run-cas" &&
    args[1] === "--confirm-lab" &&
    args[2] === "adui_scada"
  ) {
    return { write: true };
  }
  throw new Error("双身份专项只支持只读预检或显式确认的本机 CAS 验收");
}

export function requireDifferentSubjects(first, second) {
  const valid = (item) =>
    item &&
    typeof item.tenantId === "string" &&
    PRINCIPAL_PATTERN.test(item.tenantId) &&
    typeof item.subjectId === "string" &&
    PRINCIPAL_PATTERN.test(item.subjectId);
  if (!valid(first) || !valid(second)) throw new Error("真实身份响应格式不正确");
  if (first.tenantId !== second.tenantId || first.subjectId === second.subjectId) {
    throw new Error("两次登录必须属于同一可信租户的不同主体");
  }
}

export function requireCasResult(results) {
  if (
    !Array.isArray(results) ||
    results.length !== 2 ||
    results.map((result) => result?.status).sort((left, right) => left - right).join(",") !==
      "201,409"
  ) {
    throw new Error("双会话 HTTP CAS 结果不是一次 201 与一次 409");
  }
  const winnerIndex = results.findIndex((result) => result.status === 201);
  if (
    winnerIndex < 0 ||
    results[winnerIndex].revision !== 2 ||
    !/^[0-9a-f]{64}$/.test(results[winnerIndex].contentHash ?? "")
  ) {
    throw new Error("双会话 HTTP CAS 事务历史或审计不一致");
  }
  return { winnerIndex, contentHash: results[winnerIndex].contentHash };
}

export function describeDualOidcFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  if (error?.pageDiagnostic) {
    return "隔离浏览器页面执行失败（已脱敏）";
  }
  return "双身份 OIDC Lab 专项未通过，内部错误详情已脱敏";
}

/** 每次页面执行均为自包含函数；不引用 Node 模块作用域。 */
export async function identityInPage(expectedOrigin, runtime = globalThis) {
  if (runtime.location.origin !== expectedOrigin) return null;
  try {
    const response = await runtime.fetch("/api/v1/auth/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    if (response.status !== 200) return null;
    const value = await response.json();
    return value.authenticated === true ? value.principal : null;
  } catch {
    return null;
  }
}

export async function createCasProjectInPage(origin, projectId, runtime = globalThis) {
  if (runtime.location.origin !== origin) throw new Error("专用工程创建失败，禁止修改其他工程");
  if (!/^b34-oidc-cas-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(projectId)) {
    throw new Error("专用工程创建失败，禁止修改其他工程");
  }
  const matches = runtime.document.cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("__Host-adui-scada-csrf="));
  const csrf = matches.length === 1 ? matches[0].slice("__Host-adui-scada-csrf=".length) : "";
  if (!/^scada_csrf_[A-Za-z0-9_-]{43}$/.test(csrf)) {
    throw new Error("双会话专项缺少有效 CSRF Cookie");
  }
  const document = {
    schemaVersion: "0.3.0",
    projectId,
    tags: [],
    pages: [
      {
        id: "page-main",
        name: "双主体 CAS 验收",
        size: { width: 1920, height: 1080 },
        nodes: [],
      },
    ],
  };
  const response = await runtime.fetch("/api/v1/projects", {
    method: "POST",
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-SCADA-CSRF": csrf,
    },
    body: JSON.stringify({ document }),
  });
  if (response.status !== 201) throw new Error("专用工程创建失败，禁止修改其他工程");
  const result = await response.json();
  if (result.projectId !== projectId || result.headRevision !== 1) {
    throw new Error("专用工程创建失败，禁止修改其他工程");
  }
  return true;
}

export async function readCasProjectInPage(origin, projectId, revision, runtime = globalThis) {
  if (runtime.location.origin !== origin) {
    throw new Error("专用工程读取或首版契约不正确");
  }
  const response = await runtime.fetch(
    "/api/v1/projects/" + encodeURIComponent(projectId) + "/versions/" + revision,
    { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" },
  );
  if (response.status !== 200) throw new Error("专用工程读取或首版契约不正确");
  const snapshot = await response.json();
  if (
    snapshot.projectId !== projectId ||
    snapshot.revision !== revision ||
    snapshot.document?.projectId !== projectId ||
    snapshot.document?.schemaVersion !== "0.3.0" ||
    snapshot.document?.pages?.length !== 1 ||
    snapshot.document.pages[0]?.name !== "双主体 CAS 验收" ||
    snapshot.document.pages[0]?.nodes?.length !== 0 ||
    snapshot.document?.tags?.length !== 0 ||
    !/^[0-9a-f]{64}$/.test(snapshot.contentHash ?? "")
  ) {
    throw new Error("专用工程读取或首版契约不正确");
  }
  return { revision: snapshot.revision, contentHash: snapshot.contentHash };
}

export async function appendCasVersionInPage(origin, projectId, runtime = globalThis) {
  if (runtime.location.origin !== origin) {
    throw new Error("双会话 HTTP CAS 事务历史或审计不一致");
  }
  const matches = runtime.document.cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("__Host-adui-scada-csrf="));
  const csrf = matches.length === 1 ? matches[0].slice("__Host-adui-scada-csrf=".length) : "";
  if (!/^scada_csrf_[A-Za-z0-9_-]{43}$/.test(csrf)) {
    throw new Error("双会话专项缺少有效 CSRF Cookie");
  }
  const response = await runtime.fetch(
    "/api/v1/projects/" + encodeURIComponent(projectId) + "/versions",
    {
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-SCADA-CSRF": csrf,
      },
      body: JSON.stringify({
        expectedRevision: 1,
        document: {
          schemaVersion: "0.3.0",
          projectId,
          tags: [],
          pages: [
            {
              id: "page-main",
              name: "双主体 CAS 验收",
              size: { width: 1920, height: 1080 },
              nodes: [],
            },
          ],
        },
      }),
    },
  );
  if (response.status === 409) return { status: 409 };
  if (response.status !== 201) return { status: response.status };
  const saved = await response.json();
  return { status: 201, revision: saved.revision, contentHash: saved.contentHash };
}

class BrowserSession {
  constructor(child, folder, socket) {
    this.child = child;
    this.folder = folder;
    this.socket = socket;
    this.counter = 0;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const payload = JSON.parse(String(data));
      const task = this.pending.get(payload.id);
      if (!task) return;
      clearTimeout(task.timer);
      this.pending.delete(payload.id);
      if (payload.error) task.reject(new Error("隔离浏览器调试连接失败"));
      else task.resolve(payload.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("隔离浏览器调试连接失败"));
      }, method === "Runtime.evaluate" ? 45000 : 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(action, ...args) {
    const expression =
      "(" + action.toString() + ")(" + args.map((value) => JSON.stringify(value)).join(",") + ")";
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      const error = new Error("隔离浏览器页面执行失败");
      error.pageDiagnostic = describeBrowserPageException(response.exceptionDetails);
      throw error;
    }
    return response.result.value;
  }

  async close() {
    this.socket.close();
    this.child.kill();
    await pause(350);
    try {
      rmSync(this.folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    } catch {
      // 浏览器仍持有临时 Profile 文件时，不输出含会话路径的诊断。
    }
  }
}

function executablePath() {
  const root = process.env.PROGRAMFILES || "C:\\Program Files";
  const x86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  return [
    process.env.SCADA_BROWSER_PATH,
    join(root, "Google", "Chrome", "Application", "chrome.exe"),
    join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(x86, "Google", "Chrome", "Application", "chrome.exe"),
    join(x86, "Microsoft", "Edge", "Application", "msedge.exe"),
  ].find((path) => path && existsSync(path));
}

async function startBrowser(executable) {
  const folder = mkdtempSync(join(tmpdir(), "adui-scada-oidc-dual-"));
  const child = spawn(
    executable,
    [
      "--no-first-run",
      "--no-default-browser-check",
      "--no-proxy-server",
      "--remote-debugging-port=0",
      "--user-data-dir=" + folder,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    const file = join(folder, "DevToolsActivePort");
    let port = 0;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (existsSync(file)) {
        port = Number(readFileSync(file, "utf8").split("\n")[0]);
        break;
      }
      if (child.exitCode !== null) break;
      await pause(100);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("隔离浏览器调试端口未就绪");
    }
    const response = await fetch("http://" + LOOPBACK + ":" + port + "/json/new?about:blank", {
      method: "PUT",
    });
    if (!response.ok) throw new Error("隔离浏览器调试标签页创建失败");
    const tab = await response.json();
    const url = new URL(tab.webSocketDebuggerUrl);
    if (!["localhost", LOOPBACK].includes(url.hostname)) {
      throw new Error("隔离浏览器调试连接失败");
    }
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const session = new BrowserSession(child, folder, socket);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    return session;
  } catch {
    child.kill();
    await pause(200);
    try {
      rmSync(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    } catch {
      // 释放失败不输出临时目录路径。
    }
    throw new Error("隔离浏览器调试连接失败");
  }
}

async function waitForLogin(session, origin, label) {
  await session.send("Page.navigate", {
    url: origin + "/api/v1/auth/oidc/start",
  });
  process.stdout.write("请在" + label + "的独立隔离浏览器中手动登录已预绑定的 Keycloak 测试用户；不要输入终端密码。\n");
  for (let attempt = 0; attempt < 900; attempt += 1) {
    try {
      const principal = await session.evaluate(identityInPage, origin);
      if (principal) return principal;
    } catch {
      // OIDC 导航过程中页面执行上下文会发生切换。
    }
    await pause(200);
  }
  throw new Error("登录超时，请检查第二个 Keycloak 测试主体是否已预绑定");
}

/** 仅给本次新建的空白专用工程增加第二主体三项 ACL，绝不关联现有工程。 */
export async function grantSecondSubject(client, projectId, first, second) {
  requireDifferentSubjects(first, second);
  if (!PROJECT_PATTERN.test(projectId)) {
    throw new Error("专用工程 ACL 准备失败，请检查隔离 Lab 身份绑定");
  }
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const project = await client.query(
      "SELECT head_revision FROM public.scada_projects " +
        "WHERE tenant_id = $1 AND project_id = $2 FOR UPDATE",
      [first.tenantId, projectId],
    );
    const version = await client.query(
      "SELECT created_by FROM public.scada_project_versions " +
        "WHERE tenant_id = $1 AND project_id = $2 AND revision = 1",
      [first.tenantId, projectId],
    );
    const identities = await client.query(
      "SELECT subject_id FROM public.scada_identities " +
        "WHERE tenant_id = $1 AND subject_id IN ($2, $3) AND status = 'active'",
      [first.tenantId, first.subjectId, second.subjectId],
    );
    const grants = await client.query(
      "SELECT subject_id, permission FROM public.scada_project_grants " +
        "WHERE tenant_id = $1 AND project_id = $2",
      [first.tenantId, projectId],
    );
    if (
      project.rows.length !== 1 ||
      String(project.rows[0].head_revision) !== "1" ||
      version.rows.length !== 1 ||
      version.rows[0].created_by !== first.subjectId ||
      identities.rows.length !== 2 ||
      grants.rows.length !== 3 ||
      grants.rows.some((grant) => grant.subject_id !== first.subjectId) ||
      !["project:read", "version:read", "version:append"].every((permission) =>
        grants.rows.some((grant) => grant.permission === permission),
      )
    ) {
      throw new Error("专用工程 ACL 准备失败，请检查隔离 Lab 身份绑定");
    }
    await client.query(
      "INSERT INTO public.scada_project_grants (tenant_id, project_id, subject_id, permission) " +
        "VALUES ($1, $2, $3, 'project:read'), " +
        "($1, $2, $3, 'version:read'), ($1, $2, $3, 'version:append')",
      [first.tenantId, projectId, second.subjectId],
    );
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    throw new Error("专用工程 ACL 准备失败，请检查隔离 Lab 身份绑定");
  }
}

export async function verifyCasAudit(client, projectId, first, second, winnerIndex, hash) {
  const versions = await client.query(
    "SELECT revision, created_by, content_hash FROM public.scada_project_versions " +
      "WHERE tenant_id = $1 AND project_id = $2 ORDER BY revision",
    [first.tenantId, projectId],
  );
  const audits = await client.query(
    "SELECT revision, actor_id FROM public.scada_project_audit " +
      "WHERE tenant_id = $1 AND project_id = $2 ORDER BY revision",
    [first.tenantId, projectId],
  );
  const head = await client.query(
    "SELECT head_revision FROM public.scada_projects WHERE tenant_id = $1 AND project_id = $2",
    [first.tenantId, projectId],
  );
  const winner = winnerIndex === 0 ? first.subjectId : second.subjectId;
  if (
    versions.rows.length !== 2 ||
    audits.rows.length !== 2 ||
    head.rows.length !== 1 ||
    String(head.rows[0].head_revision) !== "2" ||
    String(versions.rows[0].revision) !== "1" ||
    String(versions.rows[1].revision) !== "2" ||
    versions.rows[0].created_by !== first.subjectId ||
    versions.rows[1].created_by !== winner ||
    versions.rows[1].content_hash !== hash ||
    String(audits.rows[0].revision) !== "1" ||
    String(audits.rows[1].revision) !== "2" ||
    audits.rows[0].actor_id !== first.subjectId ||
    audits.rows[1].actor_id !== winner
  ) {
    throw new Error("双会话 HTTP CAS 事务历史或审计不一致");
  }
}

/** 双人手工登录永远由维护者完成，不把任何密码、Cookie、主体 ID 发回日志。 */
async function run() {
  if (!existsSync(ROOT_ENV)) throw new Error("双身份专项仅允许可信本机 OIDC Lab");
  loadEnvFile(ROOT_ENV);
  const mode = parseDualOidcMode(process.argv.slice(2));
  const origins = resolveProjectBrowserLab(process.env);
  const target = resolveLabIdentityTarget(process.env);
  const executable = executablePath();
  if (!executable) throw new Error("未找到本机 Chrome/Edge 浏览器");
  for (const origin of origins) {
    const response = await fetch(origin + "/", { redirect: "error" });
    if (!response.ok || response.url !== origin + "/") {
      throw new Error("本机可信 HTTPS Web 服务未就绪");
    }
  }

  const browsers = [];
  let client;
  try {
    const firstBrowser = await startBrowser(executable);
    browsers.push(firstBrowser);
    const first = await waitForLogin(firstBrowser, origins[0], "第一位主体");
    const secondBrowser = await startBrowser(executable);
    browsers.push(secondBrowser);
    await waitForLogin(secondBrowser, origins[0], "第二位主体");
    await secondBrowser.send("Page.navigate", { url: origins[1] + "/" });
    let second = null;
    for (let attempt = 0; attempt < 75; attempt += 1) {
      try {
        second = await secondBrowser.evaluate(identityInPage, origins[1]);
        if (second) break;
      } catch {
        // 导航到 Vue Origin 时 JS 上下文可能暂时不可用。
      }
      await pause(200);
    }
    requireDifferentSubjects(first, second);
    process.stdout.write("两个独立 Keycloak 浏览器均已建立真实 BFF 会话，主体不同且租户一致。\n");
    if (!mode.write) {
      process.stdout.write("双主体 OIDC 只读预检通过；没有创建工程或修改授权。\n");
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

    const projectId = PROJECT_PREFIX + randomUUID();
    assert.match(projectId, PROJECT_PATTERN, "专用工程 ID 不符合受控随机命名要求");
    await firstBrowser.evaluate(createCasProjectInPage, origins[0], projectId);
    process.stdout.write("已在本机 Lab 创建独立双主体 CAS 专用工程：" + projectId + "\n");
    await grantSecondSubject(client, projectId, first, second);
    const [firstRead, secondRead] = await Promise.all([
      firstBrowser.evaluate(readCasProjectInPage, origins[0], projectId, 1),
      secondBrowser.evaluate(readCasProjectInPage, origins[1], projectId, 1),
    ]);
    assert.deepEqual(firstRead, secondRead, "两会话读取的首版快照必须一致");
    process.stdout.write("两位主体均已通过真实工程读取和授权校验，开始同修订号竞争提交。\n");
    const results = await Promise.all([
      firstBrowser.evaluate(appendCasVersionInPage, origins[0], projectId),
      secondBrowser.evaluate(appendCasVersionInPage, origins[1], projectId),
    ]);
    const outcome = requireCasResult(results);
    await verifyCasAudit(client, projectId, first, second, outcome.winnerIndex, outcome.contentHash);
    const [afterFirst, afterSecond] = await Promise.all([
      firstBrowser.evaluate(readCasProjectInPage, origins[0], projectId, 2),
      secondBrowser.evaluate(readCasProjectInPage, origins[1], projectId, 2),
    ]);
    assert.deepEqual(afterFirst, afterSecond, "两会话最终读取的版本必须一致");
    assert.equal(afterFirst.contentHash, outcome.contentHash, "最终摘要与提交结果不一致");
    process.stdout.write(
      "真实双 Keycloak 主体 HTTP CAS 专项通过：201＋409，最终修订号为 2，审计主体匹配。测试工程保留供复核。\n",
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
    process.stderr.write("错误：" + describeDualOidcFailure(error) + "\n");
    process.exitCode = 1;
  });
}
