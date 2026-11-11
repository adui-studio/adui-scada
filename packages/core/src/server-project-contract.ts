import { parseScadaDocument } from "./document.ts";
import type { ScadaDocument } from "./document.ts";
import { PROJECT_SNAPSHOT_MAX_BYTES } from "./project-snapshot.ts";

/** 仅描述未来服务端保存版本的请求体；身份和授权信息不属于客户端契约。 */
export interface ServerProjectSaveRequest {
  readonly expectedRevision: number | null;
  readonly document: ScadaDocument;
}

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const REQUEST_FIELDS = ["expectedRevision", "document"];

/**
 * 校验客户端提交的版本保存意图，不执行鉴权、数据库写入或发布操作。
 * revision、时间与摘要必须由未来服务端在授权后分配，不允许客户端指定。
 */
export function parseServerProjectSaveRequest(
  input: unknown,
  routeProjectId: string,
): ServerProjectSaveRequest {
  if (typeof routeProjectId !== "string" || !PROJECT_ID_PATTERN.test(routeProjectId)) {
    throw new TypeError("工程路由 ID 必须是 1～128 个字符的稳定 ASCII 标识符");
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("工程保存请求必须为普通对象");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("工程保存请求必须为普通对象");
  }
  const source = input as Record<string, unknown>;
  if (
    Object.keys(source).length !== REQUEST_FIELDS.length ||
    Object.keys(source).some((field) => !REQUEST_FIELDS.includes(field))
  ) {
    throw new TypeError("工程保存请求只允许 expectedRevision 与 document 字段");
  }
  const expectedRevision = source.expectedRevision;
  if (
    expectedRevision !== null &&
    (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) <= 0)
  ) {
    throw new TypeError("工程预期修订号必须为 null 或大于零的安全整数");
  }
  const document = parseScadaDocument(source.document);
  if (document.projectId !== routeProjectId) {
    throw new TypeError("请求工程 ID 与路由工程 ID 不一致");
  }
  const request = { expectedRevision: expectedRevision as number | null, document };
  const bytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
  if (bytes > PROJECT_SNAPSHOT_MAX_BYTES) {
    throw new RangeError("工程保存请求超过 2 MiB 限制");
  }
  return request;
}
