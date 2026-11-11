import { parseScadaDocument } from "./document.ts";
import type { ScadaDocument } from "./document.ts";

/** 校验范围仅为工程 Schema 与 JSON 安全规则，不代表具备正式发布条件。 */
export interface ProjectValidationIssue {
  readonly code: "DOCUMENT_INVALID";
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

export type ProjectValidationResult =
  | {
      readonly valid: true;
      readonly issues: readonly [];
      readonly document: ScadaDocument;
    }
  | { readonly valid: false; readonly issues: readonly ProjectValidationIssue[] };

/** 将严格 Parser 的首条错误转为两个框架及未来后台可复用的校验结果。 */
export function validateProjectDocument(input: unknown): ProjectValidationResult {
  try {
    return { valid: true, issues: [], document: parseScadaDocument(input) };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    const separator = error.message.indexOf(": ");
    const path = separator < 0 ? "文档" : error.message.slice(0, separator);
    const message = separator < 0 ? error.message : error.message.slice(separator + 2);
    return {
      valid: false,
      issues: [{ code: "DOCUMENT_INVALID", severity: "error", path, message }],
    };
  }
}

/** 快照容器版本与工程 Schema 版本分别维护。 */
export const PROJECT_SNAPSHOT_FORMAT_VERSION = 1;
/** 本地快照最大容量；不是服务器工程容量承诺。 */
export const PROJECT_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export interface ProjectSnapshot {
  readonly formatVersion: typeof PROJECT_SNAPSHOT_FORMAT_VERSION;
  readonly projectId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly hashAlgorithm: "SHA-256";
  readonly contentHash: string;
  readonly document: DeepReadonly<ScadaDocument>;
}

export interface ProjectSnapshotOptions {
  readonly revision: number;
  readonly createdAt: string;
}

const SNAPSHOT_FIELDS = [
  "formatVersion",
  "projectId",
  "revision",
  "createdAt",
  "hashAlgorithm",
  "contentHash",
  "document",
];

function requireRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError("快照修订号必须为大于零的安全整数");
  }
  return value as number;
}

function requireCreatedAt(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError("快照创建时间必须是有效的 UTC ISO 8601 毫秒时间");
  }
  return value;
}

/** 按键名排序，避免 JSON 对象字段插入顺序改变摘要。 */
function stableValue(source: unknown): unknown {
  if (Array.isArray(source)) return source.map(stableValue);
  if (source !== null && typeof source === "object") {
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(source).sort()) {
      result[key] = stableValue((source as Record<string, unknown>)[key]);
    }
    return result;
  }
  return source;
}

/** 仅对已校验的 JSON 编码为 UTF-8；Core 不引入 Node 或 DOM 依赖。 */
function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code <= 0x7f) bytes.push(code);
    else if (code <= 0x7ff) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** 工程内容和版本元数据一起参与摘要，避免修改修订号却保持原摘要。 */
async function hashSnapshotContent(source: {
  formatVersion: number;
  projectId: string;
  revision: number;
  createdAt: string;
  hashAlgorithm: string;
  document: ScadaDocument;
}): Promise<string> {
  const canonical = JSON.stringify(stableValue(source));
  const bytes = utf8Bytes(canonical);
  if (bytes.byteLength > PROJECT_SNAPSHOT_MAX_BYTES) {
    throw new RangeError("工程版本快照超过 2 MiB 限制");
  }
  const cryptoApi = (globalThis as unknown as {
    crypto?: {
      subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
    };
  }).crypto;
  if (!cryptoApi?.subtle) {
    throw new TypeError("当前运行环境不支持 SHA-256 摘要计算");
  }
  const hash = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (value) => value.toString(16).padStart(2, "0")).join("");
}

/** 最终快照容器本身也必须符合大小限制（包括摘要字段）。 */
function requireSnapshotSize(value: ProjectSnapshot): void {
  const bytes = utf8Bytes(JSON.stringify(stableValue(value)));
  if (bytes.byteLength > PROJECT_SNAPSHOT_MAX_BYTES) {
    throw new RangeError("工程版本快照超过 2 MiB 限制");
  }
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** 创建独立的不可变工程版本副本；不写数据库，不移动正式发布指针。 */
export async function createProjectSnapshot(
  input: unknown,
  options: ProjectSnapshotOptions,
): Promise<ProjectSnapshot> {
  const checked = validateProjectDocument(input);
  if (!checked.valid) {
    const issue = checked.issues[0]!;
    throw new TypeError(`工程校验失败：${issue.path}：${issue.message}`);
  }
  const payload = {
    formatVersion: PROJECT_SNAPSHOT_FORMAT_VERSION as 1,
    projectId: checked.document.projectId,
    revision: requireRevision(options.revision),
    createdAt: requireCreatedAt(options.createdAt),
    hashAlgorithm: "SHA-256" as const,
    document: checked.document,
  };
  const contentHash = await hashSnapshotContent(payload);
  const snapshot = { ...payload, contentHash };
  requireSnapshotSize(snapshot);
  return deepFreeze(snapshot);
}

/** 验证外部快照包裹层、Schema、摘要，返回防御性复制的冻结工程。 */
export async function readProjectSnapshot(input: unknown): Promise<ProjectSnapshot> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("工程版本快照必须为普通对象");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("工程版本快照必须为普通对象");
  }
  const raw = input as Record<string, unknown>;
  if (
    Object.keys(raw).length !== SNAPSHOT_FIELDS.length ||
    Object.keys(raw).some((key) => !SNAPSHOT_FIELDS.includes(key))
  ) {
    throw new TypeError("工程版本快照包含未知字段或缺少必需字段");
  }
  if (raw.formatVersion !== PROJECT_SNAPSHOT_FORMAT_VERSION) {
    throw new TypeError("不支持的工程版本快照格式");
  }
  if (raw.hashAlgorithm !== "SHA-256") {
    throw new TypeError("不支持的工程快照摘要算法");
  }
  if (typeof raw.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(raw.contentHash)) {
    throw new TypeError("工程快照摘要格式无效");
  }
  const document = parseScadaDocument(raw.document);
  if (raw.projectId !== document.projectId) {
    throw new TypeError("快照与工程 ID 不一致");
  }
  const payload = {
    formatVersion: PROJECT_SNAPSHOT_FORMAT_VERSION as 1,
    projectId: document.projectId,
    revision: requireRevision(raw.revision),
    createdAt: requireCreatedAt(raw.createdAt),
    hashAlgorithm: "SHA-256" as const,
    document,
  };
  const digest = await hashSnapshotContent(payload);
  if (digest !== raw.contentHash) {
    throw new TypeError("工程版本快照摘要不匹配，内容可能已被修改");
  }
  const snapshot = { ...payload, contentHash: digest };
  requireSnapshotSize(snapshot);
  return deepFreeze(snapshot);
}
