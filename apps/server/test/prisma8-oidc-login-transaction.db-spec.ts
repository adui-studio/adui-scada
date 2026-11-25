import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import postgres, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import * as oidc from "openid-client";
import { Pool } from "pg";
import { describe, expect, it } from "vite-plus/test";
import { OidcLoginTransactionService } from "../src/auth/oidc-login-transaction.service.js";
import type { OidcLoginStartResult, ConsumedOidcLoginTransaction } from "../src/auth/oidc-login-transaction.service.js";
import { Prisma8OidcLoginTransactionService } from "../src/auth/prisma8-oidc-login-transaction.service.js";
import type { OidcProviderDiscoveryService } from "../src/auth/oidc-provider-discovery.service.js";
import { resolveOidcStartupConfig } from "../src/config/oidc-startup.config.js";
import { requirePrisma8ReadOnlyTestUrl } from "../src/database/prisma8-readonly-target.js";
import { PrismaClient } from "../src/generated/prisma/client.js";
import type { Contract } from "../src/generated/prisma8/contract.d.js";
import contractJson from "../src/generated/prisma8/contract.json" with { type: "json" };

const contract = contractFromJson<Contract>(contractJson);

function same(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) throw new Error("OIDC 事务专项与独立预期不一致");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fixture(issuer: string) {
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
  // 固定合成元数据，只验证本地授权请求构造，不发出真实 IdP 网络请求。
  const provider = new oidc.Configuration(
    {
      issuer,
      authorization_endpoint: issuer + "/authorize",
      token_endpoint: issuer + "/token",
      jwks_uri: issuer + "/jwks",
    },
    config.clientId,
    { client_secret: config.clientSecret, id_token_signed_response_alg: "RS256" },
    oidc.ClientSecretBasic(config.clientSecret),
  );
  return { config, discovery: { getConfiguration: async () => provider } };
}

interface Started {
  readonly result: OidcLoginStartResult;
  readonly state: string;
  readonly stateHash: string;
  readonly nonce: string;
  readonly challenge: string;
  readonly ciphertext: string;
}

async function verifyConsumed(value: ConsumedOidcLoginTransaction | null, started: Started, issuer: string, returnPath: string): Promise<void> {
  if (!value) throw new Error("有效 OIDC 登录事务未消费");
  same([value.issuer, value.nonce, value.returnPath], [issuer, started.nonce, returnPath]);
  same(await oidc.calculatePKCECodeChallenge(value.codeVerifier), started.challenge);
  same(started.ciphertext.includes(value.codeVerifier), false);
  same(Object.isFrozen(value), true);
}

/** 只在已迁移的本机隔离数据库使用两个随机专用 Issuer，不连接真实 IdP。 */
async function verifyTransactions(): Promise<"MATCHED"> {
  const connectionString = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
  const id = randomUUID();
  const foreignId = randomUUID();
  const issuer = "https://id.example.org/realms/prisma8-oidc-" + id;
  const foreignIssuer = "https://id.example.org/realms/prisma8-oidc-" + foreignId;
  const owned: Array<{ issuer: string; stateHash: string }> = [];
  const failures: string[] = [];
  let stage = "连接初始化";
  let old: PrismaClient | undefined;
  let pool: Pool | undefined;
  let client: PostgresClient<Contract> | undefined;
  let creationUnconfirmed = false;
  let poolFailed = false;

  try {
    const base = { connectionString, connectionTimeoutMillis: 2000, idleTimeoutMillis: 5000 };
    const options = "-c statement_timeout=5000 -c lock_timeout=2000";
    const writable = new Pool({ ...base, max: 2, options });
    pool = writable;
    writable.on("error", () => { poolFailed = true; });
    const legacy = new PrismaClient({ adapter: new PrismaPg({ ...base, max: 2, options }) });
    old = legacy;
    await legacy.$connect();

    stage = "隔离库与 OIDC 结构预检";
    const boundary = await legacy.$queryRaw<Array<{ database_name: string; schema_name: string; read_only: string; ready: boolean }>>`
      SELECT current_database()::text AS database_name, current_schema()::text AS schema_name,
        current_setting('transaction_read_only') AS read_only,
        (to_regclass('public.scada_oidc_transactions') IS NOT NULL AND
         to_regclass('public.scada_oidc_transactions_expiry_idx') IS NOT NULL AND
         to_regclass('public.scada_oidc_transactions_browser_idx') IS NOT NULL) AS ready
    `;
    same(boundary, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off", ready: true }]);
    const migration = await legacy.$queryRaw<Array<{ ready: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM public._prisma_migrations
        WHERE migration_name = '20261114000000_oidc_identity_transactions'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ready
    `;
    same(migration, [{ ready: true }]);
    const poolBoundary = await writable.query("SELECT current_database()::text AS database_name, current_schema()::text AS schema_name, current_setting('transaction_read_only') AS read_only");
    same(poolBoundary.rows, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off" }]);
    same(await legacy.scadaOidcTransaction.count({ where: { issuer: { in: [issuer, foreignIssuer] } } }), 0);

    const next = postgres({ contract, pg: writable });
    client = next;
    const main = fixture(issuer);
    const foreign = fixture(foreignIssuer);
    const previous = new OidcLoginTransactionService({
      client: legacy,
      onModuleInit: () => legacy.$connect(),
      onModuleDestroy: () => legacy.$disconnect(),
    }, main.discovery as unknown as OidcProviderDiscoveryService, main.config);
    const candidate = new Prisma8OidcLoginTransactionService(next, main.discovery, main.config);
    const foreignCandidate = new Prisma8OidcLoginTransactionService(next, foreign.discovery, foreign.config);

    const start = async (service: OidcLoginTransactionService | Prisma8OidcLoginTransactionService, returnPath = "/", binding?: string): Promise<Started> => {
      creationUnconfirmed = true;
      const result = await service.start(returnPath, binding);
      const url = new URL(result.authorizationUrl);
      const state = url.searchParams.get("state");
      const nonce = url.searchParams.get("nonce");
      const challenge = url.searchParams.get("code_challenge");
      if (!state || !nonce || !challenge) throw new Error("合成授权请求缺少必要字段");
      const stateHash = sha256(state);
      owned.push({ issuer, stateHash });
      creationUnconfirmed = false;
      const record = await legacy.scadaOidcTransaction.findUniqueOrThrow({ where: { stateHash } });
      same(url.origin, main.config.issuer.origin);
      same(url.pathname, main.config.issuer.pathname + "/authorize");
      same(url.searchParams.get("code_challenge_method"), "S256");
      same(url.searchParams.get("redirect_uri"), main.config.redirectUri.href);
      same([record.stateHash, record.issuer, record.nonce, record.browserBindingHash, record.returnPath, record.expiresAt, record.consumedAt],
        [stateHash, issuer, nonce, sha256(result.browserBindingCookie), returnPath, result.expiresAt, null]);
      same(record.expiresAt.getTime() - record.createdAt.getTime(), 300_000);
      same(record.verifierCiphertext.startsWith("v1."), true);
      same(record.verifierCiphertext.split(".").length, 4);
      same(record.stateHash === state, false);
      same(record.browserBindingHash === result.browserBindingCookie, false);
      return { result, state, stateHash, nonce, challenge, ciphertext: record.verifierCiphertext };
    };

    stage = "双版本创建与消费及浏览器绑定互认";
    const first = await start(candidate, "/?view=studio");
    const second = await start(previous, "/?view=runtime", first.result.browserBindingCookie);
    same(second.result.browserBindingCookie, first.result.browserBindingCookie);
    same(first.state === second.state, false);
    same(first.nonce === second.nonce, false);
    same(await candidate.consume(second.state, "scada_oidc_b_" + randomBytes(32).toString("base64url")), null);
    same(await foreignCandidate.consume(second.state, second.result.browserBindingCookie), null);
    same((await legacy.scadaOidcTransaction.findUniqueOrThrow({ where: { stateHash: second.stateHash } })).consumedAt, null);
    await verifyConsumed(await previous.consume(first.state, first.result.browserBindingCookie), first, issuer, "/?view=studio");
    await verifyConsumed(await candidate.consume(second.state, second.result.browserBindingCookie), second, issuer, "/?view=runtime");
    same(await candidate.consume(first.state, first.result.browserBindingCookie), null);
    same(await previous.consume(second.state, second.result.browserBindingCookie), null);

    stage = "跨版本并发一次性消费";
    const racing = await start(candidate);
    const race = await Promise.allSettled([
      previous.consume(racing.state, racing.result.browserBindingCookie),
      candidate.consume(racing.state, racing.result.browserBindingCookie),
    ]);
    same(race.filter((item) => item.status === "fulfilled" && item.value !== null).length, 1);
    same(race.filter((item) => item.status === "fulfilled" && item.value === null).length, 1);
    const winner = race.find((item) => item.status === "fulfilled" && item.value !== null);
    if (!winner || winner.status !== "fulfilled") throw new Error("并发消费缺少唯一成功回执");
    await verifyConsumed(winner.value, racing, issuer, "/");
    same((await legacy.scadaOidcTransaction.findUniqueOrThrow({ where: { stateHash: racing.stateHash } })).consumedAt instanceof Date, true);
    same(await candidate.consume(racing.state, racing.result.browserBindingCookie), null);

    stage = "过期与未来创建拒绝";
    const expired = await start(candidate);
    const future = await start(previous);
    const past = new Date(Date.now() - 60_000);
    await legacy.scadaOidcTransaction.update({ where: { stateHash: expired.stateHash },
      data: { createdAt: new Date(past.getTime() - 300_000), expiresAt: past } });
    await legacy.scadaOidcTransaction.update({ where: { stateHash: future.stateHash },
      data: { createdAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 360_000) } });
    for (const item of [expired, future]) {
      same(await candidate.consume(item.state, item.result.browserBindingCookie), null);
      same(await previous.consume(item.state, item.result.browserBindingCookie), null);
      same((await legacy.scadaOidcTransaction.findUniqueOrThrow({ where: { stateHash: item.stateHash } })).consumedAt, null);
    }

    stage = "State 绑定密文、Nonce 和回跳路径篡改拒绝";
    const source = await start(previous);
    const target = await start(candidate);
    const badNonce = await start(candidate);
    const badPath = await start(candidate);
    await legacy.scadaOidcTransaction.update({ where: { stateHash: target.stateHash }, data: { verifierCiphertext: source.ciphertext } });
    await legacy.scadaOidcTransaction.update({ where: { stateHash: badNonce.stateHash }, data: { nonce: "invalid" } });
    await legacy.scadaOidcTransaction.update({ where: { stateHash: badPath.stateHash }, data: { returnPath: "/%0a" } });
    for (const item of [target, badNonce, badPath]) {
      same(await candidate.consume(item.state, item.result.browserBindingCookie), null);
      same((await legacy.scadaOidcTransaction.findUniqueOrThrow({ where: { stateHash: item.stateHash } })).consumedAt instanceof Date, true);
      same(await previous.consume(item.state, item.result.browserBindingCookie), null);
    }
    await verifyConsumed(await candidate.consume(source.state, source.result.browserBindingCookie), source, issuer, "/");

    stage = "专用 Issuer 每批 128 条过期清理";
    const live = await start(candidate);
    const seed = Array.from({ length: 138 }, (_, index) => ({
      stateHash: randomBytes(32).toString("hex"),
      issuer: index === 137 ? foreignIssuer : issuer,
      nonce: randomBytes(32).toString("base64url"),
      verifierCiphertext: "v1.test.test.test",
      browserBindingHash: randomBytes(32).toString("hex"),
      returnPath: "/",
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
      expiresAt: new Date("2000-01-01T00:05:00.000Z"),
    }));
    creationUnconfirmed = true;
    const inserted = await legacy.scadaOidcTransaction.createMany({ data: seed });
    same(inserted.count, seed.length);
    owned.push(...seed.map(({ issuer: rowIssuer, stateHash }) => ({ issuer: rowIssuer, stateHash })));
    creationUnconfirmed = false;
    const before = await legacy.scadaOidcTransaction.count({ where: { issuer } });
    same(await candidate.cleanupExpiredTransactions(), 128);
    same(await legacy.scadaOidcTransaction.count({ where: { issuer } }), before - 128);
    same(await candidate.cleanupExpiredTransactions(), 10);
    same(await candidate.cleanupExpiredTransactions(), 0);
    same(await legacy.scadaOidcTransaction.count({ where: { issuer } }), before - 138);
    same(await legacy.scadaOidcTransaction.count({ where: { issuer: foreignIssuer } }), 1);
    same((await legacy.scadaOidcTransaction.findUniqueOrThrow({ where: { stateHash: live.stateHash } })).consumedAt, null);
    await verifyConsumed(await previous.consume(live.state, live.result.browserBindingCookie), live, issuer, "/");
  } catch {
    failures.push(stage);
  } finally {
    try { await client?.close(); } catch { failures.push("Prisma 8 客户端关闭失败"); }
    try { await pool?.end(); } catch { failures.push("外部连接池关闭失败"); }
    if (poolFailed) failures.push("外部连接池发生异常");
    if (creationUnconfirmed) {
      failures.push("专用夹具创建未确认，禁止自动清理，测试标识：" + id + "、" + foreignId);
    } else if (old && owned.length > 0) {
      try {
        await old.$transaction(async (tx) => {
          const where = { OR: owned };
          const remaining = await tx.scadaOidcTransaction.count({ where });
          same((await tx.scadaOidcTransaction.deleteMany({ where })).count, remaining);
          same(await tx.scadaOidcTransaction.count({ where }), 0);
          same(await tx.scadaOidcTransaction.count({ where: { issuer: { in: [issuer, foreignIssuer] } } }), 0);
        });
      } catch {
        failures.push("专用夹具清理未确认，禁止自动重试，测试标识：" + id + "、" + foreignId);
      }
    }
    try { await old?.$disconnect(); } catch { failures.push("Prisma 7 客户端关闭失败"); }
  }
  if (failures.length) throw new Error("OIDC 登录事务专项未通过：" + failures.join("；"));
  return "MATCHED";
}

describe("真实 PostgreSQL Prisma 8 OIDC 登录事务候选", () => {
  it("验证双版本加密事务互认、并发消费、拒绝及专用批次清理", async () => {
    expect(await verifyTransactions()).toBe("MATCHED");
    console.info("Prisma 8 OIDC 登录事务双版本对照、一次性消费与专用夹具清理通过");
  }, 60_000);
});
