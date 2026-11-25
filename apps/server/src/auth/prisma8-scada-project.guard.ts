import { NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { PostgresClient, PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.d.js";
import { hasProjectPermission } from "../projects/project-access-policy.js";
import type { ProjectAccessAction } from "../projects/project-access-policy.js";
import type { SecurityAuditReporter } from "../security/scada-security-audit.js";
import type { ScadaAuthenticatedRequest } from "./scada-session.guard.js";

import { SCADA_PROJECT_PERMISSION } from "./scada-project.guard.js";

type Tx = PostgresTransactionContext<Contract>;
const OPTIONS = { isolationLevel: "ReadCommitted", timeout: 10000 } as const;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

async function requireBoundary(tx: Tx): Promise<void> {
  const rows = await tx
    .query(
      tx.raw.sql`SELECT current_database()::text AS database_name,
      current_schema()::text AS schema_name,
      current_setting('transaction_read_only') AS read_only,
      current_setting('transaction_isolation') AS isolation`
        .returnsRow({
          database_name: "pg/text@1",
          schema_name: "pg/text@1",
          read_only: "pg/text@1",
          isolation: "pg/text@1",
        })
        .build(),
    )
    .toArray();
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row?.database_name !== "adui_scada_test" ||
    row.schema_name !== "public" ||
    row.read_only !== "off" ||
    row.isolation !== "read committed"
  ) {
    throw new Error("Prisma 8 工程 ACL 候选仅允许隔离库读已提交事务");
  }
}

/** 仅隔离验收的工程前置 ACL 候选，不注册正式 Provider，不替代锁内授权或会话验证。 */
export class Prisma8ScadaProjectGuard implements CanActivate {
  constructor(
    private readonly client: PostgresClient<Contract>,
    private readonly reflector: Reflector,
    private readonly audit: SecurityAuditReporter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "unsupported_context",
      });
      throw new UnauthorizedException("工程权限仅支持受保护的 HTTP 请求");
    }
    const action = this.reflector.getAllAndOverride<ProjectAccessAction>(SCADA_PROJECT_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 缺失元数据时必须拒绝，而不是默认允许访问未声明权限的路由。
    if (!action) {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "missing_policy",
      });
      throw new NotFoundException("工程资源不存在或无权访问");
    }
    const request = context.switchToHttp().getRequest<ScadaAuthenticatedRequest>();
    const verified = request.scadaPrincipal;
    if (!verified) {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "missing_principal",
      });
      throw new UnauthorizedException("尚未建立可信身份上下文");
    }

    // 固定可信主体副本，避免异步查询期间改用另一组请求字段。
    const principal = Object.freeze({ tenantId: verified.tenantId, subjectId: verified.subjectId });
    const projectId = request.params?.projectId;
    const routeTenant = request.params?.tenantId;
    if (
      typeof projectId !== "string" ||
      !PROJECT_ID_PATTERN.test(projectId) ||
      (routeTenant !== undefined && routeTenant !== principal.tenantId)
    ) {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "invalid_scope",
      });
      throw new NotFoundException("工程资源不存在或无权访问");
    }

    if (
      typeof principal.tenantId !== "string" ||
      !PROJECT_ID_PATTERN.test(principal.tenantId) ||
      typeof principal.subjectId !== "string" ||
      !PROJECT_ID_PATTERN.test(principal.subjectId)
    ) {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "permission_denied",
      });
      throw new NotFoundException("工程资源不存在或无权访问");
    }

    const { tenantId, subjectId } = principal;
    let grants: readonly { readonly permission: string }[];
    try {
      grants = await this.client.transaction(async (tx) => {
        await requireBoundary(tx);
        // 不按 action 预过滤，完整权限集合交由原纯策略判定。
        return await tx.orm.public.ScadaProjectGrant.where({ tenantId, projectId, subjectId })
          .select("permission").all();
      }, OPTIONS);
    } catch {
      // 不将原始连接异常、请求字段或授权行写入诊断。
      throw new ServiceUnavailableException("工程权限查询暂不可用，请稍后重试");
    }
    const allowed = hasProjectPermission(
      principal,
      { tenantId: principal.tenantId, projectId },
      {
        tenantId: principal.tenantId,
        projectId,
        subjectId: principal.subjectId,
        permissions: grants.map((grant) => grant.permission as ProjectAccessAction),
      },
      action,
    );
    if (!allowed) {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "permission_denied",
      });
      throw new NotFoundException("工程资源不存在或无权访问");
    }
    this.audit.record({
      action: "project.authorize",
      outcome: "allowed",
      reason: "permission_granted",
    });
    return true;
  }
}
