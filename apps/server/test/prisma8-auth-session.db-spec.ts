import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import postgres, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { Pool } from "pg";
import { describe, expect, it } from "vite-plus/test";
import { AuthSessionService, type IssuedAuthSession } from "../src/auth/auth-session.service.js";
import { Prisma8AuthSessionService } from "../src/auth/prisma8-auth-session.service.js";
import { requirePrisma8ReadOnlyTestUrl } from "../src/database/prisma8-readonly-target.js";
import { PrismaClient } from "../src/generated/prisma/client.js";
import type { Contract } from "../src/generated/prisma8/contract.d.js";
import contractJson from "../src/generated/prisma8/contract.json" with { type: "json" };

const contract = contractFromJson<Contract>(contractJson);

function same(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) throw new Error("身份会话专项与独立预期不一致");
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function rejected(operation: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error && error.message === message) return;
  }
  throw new Error("身份会话请求未按预期拒绝");
}

/** 只对本机隔离库的随机专用身份与会话执行验证，禁止回退到业务库。 */
async function verifySessions(): Promise<"MATCHED"> {
  const connectionString = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
  const id = randomUUID();
  const actor = { tenantId: "prisma8-auth-" + id, subjectId: "operator" };
  const other = { tenantId: "prisma8-other-" + id, subjectId: "operator" };
  const identities = [actor, other];
  const issuer = "https://id.example.org/realms/prisma8-" + id;
  const binding = { issuer, subject: "external-" + id };
  const secondBinding = { issuer, subject: "external-other-" + id };
  const bindings = [binding, secondBinding];
  const sessionKeys: Array<{ tenantId: string; subjectId: string; sessionId: string }> = [];
  const failures: string[] = [];
  let stage = "连接初始化";
  let old: PrismaClient | undefined;
  let pool: Pool | undefined;
  let client: PostgresClient<Contract> | undefined;
  let ownsIdentities = false;
  let ownsBindings = false;
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
    stage = "隔离库及身份结构预检";
    const boundary = await legacy.$queryRaw<Array<{ database_name: string; schema_name: string; read_only: string; ready: boolean }>>`
      SELECT current_database()::text AS database_name, current_schema()::text AS schema_name,
        current_setting('transaction_read_only') AS read_only,
        (to_regclass('public.scada_identities') IS NOT NULL AND
         to_regclass('public.scada_external_identities') IS NOT NULL AND
         to_regclass('public.scada_auth_sessions') IS NOT NULL) AS ready
    `;
    same(boundary, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off", ready: true }]);
    const poolBoundary = await writable.query("SELECT current_database()::text AS database_name, current_schema()::text AS schema_name, current_setting('transaction_read_only') AS read_only");
    same(poolBoundary.rows, [{ database_name: "adui_scada_test", schema_name: "public", read_only: "off" }]);
    const next = postgres({ contract, pg: writable });
    client = next;
    const previous = new AuthSessionService({
      client: legacy,
      onModuleInit: () => legacy.$connect(),
      onModuleDestroy: () => legacy.$disconnect(),
    });
    const candidate = new Prisma8AuthSessionService(next);

    stage = "随机专用身份与预绑定创建";
    creationUnconfirmed = true;
    await legacy.$transaction(async (tx) => {
      same(await tx.scadaIdentity.count({ where: { OR: identities } }), 0);
      same(await tx.scadaExternalIdentity.count({ where: { OR: bindings } }), 0);
      same((await tx.scadaIdentity.createMany({ data: identities })).count, 2);
      same((await tx.scadaExternalIdentity.createMany({ data: [
        { ...binding, ...actor },
        { ...secondBinding, ...other },
      ] })).count, 2);
    });
    ownsIdentities = true;
    ownsBindings = true;
    creationUnconfirmed = false;

    stage = "固定 Issuer 与预绑定主体隔离";
    const mapped = await candidate.resolveVerifiedExternalIdentity(issuer, issuer, binding.subject);
    same(mapped, actor);
    const oldMapped = await legacy.scadaExternalIdentity.findUniqueOrThrow({
      where: { issuer_subject: binding }, select: { tenantId: true, subjectId: true },
    });
    same(mapped, oldMapped);
    same(await candidate.resolveVerifiedExternalIdentity(issuer, issuer, secondBinding.subject), other);
    same(await candidate.resolveVerifiedExternalIdentity(issuer, issuer + "/other", binding.subject), null);
    same(await candidate.resolveVerifiedExternalIdentity(issuer, issuer, "missing-" + id), null);
    same(await legacy.scadaExternalIdentity.count({ where: { issuer } }), 2);

    const issue = async (service: AuthSessionService | Prisma8AuthSessionService, principal = actor): Promise<IssuedAuthSession> => {
      creationUnconfirmed = true;
      const result = await service.issueForVerifiedSubject(principal);
      sessionKeys.push({ ...principal, sessionId: result.sessionId });
      creationUnconfirmed = false;
      const stored = await legacy.scadaAuthSession.findUniqueOrThrow({ where: { sessionId: result.sessionId } });
      same([stored.tenantId, stored.subjectId, stored.tokenHash, stored.csrfTokenHash, stored.revokedAt, stored.expiresAt],
        [principal.tenantId, principal.subjectId, hash(result.token), hash(result.csrfToken), null, result.expiresAt]);
      same(/^[a-f0-9]{64}$/.test(stored.tokenHash), true);
      same(stored.tokenHash === stored.csrfTokenHash, false);
      const duration = stored.expiresAt.getTime() - stored.issuedAt.getTime();
      same(duration > 0 && duration <= 900_000, true);
      return result;
    };

    stage = "双版本会话签发、Bearer 与 Cookie 互认";
    const first = await issue(candidate);
    const second = await issue(previous);
    const foreign = await issue(candidate, other);
    for (const session of [first, second]) {
      const expected = { sessionId: session.sessionId, principal: actor };
      same(await previous.authenticateWithSession(session.token), expected);
      same(await candidate.authenticateWithSession(session.token), expected);
      same(await candidate.authenticate(session.token), actor);
      same(await candidate.authenticateCookieSession(session.token), { authenticated: true, ...expected });
      same(await candidate.authenticateCookieSession(session.token, session.csrfToken),
        await previous.authenticateCookieSession(session.token, session.csrfToken));
      same(await candidate.authenticateCookieSession(session.token, foreign.csrfToken),
        { authenticated: false, reason: "csrf_rejected" });
      same(await candidate.authenticateCookieSession(session.token, "invalid"),
        { authenticated: false, reason: "csrf_rejected" });
    }
    same(await candidate.authenticate(foreign.token), other);
    same(await candidate.authenticate("scada_s_" + randomBytes(32).toString("base64url")), null);

    stage = "旧 Bearer 会话不能升级 Cookie";
    const bearerToken = "scada_s_" + randomBytes(32).toString("base64url");
    const bearerId = randomUUID();
    creationUnconfirmed = true;
    await legacy.scadaAuthSession.create({
      data: { ...actor, sessionId: bearerId, tokenHash: hash(bearerToken), expiresAt: new Date(Date.now() + 600_000) },
    });
    sessionKeys.push({ ...actor, sessionId: bearerId });
    creationUnconfirmed = false;
    same(await candidate.authenticate(bearerToken), actor);
    same(await candidate.authenticateCookieSession(bearerToken), { authenticated: false, reason: "invalid_session" });
    same(await candidate.authenticateCookieSession(bearerToken), await previous.authenticateCookieSession(bearerToken));

    stage = "跨租户撤销拒绝与双版本并发撤销";
    same(await candidate.revokeForVerifiedSubject(other, first.sessionId), false);
    same(await candidate.authenticate(first.token), actor);
    const race = await Promise.allSettled([
      candidate.revokeForVerifiedSubject(actor, first.sessionId),
      previous.revokeForVerifiedSubject(actor, first.sessionId),
    ]);
    same(race.filter((result) => result.status === "fulfilled" && result.value === true).length, 1);
    same(race.filter((result) => result.status === "fulfilled" && result.value === false).length, 1);
    same(await candidate.revokeForVerifiedSubject(actor, first.sessionId), false);
    same(await previous.authenticate(first.token), null);
    same(await candidate.authenticate(first.token), null);
    same(await candidate.authenticateCookieSession(first.token, first.csrfToken), { authenticated: false, reason: "invalid_session" });

    stage = "精确过期及未来签发拒绝";
    const expired = await issue(candidate);
    const future = await issue(previous);
    const past = new Date(Date.now() - 60_000);
    await legacy.scadaAuthSession.update({
      where: { sessionId: expired.sessionId },
      data: { issuedAt: new Date(past.getTime() - 60_000), expiresAt: past },
    });
    await legacy.scadaAuthSession.update({
      where: { sessionId: future.sessionId },
      data: { issuedAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 120_000) },
    });
    for (const session of [expired, future]) {
      same(await candidate.authenticate(session.token), null);
      same(await previous.authenticate(session.token), null);
      same(await candidate.authenticateCookieSession(session.token, session.csrfToken), { authenticated: false, reason: "invalid_session" });
    }

    stage = "主体停用、签发拒绝及预绑定保留";
    await legacy.scadaIdentity.update({ where: { tenantId_subjectId: actor }, data: { status: "disabled" } });
    same(await candidate.authenticate(second.token), null);
    same(await previous.authenticate(second.token), null);
    same(await candidate.resolveVerifiedExternalIdentity(issuer, issuer, binding.subject), null);
    same(await candidate.resolveVerifiedExternalIdentity(issuer, issuer, secondBinding.subject), other);
    same(await candidate.authenticate(foreign.token), other);
    await rejected(() => candidate.issueForVerifiedSubject(actor), "主体不存在或已停用，禁止签发会话");
    await rejected(() => candidate.issueForVerifiedSubject({ ...actor, subjectId: "missing-" + id }), "主体不存在或已停用，禁止签发会话");
    same(await legacy.scadaIdentity.count({ where: { OR: identities } }), 2);
    same(await legacy.scadaExternalIdentity.count({ where: { OR: bindings } }), 2);
    same(await legacy.scadaAuthSession.count({ where: { OR: identities } }), sessionKeys.length);
  } catch {
    failures.push(stage);
  } finally {
    try { await client?.close(); } catch { failures.push("Prisma 8 客户端关闭失败"); }
    try { await pool?.end(); } catch { failures.push("外部连接池关闭失败"); }
    if (poolFailed) failures.push("外部连接池发生异常");
    if (creationUnconfirmed) {
      failures.push("专用夹具创建未确认，禁止自动清理，测试标识：" + id);
    } else if (old && ownsIdentities) {
      try {
        await old.$transaction(async (tx) => {
          if (sessionKeys.length > 0) {
            const where = { OR: sessionKeys };
            same((await tx.scadaAuthSession.deleteMany({ where })).count, sessionKeys.length);
            same(await tx.scadaAuthSession.count({ where }), 0);
          }
          if (ownsBindings) {
            const where = { OR: [{ ...binding, ...actor }, { ...secondBinding, ...other }] };
            same((await tx.scadaExternalIdentity.deleteMany({ where })).count, 2);
            same(await tx.scadaExternalIdentity.count({ where }), 0);
          }
          const where = { OR: identities };
          same(await tx.scadaAuthSession.count({ where }), 0);
          same(await tx.scadaExternalIdentity.count({ where }), 0);
          same((await tx.scadaIdentity.deleteMany({ where })).count, 2);
          same(await tx.scadaIdentity.count({ where }), 0);
        });
      } catch {
        failures.push("专用夹具清理未确认，禁止自动重试，测试标识：" + id);
      }
    }
    try { await old?.$disconnect(); } catch { failures.push("Prisma 7 客户端关闭失败"); }
  }
  if (failures.length) throw new Error("身份会话专项未通过：" + failures.join("；"));
  return "MATCHED";
}

describe("真实 PostgreSQL Prisma 8 身份与会话候选", () => {
  it("验证预绑定、双版本会话互认、CSRF、并发撤销、时效和精确清理", async () => {
    expect(await verifySessions()).toBe("MATCHED");
    console.info("Prisma 8 身份会话双版本对照、授权拒绝与专用夹具清理通过");
  }, 60_000);
});
