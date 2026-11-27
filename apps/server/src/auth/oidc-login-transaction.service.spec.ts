import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import * as oidc from "openid-client";
import { BadRequestException } from "@nestjs/common";
import { resolveOidcStartupConfig } from "../config/oidc-startup.config.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import type { Prisma8Transaction } from "../database/prisma8-read-transaction.js";
import type { Prisma8Service } from "../database/prisma8.service.js";
import type { OidcProviderDiscoveryService } from "./oidc-provider-discovery.service.js";
import { Prisma8RuntimeOidcLoginTransactionService } from "./prisma8-runtime-identity.service.js";

interface StoredTransaction {
  stateHash: string;
  issuer: string;
  nonce: string;
  verifierCiphertext: string;
  browserBindingHash: string;
  returnPath: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

type Plan = { text: string; parameters: unknown[] };

function textParameter(value: unknown): string {
  if (typeof value !== "string") throw new Error("测试登录事务参数必须为字符串");
  return value;
}

function createConfig(): EnabledOidcConfig {
  const result = resolveOidcStartupConfig({
    NODE_ENV: "test",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ISSUER: "https://id.example.org/realms/scada",
    SCADA_OIDC_CLIENT_ID: "adui-scada",
    SCADA_OIDC_CLIENT_SECRET: "oidc-transaction-test-secret",
    SCADA_OIDC_REDIRECT_URI: "https://scada.example.org/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: "https://scada.example.org",
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  });
  if (!result.enabled) throw new Error("测试 OIDC 配置未启用");
  return result;
}

function createProviderConfiguration(config: EnabledOidcConfig): oidc.Configuration {
  return new oidc.Configuration(
    {
      issuer: config.issuer.href,
      authorization_endpoint: "https://id.example.org/realms/scada/authorize",
      token_endpoint: "https://id.example.org/realms/scada/token",
      jwks_uri: "https://id.example.org/realms/scada/jwks",
    },
    config.clientId,
    { client_secret: config.clientSecret, id_token_signed_response_alg: "RS256" },
    oidc.ClientSecretBasic(config.clientSecret),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createFakeService(config = createConfig()) {
  const records = new Map<string, StoredTransaction>();
  let createCalls = 0;
  let consumeCalls = 0;
  let failCreate = false;
  let failTransaction = false;
  function findActive(parameters: readonly unknown[]): StoredTransaction | undefined {
    const [stateHash, issuer, binding, expires, created] = parameters.map(textParameter);
    const record = records.get(stateHash ?? "");
    return record &&
      record.issuer === issuer &&
      record.browserBindingHash === binding &&
      record.consumedAt === null &&
      record.expiresAt.getTime() > Date.parse(expires ?? "") &&
      record.createdAt.getTime() <= Date.parse(created ?? "")
      ? record
      : undefined;
  }
  const tx = {
    raw: {
      sql: (strings: TemplateStringsArray, ...parameters: unknown[]) => {
        const plan = { text: strings.join("?"), parameters };
        return {
          returnsRow: () => ({ build: () => plan }),
          affectedCount: () => ({ build: () => plan }),
        };
      },
    },
    query(plan: Plan) {
      const record = findActive(plan.parameters);
      return {
        toArray: () =>
          Promise.resolve(
            record
              ? [
                  {
                    issuer: record.issuer,
                    nonce: record.nonce,
                    verifier_ciphertext: record.verifierCiphertext,
                    return_path: record.returnPath,
                  },
                ]
              : [],
          ),
      };
    },
    execute(plan: Plan) {
      if (plan.text.includes("INSERT INTO public.scada_oidc_transactions")) {
        createCalls += 1;
        if (failCreate) throw new Error("数据库错误不得泄漏");
        const [
          stateHash,
          issuer,
          nonce,
          verifierCiphertext,
          browserBindingHash,
          returnPath,
          createdAt,
          expiresAt,
        ] = plan.parameters.map(textParameter);
        if (
          !stateHash ||
          !issuer ||
          !nonce ||
          !verifierCiphertext ||
          !browserBindingHash ||
          returnPath === undefined ||
          !createdAt ||
          !expiresAt ||
          records.has(stateHash)
        ) {
          throw new Error("测试登录事务参数无效或重复 State 摘要");
        }
        records.set(stateHash, {
          stateHash,
          issuer,
          nonce,
          verifierCiphertext,
          browserBindingHash,
          returnPath,
          createdAt: new Date(createdAt),
          expiresAt: new Date(expiresAt),
          consumedAt: null,
        });
        return Promise.resolve({ affectedRows: 1 });
      }
      if (plan.text.includes("UPDATE public.scada_oidc_transactions")) {
        const record = findActive(plan.parameters.slice(1));
        if (!record) return Promise.resolve({ affectedRows: 0 });
        record.consumedAt = new Date(textParameter(plan.parameters[0]));
        consumeCalls += 1;
        return Promise.resolve({ affectedRows: 1 });
      }
      if (!plan.text.includes("DELETE FROM public.scada_oidc_transactions")) {
        throw new Error("测试出现未预期登录事务写入");
      }
      const issuer = textParameter(plan.parameters[0]);
      const cutoff = new Date(textParameter(plan.parameters[1]));
      const limit = plan.parameters[4];
      if (
        typeof limit !== "number" ||
        plan.parameters[2] !== issuer ||
        plan.parameters[3] !== plan.parameters[1]
      ) {
        throw new Error("测试登录事务清理边界无效");
      }
      const expired = [...records.values()]
        .filter((item) => item.issuer === issuer && item.expiresAt <= cutoff)
        .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime())
        .slice(0, limit);
      for (const item of expired) records.delete(item.stateHash);
      return Promise.resolve({ affectedRows: expired.length });
    },
  };
  // 顺序事务替身模拟同一行的排他锁；不代表真实 PostgreSQL 并发验收。
  let tail = Promise.resolve();
  function transaction<T>(callback: (value: Prisma8Transaction) => Promise<T>): Promise<T> {
    const result = tail.then(() => {
      if (failTransaction) throw new Error("数据库事务异常不得泄漏");
      return callback(tx as unknown as Prisma8Transaction);
    });
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  const database = {
    writable: true,
    assertWritable: () => undefined,
    writeTransaction: transaction,
  } as unknown as Prisma8Service;
  const discovery = {
    getConfiguration: async () => createProviderConfiguration(config),
  };
  const service = new Prisma8RuntimeOidcLoginTransactionService(
    database,
    discovery as unknown as OidcProviderDiscoveryService,
    config,
  );
  return {
    service,
    records,
    config,
    discovery,
    get createCalls() {
      return createCalls;
    },
    get consumeCalls() {
      return consumeCalls;
    },
    set failCreate(value: boolean) {
      failCreate = value;
    },
    set failTransaction(value: boolean) {
      failTransaction = value;
    },
  };
}

describe("OIDC 一次性登录事务", () => {
  it("创建授权码请求并只保存 State 与浏览器绑定摘要", async () => {
    const fake = createFakeService();
    const result = await fake.service.start("/studio/projects?tab=recent");

    const authorizationUrl = new URL(result.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");
    const nonce = authorizationUrl.searchParams.get("nonce");
    const challenge = authorizationUrl.searchParams.get("code_challenge");
    const method = authorizationUrl.searchParams.get("code_challenge_method");
    if (!state || !nonce || !challenge) throw new Error("授权请求缺少必要的安全参数");
    const stateHash = sha256(state);
    const bindingHash = sha256(result.browserBindingCookie);
    const record = fake.records.get(stateHash);
    if (!record) throw new Error("测试登录事务不存在");

    expect(authorizationUrl.origin).toBe("https://id.example.org");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(fake.config.redirectUri.href);
    expect(authorizationUrl.searchParams.get("scope")).toBe("openid");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(method).toBe("S256");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.browserBindingCookie).toMatch(/^scada_oidc_b_[A-Za-z0-9_-]{43}$/);
    expect(record.nonce).toBe(nonce);
    expect(record.stateHash).toBe(stateHash);
    expect(record.browserBindingHash).toBe(bindingHash);
    expect(record.returnPath).toBe("/studio/projects?tab=recent");
    expect(record.verifierCiphertext).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(record.verifierCiphertext).not.toContain(state);
    expect(record.verifierCiphertext).not.toContain(result.browserBindingCookie);
    expect(record.expiresAt.getTime() - record.createdAt.getTime()).toBe(5 * 60 * 1000);
    expect(fake.createCalls).toBe(1);
  });

  it("消费事务后恢复加密的 PKCE verifier 并拒绝第二次消费", async () => {
    const fake = createFakeService();
    const result = await fake.service.start("/studio");
    const authorizationUrl = new URL(result.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");
    if (!state) throw new Error("授权请求缺少 State");

    const consumed = await fake.service.consume(state, result.browserBindingCookie);
    if (!consumed) throw new Error("有效登录事务未能消费");
    expect(consumed.issuer).toBe(fake.config.issuer.href);
    expect(consumed.nonce).toBe(authorizationUrl.searchParams.get("nonce"));
    expect(consumed.returnPath).toBe("/studio");
    expect(consumed.codeVerifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(await oidc.calculatePKCECodeChallenge(consumed.codeVerifier)).toBe(
      authorizationUrl.searchParams.get("code_challenge"),
    );
    expect(fake.records.get(sha256(state))?.consumedAt).toBeInstanceOf(Date);
    expect(fake.records.get(sha256(state))?.verifierCiphertext).not.toContain(
      consumed.codeVerifier,
    );
    expect(await fake.service.consume(state, result.browserBindingCookie)).toBeNull();
    expect(fake.consumeCalls).toBe(1);
  });

  it("复用有效浏览器绑定 Cookie，支持多个标签页独立事务", async () => {
    const fake = createFakeService();
    const first = await fake.service.start("/");
    const second = await fake.service.start("/studio", first.browserBindingCookie);

    expect(second.browserBindingCookie).toBe(first.browserBindingCookie);
    expect(fake.records.size).toBe(2);
    expect(new URL(first.authorizationUrl).searchParams.get("state")).not.toBe(
      new URL(second.authorizationUrl).searchParams.get("state"),
    );
  });

  it("拒绝外部、协议相对、反斜杠和片段形式的回跳路径", async () => {
    const fake = createFakeService();
    const invalidPaths = [
      "https://attacker.example.org/",
      "//attacker.example.org/",
      "/\\\\attacker.example.org/",
      "/studio#external",
      "/studio/%5c%5cattacker.example.org",
      "/studio/%0d%0aLocation:%20https://attacker.example.org",
      "/studio/\n非法路径",
      "/studio/\u0000非法路径",
      "/studio/\u007f非法路径",
      "studio",
    ];

    for (const path of invalidPaths) {
      await expect(fake.service.start(path)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(fake.createCalls).toBe(0);
  });

  it("拒绝缺失、伪造或跨浏览器的 State 事务", async () => {
    const fake = createFakeService();
    const result = await fake.service.start("/");
    const state = new URL(result.authorizationUrl).searchParams.get("state");
    if (!state) throw new Error("授权请求缺少 State");

    expect(await fake.service.consume(undefined, result.browserBindingCookie)).toBeNull();
    expect(await fake.service.consume("伪造 State", result.browserBindingCookie)).toBeNull();
    expect(await fake.service.consume(state, "scada_oidc_b_" + "x".repeat(43))).toBeNull();
    expect(await fake.service.consume(state, result.browserBindingCookie)).not.toBeNull();
  });

  it("拒绝过期和未来创建的登录事务", async () => {
    const fake = createFakeService();
    const result = await fake.service.start("/");
    const state = new URL(result.authorizationUrl).searchParams.get("state");
    if (!state) throw new Error("授权请求缺少 State");
    const record = fake.records.get(sha256(state));
    if (!record) throw new Error("测试登录事务不存在");

    record.expiresAt = new Date(Date.now() - 1000);
    expect(await fake.service.consume(state, result.browserBindingCookie)).toBeNull();

    const future = await fake.service.start("/");
    const futureState = new URL(future.authorizationUrl).searchParams.get("state");
    if (!futureState) throw new Error("授权请求缺少 State");
    const futureRecord = fake.records.get(sha256(futureState));
    if (!futureRecord) throw new Error("测试登录事务不存在");
    futureRecord.createdAt = new Date(Date.now() + 60_000);
    expect(await fake.service.consume(futureState, future.browserBindingCookie)).toBeNull();
  });

  it("拒绝数据库中被篡改的 Nonce 与回跳路径", async () => {
    const invalidPath = createFakeService();
    const pathTransaction = await invalidPath.service.start("/");
    const pathState = new URL(pathTransaction.authorizationUrl).searchParams.get("state");
    if (!pathState) throw new Error("授权请求缺少 State");
    const pathRecord = invalidPath.records.get(sha256(pathState));
    if (!pathRecord) throw new Error("测试登录事务不存在");
    pathRecord.returnPath = "https://attacker.example.org/";
    expect(
      await invalidPath.service.consume(pathState, pathTransaction.browserBindingCookie),
    ).toBeNull();

    const invalidNonce = createFakeService();
    const nonceTransaction = await invalidNonce.service.start("/");
    const nonceState = new URL(nonceTransaction.authorizationUrl).searchParams.get("state");
    if (!nonceState) throw new Error("授权请求缺少 State");
    const nonceRecord = invalidNonce.records.get(sha256(nonceState));
    if (!nonceRecord) throw new Error("测试登录事务不存在");
    nonceRecord.nonce = "无效 Nonce";
    expect(
      await invalidNonce.service.consume(nonceState, nonceTransaction.browserBindingCookie),
    ).toBeNull();
  });

  it("并发回调只有一个请求能成功消费事务", async () => {
    const fake = createFakeService();
    const result = await fake.service.start("/");
    const state = new URL(result.authorizationUrl).searchParams.get("state");
    if (!state) throw new Error("授权请求缺少 State");

    const consumed = await Promise.all([
      fake.service.consume(state, result.browserBindingCookie),
      fake.service.consume(state, result.browserBindingCookie),
    ]);

    expect(consumed.filter((value) => value !== null)).toHaveLength(1);
    expect(fake.consumeCalls).toBe(1);
  });

  it("密文被篡改后拒绝返回 PKCE verifier", async () => {
    const fake = createFakeService();
    const result = await fake.service.start("/");
    const state = new URL(result.authorizationUrl).searchParams.get("state");
    if (!state) throw new Error("授权请求缺少 State");
    const record = fake.records.get(sha256(state));
    if (!record) throw new Error("测试登录事务不存在");
    const parts = record.verifierCiphertext.split(".");
    const tag = parts[2];
    if (!tag) throw new Error("测试密文缺少认证标签");
    parts[2] = (tag.startsWith("A") ? "B" : "A") + tag.slice(1);
    record.verifierCiphertext = parts.join(".");

    expect(await fake.service.consume(state, result.browserBindingCookie)).toBeNull();
    expect(record.consumedAt).toBeInstanceOf(Date);
  });

  it("匿名登录按每分钟 60 次限制创建额外事务", async () => {
    const fake = createFakeService();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await fake.service.start("/");
    }
    await expect(fake.service.start("/")).rejects.toMatchObject({ status: 429 });
    expect(fake.createCalls).toBe(60);
    expect(fake.records.size).toBe(60);
  });

  it("并发登录占位超过 8 个时拒绝第九个请求并在完成后释放", async () => {
    const fake = createFakeService();
    let unblock: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    fake.discovery.getConfiguration = async () => {
      await gate;
      return createProviderConfiguration(fake.config);
    };

    const pending = Array.from({ length: 8 }, () => fake.service.start("/"));
    await expect(fake.service.start("/")).rejects.toMatchObject({ status: 429 });
    expect(fake.createCalls).toBe(0);
    unblock?.();
    await Promise.all(pending);
    expect(fake.createCalls).toBe(8);
  });

  it("过期事务按每批 128 条回收且保留未过期记录", async () => {
    const fake = createFakeService();
    await fake.service.start("/");
    const record = [...fake.records.values()][0];
    if (!record) throw new Error("测试登录事务不存在");

    for (let index = 0; index < 137; index += 1) {
      const stateHash = "expired-" + index;
      fake.records.set(stateHash, {
        ...record,
        stateHash,
        expiresAt: new Date(Date.now() - 1_000),
      });
    }
    expect(await fake.service.cleanupExpiredTransactions()).toBe(128);
    expect(fake.records.size).toBe(10);
    expect(await fake.service.cleanupExpiredTransactions()).toBe(9);
    expect(fake.records.size).toBe(1);
    expect([...fake.records.values()][0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("数据库写入或事务异常只返回固定中文错误", async () => {
    const createFailure = createFakeService();
    createFailure.failCreate = true;
    await expect(createFailure.service.start("/")).rejects.toThrow(
      "OIDC 登录事务创建失败，请稍后重试",
    );

    const consumeFailure = createFakeService();
    const result = await consumeFailure.service.start("/");
    const state = new URL(result.authorizationUrl).searchParams.get("state");
    if (!state) throw new Error("授权请求缺少 State");
    consumeFailure.failTransaction = true;
    await expect(
      consumeFailure.service.consume(state, result.browserBindingCookie),
    ).rejects.toThrow("OIDC 登录事务验证失败，请稍后重试");
  });
});
