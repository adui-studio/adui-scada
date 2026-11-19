import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import request from "supertest";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { AuthSessionService } from "../src/auth/auth-session.service.js";
import type { IssuedAuthSession } from "../src/auth/auth-session.service.js";
import { ScadaAuthController } from "../src/auth/scada-auth.controller.js";
import { OidcCallbackService } from "../src/auth/oidc-callback.service.js";
import { OidcLoginTransactionService } from "../src/auth/oidc-login-transaction.service.js";
import {
  SCADA_CSRF_COOKIE_NAME,
  SCADA_SESSION_COOKIE_NAME,
} from "../src/auth/scada-auth-cookie.js";
import { ScadaProjectGuard } from "../src/auth/scada-project.guard.js";
import { ScadaSessionGuard } from "../src/auth/scada-session.guard.js";
import { SCADA_OIDC_STARTUP_CONFIG } from "../src/auth/oidc-provider-discovery.service.js";
import { resolveOidcStartupConfig } from "../src/config/oidc-startup.config.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { ProjectApiController } from "../src/projects/project-api.controller.js";
import { ProjectApiExceptionFilter } from "../src/projects/project-api.exception-filter.js";
import { PrismaProjectVersionStore } from "../src/projects/prisma-project-version-store.js";
import { ScadaSecurityAuditService } from "../src/security/scada-security-audit.js";

// 本测试执行真实 HTTP + Cookie/CSRF + ACL + Prisma，严格禁止触碰业务库。
const testUrl = process.env.SCADA_TEST_DATABASE_URL;
if (!testUrl) throw new Error("真实双会话 HTTP 测试必须显式设置 SCADA_TEST_DATABASE_URL");
let parsedUrl: URL;
try {
  parsedUrl = new URL(testUrl);
} catch {
  throw new Error("真实双会话 HTTP 测试数据库地址格式无效");
}
if (
  !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) ||
  parsedUrl.pathname !== "/adui_scada_test" ||
  !["postgresql:", "postgres:"].includes(parsedUrl.protocol)
) {
  throw new Error("真实双会话 HTTP 测试仅允许连接本机 adui_scada_test 隔离数据库");
}

const originalDatabaseUrl = process.env.SCADA_DATABASE_URL;
const origin = "https://scada.example.org";
const subjectA = "test-http-engineer-a";
const subjectB = "test-http-engineer-b";
const projectId = waterTreatmentDemoDocument.projectId;

interface IsolatedFixture {
  readonly tenantId: string;
  readonly sessionA: IssuedAuthSession;
  readonly sessionB: IssuedAuthSession;
}

let app: INestApplication | undefined;
let database: PrismaService | undefined;
let sessions: AuthSessionService;
let store: PrismaProjectVersionStore;

function document() {
  const copy = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  return copy as typeof waterTreatmentDemoDocument;
}

function cookie(session: IssuedAuthSession): string {
  return (
    SCADA_SESSION_COOKIE_NAME +
    "=" +
    session.token +
    "; " +
    SCADA_CSRF_COOKIE_NAME +
    "=" +
    session.csrfToken
  );
}

function postVersion(session: IssuedAuthSession, expectedRevision = 1) {
  return request(app!.getHttpServer())
    .post("/api/v1/projects/" + projectId + "/versions")
    .set("Cookie", cookie(session))
    .set("Origin", origin)
    .set("Sec-Fetch-Site", "same-origin")
    .set("X-SCADA-CSRF", session.csrfToken)
    .send({ expectedRevision, document: document() });
}

/** 受保护的 GET 发布预检不需要 CSRF Header，也不接收工程 JSON。 */
function getReleasePreflight(session: IssuedAuthSession, revision: number) {
  return request(app!.getHttpServer())
    .get("/api/v1/projects/" + projectId + "/versions/" + revision + "/release-preflight")
    .set("Cookie", cookie(session));
}

/** 每个测试独立租户和会话；只清理本用例写入的记录。 */
async function withFixture(run: (fixture: IsolatedFixture) => Promise<void>): Promise<void> {
  const tenantId = "test-" + randomUUID();
  try {
    await database!.client.scadaIdentity.createMany({
      data: [
        { tenantId, subjectId: subjectA, status: "active" },
        { tenantId, subjectId: subjectB, status: "active" },
      ],
    });
    const principalA = { tenantId, subjectId: subjectA };
    const principalB = { tenantId, subjectId: subjectB };
    const [sessionA, sessionB] = await Promise.all([
      sessions.issueForVerifiedSubject(principalA),
      sessions.issueForVerifiedSubject(principalB),
    ]);
    await store.create(principalA, { document: document() });
    await database!.client.scadaProjectGrant.createMany({
      data: ["project:read", "version:read", "version:append"].map((permission) => ({
        tenantId,
        projectId,
        subjectId: subjectB,
        permission,
      })),
    });
    await run({ tenantId, sessionA, sessionB });
  } finally {
    if (database) {
      // 发布状态通过 RESTRICT 外键保护工程；先删除状态，再删除事件与工程版本。
      await database.client.scadaProjectReleaseState.deleteMany({ where: { tenantId } });
      await database.client.scadaProjectReleaseEvent.deleteMany({ where: { tenantId } });
      await database.client.scadaProjectAudit.deleteMany({ where: { tenantId } });
      await database.client.scadaProjectVersion.deleteMany({ where: { tenantId } });
      await database.client.scadaProjectGrant.deleteMany({ where: { tenantId } });
      await database.client.scadaProject.deleteMany({ where: { tenantId } });
      await database.client.scadaAuthSession.deleteMany({ where: { tenantId } });
      await database.client.scadaIdentity.deleteMany({ where: { tenantId } });
    }
  }
}

beforeAll(async () => {
  process.env.SCADA_DATABASE_URL = testUrl;
  database = new PrismaService();
  await database.onModuleInit();
  const config = resolveOidcStartupConfig({
    NODE_ENV: "test",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ISSUER: "https://id.example.org/realms/scada",
    SCADA_OIDC_CLIENT_ID: "adui-scada",
    SCADA_OIDC_CLIENT_SECRET: "isolated-http-cas-test-secret",
    SCADA_OIDC_REDIRECT_URI: origin + "/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: origin,
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  });
  if (!config.enabled) throw new Error("真实双会话测试 OIDC 配置未启用");
  const moduleRef = await Test.createTestingModule({
    controllers: [ProjectApiController, ScadaAuthController],
    providers: [
      { provide: PrismaService, useValue: database },
      { provide: SCADA_OIDC_STARTUP_CONFIG, useValue: config },
      // 本专项不发起 IdP 授权码流程，只复用真实 Cookie 认证和注销入口。
      { provide: OidcLoginTransactionService, useValue: {} },
      { provide: OidcCallbackService, useValue: {} },
      AuthSessionService,
      PrismaProjectVersionStore,
      ScadaSecurityAuditService,
      ScadaSessionGuard,
      ScadaProjectGuard,
      ProjectApiExceptionFilter,
      Reflector,
    ],
  }).compile();
  sessions = moduleRef.get(AuthSessionService);
  store = moduleRef.get(PrismaProjectVersionStore);
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    try {
      await database?.onModuleDestroy();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.SCADA_DATABASE_URL;
      else process.env.SCADA_DATABASE_URL = originalDatabaseUrl;
    }
  }
});

describe("本机隔离 PostgreSQL 双 Cookie 会话 HTTP CAS 事务", () => {
  it("两个不同可信主体的独立 Cookie 会话均通过实际授权列表与身份隔离", async () => {
    await withFixture(async ({ tenantId, sessionA, sessionB }) => {
      expect(sessionA.sessionId).not.toBe(sessionB.sessionId);
      expect(sessionA.token).not.toBe(sessionB.token);
      const responses = await Promise.all(
        [sessionA, sessionB].map((session) =>
          request(app!.getHttpServer()).get("/api/v1/projects").set("Cookie", cookie(session)),
        ),
      );
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.body).toEqual([expect.objectContaining({ projectId, headRevision: 1 })]);
      }
      expect(await database!.client.scadaAuthSession.count({ where: { tenantId } })).toBe(2);
      const unauthenticated = await request(app!.getHttpServer()).get("/api/v1/projects");
      expect(unauthenticated.status).toBe(401);
    });
  });

  it("错误 CSRF、非法 Origin 和混用凭据均拒绝写入且不改变水位", async () => {
    await withFixture(async ({ tenantId, sessionA, sessionB }) => {
      const wrongCsrf = await postVersion(sessionA).set("X-SCADA-CSRF", sessionB.csrfToken);
      expect(wrongCsrf.status).toBe(403);
      const wrongOrigin = await postVersion(sessionA).set(
        "Origin",
        "https://untrusted.example.org",
      );
      expect(wrongOrigin.status).toBe(403);
      const mixedCredentials = await postVersion(sessionA).set(
        "Authorization",
        "Bearer " + sessionA.token,
      );
      expect(mixedCredentials.status).toBe(401);
      const project = await database!.client.scadaProject.findUniqueOrThrow({
        where: { tenantId_projectId: { tenantId, projectId } },
      });
      expect(project.headRevision).toBe(1n);
      expect(
        await database!.client.scadaProjectVersion.count({ where: { tenantId, projectId } }),
      ).toBe(1);
      expect(
        await database!.client.scadaProjectAudit.count({ where: { tenantId, projectId } }),
      ).toBe(1);
    });
  });

  it("有有效会话但缺少版本追加 ACL 的主体仍无法写入工程", async () => {
    await withFixture(async ({ tenantId, sessionB }) => {
      const removed = await database!.client.scadaProjectGrant.deleteMany({
        where: { tenantId, projectId, subjectId: subjectB, permission: "version:append" },
      });
      expect(removed.count).toBe(1);
      const denied = await postVersion(sessionB);
      expect(denied.status).toBe(404);
      const summary = await request(app!.getHttpServer())
        .get("/api/v1/projects")
        .set("Cookie", cookie(sessionB));
      expect(summary.status).toBe(200);
      expect(summary.body).toHaveLength(1);
      expect(
        await database!.client.scadaProjectVersion.count({ where: { tenantId, projectId } }),
      ).toBe(1);
    });
  });

  it("两个不同会话并发保存同一修订号只能一个 HTTP 201，另一个 HTTP 409", async () => {
    await withFixture(async ({ tenantId, sessionA, sessionB }) => {
      const responses = await Promise.all([postVersion(sessionA), postVersion(sessionB)]);
      expect(
        responses.map((response) => response.status).sort((left, right) => left - right),
      ).toEqual([201, 409]);
      const winningIndex = responses.findIndex((response) => response.status === 201);
      expect(winningIndex).toBeGreaterThanOrEqual(0);
      const winning = responses[winningIndex]!;
      const losing = responses[1 - winningIndex]!;
      const winner = winningIndex === 0 ? subjectA : subjectB;
      expect(winning.body.revision).toBe(2);
      expect(winning.body.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(losing.body).toEqual({
        statusCode: 409,
        message: "工程版本已变化，请重新获取最新修订号",
      });
      expect(JSON.stringify(losing.body)).not.toContain("Prisma");

      const [project, versions, audits] = await Promise.all([
        database!.client.scadaProject.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId, projectId } },
        }),
        database!.client.scadaProjectVersion.findMany({
          where: { tenantId, projectId },
          orderBy: { revision: "asc" },
        }),
        database!.client.scadaProjectAudit.findMany({
          where: { tenantId, projectId },
          orderBy: { revision: "asc" },
        }),
      ]);
      expect(project.headRevision).toBe(2n);
      expect(versions.map((version) => version.revision)).toEqual([1n, 2n]);
      expect(versions[1]?.contentHash).toBe(winning.body.contentHash);
      expect(versions[1]?.createdBy).toBe(winner);
      expect(audits.map((audit) => audit.revision)).toEqual([1n, 2n]);
      expect(audits.map((audit) => audit.actorId)).toEqual([subjectA, winner]);

      const staleRetry = await postVersion(winningIndex === 0 ? sessionB : sessionA);
      expect(staleRetry.status).toBe(409);
      const afterRetry = await database!.client.scadaProjectVersion.count({
        where: { tenantId, projectId },
      });
      expect(afterRetry).toBe(2);
    });
  });

  it("真实 PostgreSQL 已提交版本后延迟交付旧 201，最新水位与审计不得回退", async () => {
    await withFixture(async ({ tenantId, sessionA, sessionB }) => {
      // 仅延迟测试消费端收到真实 201 的时机，不伪造 HTTP 成功，也不暂停数据库事务。
      const committed = await postVersion(sessionA, 1);
      expect(committed.status).toBe(201);
      expect(committed.body.revision).toBe(2);
      expect(committed.body.contentHash).toMatch(/^[a-f0-9]{64}$/);
      let releaseReply: (() => void) | undefined;
      const delayedReply = new Promise<{ revision: number; contentHash: string }>((resolve) => {
        releaseReply = () =>
          resolve({ revision: committed.body.revision, contentHash: committed.body.contentHash });
      });
      let clientReceived = false;
      const pendingDelivery = delayedReply.then((reply) => {
        clientReceived = true;
        return reply;
      });

      // 旧回包仍被消费端持有期间，真实数据库已提交修订号 2 和对应审计。
      const [afterCommit, committedVersions, committedAudits] = await Promise.all([
        database!.client.scadaProject.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId, projectId } },
        }),
        database!.client.scadaProjectVersion.findMany({
          where: { tenantId, projectId },
          orderBy: { revision: "asc" },
        }),
        database!.client.scadaProjectAudit.findMany({
          where: { tenantId, projectId },
          orderBy: { revision: "asc" },
        }),
      ]);
      expect(afterCommit.headRevision).toBe(2n);
      expect(committedVersions.map((version) => version.revision)).toEqual([1n, 2n]);
      expect(committedAudits.map((audit) => audit.revision)).toEqual([1n, 2n]);
      expect(committedAudits[1]?.actorId).toBe(subjectA);

      // 第二个受控 Cookie 会话在旧回包交付前追加到修订号 3。
      const next = await postVersion(sessionB, 2);
      expect(next.status).toBe(201);
      expect(next.body.revision).toBe(3);
      const refreshed = await request(app!.getHttpServer())
        .get("/api/v1/projects/" + projectId)
        .set("Cookie", cookie(sessionA));
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.headRevision).toBe(3);
      const latestSnapshot = await request(app!.getHttpServer())
        .get("/api/v1/projects/" + projectId + "/versions/3")
        .set("Cookie", cookie(sessionA));
      expect(latestSnapshot.status).toBe(200);
      expect(latestSnapshot.body.revision).toBe(3);
      expect(latestSnapshot.body.contentHash).toBe(next.body.contentHash);

      // 现在才向模拟客户端交付旧 201；旧修订号不得作为新的 CAS 写入依据。
      expect(clientReceived).toBe(false);
      releaseReply?.();
      const late = await pendingDelivery;
      expect(clientReceived).toBe(true);
      expect(late.revision).toBe(2);
      expect(late.contentHash).toBe(committed.body.contentHash);
      const staleRetry = await postVersion(sessionA, late.revision);
      expect(staleRetry.status).toBe(409);

      const [finalProject, finalVersions, finalAudits] = await Promise.all([
        database!.client.scadaProject.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId, projectId } },
        }),
        database!.client.scadaProjectVersion.findMany({
          where: { tenantId, projectId },
          orderBy: { revision: "asc" },
        }),
        database!.client.scadaProjectAudit.findMany({
          where: { tenantId, projectId },
          orderBy: { revision: "asc" },
        }),
      ]);
      expect(finalProject.headRevision).toBe(3n);
      expect(finalVersions.map((version) => version.revision)).toEqual([1n, 2n, 3n]);
      expect(finalVersions[1]?.contentHash).toBe(late.contentHash);
      expect(finalVersions[2]?.contentHash).toBe(next.body.contentHash);
      expect(finalAudits.map((audit) => audit.revision)).toEqual([1n, 2n, 3n]);
      expect(finalAudits.map((audit) => audit.actorId)).toEqual([subjectA, subjectA, subjectB]);
    });
  });

  it("真实 HTTP 注销只撤销当前 Cookie 会话，旧请求立即失败且另一主体仍能保存", async () => {
    await withFixture(async ({ tenantId, sessionA, sessionB }) => {
      const logout = await request(app!.getHttpServer())
        .post("/api/v1/auth/logout")
        .set("Cookie", cookie(sessionA))
        .set("Origin", origin)
        .set("Sec-Fetch-Site", "same-origin")
        .set("X-SCADA-CSRF", sessionA.csrfToken);
      expect(logout.status).toBe(204);
      expect(logout.headers["cache-control"]).toBe("no-store");
      expect(JSON.stringify(logout.headers["set-cookie"])).toContain("Max-Age=0");

      const [revoked, active] = await Promise.all([
        database!.client.scadaAuthSession.findUnique({
          where: { sessionId: sessionA.sessionId },
          select: { revokedAt: true },
        }),
        database!.client.scadaAuthSession.findUnique({
          where: { sessionId: sessionB.sessionId },
          select: { revokedAt: true },
        }),
      ]);
      expect(revoked?.revokedAt).toBeInstanceOf(Date);
      expect(active?.revokedAt).toBeNull();

      const identityA = await request(app!.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Cookie", cookie(sessionA));
      expect(identityA.status).toBe(401);
      const listA = await request(app!.getHttpServer())
        .get("/api/v1/projects")
        .set("Cookie", cookie(sessionA));
      expect(listA.status).toBe(401);
      const writeA = await postVersion(sessionA);
      expect(writeA.status).toBe(401);

      const identityB = await request(app!.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Cookie", cookie(sessionB));
      expect(identityB.status).toBe(200);
      expect(identityB.body).toEqual({
        authenticated: true,
        principal: { tenantId, subjectId: subjectB },
      });
      const writeB = await postVersion(sessionB);
      expect(writeB.status).toBe(201);
      expect(writeB.body.revision).toBe(2);

      const audit = await database!.client.scadaProjectAudit.findMany({
        where: { tenantId, projectId },
        orderBy: { revision: "asc" },
      });
      expect(audit.map((entry) => entry.actorId)).toEqual([subjectA, subjectB]);
    });
  });

  it("移除第二主体全部工程 ACL 后原会话仍有效但列表、详情、历史和写入立即隔离", async () => {
    await withFixture(async ({ tenantId, sessionA, sessionB }) => {
      const removed = await database!.client.scadaProjectGrant.deleteMany({
        where: { tenantId, projectId, subjectId: subjectB },
      });
      expect(removed.count).toBe(3);

      const identityB = await request(app!.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Cookie", cookie(sessionB));
      expect(identityB.status).toBe(200);
      expect(identityB.body).toEqual({
        authenticated: true,
        principal: { tenantId, subjectId: subjectB },
      });

      const listB = await request(app!.getHttpServer())
        .get("/api/v1/projects")
        .set("Cookie", cookie(sessionB));
      expect(listB.status).toBe(200);
      expect(listB.body).toEqual([]);

      const detailB = await request(app!.getHttpServer())
        .get("/api/v1/projects/" + projectId)
        .set("Cookie", cookie(sessionB));
      expect(detailB.status).toBe(404);
      const versionsB = await request(app!.getHttpServer())
        .get("/api/v1/projects/" + projectId + "/versions")
        .set("Cookie", cookie(sessionB));
      expect(versionsB.status).toBe(404);
      const snapshotB = await request(app!.getHttpServer())
        .get("/api/v1/projects/" + projectId + "/versions/1")
        .set("Cookie", cookie(sessionB));
      expect(snapshotB.status).toBe(404);
      const writeB = await postVersion(sessionB);
      expect(writeB.status).toBe(404);

      const detailA = await request(app!.getHttpServer())
        .get("/api/v1/projects/" + projectId)
        .set("Cookie", cookie(sessionA));
      expect(detailA.status).toBe(200);
      const writeA = await postVersion(sessionA);
      expect(writeA.status).toBe(201);
      expect(writeA.body.revision).toBe(2);

      const [project, audits] = await Promise.all([
        database!.client.scadaProject.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId, projectId } },
        }),
        database!.client.scadaProjectAudit.findMany({
          where: { tenantId, projectId },
          orderBy: { revision: "asc" },
        }),
      ]);
      expect(project.headRevision).toBe(2n);
      expect(audits.map((entry) => entry.actorId)).toEqual([subjectA, subjectA]);
    });
  });

  it("真实 PostgreSQL 当前版本预检对两个 Cookie 主体返回一致只读报告", async () => {
    await withFixture(async ({ tenantId, sessionA, sessionB }) => {
      const version = await database!.client.scadaProjectVersion.findUniqueOrThrow({
        where: { tenantId_projectId_revision: { tenantId, projectId, revision: 1n } },
      });
      for (const session of [sessionA, sessionB]) {
        const response = await getReleasePreflight(session, 1);
        expect(response.status).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).toEqual({
          projectId,
          revision: 1,
          headRevision: 1,
          contentHash: version.contentHash,
          passed: true,
          issues: [],
        });
        expect(response.body).not.toHaveProperty("document");
        expect(response.body).not.toHaveProperty("snapshot");
      }

      const unauthenticated = await request(app!.getHttpServer()).get(
        "/api/v1/projects/" + projectId + "/versions/1/release-preflight",
      );
      expect(unauthenticated.status).toBe(401);

      const [project, versionCount, auditCount] = await Promise.all([
        database!.client.scadaProject.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId, projectId } },
        }),
        database!.client.scadaProjectVersion.count({ where: { tenantId, projectId } }),
        database!.client.scadaProjectAudit.count({ where: { tenantId, projectId } }),
      ]);
      expect(project.headRevision).toBe(1n);
      expect(versionCount).toBe(1);
      expect(auditCount).toBe(1);
    });
  });

  it("真实版本推进后旧预检返回 409，当前不兼容属性仅报告问题", async () => {
    await withFixture(async ({ tenantId, sessionB }) => {
      const incompatible = document();
      incompatible.pages[0]!.nodes[1]!.props.color = "#ff0000";
      const saved = await store.append({ tenantId, subjectId: subjectA }, projectId, {
        expectedRevision: 1,
        document: incompatible,
      });
      expect(saved.revision).toBe(2);
      const stale = await getReleasePreflight(sessionB, 1);
      expect(stale.status).toBe(409);
      expect(stale.body.message).toBe("工程版本已变化，请重新获取最新修订号");

      const current = await getReleasePreflight(sessionB, 2);
      expect(current.status).toBe(200);
      expect(current.body).toEqual({
        projectId,
        revision: 2,
        headRevision: 2,
        contentHash: saved.contentHash,
        passed: false,
        issues: [
          {
            code: "UNSUPPORTED_SYMBOL_PROP",
            severity: "error",
            path: "pages[0].nodes[1].props.color",
            message: "当前 SVG 运行时不处理此图元属性",
          },
        ],
      });

      const [head, revisions, audits] = await Promise.all([
        database!.client.scadaProject.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId, projectId } },
        }),
        database!.client.scadaProjectVersion.findMany({
          where: { tenantId, projectId },
          orderBy: { revision: "asc" },
        }),
        database!.client.scadaProjectAudit.findMany({
          where: { tenantId, projectId },
          orderBy: { revision: "asc" },
        }),
      ]);
      expect(head.headRevision).toBe(2n);
      expect(revisions.map((entry) => entry.revision)).toEqual([1n, 2n]);
      expect(audits.map((entry) => entry.revision)).toEqual([1n, 2n]);
    });
  });

  it("真实 ACL 撤销 version:read 后预检立即返回 404，原授权主体不受影响", async () => {
    await withFixture(async ({ tenantId, sessionA, sessionB }) => {
      const removed = await database!.client.scadaProjectGrant.deleteMany({
        where: { tenantId, projectId, subjectId: subjectB, permission: "version:read" },
      });
      expect(removed.count).toBe(1);

      const denied = await getReleasePreflight(sessionB, 1);
      expect(denied.status).toBe(404);
      expect(denied.body.message).toBe("工程资源不存在或无权访问");
      const allowed = await getReleasePreflight(sessionA, 1);
      expect(allowed.status).toBe(200);
      expect(allowed.body.passed).toBe(true);

      const [project, versions, audits] = await Promise.all([
        database!.client.scadaProject.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId, projectId } },
        }),
        database!.client.scadaProjectVersion.count({ where: { tenantId, projectId } }),
        database!.client.scadaProjectAudit.count({ where: { tenantId, projectId } }),
      ]);
      expect(project.headRevision).toBe(1n);
      expect(versions).toBe(1);
      expect(audits).toBe(1);
    });
  });

  it("仅在随机测试租户篡改元数据摘要后预检受控失败且不追加版本", async () => {
    await withFixture(async ({ tenantId, sessionA }) => {
      const corrupted = await database!.client.scadaProjectVersion.update({
        where: { tenantId_projectId_revision: { tenantId, projectId, revision: 1n } },
        data: { contentHash: "0".repeat(64) },
      });
      expect(corrupted.contentHash).toBe("0".repeat(64));

      const response = await getReleasePreflight(sessionA, 1);
      expect(response.status).toBe(500);
      expect(response.body.statusCode).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain("Prisma");
      expect(JSON.stringify(response.body)).not.toContain("数据库工程版本元数据与快照不一致");

      const [project, versions, audits] = await Promise.all([
        database!.client.scadaProject.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId, projectId } },
        }),
        database!.client.scadaProjectVersion.count({ where: { tenantId, projectId } }),
        database!.client.scadaProjectAudit.count({ where: { tenantId, projectId } }),
      ]);
      expect(project.headRevision).toBe(1n);
      expect(versions).toBe(1);
      expect(audits).toBe(1);
    });
  });
});
