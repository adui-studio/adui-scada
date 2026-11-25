import { randomUUID } from "node:crypto";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Contract } from "../generated/prisma8/contract.d.js";
import { Prisma8AuthSessionService } from "./prisma8-auth-session.service.js";

function harness() {
  const transaction = vi.fn<() => Promise<never>>();
  const service = new Prisma8AuthSessionService({
    transaction,
  } as unknown as PostgresClient<Contract>);
  return { transaction, service };
}

const actor = { tenantId: "tenant-a", subjectId: "operator-a" };
const issuer = "https://id.example.org/realms/scada";

describe("Prisma 8 身份与会话候选输入边界", () => {
  it("拒绝无效可信主体而不启动签发事务", async () => {
    const { service, transaction } = harness();
    await expect(service.issueForVerifiedSubject({ ...actor, tenantId: "../bad" })).rejects.toThrow(
      "无效的可信主体，禁止签发会话",
    );
    await expect(service.issueForVerifiedSubject({ ...actor, subjectId: "" })).rejects.toThrow(
      "无效的可信主体，禁止签发会话",
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("非法令牌在数据库查询前拒绝", async () => {
    const { service, transaction } = harness();
    expect(await service.authenticate(null)).toBeNull();
    expect(await service.authenticateWithSession("invalid")).toBeNull();
    expect(await service.authenticateCookieSession("invalid")).toEqual({
      authenticated: false,
      reason: "invalid_session",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("撤销拒绝非法会话标识及主体", async () => {
    const { service, transaction } = harness();
    await expect(service.revokeForVerifiedSubject(actor, "invalid")).rejects.toThrow(
      "撤销会话的主体或标识无效",
    );
    await expect(
      service.revokeForVerifiedSubject({ ...actor, subjectId: "../bad" }, randomUUID()),
    ).rejects.toThrow("撤销会话的主体或标识无效");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("外部映射只接受匹配的固定 Issuer 及合法主体", async () => {
    const { service, transaction } = harness();
    expect(
      await service.resolveVerifiedExternalIdentity(issuer, issuer + "/other", "subject"),
    ).toBeNull();
    expect(await service.resolveVerifiedExternalIdentity(issuer, issuer, "")).toBeNull();
    expect(
      await service.resolveVerifiedExternalIdentity(issuer, issuer, "a".repeat(257)),
    ).toBeNull();
    expect(await service.resolveVerifiedExternalIdentity(issuer, issuer, "主体")).toBeNull();
    expect(await service.resolveVerifiedExternalIdentity(issuer, issuer, "subject\n")).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });
});
