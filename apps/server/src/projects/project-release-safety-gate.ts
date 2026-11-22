import { Injectable } from "@nestjs/common";
import { validateProjectReleasePreflight } from "@adui/scada-core";
import type { ProjectSnapshot } from "@adui/scada-core";
import type { Prisma } from "../generated/prisma/client.js";

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
  | "RUNTIME_COMPATIBILITY_UNVERIFIED"
  | "TAG_SOURCE_UNVERIFIED"
  | "RUNTIME_ADMISSION_UNAVAILABLE"
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
  // 目前 Tag 目录没有工业地址/可信数据源映射；已有 Tag 即不能证明数据安全。
  if (snapshot.document.tags.length > 0) {
    blocks.push({ code: "TAG_SOURCE_UNVERIFIED", path: "snapshot.document.tags" });
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

/**
 * 正式发布安全门禁默认拒绝。
 * 本阶段已接入只读安全能力清单，但完整 Runtime/Tag/工业评审未交付，
 * 因此任何请求仍必须抛错。不得通过环境变量或请求参数绕过。
 */
@Injectable()
export class ProjectReleaseSafetyGate {
  async assertReady(
    _transaction: Prisma.TransactionClient,
    snapshot: ProjectSnapshot,
    context: ProjectReleaseSafetyContext,
  ): Promise<void> {
    const blocks = assessProjectReleaseSafety(snapshot, context);
    throw new ProjectReleaseGateUnavailableError(blocks);
  }
}
