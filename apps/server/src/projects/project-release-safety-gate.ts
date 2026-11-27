import { validateProjectReleasePreflight } from "@adui/scada-core";
import type { ProjectSnapshot } from "@adui/scada-core";

/** 发布安全门禁执行上下文；所有身份字段均来自服务端可信会话。 */
export interface ProjectReleaseSafetyContext {
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
}

/** 只记录固定类别和字段路径，绝不记录工程正文、凭据或设备地址。 */
export type ProjectReleaseSafetyBlockCode =
  | "UNTRUSTED_CONTEXT"
  | "PROJECT_MISMATCH"
  | "SAFETY_ASSESSMENT_UNAVAILABLE"
  | "RUNTIME_COMPATIBILITY_UNVERIFIED"
  | "TAG_SOURCE_UNVERIFIED"
  | "TAG_BINDING_SOURCE_UNVERIFIED"
  | "TAG_BOUND_TYPE_UNRESOLVED"
  | "RUNTIME_ADMISSION_UNAVAILABLE"
  | "INDUSTRIAL_BINDING_POLICY_UNVERIFIED"
  | "INDUSTRIAL_RULES_UNREVIEWED"
  | "INDUSTRIAL_READ_POLICY_UNAVAILABLE";

export interface ProjectReleaseSafetyBlock {
  readonly code: ProjectReleaseSafetyBlockCode;
  readonly path: string;
}

/**
 * 识别正式发布仍缺少的准入能力；纯函数不连接数据库或设备。
 * 该结果是安全阻塞清单，不是允许发布的许可或预检成功证明。
 */
export function assessProjectReleaseSafety(
  snapshot: ProjectSnapshot,
  context: ProjectReleaseSafetyContext,
): readonly ProjectReleaseSafetyBlock[] {
  const blocks: ProjectReleaseSafetyBlock[] = [];
  if (!context.tenantId || !context.actorId || !context.projectId) {
    blocks.push({ code: "UNTRUSTED_CONTEXT", path: "context" });
  }
  if (
    snapshot.projectId !== context.projectId ||
    snapshot.document.projectId !== context.projectId
  ) {
    blocks.push({ code: "PROJECT_MISMATCH", path: "snapshot.projectId" });
  }
  if (!validateProjectReleasePreflight(snapshot.document).passed) {
    blocks.push({ code: "RUNTIME_COMPATIBILITY_UNVERIFIED", path: "snapshot.document" });
  }
  // TagDefinition 仅为可编辑元数据，既不携带可信数据源身份，也不证明实时质量。
  if (snapshot.document.tags.length > 0) {
    blocks.push({ code: "TAG_SOURCE_UNVERIFIED", path: "snapshot.document.tags" });
  }
  const tagTypes = new Map(snapshot.document.tags.map((tag) => [tag.tagId, tag.dataType]));
  let hasBindings = false;
  let hasUnresolvedBoundType = false;
  let hasUnreviewedRules = false;
  // 隐藏页面和图元仍可能在正式运行时被引用，不可跳过其绑定。
  for (const page of snapshot.document.pages) {
    for (const node of page.nodes) {
      if (node.rules.length > 0) hasUnreviewedRules = true;
      for (const binding of Object.values(node.bindings)) {
        hasBindings = true;
        const dataType = tagTypes.get(binding.tagId);
        if (dataType === undefined || dataType === "unknown") {
          hasUnresolvedBoundType = true;
        }
      }
    }
  }
  if (hasBindings) {
    blocks.push({ code: "TAG_BINDING_SOURCE_UNVERIFIED", path: "snapshot.document.pages" });
  }
  if (hasUnresolvedBoundType) {
    blocks.push({ code: "TAG_BOUND_TYPE_UNRESOLVED", path: "snapshot.document.tags" });
  }
  // 数据源身份并不能证明采集接口只读；规则数组是未知 JSON，不能推断为已审核的安全操作。
  if (hasBindings) {
    blocks.push({ code: "INDUSTRIAL_BINDING_POLICY_UNVERIFIED", path: "snapshot.document.pages" });
  }
  if (hasUnreviewedRules) {
    blocks.push({ code: "INDUSTRIAL_RULES_UNREVIEWED", path: "snapshot.document.pages" });
  }
  // Runtime 发布准入与工业网关只读策略仍未完成，任何静态工程也不能自动放行。
  blocks.push({ code: "RUNTIME_ADMISSION_UNAVAILABLE", path: "runtime" });
  blocks.push({ code: "INDUSTRIAL_READ_POLICY_UNAVAILABLE", path: "industrial" });
  return Object.freeze(blocks.map((block) => Object.freeze(block)));
}

/** 所需 Runtime、Tag、数据源和工业安全门禁尚未全部交付时统一拒绝发布。 */
export class ProjectReleaseGateUnavailableError extends Error {
  /** 仅供受控测试和后续内部审查，不得直接序列化到对外 HTTP 响应。 */
  readonly blocks: readonly ProjectReleaseSafetyBlock[];

  constructor(blocks: readonly ProjectReleaseSafetyBlock[] = []) {
    super("正式发布安全门禁尚未完成，当前请求已被安全拒绝");
    this.name = "ProjectReleaseGateUnavailableError";
    this.blocks = Object.freeze(blocks.map(({ code, path }) => Object.freeze({ code, path })));
  }
}

/** 固定拒绝的正式安全门禁；不接受事务或可注入的放行参数。 */
export function requireProjectReleaseSafety(
  snapshot: ProjectSnapshot,
  context: ProjectReleaseSafetyContext,
): never {
  let blocks: readonly ProjectReleaseSafetyBlock[];
  try {
    blocks = assessProjectReleaseSafety(snapshot, context);
  } catch {
    blocks = [{ code: "SAFETY_ASSESSMENT_UNAVAILABLE", path: "assessment" }];
  }
  throw new ProjectReleaseGateUnavailableError(blocks);
}
