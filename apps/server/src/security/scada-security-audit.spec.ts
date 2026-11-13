import { describe, expect, it } from "vite-plus/test";
import {
  createSafeSecurityAuditRecord,
} from "./scada-security-audit.js";
import type { SecurityAuditDecision } from "./scada-security-audit.js";

describe("身份与工程安全审计白名单", () => {
  it("仅输出已定义的事件类别、操作、结果和原因", () => {
    const record = createSafeSecurityAuditRecord({
      action: "session.authenticate",
      outcome: "denied",
      reason: "invalid_session",
    });
    expect(record).toEqual({
      category: "scada_security",
      action: "session.authenticate",
      outcome: "denied",
      reason: "invalid_session",
    });
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("忽略额外的敏感字段，绝不复制 Authorization 或请求体", () => {
    const unsafeInput = {
      action: "project.authorize" as const,
      outcome: "denied" as const,
      reason: "invalid_scope" as const,
      token: "scada_s_不可记录",
      authorization: "Bearer secret",
      cookie: "session=private",
      password: "secret",
      request: { url: "/projects/tenant-private?token=secret" },
      body: { secret: "private" },
    };
    const record = createSafeSecurityAuditRecord(unsafeInput);
    expect(Object.keys(record).sort()).toEqual(["action", "category", "outcome", "reason"]);
    const text = JSON.stringify(record);
    for (const forbidden of ["secret", "Bearer", "tenant-private", "scada_s_", "private"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("拒绝未定义事件类型及执行结果，错误不得包含原始输入", () => {
    const invalid = {
      action: "unexpected_request",
      outcome: "denied",
      reason: "invalid_scope",
      token: "不要输出的令牌",
    } as unknown as SecurityAuditDecision;
    expect(() => createSafeSecurityAuditRecord(invalid)).toThrow(
      "安全审计事件类型或结果无效",
    );
    const badOutcome = {
      action: "session.authenticate",
      outcome: "trace_user_token",
      reason: "invalid_session",
    } as unknown as SecurityAuditDecision;
    expect(() => createSafeSecurityAuditRecord(badOutcome)).toThrow(
      "安全审计事件类型或结果无效",
    );
  });

  it("拒绝与操作或执行结果不匹配的原因代码", () => {
    expect(() =>
      createSafeSecurityAuditRecord({
        action: "project.authorize",
        outcome: "allowed",
        reason: "permission_denied",
      }),
    ).toThrow("安全审计事件原因与结果不匹配");
    expect(() =>
      createSafeSecurityAuditRecord({
        action: "session.authenticate",
        outcome: "denied",
        reason: "permission_denied",
      }),
    ).toThrow("安全审计事件原因与结果不匹配");
  });
});
