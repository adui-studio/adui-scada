import {
  parsePublishedRelease,
  parseServerProjectSaveRequest,
  readProjectSnapshot,
} from "@adui/scada-core";
import type {
  ProjectSnapshot,
  PublishedRelease,
  ProjectReleasePreflightIssue,
  ProjectListQuery,
  ProjectVersionQuery,
  ProjectVersionSummary,
  ScadaDocument,
} from "@adui/scada-core";

const API_PREFIX = "/api/v1";
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ID_PATTERN = PROJECT_ID_PATTERN;
const CSRF_COOKIE_NAME = "__Host-adui-scada-csrf";
const CSRF_TOKEN_PATTERN = /^scada_csrf_[A-Za-z0-9_-]{43}$/;
const MAX_COOKIE_LENGTH = 4096;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// 发布响应包含已校验的最大 2 MiB 快照和少量发布指针元数据。
const MAX_RELEASE_RESPONSE_BYTES = MAX_RESPONSE_BYTES + 4096;

export interface ScadaProjectSummary {
  readonly projectId: string;
  readonly headRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 已保存的当前工程版本的服务端静态预检，不代表正式发布许可。 */
export interface ScadaReleasePreflightReport {
  readonly projectId: string;
  readonly revision: number;
  readonly headRevision: number;
  readonly contentHash: string;
  readonly passed: boolean;
  readonly issues: readonly ProjectReleasePreflightIssue[];
}

export interface ScadaPrincipal {
  readonly tenantId: string;
  readonly subjectId: string;
}

export interface ScadaCurrentIdentity {
  readonly authenticated: true;
  readonly principal: ScadaPrincipal;
}

export type ScadaApiErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_request"
  | "server"
  | "network"
  | "invalid_response";

/** 所有可展示错误均为受控中文文案，不透传服务端原始异常或敏感字段。 */
export class ScadaApiError extends Error {
  readonly kind: ScadaApiErrorKind;
  readonly status: number | null;

  constructor(message: string, kind: ScadaApiErrorKind, status: number | null = null) {
    super(message);
    this.name = "ScadaApiError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * 认证丢失或工程访问被拒绝时的失效信号。
 * 404 不能区分不存在和无权访问，应用层应保守丢弃已缓存的服务端摘要。
 */
export function isScadaAccessRejection(error: unknown): error is ScadaApiError {
  return (
    error instanceof ScadaApiError &&
    (error.kind === "unauthenticated" || error.kind === "forbidden" || error.kind === "not_found")
  );
}

/** 由应用层提供运行时环境；默认仅使用浏览器同源 Fetch 与当前 Cookie。 */
export interface ScadaApiClientOptions {
  readonly fetcher?: typeof fetch;
  readonly readCookie?: () => string;
}

export interface ScadaApiClient {
  getMe(): Promise<ScadaCurrentIdentity>;
  logout(): Promise<void>;
  createProject(document: ScadaDocument): Promise<ScadaProjectSummary>;
  listProjects(query?: ProjectListQuery): Promise<readonly ScadaProjectSummary[]>;
  getProject(projectId: string): Promise<ScadaProjectSummary>;
  listVersions(
    projectId: string,
    query?: ProjectVersionQuery,
  ): Promise<readonly ProjectVersionSummary[]>;
  readVersion(projectId: string, revision: number): Promise<ProjectSnapshot>;
  /** 只读取正式发布指针，独立权限 release:read；不接触编辑 head。 */
  readCurrentRelease(projectId: string, signal?: AbortSignal): Promise<PublishedRelease>;
  preflightRelease(projectId: string, revision: number): Promise<ScadaReleasePreflightReport>;
  appendVersion(
    projectId: string,
    expectedRevision: number,
    document: ScadaDocument,
  ): Promise<ProjectSnapshot>;
}

function requireProjectId(value: string): string {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) {
    throw new TypeError("工程 ID 必须是合法的 1～128 字符 ASCII 标识符");
  }
  return value;
}

function requirePositiveNumber(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(label + "必须是正安全整数");
  }
  return value;
}

function requireRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ScadaApiError("服务端返回的数据结构无效", "invalid_response");
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new ScadaApiError("服务端返回的数据字段不符合协议", "invalid_response");
  }
  return source;
}

function requireUtcTime(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new ScadaApiError("服务端返回的时间格式无效", "invalid_response");
  }
  return value;
}

function parseProjectSummary(value: unknown): ScadaProjectSummary {
  const record = requireRecord(value, ["projectId", "headRevision", "createdAt", "updatedAt"]);
  if (
    typeof record.projectId !== "string" ||
    !PROJECT_ID_PATTERN.test(record.projectId) ||
    !Number.isSafeInteger(record.headRevision) ||
    (record.headRevision as number) < 1
  ) {
    throw new ScadaApiError("服务端返回的工程摘要无效", "invalid_response");
  }
  return {
    projectId: record.projectId,
    headRevision: record.headRevision as number,
    createdAt: requireUtcTime(record.createdAt),
    updatedAt: requireUtcTime(record.updatedAt),
  };
}

function parseVersionSummary(value: unknown): ProjectVersionSummary {
  const record = requireRecord(value, ["projectId", "revision", "createdAt", "contentHash"]);
  if (
    typeof record.projectId !== "string" ||
    !PROJECT_ID_PATTERN.test(record.projectId) ||
    !Number.isSafeInteger(record.revision) ||
    (record.revision as number) < 1 ||
    typeof record.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.contentHash)
  ) {
    throw new ScadaApiError("服务端返回的历史摘要无效", "invalid_response");
  }
  return {
    projectId: record.projectId,
    revision: record.revision as number,
    createdAt: requireUtcTime(record.createdAt),
    contentHash: record.contentHash,
  };
}

const PREFLIGHT_CODES: ReadonlySet<string> = new Set([
  "DOCUMENT_INVALID",
  "UNSUPPORTED_SYMBOL",
  "UNSUPPORTED_SYMBOL_VERSION",
  "UNSUPPORTED_BINDING_SLOT",
  "UNSUPPORTED_SYMBOL_PROP",
  "UNRESOLVED_BOUND_TAG",
  "UNSUPPORTED_RULES",
]);

function parsePreflightIssue(value: unknown): ProjectReleasePreflightIssue {
  const record = requireRecord(value, ["code", "severity", "path", "message"]);
  if (
    typeof record.code !== "string" ||
    !PREFLIGHT_CODES.has(record.code) ||
    record.severity !== "error" ||
    typeof record.path !== "string" ||
    record.path.length === 0 ||
    record.path.length > 512 ||
    typeof record.message !== "string" ||
    record.message.length === 0 ||
    record.message.length > 512
  ) {
    throw new ScadaApiError("服务端发布预检问题项无效", "invalid_response");
  }
  return {
    code: record.code as ProjectReleasePreflightIssue["code"],
    severity: "error",
    path: record.path,
    message: record.message,
  };
}

function parseReleasePreflightReport(
  value: unknown,
  projectId: string,
  revision: number,
): ScadaReleasePreflightReport {
  const record = requireRecord(value, [
    "projectId",
    "revision",
    "headRevision",
    "contentHash",
    "passed",
    "issues",
  ]);
  if (
    record.projectId !== projectId ||
    record.revision !== revision ||
    record.headRevision !== revision ||
    typeof record.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.contentHash) ||
    typeof record.passed !== "boolean" ||
    !Array.isArray(record.issues) ||
    record.issues.length > 10000
  ) {
    throw new ScadaApiError("服务端发布预检报告与请求版本不一致", "invalid_response");
  }
  const issues = record.issues.map(parsePreflightIssue);
  if (record.passed !== (issues.length === 0)) {
    throw new ScadaApiError("服务端发布预检结果与问题列表不一致", "invalid_response");
  }
  return {
    projectId,
    revision,
    headRevision: revision,
    contentHash: record.contentHash,
    passed: record.passed,
    issues,
  };
}

function parseList<T>(value: unknown, parser: (input: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > 10000) {
    throw new ScadaApiError("服务端返回的列表无效", "invalid_response");
  }
  return value.map(parser);
}

function parseCurrentIdentity(value: unknown): ScadaCurrentIdentity {
  const source = requireRecord(value, ["authenticated", "principal"]);
  const principal = requireRecord(source.principal, ["tenantId", "subjectId"]);
  if (
    source.authenticated !== true ||
    typeof principal.tenantId !== "string" ||
    !ID_PATTERN.test(principal.tenantId) ||
    typeof principal.subjectId !== "string" ||
    !ID_PATTERN.test(principal.subjectId)
  ) {
    throw new ScadaApiError("服务端返回的身份信息无效", "invalid_response");
  }
  return {
    authenticated: true,
    principal: { tenantId: principal.tenantId, subjectId: principal.subjectId },
  };
}

/** CSRF Cookie 严格读取：拒绝缺失、重复、超长或格式异常，禁止使用本地持久化令牌。 */
function requireCsrfToken(header: string): string {
  if (typeof header !== "string" || header.length > MAX_COOKIE_LENGTH) {
    throw new ScadaApiError("浏览器 CSRF Cookie 无效，请重新登录", "unauthenticated");
  }
  let token: string | undefined;
  for (const fragment of header.split(";")) {
    const item = fragment.trim();
    if (item.length === 0) continue;
    const separator = item.indexOf("=");
    if (separator < 1) {
      throw new ScadaApiError("浏览器 CSRF Cookie 格式无效", "unauthenticated");
    }
    if (item.slice(0, separator).trim() !== CSRF_COOKIE_NAME) continue;
    if (token !== undefined) {
      throw new ScadaApiError("浏览器 CSRF Cookie 重复", "unauthenticated");
    }
    token = item.slice(separator + 1).trim();
  }
  if (!token || !CSRF_TOKEN_PATTERN.test(token)) {
    throw new ScadaApiError("缺少有效 CSRF Cookie，请重新登录", "unauthenticated");
  }
  return token;
}

function responseError(status: number): ScadaApiError {
  if (status === 400 || status === 413) {
    return new ScadaApiError("工程请求无效或超过容量限制", "invalid_request", status);
  }
  if (status === 401) return new ScadaApiError("登录已失效，请重新登录", "unauthenticated", 401);
  if (status === 403) return new ScadaApiError("当前操作未获得授权", "forbidden", 403);
  if (status === 404) return new ScadaApiError("工程不存在或无权访问", "not_found", 404);
  if (status === 409) return new ScadaApiError("工程存在冲突，请刷新后重试", "conflict", 409);
  return new ScadaApiError("服务端暂时无法完成请求", "server", status);
}

/** 固定同源 URL，不接受调用方提供 Origin、Bearer Token 或任意路径。 */
export function createScadaApiClient(options: ScadaApiClientOptions = {}): ScadaApiClient {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new TypeError("当前运行环境不支持 Fetch 请求");
  }
  const readCookie =
    options.readCookie ?? (() => (typeof document === "undefined" ? "" : document.cookie));
  if (typeof readCookie !== "function") {
    throw new TypeError("Cookie 读取函数必须是函数");
  }

  async function request(
    method: "GET" | "POST",
    path: string,
    expectedStatus: 200 | 201 | 204,
    body?: unknown,
    requireNoStore = false,
    signal?: AbortSignal,
    maxResponseBytes = MAX_RESPONSE_BYTES,
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (method === "POST") {
      headers["X-SCADA-CSRF"] = requireCsrfToken(readCookie());
      if (body !== undefined) headers["Content-Type"] = "application/json";
    }
    let response: Response;
    try {
      response = await fetcher(API_PREFIX + path, {
        method,
        headers,
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        ...(signal === undefined ? {} : { signal }),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ScadaApiError("网络请求失败，请检查连接", "network");
    }
    if (response.status !== expectedStatus) {
      if (!response.ok) throw responseError(response.status);
      throw new ScadaApiError("服务端响应状态不符合接口协议", "invalid_response", response.status);
    }
    if (
      requireNoStore &&
      !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get("cache-control") ?? "")
    ) {
      throw new ScadaApiError("服务端发布预检响应缺少禁止缓存标记", "invalid_response");
    }
    if (expectedStatus === 204) return undefined;
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      throw new ScadaApiError("服务端响应不是有效的 JSON", "invalid_response");
    }
    let content: string;
    try {
      content = await response.text();
    } catch {
      throw new ScadaApiError("读取服务端响应失败", "network");
    }
    if (!content || new TextEncoder().encode(content).byteLength > maxResponseBytes) {
      throw new ScadaApiError("服务端响应为空或超过容量限制", "invalid_response");
    }
    try {
      return JSON.parse(content) as unknown;
    } catch {
      throw new ScadaApiError("服务端返回了无效的 JSON", "invalid_response");
    }
  }

  function projectPath(projectId: string): string {
    return "/projects/" + encodeURIComponent(requireProjectId(projectId));
  }

  async function parseSnapshotResponse(
    value: unknown,
    projectId: string,
  ): Promise<ProjectSnapshot> {
    try {
      const snapshot = await readProjectSnapshot(value);
      if (snapshot.projectId !== projectId) {
        throw new TypeError("历史快照的工程标识与请求不一致");
      }
      return snapshot;
    } catch {
      throw new ScadaApiError("服务端工程快照完整性校验失败", "invalid_response");
    }
  }

  return {
    async getMe() {
      return parseCurrentIdentity(await request("GET", "/auth/me", 200));
    },
    async logout() {
      await request("POST", "/auth/logout", 204);
    },
    async createProject(document) {
      // 沿用 Core 的 ID、Schema 与 2 MiB 白名单验证，但不发送 expectedRevision 字段。
      const input = parseServerProjectSaveRequest(
        { expectedRevision: null, document },
        document?.projectId,
      );
      const summary = parseProjectSummary(
        await request("POST", "/projects", 201, { document: input.document }),
      );
      if (summary.projectId !== input.document.projectId || summary.headRevision !== 1) {
        throw new ScadaApiError("新建工程返回的标识不一致", "invalid_response");
      }
      return summary;
    },
    async listProjects(query) {
      const limit =
        query?.limit === undefined ? 20 : requirePositiveNumber(query.limit, "工程列表分页数量");
      if (limit > 100) throw new TypeError("工程列表分页数量不能超过 100");
      const params = new URLSearchParams();
      if (query?.limit !== undefined) params.set("limit", String(limit));
      const afterProjectId =
        query?.afterProjectId === undefined ? undefined : requireProjectId(query.afterProjectId);
      if (afterProjectId !== undefined) params.set("afterProjectId", afterProjectId);
      const suffix = params.size === 0 ? "" : "?" + params.toString();
      const projects = parseList(
        await request("GET", "/projects" + suffix, 200),
        parseProjectSummary,
      );
      let lastId = afterProjectId ?? "";
      for (const project of projects) {
        if (project.projectId <= lastId) {
          throw new ScadaApiError("服务端工程列表游标顺序无效", "invalid_response");
        }
        lastId = project.projectId;
      }
      if (projects.length > limit) {
        throw new ScadaApiError("服务端工程列表数量超出分页上限", "invalid_response");
      }
      return projects;
    },
    async getProject(projectId) {
      const summary = parseProjectSummary(await request("GET", projectPath(projectId), 200));
      if (summary.projectId !== projectId) {
        throw new ScadaApiError("服务端返回的工程标识不一致", "invalid_response");
      }
      return summary;
    },
    async listVersions(projectId, query) {
      const path = projectPath(projectId);
      const params = new URLSearchParams();
      if (query?.limit !== undefined) {
        const limit = requirePositiveNumber(query.limit, "历史版本分页数量");
        if (limit > 100) throw new TypeError("历史版本分页数量不能超过 100");
        params.set("limit", String(limit));
      }
      if (query?.beforeRevision !== undefined) {
        params.set(
          "beforeRevision",
          String(requirePositiveNumber(query.beforeRevision, "分页修订号")),
        );
      }
      const suffix = params.size === 0 ? "" : "?" + params.toString();
      const items = parseList(
        await request("GET", path + "/versions" + suffix, 200),
        parseVersionSummary,
      );
      if (items.some((item) => item.projectId !== projectId)) {
        throw new ScadaApiError("历史版本所属工程不一致", "invalid_response");
      }
      return items;
    },
    async readVersion(projectId, revision) {
      const path = projectPath(projectId);
      const value = await request(
        "GET",
        path + "/versions/" + requirePositiveNumber(revision, "历史修订号"),
        200,
      );
      const snapshot = await parseSnapshotResponse(value, projectId);
      if (snapshot.revision !== revision) {
        throw new ScadaApiError("服务端返回的历史修订号不一致", "invalid_response");
      }
      return snapshot;
    },
    async readCurrentRelease(projectId, signal) {
      const path = projectPath(projectId) + "/releases/current";
      const response = await request(
        "GET",
        path,
        200,
        undefined,
        true,
        signal,
        MAX_RELEASE_RESPONSE_BYTES,
      );
      try {
        return await parsePublishedRelease(response, projectId);
      } catch {
        // 服务端未知字段、篡改快照或跨工程指针均不允许透传原始响应内容。
        throw new ScadaApiError("当前正式发布响应完整性校验失败", "invalid_response");
      }
    },
    async preflightRelease(projectId, revision) {
      const path = projectPath(projectId);
      const checkedRevision = requirePositiveNumber(revision, "发布预检修订号");
      const report = await request(
        "GET",
        path + "/versions/" + checkedRevision + "/release-preflight",
        200,
        undefined,
        true,
      );
      return parseReleasePreflightReport(report, projectId, checkedRevision);
    },
    async appendVersion(projectId, expectedRevision, document) {
      const path = projectPath(projectId);
      requirePositiveNumber(expectedRevision, "预期修订号");
      const checked = parseServerProjectSaveRequest({ expectedRevision, document }, projectId);
      const result = await request("POST", path + "/versions", 201, checked);
      const snapshot = await parseSnapshotResponse(result, projectId);
      if (snapshot.revision !== expectedRevision + 1) {
        throw new ScadaApiError("版本追加结果与预期修订号不一致", "invalid_response");
      }
      return snapshot;
    },
  };
}

// 工程中心的分页游标会话，不依赖 UI 框架或浏览器持久化。
export {
  createStudioProjectBrowser,
  StudioProjectBrowser,
  STUDIO_PROJECT_PAGE_SIZE,
} from "./project-browser.ts";
export type { StudioProjectBrowserPage } from "./project-browser.ts";

// 与 Vue/React 生命周期无关的服务端版本基线与 CAS 保存状态机。
export { createStudioServerProjectSession, StudioServerProjectSession } from "./studio-session.ts";
export type { ServerProjectSaveResult, ServerProjectVersion } from "./studio-session.ts";

// 当前已保存版本的只读发布预检编排，不建立服务器 CAS 基线。
export { readCurrentServerReleasePreflight } from "./server-release-preflight.ts";
export type { StudioServerReleasePreflight } from "./server-release-preflight.ts";
