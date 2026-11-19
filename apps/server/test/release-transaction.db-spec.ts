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
import { PrismaProjectReleaseStore } from "../src/projects/prisma-project-release-store.js";
import { ProjectReleaseSafetyGate } from "../src/projects/project-release-safety-gate.js";
import { ScadaSecurityAuditService } from "../src/security/scada-security-audit.js";

// 真实发布事务测试只允许连接本机隔离数据库，不得触碰开发库或生产库。
const testUrl = process.env.SCADA_TEST_DATABASE_URL;
if (!testUrl) throw new Error("正式发布事务数据库测试必须显式设置 SCADA_TEST_DATABASE_URL");
let parsedUrl: URL;
try {
  parsedUrl = new URL(testUrl);
} catch {
  throw new Error("正式发布事务数据库测试连接字符串格式无效");
}
if (
  !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) ||
  parsedUrl.pathname !== "/adui_scada_test" ||
  !["postgresql:", "postgres:"].includes(parsedUrl.protocol)
) {
  throw new Error("正式发布事务数据库测试仅允许连接本机 adui_scada_test 隔离数据库");
}

const originalDatabaseUrl = process.env.SCADA_DATABASE_URL;
const origin = "https://scada.example.org";
const subjectId = "test-release-engineer";

interface ReleaseFixture {
  readonly tenantId: string;
  readonly projectId: string;
  readonly session: IssuedAuthSession;
}

let app: INestApplication | undefined;
let database: PrismaService | undefined;
let sessions: AuthSessionService;
let projectStore: PrismaProjectVersionStore;

function createDocument(projectId: string, unsupported = false): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) as Record<string, unknown>;
  copy.projectId = projectId;
  if (unsupported) {
    const pages = copy.pages as Array<Record<string, unknown>>;
    const nodes = pages[0]?.nodes as Array<Record<string, unknown>>;
    const props = nodes[1]?.props as Record<string, unknown>;
    props.color = "red";
  }
  return copy;
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

function publishBody(expectedReleaseGeneration = 0) {
  return {
    expectedHeadRevision: 1,
    targetRevision: 1,
    expectedReleaseGeneration,
  };
}

function postPublish(
  fixture: ReleaseFixture,
  idempotencyKey: string,
  expectedReleaseGeneration = 0,
) {
  return request(app!.getHttpServer())
    .post("/api/v1/projects/" + fixture.projectId + "/releases")
    .set("Cookie", cookie(fixture.session))
    .set("Origin", origin)
    .set("Sec-Fetch-Site", "same-origin")
    .set("X-SCADA-CSRF", fixture.session.csrfToken)
    .set("Idempotency-Key", idempotencyKey)
    .send(publishBody(expectedReleaseGeneration));
}

/** 每项测试使用随机租户、工程与真实会话，只清理本用例写入的数据。 */
async function withFixture(
  run: (fixture: ReleaseFixture) => Promise<void>,
  options: { readonly unsupported?: boolean; readonly grantRelease?: boolean } = {},
): Promise<void> {
  const tenantId = "test-" + randomUUID();
  const projectId = "release-" + randomUUID();
  const principal = { tenantId, subjectId };
  try {
    await database!.client.scadaIdentity.create({
      data: { tenantId, subjectId, status: "active" },
    });
    const session = await sessions.issueForVerifiedSubject(principal);
    await projectStore.create(principal, {
      document: createDocument(projectId, options.unsupported),
    });
    if (options.grantRelease !== false) {
      await database!.client.scadaProjectGrant.create({
        data: {
          tenantId,
          projectId,
          subjectId,
          permission: "release:publish",
        },
      });
    }
    await run({ tenantId, projectId, session });
  } finally {
    if (database) {
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
    SCADA_OIDC_CLIENT_SECRET: "isolated-release-transaction-test-secret",
    SCADA_OIDC_REDIRECT_URI: origin + "/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: origin,
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  });
  if (!config.enabled) throw new Error("正式发布事务测试 OIDC 配置未启用");
  const moduleRef = await Test.createTestingModule({
    controllers: [ProjectApiController],
    providers: [
      { provide: PrismaService, useValue: database },
      { provide: SCADA_OIDC_STARTUP_CONFIG, useValue: config },
      AuthSessionService,
      PrismaProjectVersionStore,
      PrismaProjectReleaseStore,
      // 仅此隔离测试模块替换默认拒绝门禁，验证数据库事务本身；不改变生产 Provider。
      {
        provide: ProjectReleaseSafetyGate,
        useValue: { assertReady: async () => undefined },
      },
      ScadaSecurityAuditService,
      ScadaSessionGuard,
      ScadaProjectGuard,
      ProjectApiExceptionFilter,
      Reflector,
    ],
  }).compile();
  sessions = moduleRef.get(AuthSessionService);
  projectStore = moduleRef.get(PrismaProjectVersionStore);
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

describe("隔离 PostgreSQL 正式发布事务", () => {
  it("成功发布在同一事务内写入事件和发布指针且不修改编辑 head", async () => {
    await withFixture(async (fixture) => {
      const response = await postPublish(fixture, "release-db-success-0001");
      expect(response.status).toBe(201);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({
        projectId: fixture.projectId,
        action: "PUBLISH",
        headRevision: 1,
        releasedRevision: 1,
        releaseGeneration: 1,
      });
      expect(response.body.releasedContentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(response.body.eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      const [project, state, events] = await Promise.all([
        database!.client.scadaProject.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId: fixture.tenantId, projectId: fixture.projectId } },
        }),
        database!.client.scadaProjectReleaseState.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId: fixture.tenantId, projectId: fixture.projectId } },
        }),
        database!.client.scadaProjectReleaseEvent.findMany({
          where: { tenantId: fixture.tenantId, projectId: fixture.projectId },
        }),
      ]);
      expect(project.headRevision).toBe(1n);
      expect(state.releaseGeneration).toBe(1n);
      expect(state.releasedRevision).toBe(1n);
      expect(state.releasedContentHash).toBe(response.body.releasedContentHash);
      expect(state.lastReleaseEventId).toBe(response.body.eventId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventId: response.body.eventId,
        generation: 1n,
        action: "PUBLISH",
        toRevision: 1n,
        toContentHash: response.body.releasedContentHash,
        actorId: subjectId,
      });
    });
  });

  it("同幂等键同语义重试复用原事件，不重复推进代次", async () => {
    await withFixture(async (fixture) => {
      const first = await postPublish(fixture, "release-db-idempotent-0001");
      const second = await postPublish(fixture, "release-db-idempotent-0001");
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(
        await database!.client.scadaProjectReleaseEvent.count({
          where: { tenantId: fixture.tenantId, projectId: fixture.projectId },
        }),
      ).toBe(1);
      const state = await database!.client.scadaProjectReleaseState.findUniqueOrThrow({
        where: { tenantId_projectId: { tenantId: fixture.tenantId, projectId: fixture.projectId } },
      });
      expect(state.releaseGeneration).toBe(1n);
    });
  });

  it("同幂等键不同语义返回 409 且不追加第二条事件", async () => {
    await withFixture(async (fixture) => {
      const first = await postPublish(fixture, "release-db-conflict-0001");
      const second = await postPublish(fixture, "release-db-conflict-0001", 1);
      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(
        await database!.client.scadaProjectReleaseEvent.count({
          where: { tenantId: fixture.tenantId, projectId: fixture.projectId },
        }),
      ).toBe(1);
    });
  });

  it("同一工程相同预期代次的并发发布最多一个成功", async () => {
    await withFixture(async (fixture) => {
      const responses = await Promise.all([
        postPublish(fixture, "release-db-race-a-0001"),
        postPublish(fixture, "release-db-race-b-0001"),
      ]);
      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([
        201,
        409,
      ]);
      const [state, eventCount] = await Promise.all([
        database!.client.scadaProjectReleaseState.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId: fixture.tenantId, projectId: fixture.projectId } },
        }),
        database!.client.scadaProjectReleaseEvent.count({
          where: { tenantId: fixture.tenantId, projectId: fixture.projectId },
        }),
      ]);
      expect(state.releaseGeneration).toBe(1n);
      expect(eventCount).toBe(1);
    });
  });

  it("缺少独立发布权限时拒绝且不写入发布事件", async () => {
    await withFixture(
      async (fixture) => {
        const response = await postPublish(fixture, "release-db-denied-0001");
        expect(response.status).toBe(404);
        expect(
          await database!.client.scadaProjectReleaseEvent.count({
            where: { tenantId: fixture.tenantId, projectId: fixture.projectId },
          }),
        ).toBe(0);
      },
      { grantRelease: false },
    );
  });

  it("静态兼容性不通过时返回 422 且不改变发布状态", async () => {
    await withFixture(
      async (fixture) => {
        const response = await postPublish(fixture, "release-db-preflight-0001");
        expect(response.status).toBe(422);
        expect(response.body.issues).toHaveLength(1);
        const state = await database!.client.scadaProjectReleaseState.findUniqueOrThrow({
          where: { tenantId_projectId: { tenantId: fixture.tenantId, projectId: fixture.projectId } },
        });
        expect(state.releaseGeneration).toBe(0n);
        expect(state.releasedRevision).toBeNull();
        expect(
          await database!.client.scadaProjectReleaseEvent.count({
            where: { tenantId: fixture.tenantId, projectId: fixture.projectId },
          }),
        ).toBe(0);
      },
      { unsupported: true },
    );
  });

  it("会话撤销后拒绝发布且不写入事件", async () => {
    await withFixture(async (fixture) => {
      expect(await sessions.revokeForVerifiedSubject(
        { tenantId: fixture.tenantId, subjectId },
        fixture.session.sessionId,
      )).toBe(true);
      const response = await postPublish(fixture, "release-db-revoked-0001");
      expect(response.status).toBe(401);
      expect(
        await database!.client.scadaProjectReleaseEvent.count({
          where: { tenantId: fixture.tenantId, projectId: fixture.projectId },
        }),
      ).toBe(0);
    });
  });
});
