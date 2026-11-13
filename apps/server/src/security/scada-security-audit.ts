import { Injectable, Logger } from "@nestjs/common";

/** 审计代码仅使用服务端固定枚举，不允许拼入用户提交的内容。 */
export type SecurityAuditAction = "session.authenticate" | "project.authorize";
export type SecurityAuditOutcome = "allowed" | "denied";
export type SecurityAuditReason =
  | "unsupported_context"
  | "malformed_authorization"
  | "invalid_session"
  | "verified"
  | "missing_policy"
  | "missing_principal"
  | "invalid_scope"
  | "permission_denied"
  | "permission_granted";

export interface SecurityAuditDecision {
  readonly action: SecurityAuditAction;
  readonly outcome: SecurityAuditOutcome;
  readonly reason: SecurityAuditReason;
}

export interface SafeSecurityAuditRecord extends SecurityAuditDecision {
  readonly category: "scada_security";
}

/** 当前仅用于诊断日志，不代表不可篡改的持久化安全审计。 */
export interface SecurityAuditReporter {
  record(decision: SecurityAuditDecision): void;
}

const ALLOWED_REASONS: Readonly<
  Record<SecurityAuditAction, Readonly<Record<SecurityAuditOutcome, readonly SecurityAuditReason[]>>>
> = {
  "session.authenticate": {
    allowed: ["verified"],
    denied: ["unsupported_context", "malformed_authorization", "invalid_session"],
  },
  "project.authorize": {
    allowed: ["permission_granted"],
    denied: [
      "unsupported_context",
      "missing_policy",
      "missing_principal",
      "invalid_scope",
      "permission_denied",
    ],
  },
};

/**
 * 只按白名单重建日志字段，不复制未知属性，也不接受任意原因码。
 * Authorization、Cookie、令牌、请求 URL、工程路径和错误对象都不能进入此记录。
 */
export function createSafeSecurityAuditRecord(
  decision: SecurityAuditDecision,
): SafeSecurityAuditRecord {
  const { action, outcome, reason } = decision;
  if (
    !Object.hasOwn(ALLOWED_REASONS, action) ||
    (outcome !== "allowed" && outcome !== "denied") ||
    !Object.hasOwn(ALLOWED_REASONS[action], outcome)
  ) {
    throw new Error("安全审计事件类型或结果无效");
  }

  if (!ALLOWED_REASONS[action][outcome].includes(reason)) {
    throw new Error("安全审计事件原因与结果不匹配");
  }

  return Object.freeze({
    category: "scada_security" as const,
    action,
    outcome,
    reason,
  });
}

/**
 * 现阶段写入 NestJS 应用日志；生产持久化审计、失败处理与保留策略后续专项实现。
 * 本模块未挂入正式 AppModule，当前不会产生实际身份审计流量。
 */
@Injectable()
export class ScadaSecurityAuditService implements SecurityAuditReporter {
  private readonly logger = new Logger(ScadaSecurityAuditService.name);

  record(decision: SecurityAuditDecision): void {
    const entry = createSafeSecurityAuditRecord(decision);
    const message = JSON.stringify(entry);
    if (entry.outcome === "denied") {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }
}
