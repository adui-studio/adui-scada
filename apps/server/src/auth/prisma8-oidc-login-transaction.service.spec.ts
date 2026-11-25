import { randomBytes, randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Contract } from "../generated/prisma8/contract.d.js";
import { resolveOidcStartupConfig } from "../config/oidc-startup.config.js";
import { Prisma8OidcLoginTransactionService } from "./prisma8-oidc-login-transaction.service.js";

function createHarness(issuer = "https://id.example.org/realms/prisma8-oidc-" + randomUUID()) {
  const config = resolveOidcStartupConfig({
    NODE_ENV: "test",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ISSUER: issuer,
    SCADA_OIDC_CLIENT_ID: "adui-scada",
    SCADA_OIDC_CLIENT_SECRET: randomBytes(32).toString("base64url"),
    SCADA_OIDC_REDIRECT_URI: "https://scada.example.org/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: "https://scada.example.org",
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  });
  if (!config.enabled) throw new Error("测试 OIDC 配置未启用");
  const provider = new oidc.Configuration(
    {
      issuer: config.issuer.href,
      authorization_endpoint: issuer + "/authorize",
      token_endpoint: issuer + "/token",
      jwks_uri: issuer + "/jwks",
    },
    config.clientId,
    { client_secret: config.clientSecret, id_token_signed_response_alg: "RS256" },
    oidc.ClientSecretBasic(config.clientSecret),
  );
  const transaction = vi.fn<() => Promise<never>>().mockRejectedValue(new Error("模拟内部数据库错误"));
  const getConfiguration = vi.fn<() => Promise<oidc.Configuration>>().mockResolvedValue(provider);
  const service = new Prisma8OidcLoginTransactionService(
    { transaction } as unknown as PostgresClient<Contract>,
    { getConfiguration },
    config,
  );
  return { service, transaction, getConfiguration };
}

describe("Prisma 8 OIDC 登录事务候选输入与脱敏", () => {
  it("拒绝非专用 Issuer 及伪造专用前缀", () => {
    expect(() => createHarness("https://id.example.org/realms/scada"))
      .toThrow("Prisma 8 OIDC 候选仅允许随机专用测试 Issuer");
    expect(() => createHarness("https://id.example.org/realms/prisma8-oidc-invalid"))
      .toThrow("Prisma 8 OIDC 候选仅允许随机专用测试 Issuer");
  });

  it("非法回跳路径在 Discovery 与数据库前拒绝", async () => {
    const { service, transaction, getConfiguration } = createHarness();
    await expect(service.start("//outside.example.org/")).rejects.toThrow("OIDC 登录返回路径无效");
    await expect(service.start("/%0a")).rejects.toThrow("OIDC 登录返回路径无效");
    await expect(service.start("/#fragment")).rejects.toThrow("OIDC 登录返回路径无效");
    expect(getConfiguration).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("非法 State 或浏览器绑定不进入数据库事务", async () => {
    const { service, transaction } = createHarness();
    const state = randomBytes(32).toString("base64url");
    const binding = "scada_oidc_b_" + randomBytes(32).toString("base64url");
    expect(await service.consume(null, binding)).toBeNull();
    expect(await service.consume(state, "invalid")).toBeNull();
    expect(await service.consume("invalid", binding)).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("创建失败只返回原有固定中文错误", async () => {
    const { service, transaction } = createHarness();
    await expect(service.start("/")).rejects.toThrow("OIDC 登录事务创建失败，请稍后重试");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("消费与清理失败只返回固定中文错误且清理占位能够释放", async () => {
    const { service, transaction } = createHarness();
    const state = randomBytes(32).toString("base64url");
    const binding = "scada_oidc_b_" + randomBytes(32).toString("base64url");
    await expect(service.consume(state, binding)).rejects.toThrow("OIDC 登录事务验证失败，请稍后重试");
    await expect(service.cleanupExpiredTransactions()).rejects.toThrow("OIDC 登录事务清理失败，请稍后重试");
    await expect(service.cleanupExpiredTransactions()).rejects.toThrow("OIDC 登录事务清理失败，请稍后重试");
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
