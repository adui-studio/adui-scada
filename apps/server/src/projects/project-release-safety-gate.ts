import { Injectable } from "@nestjs/common";
import type { ProjectSnapshot } from "@adui/scada-core";
import type { Prisma } from "../generated/prisma/client.js";

/** 发布安全门禁执行上下文；所有身份字段均来自服务端可信会话。 */
export interface ProjectReleaseSafetyContext {
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
}

/** 所需 Runtime、Tag、数据源和工业安全门禁尚未全部交付时统一拒绝发布。 */
export class ProjectReleaseGateUnavailableError extends Error {
  constructor() {
    super("正式发布安全门禁尚未完成，当前请求已被安全拒绝");
    this.name = "ProjectReleaseGateUnavailableError";
  }
}

/**
 * 正式发布安全门禁默认拒绝。
 * 后续只有经过独立工业安全评审的实现才能替换本服务；不得通过环境变量或请求参数绕过。
 */
@Injectable()
export class ProjectReleaseSafetyGate {
  async assertReady(
    _transaction: Prisma.TransactionClient,
    _snapshot: ProjectSnapshot,
    _context: ProjectReleaseSafetyContext,
  ): Promise<void> {
    throw new ProjectReleaseGateUnavailableError();
  }
}
