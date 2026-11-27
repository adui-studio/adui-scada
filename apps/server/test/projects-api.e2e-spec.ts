import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { waterTreatmentDemoDocument, createProjectSnapshot } from "@adui/scada-core";
import type { ProjectSnapshot, ProjectVersionSummary } from "@adui/scada-core";
import { resolveOidcStartupConfig } from "../src/config/oidc-startup.config.js";
import { AuthSessionService } from "../src/auth/auth-session.service.js";
import type {
  AuthenticatedSession,
  CookieSessionAuthenticationResult,
} from "../src/auth/auth-session.service.js";
import {
  SCADA_CSRF_COOKIE_NAME,
  SCADA_SESSION_COOKIE_NAME,
} from "../src/auth/scada-auth-cookie.js";
import { ScadaProjectGuard } from "../src/auth/scada-project.guard.js";
import { ScadaSessionGuard } from "../src/auth/scada-session.guard.js";
import { SCADA_OIDC_STARTUP_CONFIG } from "../src/auth/oidc-provider-discovery.service.js";
import type {
  AuthenticatedProjectPrincipal,
  ProjectAccessAction,
} from "../src/projects/project-access-policy.js";
import {
  PrismaProjectVersionStore,
  ProjectRevisionConflictError,
  ProjectAlreadyExistsError,
  ProjectRequestValidationError,
} from "../src/projects/prisma-project-version-store.js";
import type {
  ProjectSummary,
  ProjectReleasePreflightSummary,
} from "../src/projects/prisma-project-version-store.js";
import { ProjectApiController } from "../src/projects/project-api.controller.js";
import { PrismaProjectReleaseStore } from "../src/projects/prisma-project-release-store.js";
import type {
  ProjectCurrentReleaseResult,
  ProjectReleaseResult,
} from "../src/projects/prisma-project-release-store.js";
import { ProjectReleaseGateUnavailableError } from "../src/projects/project-release-safety-gate.js";
import { ProjectApiExceptionFilter } from "../src/projects/project-api.exception-filter.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AuthorizationReadStore } from "../src/auth/authorization-read-store.js";
import { Prisma7AuthorizationReadStore } from "../src/auth/prisma7-authorization-read-store.js";
import { ScadaSecurityAuditService } from "../src/security/scada-security-audit.js";
import type { SecurityAuditDecision } from "../src/security/scada-security-audit.js";

const PRINCIPAL: AuthenticatedProjectPrincipal = {
  tenantId: "tenant-a",
  subjectId: "engineer-a",
};
const SESSION_TOKEN = "scada_s_" + "s".repeat(43);
const CSRF_TOKEN = "scada_csrf_" + "c".repeat(43);
const SESSION_ID = "9b0d8c2d-6d45-4f0f-8d5c-12e4a0d3a7a1";
const ORIGIN = "https://scada.example.org";
const PROJECT_ID = waterTreatmentDemoDocument.projectId;
const PROJECT_SUMMARY: ProjectSummary = {
  projectId: PROJECT_ID,
  headRevision: 1,
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z",
};

function createConfig() {
  const config = resolveOidcStartupConfig({
    NODE_ENV: "test",
    SCADA_OIDC_ENABLED: "true",
    SCADA_OIDC_ISSUER: "https://id.example.org/realms/scada",
    SCADA_OIDC_CLIENT_ID: "adui-scada",
    SCADA_OIDC_CLIENT_SECRET: "controller-test-client-secret",
    SCADA_OIDC_REDIRECT_URI: ORIGIN + "/api/v1/auth/oidc/callback",
    SCADA_OIDC_WEB_ORIGINS: ORIGIN,
    SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  });
  if (!config.enabled) throw new Error("测试 OIDC 配置未启用");
  return config;
}

describe("工程 API HTTP 接口（端到端）", () => {
  let app: INestApplication;
  let snapshot: ProjectSnapshot;
  let permissions: readonly ProjectAccessAction[] = [
    "project:read",
    "version:read",
    "version:append",
  ];

  const versionSummary: ProjectVersionSummary = {
    projectId: PROJECT_ID,
    revision: 1,
    createdAt: PROJECT_SUMMARY.createdAt,
    contentHash: "a".repeat(64),
  };

  const store = {
    create: vi.fn<
      (principal: AuthenticatedProjectPrincipal | null, input: unknown) => Promise<ProjectSummary>
    >(async () => PROJECT_SUMMARY),
    list: vi.fn<
      (
        principal: AuthenticatedProjectPrincipal | null,
        query?: unknown,
      ) => Promise<readonly ProjectSummary[]>
    >(async () => [PROJECT_SUMMARY]),
    getProject: vi.fn<
      (
        principal: AuthenticatedProjectPrincipal | null,
        projectId: string,
      ) => Promise<ProjectSummary>
    >(async () => PROJECT_SUMMARY),
    listVersions: vi.fn<
      (
        principal: AuthenticatedProjectPrincipal | null,
        projectId: string,
        query?: unknown,
      ) => Promise<readonly ProjectVersionSummary[]>
    >(async () => [versionSummary]),
    read: vi.fn<
      (
        principal: AuthenticatedProjectPrincipal | null,
        projectId: string,
        revision: number,
      ) => Promise<ProjectSnapshot>
    >(async () => snapshot),
    preflightRelease: vi.fn<
      (
        principal: AuthenticatedProjectPrincipal | null,
        projectId: string,
        revision: number,
      ) => Promise<ProjectReleasePreflightSummary>
    >(async () => ({
      projectId: PROJECT_ID,
      revision: 1,
      headRevision: 1,
      contentHash: snapshot.contentHash,
      passed: true,
      issues: [],
    })),
    append: vi.fn<
      (
        principal: AuthenticatedProjectPrincipal | null,
        projectId: string,
        input: unknown,
      ) => Promise<ProjectSnapshot>
    >(async () => snapshot),
  };

  const releaseResult: ProjectReleaseResult = {
    projectId: PROJECT_ID,
    action: "PUBLISH",
    headRevision: 1,
    releasedRevision: 1,
    releasedContentHash: "a".repeat(64),
    releaseGeneration: 1,
    eventId: "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e8",
    createdAt: "2026-11-19T00:00:00.000Z",
  };
  const currentReleaseResult: ProjectCurrentReleaseResult = {
    status: "UNRELEASED",
    projectId: PROJECT_ID,
    releaseGeneration: 0,
  };
  const releases = {
    readCurrent: vi.fn<
      (
        principal: AuthenticatedProjectPrincipal | null,
        sessionId: string | null,
        projectId: string,
      ) => Promise<ProjectCurrentReleaseResult>
    >(async () => currentReleaseResult),
    publish: vi.fn<
      (
        principal: AuthenticatedProjectPrincipal | null,
        sessionId: string | null,
        projectId: string,
        input: unknown,
        idempotencyKey: unknown,
      ) => Promise<ProjectReleaseResult>
    >(async () => releaseResult),
  };

  const sessions = {
    authenticateWithSession: vi.fn<(token: unknown) => Promise<AuthenticatedSession | null>>(
      async (token) =>
        token === SESSION_TOKEN ? { sessionId: SESSION_ID, principal: PRINCIPAL } : null,
    ),
    authenticateCookieSession: vi.fn<
      (token: unknown, csrfToken?: unknown) => Promise<CookieSessionAuthenticationResult>
    >(async (token, csrfToken) => {
      if (token !== SESSION_TOKEN) {
        return { authenticated: false, reason: "invalid_session" };
      }
      if (csrfToken !== undefined && csrfToken !== CSRF_TOKEN) {
        return { authenticated: false, reason: "csrf_rejected" };
      }
      return { authenticated: true, sessionId: SESSION_ID, principal: PRINCIPAL };
    }),
  };

  const grantLookup = vi.fn<(args: unknown) => Promise<Array<{ readonly permission: string }>>>(
    async () => permissions.map((permission) => ({ permission })),
  );
  const auditRecords: SecurityAuditDecision[] = [];
  const audit = {
    record(decision: SecurityAuditDecision) {
      auditRecords.push(decision);
    },
  };
  const database = {
    client: {
      scadaProjectGrant: { findMany: grantLookup },
    },
  };

  beforeAll(async () => {
    snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
      revision: 1,
      createdAt: PROJECT_SUMMARY.createdAt,
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectApiController],
      providers: [
        { provide: PrismaProjectVersionStore, useValue: store },
        { provide: PrismaProjectReleaseStore, useValue: releases },
        { provide: AuthSessionService, useValue: sessions },
        { provide: PrismaService, useValue: database },
        { provide: AuthorizationReadStore, useClass: Prisma7AuthorizationReadStore },
        { provide: ScadaSecurityAuditService, useValue: audit },
        { provide: SCADA_OIDC_STARTUP_CONFIG, useValue: createConfig() },
        ScadaSessionGuard,
        ScadaProjectGuard,
        ProjectApiExceptionFilter,
        Reflector,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    permissions = ["project:read", "version:read", "version:append"];
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("未认证请求不能读取工程列表", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/projects").expect(401);

    expect(response.status).toBe(401);
    expect(store.list).not.toHaveBeenCalled();
  });

  it("认证主体只能读取当前租户的工程摘要列表", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(200);

    expect(response.body).toEqual([PROJECT_SUMMARY]);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(store.list).toHaveBeenCalledWith(PRINCIPAL, {});
  });

  it("工程列表 HTTP 转发分页数量与安全游标", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects")
      .query({ limit: 5, afterProjectId: "previous-project" })
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(200);

    expect(response.status).toBe(200);
    expect(store.list).toHaveBeenCalledWith(PRINCIPAL, {
      limit: "5",
      afterProjectId: "previous-project",
    });
  });

  it("工程列表分页错误映射为受控 HTTP 400", async () => {
    store.list.mockRejectedValueOnce(
      new ProjectRequestValidationError("工程列表每页数量不能超过 100 条"),
    );
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects")
      .query({ limit: 101 })
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(400);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("工程列表每页数量不能超过 100 条");
  });

  it("工程详情必须通过 project:read 权限", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID)
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(200);

    expect(response.body).toEqual(PROJECT_SUMMARY);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(store.getProject).toHaveBeenCalledWith(PRINCIPAL, PROJECT_ID);
  });

  it("历史版本列表转发 limit 与 beforeRevision 参数", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/versions")
      .query({ limit: 10, beforeRevision: 3 })
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(200);

    expect(response.body).toEqual([versionSummary]);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(store.listVersions).toHaveBeenCalledWith(PRINCIPAL, PROJECT_ID, {
      limit: "10",
      beforeRevision: "3",
    });
  });

  it("历史版本读取返回完整快照", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/versions/1")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(200);

    expect(response.body).toEqual(snapshot);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(store.read).toHaveBeenCalledWith(PRINCIPAL, PROJECT_ID, 1);
  });

  it("创建工程通过可信会话建立首版快照", async () => {
    const body = { document: JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) };
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .send(body)
      .expect(201);

    expect(response.body).toEqual(PROJECT_SUMMARY);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(store.create).toHaveBeenCalledWith(PRINCIPAL, body);
  });

  it("追加历史版本通过会话与 version:append ACL", async () => {
    const body = {
      expectedRevision: 1,
      document: JSON.parse(JSON.stringify(waterTreatmentDemoDocument)),
    };
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects/" + PROJECT_ID + "/versions")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .send(body)
      .expect(201);

    expect(response.body).toEqual(snapshot);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(store.append).toHaveBeenCalledWith(PRINCIPAL, PROJECT_ID, body);
  });

  it("缺少工程权限时统一返回 404 且不进入仓储", async () => {
    permissions = [];
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID)
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(404);

    expect(response.status).toBe(404);
    expect(store.getProject).not.toHaveBeenCalled();
  });

  it("Cookie 写请求缺少 CSRF Header 时拒绝创建工程", async () => {
    const cookie =
      SCADA_SESSION_COOKIE_NAME +
      "=" +
      SESSION_TOKEN +
      "; " +
      SCADA_CSRF_COOKIE_NAME +
      "=" +
      CSRF_TOKEN;
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .set("Sec-Fetch-Site", "same-origin")
      .send({ document: JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) })
      .expect(403);

    expect(response.status).toBe(403);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("Cookie 写请求通过 CSRF 双提交后允许创建工程", async () => {
    const cookie =
      SCADA_SESSION_COOKIE_NAME +
      "=" +
      SESSION_TOKEN +
      "; " +
      SCADA_CSRF_COOKIE_NAME +
      "=" +
      CSRF_TOKEN;
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .set("Sec-Fetch-Site", "same-origin")
      .set("X-SCADA-CSRF", CSRF_TOKEN)
      .send({ document: JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) })
      .expect(201);

    expect(response.status).toBe(201);
    expect(store.create).toHaveBeenCalledTimes(1);
  });

  it("CAS 冲突映射为 HTTP 409", async () => {
    store.append.mockRejectedValueOnce(new ProjectRevisionConflictError());
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects/" + PROJECT_ID + "/versions")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .send({
        expectedRevision: 0,
        document: JSON.parse(JSON.stringify(waterTreatmentDemoDocument)),
      })
      .expect(409);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe("工程版本已变化，请重新获取最新修订号");
  });

  it("最终快照添加版本元数据后超限仍返回受控 HTTP 400", async () => {
    store.create.mockRejectedValueOnce(
      new ProjectRequestValidationError("工程版本快照超过 2 MiB 限制"),
    );
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .send({ document: JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) })
      .expect(400);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("工程版本快照超过 2 MiB 限制");
    expect(JSON.stringify(response.body)).not.toContain("Prisma");
  });

  it("非法历史修订号返回 400，仓储不得读取", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/versions/0")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(400);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("修订号");
    expect(store.read).not.toHaveBeenCalled();
  });

  it("创建重复工程映射为 409 且不会返回内部 Prisma 错误", async () => {
    store.create.mockRejectedValueOnce(new ProjectAlreadyExistsError());
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .send({ document: JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) })
      .expect(409);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe("当前租户下已存在相同工程标识的工程");
    expect(JSON.stringify(response.body)).not.toContain("Prisma");
  });

  it("受保护只读预检返回最小报告，不泄漏快照或创建版本", async () => {
    permissions = ["version:read"];
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/versions/1/release-preflight")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(200);

    expect(response.body).toEqual({
      projectId: PROJECT_ID,
      revision: 1,
      headRevision: 1,
      contentHash: snapshot.contentHash,
      passed: true,
      issues: [],
    });
    expect(response.body).not.toHaveProperty("document");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(store.preflightRelease).toHaveBeenCalledWith(PRINCIPAL, PROJECT_ID, 1);
    expect(store.append).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
  });

  it("发布预检没有可信会话时返回 401 而不调用仓储", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/versions/1/release-preflight")
      .expect(401);

    expect(response.status).toBe(401);
    expect(store.preflightRelease).not.toHaveBeenCalled();
  });

  it("发布预检缺少版本读取权限时返回 404 且不暴露工程存在性", async () => {
    permissions = ["project:read"];
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/versions/1/release-preflight")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(404);

    expect(response.status).toBe(404);
    expect(store.preflightRelease).not.toHaveBeenCalled();
  });

  it("当前发布读取只接受独立 release:read 并返回未发布状态", async () => {
    permissions = ["release:read"];
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/releases/current")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(200);

    expect(response.body).toEqual(currentReleaseResult);
    expect(response.body).not.toHaveProperty("headRevision");
    expect(response.body).not.toHaveProperty("document");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(releases.readCurrent).toHaveBeenCalledWith(PRINCIPAL, SESSION_ID, PROJECT_ID);
  });

  it("工程读取或历史版本读取权限不能继承 release:read", async () => {
    permissions = ["project:read", "version:read", "version:append"];
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/releases/current")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(404);

    expect(response.status).toBe(404);
    expect(releases.readCurrent).not.toHaveBeenCalled();
  });

  it("当前发布读取没有可信会话时返回 401 且不进入仓储", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/releases/current")
      .expect(401);

    expect(response.status).toBe(401);
    expect(releases.readCurrent).not.toHaveBeenCalled();
  });

  it("正式发布必须具有独立 release:publish 权限并使用服务端会话上下文", async () => {
    permissions = ["release:publish"];
    const body = {
      expectedHeadRevision: 1,
      targetRevision: 1,
      expectedReleaseGeneration: 0,
    };
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects/" + PROJECT_ID + "/releases")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .set("Idempotency-Key", "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e8")
      .send(body)
      .expect(201);

    expect(response.status).toBe(201);
    expect(response.body).toEqual(releaseResult);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(releases.publish).toHaveBeenCalledWith(
      PRINCIPAL,
      SESSION_ID,
      PROJECT_ID,
      body,
      "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e8",
    );
  });

  it("缺少 release:publish 时统一返回 404 且不进入发布仓储", async () => {
    permissions = ["project:read", "version:read", "version:append"];
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects/" + PROJECT_ID + "/releases")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .set("Idempotency-Key", "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4e9")
      .send({
        expectedHeadRevision: 1,
        targetRevision: 1,
        expectedReleaseGeneration: 0,
      })
      .expect(404);

    expect(response.status).toBe(404);
    expect(releases.publish).not.toHaveBeenCalled();
  });

  it("正式发布 Cookie 写请求缺少 CSRF Header 时拒绝执行", async () => {
    const cookie =
      SCADA_SESSION_COOKIE_NAME +
      "=" +
      SESSION_TOKEN +
      "; " +
      SCADA_CSRF_COOKIE_NAME +
      "=" +
      CSRF_TOKEN;
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects/" + PROJECT_ID + "/releases")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .set("Sec-Fetch-Site", "same-origin")
      .set("Idempotency-Key", "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4ea")
      .send({
        expectedHeadRevision: 1,
        targetRevision: 1,
        expectedReleaseGeneration: 0,
      })
      .expect(403);

    expect(response.status).toBe(403);
    expect(releases.publish).not.toHaveBeenCalled();
  });

  it("工业安全门禁尚未就绪时返回 503 且不泄漏内部细节", async () => {
    permissions = ["release:publish"];
    releases.publish.mockRejectedValueOnce(
      new ProjectReleaseGateUnavailableError([
        { code: "TAG_SOURCE_UNVERIFIED", path: "snapshot.document.tags" },
        { code: "RUNTIME_ADMISSION_UNAVAILABLE", path: "runtime" },
        { code: "INDUSTRIAL_READ_POLICY_UNAVAILABLE", path: "industrial" },
      ]),
    );
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects/" + PROJECT_ID + "/releases")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .set("Idempotency-Key", "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4eb")
      .send({
        expectedHeadRevision: 1,
        targetRevision: 1,
        expectedReleaseGeneration: 0,
      })
      .expect(503);

    expect(response.status).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      statusCode: 503,
      message: "正式发布安全门禁尚未完成，当前请求已被安全拒绝",
    });
    expect(JSON.stringify(response.body)).not.toContain("Prisma");
    expect(JSON.stringify(response.body)).not.toContain("TAG_SOURCE_UNVERIFIED");
    expect(JSON.stringify(response.body)).not.toContain("snapshot.document.tags");
  });

  it("安全评估异常经正式发布 HTTP 路由只返回固定 503，不泄漏内部阻塞", async () => {
    permissions = ["release:publish"];
    releases.publish.mockRejectedValueOnce(
      new ProjectReleaseGateUnavailableError([
        { code: "SAFETY_ASSESSMENT_UNAVAILABLE", path: "assessment" },
      ]),
    );
    const response = await request(app.getHttpServer())
      .post("/api/v1/projects/" + PROJECT_ID + "/releases")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .set("Idempotency-Key", "b2f8a51c-03c6-4e6c-a4d0-4d7f6ef4a4ec")
      .send({
        expectedHeadRevision: 1,
        targetRevision: 1,
        expectedReleaseGeneration: 0,
      })
      .expect(503);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      statusCode: 503,
      message: "正式发布安全门禁尚未完成，当前请求已被安全拒绝",
    });
    expect(JSON.stringify(response.body)).not.toContain("SAFETY_ASSESSMENT_UNAVAILABLE");
    expect(JSON.stringify(response.body)).not.toContain("assessment");
    expect(releases.publish).toHaveBeenCalledTimes(1);
    expect(store.append).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
  });

  it("过期修订号返回 409，非法修订号返回 400，均不修改工程", async () => {
    store.preflightRelease.mockRejectedValueOnce(new ProjectRevisionConflictError());
    const stale = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/versions/1/release-preflight")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(409);

    expect(stale.body.message).toBe("工程版本已变化，请重新获取最新修订号");
    const invalid = await request(app.getHttpServer())
      .get("/api/v1/projects/" + PROJECT_ID + "/versions/0/release-preflight")
      .set("Authorization", "Bearer " + SESSION_TOKEN)
      .expect(400);
    expect(invalid.body.message).toContain("修订号");
    expect(store.preflightRelease).toHaveBeenCalledTimes(1);
    expect(store.append).not.toHaveBeenCalled();
  });
});
