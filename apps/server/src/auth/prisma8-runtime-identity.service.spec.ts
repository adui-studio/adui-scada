import "reflect-metadata";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import {
  nativeAuthTransaction,
  type Prisma8AuthTransaction,
} from "./prisma8-auth-transaction-port.js";
import { describe, expect, it, vi } from "vite-plus/test";
import { resolveOidcStartupConfig } from "../config/oidc-startup.config.js";
import {
  assertPrisma8Writable,
  readPrisma8Transaction,
  writePrisma8Transaction,
  type Prisma8Transaction,
} from "../database/prisma8-read-transaction.js";
import type { Prisma8Client, Prisma8Service } from "../database/prisma8.service.js";
import { buildB4OidcCleanupBody } from "../database/prisma8-b4-oidc-cleanup.js";
import type { OidcProviderDiscoveryService } from "./oidc-provider-discovery.service.js";
import {
  Prisma8RuntimeAuthSessionService,
  Prisma8RuntimeOidcLoginTransactionService,
} from "./prisma8-runtime-identity.service.js";

const storageHash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
const actor = { tenantId: "tenant-a", subjectId: "operator-a" };
const issuer = "https://127.0.0.1:18443/realms/adui-scada";
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

type Plan = { text: string; parameters: unknown[] };
type Row = Record<string, string>;

function harness(readOnly = false) {
  const mode = readOnly ? "on" : "off";
  const config = { connectionString: undefined, expectedSystemIdentifier: "123456789", readOnly };
  const identity = {
    database: "adui_scada",
    role: "adui_scada",
    sessionRole: "adui_scada",
    schema: "public",
    version: "190000",
    systemIdentifier: "123456789",
    storageHash,
    readOnly: mode,
    defaultReadOnly: mode,
    recovery: "false",
    isolation: "read committed",
  };
  const queries: Plan[] = [];
  const mutations: Plan[] = [];
  const options: unknown[] = [];
  const outcomes: string[] = [];
  const state = {
    identityRows: [{ status: "active" }] as Row[],
    sessionRows: [] as Row[],
    oidcRows: [] as Row[],
    affectedRows: 1,
    cleanupRows: [{ deleted: "2" }] as Row[],
    denyAt: 0,
    boundaryChecks: 0,
  };
  const tx = {
    raw: {
      sql: (strings: TemplateStringsArray, ...parameters: unknown[]) => {
        const build = () => ({ text: strings.join("?"), parameters });
        return { returnsRow: () => ({ build }), affectedCount: () => ({ build }) };
      },
    },
    query(plan: Plan) {
      queries.push(plan);
      let rows: Row[];
      if (plan.text.includes("current_database()")) {
        state.boundaryChecks += 1;
        rows = [
          state.boundaryChecks === state.denyAt ? { ...identity, storageHash: "" } : identity,
        ];
      } else if (plan.text.includes("public.scada_cleanup_expired_oidc()")) {
        rows = state.cleanupRows;
      } else if (plan.text.includes("scada_oidc_transactions")) {
        rows = state.oidcRows;
      } else if (plan.text.includes("scada_auth_sessions")) {
        rows = state.sessionRows;
      } else {
        rows = state.identityRows;
      }
      return { toArray: () => Promise.resolve(rows) };
    },
    execute(plan: Plan) {
      mutations.push(plan);
      if (plan.text.includes("UPDATE public.scada_oidc_transactions")) state.oidcRows = [];
      return Promise.resolve({ affectedRows: state.affectedRows });
    },
  };
  const client = {
    async transaction(
      operation: (transaction: Prisma8Transaction) => Promise<unknown>,
      option: unknown,
    ) {
      options.push(option);
      try {
        const result = await operation(tx as unknown as Prisma8Transaction);
        outcomes.push("提交");
        return result;
      } catch (error) {
        outcomes.push("回滚");
        throw error;
      }
    },
  } as unknown as Prisma8Client;
  const database = {
    writable: !readOnly,
    assertWritable: () => assertPrisma8Writable(config),
    readTransaction: <T>(operation: (tx: Prisma8Transaction) => Promise<T>) =>
      readPrisma8Transaction(client, config, storageHash, operation),
    writeTransaction: <T>(
      operation: (tx: Prisma8Transaction) => Promise<T>,
      timeout: 5000 | 10000,
    ) => writePrisma8Transaction(client, config, storageHash, operation, timeout),
  } as Prisma8Service;
  const startupConfig = resolveOidcStartupConfig({
    NODE_ENV: "test",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ISSUER: issuer,
    SCADA_OIDC_CLIENT_ID: "adui-scada",
    SCADA_OIDC_CLIENT_SECRET: randomBytes(32).toString("base64url"),
    SCADA_OIDC_REDIRECT_URI: "https://scada.example.org/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: "https://scada.example.org",
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  });
  if (!startupConfig.enabled) throw new Error("测试 OIDC 配置未启用");
  const provider = new oidc.Configuration(
    {
      issuer: startupConfig.issuer.href,
      authorization_endpoint: issuer + "/authorize",
      token_endpoint: issuer + "/token",
      jwks_uri: issuer + "/jwks",
    },
    startupConfig.clientId,
    { client_secret: startupConfig.clientSecret, id_token_signed_response_alg: "RS256" },
    oidc.ClientSecretBasic(startupConfig.clientSecret),
  );
  const discoveryCalls: string[] = [];
  const discovery = {
    getConfiguration: () => {
      discoveryCalls.push("发现");
      return Promise.resolve(provider);
    },
  } as unknown as OidcProviderDiscoveryService;
  return {
    client,
    config,
    database,
    tx,
    state,
    queries,
    mutations,
    options,
    outcomes,
    discoveryCalls,
    startupConfig,
    discovery,
    sessions: new Prisma8RuntimeAuthSessionService(database),
    transactions: new Prisma8RuntimeOidcLoginTransactionService(database, discovery, startupConfig),
  };
}

describe("原生身份业务事务边界", () => {
  it("原生事务适配器构造参数化计划并拒绝缺少文本列的结果", async () => {
    const h = harness();
    const native = nativeAuthTransaction(h.tx as unknown as Prisma8Transaction);
    const read = (transaction: Prisma8AuthTransaction) =>
      transaction.queryText({ status: "pg/text@1" })`SELECT ${actor.subjectId}::text AS status`;
    const write = (transaction: Prisma8AuthTransaction) =>
      transaction.executeCount`UPDATE public.scada_auth_sessions SET revoked_at = ${"2026-11-27T00:00:00Z"}::timestamptz WHERE session_id = ${"00000000-0000-4000-8000-000000000001"}::uuid`;
    await expect(read(native)).resolves.toEqual([{ status: "active" }]);
    expect(h.queries.map((plan) => plan.parameters)).toEqual([[actor.subjectId]]);
    await expect(write(native)).resolves.toEqual({ affectedRows: 1 });
    expect(h.mutations[0]?.parameters).toEqual([
      "2026-11-27T00:00:00Z",
      "00000000-0000-4000-8000-000000000001",
    ]);
    h.state.identityRows = [{}];
    await expect(read(native)).rejects.toThrow("身份事务查询结果缺少有效文本列");
  });

  it("原生身份查询缺少声明文本列时拒绝签发并模拟回滚", async () => {
    const h = harness();
    h.state.identityRows = [{}];
    await expect(h.sessions.issueForVerifiedSubject(actor)).rejects.toThrow(
      "本地身份事务暂时不可用，请稍后重试",
    );
    expect(h.mutations).toHaveLength(0);
    expect(h.outcomes).toEqual(["回滚"]);
  });

  it("只读配置在获得事务前拒绝写入且不启动 OIDC 发现", async () => {
    const h = harness(true);
    const state = randomBytes(32).toString("base64url");
    const binding = "scada_oidc_b_" + randomBytes(32).toString("base64url");
    await expect(h.sessions.issueForVerifiedSubject(actor)).rejects.toThrow(
      "本地身份事务暂时不可用，请稍后重试",
    );
    await expect(h.sessions.revokeForVerifiedSubject(actor, randomUUID())).rejects.toThrow(
      "本地身份事务暂时不可用，请稍后重试",
    );
    await expect(h.transactions.start("/")).rejects.toThrow("OIDC 登录事务创建失败，请稍后重试");
    await expect(h.transactions.consume(state, binding)).rejects.toThrow(
      "OIDC 登录事务验证失败，请稍后重试",
    );
    await expect(h.transactions.cleanupExpiredTransactions()).rejects.toThrow(
      "OIDC 登录事务清理失败，请稍后重试",
    );
    expect(h.options).toHaveLength(0);
    expect(h.queries).toHaveLength(0);
    expect(h.mutations).toHaveLength(0);
    expect(h.discoveryCalls).toHaveLength(0);
  });

  it("事务前边界漂移拒绝业务操作，事务后漂移模拟回滚并脱敏", async () => {
    const before = harness();
    before.state.denyAt = 1;
    await expect(before.sessions.issueForVerifiedSubject(actor)).rejects.toThrow(
      "本地身份事务暂时不可用，请稍后重试",
    );
    expect(before.queries).toHaveLength(1);
    expect(before.mutations).toHaveLength(0);
    expect(before.outcomes).toEqual(["回滚"]);

    const after = harness();
    after.state.denyAt = 2;
    await expect(after.sessions.issueForVerifiedSubject(actor)).rejects.toThrow(
      "本地身份事务暂时不可用，请稍后重试",
    );
    expect(after.mutations).toHaveLength(1);
    expect(after.outcomes).toEqual(["回滚"]);
  });

  it("在主体共享锁中签发，只保存独立摘要和有限有效期", async () => {
    const h = harness();
    const session = await h.sessions.issueForVerifiedSubject(actor);
    const insert = h.mutations[0];
    expect(h.options).toEqual([{ isolationLevel: "ReadCommitted", timeout: 10000 }]);
    expect(h.state.boundaryChecks).toBe(2);
    expect(h.queries[1]?.text).toContain("public.scada_lock_identity(?::text, ?::text)");
    expect(h.queries[1]?.parameters).toEqual([actor.tenantId, actor.subjectId]);
    expect(insert?.text).toContain("INSERT INTO public.scada_auth_sessions");
    expect(insert?.parameters.slice(0, 5)).toEqual([
      session.sessionId,
      actor.tenantId,
      actor.subjectId,
      hash(session.token),
      hash(session.csrfToken),
    ]);
    expect(insert?.parameters).not.toContain(session.token);
    expect(insert?.parameters).not.toContain(session.csrfToken);
    expect(session.token).not.toBe(session.csrfToken);
    const issuedAt = insert?.parameters[5];
    if (typeof issuedAt !== "string") throw new Error("测试缺少签发时间");
    expect(session.expiresAt.getTime() - Date.parse(issuedAt)).toBe(900000);
    expect(h.outcomes).toEqual(["提交"]);
  });

  it("拒绝不存在停用或非法主体，异常影响行数不签发会话", async () => {
    const h = harness();
    await expect(
      h.sessions.issueForVerifiedSubject({ ...actor, tenantId: "../bad" }),
    ).rejects.toThrow("无效的可信主体，禁止签发会话");
    expect(h.options).toHaveLength(0);
    h.state.identityRows = [{ status: "disabled" }];
    await expect(h.sessions.issueForVerifiedSubject(actor)).rejects.toThrow(
      "主体不存在或已停用，禁止签发会话",
    );
    h.state.identityRows = [];
    await expect(h.sessions.issueForVerifiedSubject(actor)).rejects.toThrow(
      "主体不存在或已停用，禁止签发会话",
    );
    expect(h.mutations).toHaveLength(0);
    h.state.identityRows = [{ status: "active" }];
    h.state.affectedRows = 0;
    await expect(h.sessions.issueForVerifiedSubject(actor)).rejects.toThrow(
      "本地身份事务暂时不可用，请稍后重试",
    );
    expect(h.outcomes).toEqual(["回滚", "回滚", "回滚"]);
  });

  it("只读认证以摘要查询并保持过期和 CSRF 拒绝语义", async () => {
    const h = harness(true);
    const token = "scada_s_" + randomBytes(32).toString("base64url");
    const csrf = "scada_csrf_" + randomBytes(32).toString("base64url");
    const id = randomUUID();
    expect(await h.sessions.authenticate("invalid")).toBeNull();
    expect(h.options).toHaveLength(0);
    expect(await h.sessions.authenticateWithSession(token)).toBeNull();
    const row = {
      session_id: id,
      tenant_id: actor.tenantId,
      subject_id: actor.subjectId,
      csrf_hash: hash(csrf),
      csrf_is_null: "false",
      issued_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    h.state.sessionRows = [row];
    expect(await h.sessions.authenticateCookieSession(token, csrf)).toEqual({
      authenticated: true,
      sessionId: id,
      principal: actor,
    });
    expect(await h.sessions.authenticateCookieSession(token, "invalid")).toEqual({
      authenticated: false,
      reason: "csrf_rejected",
    });
    h.state.sessionRows = [{ ...row, csrf_is_null: "true", csrf_hash: "" }];
    expect(await h.sessions.authenticateCookieSession(token)).toEqual({
      authenticated: false,
      reason: "invalid_session",
    });
    h.state.sessionRows = [{ ...row, expires_at: new Date(0).toISOString() }];
    expect(await h.sessions.authenticateWithSession(token)).toBeNull();
    const sessionQuery = h.queries.find((plan) => plan.text.includes("scada_auth_sessions"));
    expect(sessionQuery?.parameters).toEqual([hash(token)]);
    expect(sessionQuery?.text).toContain("s.revoked_at IS NULL AND i.status = 'active'");
    expect(h.mutations).toHaveLength(0);
  });

  it("撤销严格绑定会话租户与主体，重复撤销返回 false", async () => {
    const h = harness();
    const id = randomUUID();
    expect(await h.sessions.revokeForVerifiedSubject(actor, id)).toBe(true);
    h.state.affectedRows = 0;
    expect(await h.sessions.revokeForVerifiedSubject(actor, id)).toBe(false);
    expect(h.mutations[0]?.parameters.slice(1)).toEqual([id, actor.tenantId, actor.subjectId]);
    expect(h.mutations[0]?.text).toContain("AND revoked_at IS NULL");
    h.state.affectedRows = 2;
    await expect(h.sessions.revokeForVerifiedSubject(actor, id)).rejects.toThrow(
      "本地身份事务暂时不可用，请稍后重试",
    );
  });

  it("OIDC 创建使用独立摘要和加密 verifier，模拟一次性消费及重放拒绝", async () => {
    const h = harness();
    const start = await h.transactions.start("/studio");
    const url = new URL(start.authorizationUrl);
    const state = url.searchParams.get("state");
    const nonce = url.searchParams.get("nonce");
    if (!state || !nonce) throw new Error("测试授权请求缺少必要参数");
    const insert = h.mutations[0];
    const ciphertext = insert?.parameters[3];
    if (typeof ciphertext !== "string") throw new Error("测试未取得加密 verifier");
    expect(insert?.parameters.slice(0, 3)).toEqual([hash(state), issuer, nonce]);
    expect(insert?.parameters[4]).toBe(hash(start.browserBindingCookie));
    expect(ciphertext).toMatch(/^v1\./);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(h.options[0]).toEqual({ isolationLevel: "ReadCommitted", timeout: 5000 });
    h.state.oidcRows = [{ issuer, nonce, verifier_ciphertext: ciphertext, return_path: "/studio" }];
    const consumed = await h.transactions.consume(state, start.browserBindingCookie);
    if (!consumed) throw new Error("测试首次消费未返回结果");
    expect(consumed.returnPath).toBe("/studio");
    expect(consumed.nonce).toBe(nonce);
    expect(await oidc.calculatePKCECodeChallenge(consumed.codeVerifier)).toBe(
      url.searchParams.get("code_challenge"),
    );
    expect(
      h.queries.find((plan) => plan.text.includes("FOR UPDATE"))?.parameters.slice(0, 3),
    ).toEqual([hash(state), issuer, hash(start.browserBindingCookie)]);
    expect(h.mutations[1]?.text).toContain("AND consumed_at IS NULL");
    expect(await h.transactions.consume(state, start.browserBindingCookie)).toBeNull();
    expect(h.mutations).toHaveLength(2);
    expect(h.outcomes).toEqual(["提交", "提交", "提交"]);
  });

  it("OIDC 过期清理仅限当前 Issuer 与固定批次，异常影响行数回滚", async () => {
    const h = harness();
    expect(await h.transactions.cleanupExpiredTransactions()).toBe(2);
    expect(h.queries[1]?.parameters).toEqual([buildB4OidcCleanupBody(issuer)]);
    expect(h.queries[1]?.text).toContain("AND p.prosrc = ?::text");
    expect(h.queries[1]?.text).toContain("THEN public.scada_cleanup_expired_oidc()");
    expect(h.mutations).toHaveLength(0);
    for (const rows of [
      [{ deleted: "129" }],
      [{ deleted: "BINDING_MISMATCH" }],
      [],
      [{ deleted: "01" }],
    ]) {
      h.state.cleanupRows = rows;
      await expect(h.transactions.cleanupExpiredTransactions()).rejects.toThrow(
        "OIDC 登录事务清理失败，请稍后重试",
      );
    }
    expect(h.outcomes).toEqual(["提交", "回滚", "回滚", "回滚", "回滚"]);
    expect(h.mutations).toHaveLength(0);
  });

  it("可写提供方只启动一个过期清理定时器，关闭后不再访问数据库", async () => {
    const h = harness();
    vi.useFakeTimers();
    try {
      h.transactions.onModuleInit();
      h.transactions.onModuleInit();
      await vi.advanceTimersByTimeAsync(30_000);
      const cleanups = () =>
        h.queries.filter((plan) => plan.text.includes("public.scada_cleanup_expired_oidc()"));
      expect(cleanups()).toHaveLength(1);
      expect(cleanups()[0]?.parameters).toEqual([buildB4OidcCleanupBody(issuer)]);
      expect(h.mutations).toHaveLength(0);
      await h.transactions.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(cleanups()).toHaveLength(1);
    } finally {
      await h.transactions.onModuleDestroy();
      vi.useRealTimers();
    }
  });

  it("严格只读提供方不启动过期清理定时器", async () => {
    const h = harness(true);
    vi.useFakeTimers();
    try {
      h.transactions.onModuleInit();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.options).toHaveLength(0);
      expect(h.queries).toHaveLength(0);
      expect(h.mutations).toHaveLength(0);
    } finally {
      await h.transactions.onModuleDestroy();
      vi.useRealTimers();
    }
  });
});
