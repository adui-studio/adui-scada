import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PrismaService } from "../database/prisma.service.js";
import { AuthSessionService } from "./auth-session.service.js";
import { SCADA_PROJECT_PERMISSION, ScadaProjectGuard } from "./scada-project.guard.js";
import type { ScadaAuthenticatedRequest } from "./scada-session.guard.js";
import { ScadaSessionGuard } from "./scada-session.guard.js";

const principal = { tenantId: "tenant-a", subjectId: "engineer-1" };

interface StoredSession {
  sessionId: string;
  tenantId: string;
  subjectId: string;
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  identity: { status: string };
}

function makeSessionService() {
  let status = "active";
  const sessions = new Map<string, StoredSession>();
  const client = {
    scadaIdentity: {
      findUnique: async (args: {
        where: { tenantId_subjectId: { tenantId: string; subjectId: string } };
      }) => {
        const { tenantId, subjectId } = args.where.tenantId_subjectId;
        return tenantId === principal.tenantId && subjectId === principal.subjectId
          ? { status }
          : null;
      },
    },
    scadaAuthSession: {
      create: async (args: {
        data: { tenantId: string; subjectId: string; tokenHash: string; expiresAt: Date };
      }) => {
        const session: StoredSession = {
          ...args.data,
          sessionId: randomUUID(),
          issuedAt: new Date(),
          revokedAt: null,
          identity: { status },
        };
        sessions.set(session.tokenHash, session);
        return { sessionId: session.sessionId, expiresAt: session.expiresAt };
      },
      findUnique: async (args: { where: { tokenHash: string } }) => {
        const session = sessions.get(args.where.tokenHash);
        return session ? { ...session, identity: { status } } : null;
      },
      updateMany: async (args: {
        where: { sessionId: string; tenantId: string; subjectId: string; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        const session = [...sessions.values()].find(
          (row) =>
            row.sessionId === args.where.sessionId &&
            row.tenantId === args.where.tenantId &&
            row.subjectId === args.where.subjectId &&
            row.revokedAt === null,
        );
        if (session) session.revokedAt = args.data.revokedAt;
        return { count: session ? 1 : 0 };
      },
    },
  };
  return {
    service: new AuthSessionService({ client } as unknown as PrismaService),
    sessions,
    disable: () => {
      status = "disabled";
    },
  };
}

function context(
  request: ScadaAuthenticatedRequest,
  action?: "project:read" | "version:read" | "version:append",
): ExecutionContext {
  const handler = () => undefined;
  if (action) Reflect.defineMetadata(SCADA_PROJECT_PERMISSION, action, handler);
  return {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => class TestRoute {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("可信会话与工程 Guard", () => {
  it("签发高熵会话时只将摘要保存到数据库", async () => {
    const fake = makeSessionService();
    const issued = await fake.service.issueForVerifiedSubject(principal);
    expect(issued.token).toMatch(/^scada_s_[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const hash = createHash("sha256").update(issued.token).digest("hex");
    expect(fake.sessions.get(hash)?.tokenHash).toBe(hash);
    expect(fake.sessions.get(issued.token)).toBeUndefined();
    expect(await fake.service.authenticate(issued.token)).toEqual(principal);
  });

  it("不存在的主体、无效主体和禁用主体均不能签发会话", async () => {
    const fake = makeSessionService();
    await expect(
      fake.service.issueForVerifiedSubject({ tenantId: "tenant-b", subjectId: "engineer-1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      fake.service.issueForVerifiedSubject({ tenantId: "../x", subjectId: "engineer-1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    fake.disable();
    await expect(fake.service.issueForVerifiedSubject(principal)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("被撤销的会话即时失效且不能被别的租户撤销", async () => {
    const fake = makeSessionService();
    const issued = await fake.service.issueForVerifiedSubject(principal);
    expect(
      await fake.service.revokeForVerifiedSubject(
        { tenantId: "tenant-b", subjectId: principal.subjectId },
        issued.sessionId,
      ),
    ).toBe(false);
    expect(await fake.service.authenticate(issued.token)).toEqual(principal);
    expect(await fake.service.revokeForVerifiedSubject(principal, issued.sessionId)).toBe(true);
    expect(await fake.service.authenticate(issued.token)).toBeNull();
    expect(await fake.service.revokeForVerifiedSubject(principal, issued.sessionId)).toBe(false);
  });

  it("到期令牌和停用主体不能通过服务端验证", async () => {
    const fake = makeSessionService();
    const issued = await fake.service.issueForVerifiedSubject(principal);
    fake.disable();
    expect(await fake.service.authenticate(issued.token)).toBeNull();

    const second = makeSessionService();
    const token = await second.service.issueForVerifiedSubject(principal);
    const hash = createHash("sha256").update(token.token).digest("hex");
    second.sessions.get(hash)!.expiresAt = new Date(Date.now() - 1000);
    expect(await second.service.authenticate(token.token)).toBeNull();
  });

  it("伪造、空值或错误格式的令牌不执行数据库查询", async () => {
    const fake = makeSessionService();
    for (const candidate of [null, undefined, 12, "", "fake", "scada_s_incomplete"]) {
      expect(await fake.service.authenticate(candidate)).toBeNull();
    }
    expect(fake.sessions.size).toBe(0);
  });

  it("会话 Guard 拒绝缺失、重复或伪造的 Bearer 请求头", async () => {
    const fake = makeSessionService();
    const guard = new ScadaSessionGuard(fake.service);
    for (const header of [undefined, ["Bearer fake"], "Basic fake", "Bearer fake"]) {
      await expect(
        guard.canActivate(context({ headers: { authorization: header } })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it("会话 Guard 将数据库验证后的租户和主体写入请求上下文", async () => {
    const fake = makeSessionService();
    const issued = await fake.service.issueForVerifiedSubject(principal);
    const guard = new ScadaSessionGuard(fake.service);
    const request: ScadaAuthenticatedRequest = {
      headers: { authorization: `Bearer ${issued.token}` },
    };
    expect(await guard.canActivate(context(request))).toBe(true);
    expect(request.scadaPrincipal).toEqual(principal);
  });

  it("工程 Guard 缺少权限元数据时默认拒绝", async () => {
    const db = { client: { scadaProjectGrant: { findMany: async () => [] } } };
    const guard = new ScadaProjectGuard(db as unknown as PrismaService, new Reflector());
    await expect(
      guard.canActivate(
        context({ headers: {}, params: { projectId: "project-a" }, scadaPrincipal: principal }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("工程 Guard 拒绝无身份、跨租户路径和无对应工程权限", async () => {
    let queries = 0;
    const db = {
      client: {
        scadaProjectGrant: {
          findMany: async () => {
            queries += 1;
            return [{ permission: "version:read" }];
          },
        },
      },
    };
    const guard = new ScadaProjectGuard(db as unknown as PrismaService, new Reflector());
    await expect(
      guard.canActivate(
        context({ headers: {}, params: { projectId: "project-a" } }, "version:read"),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(
        context(
          {
            headers: {},
            params: {
              tenantId: "tenant-b",
              projectId: "project-a",
            },
            scadaPrincipal: principal,
          },
          "version:read",
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queries).toBe(0);
  });

  it("工程 Guard 仅授予当前租户、主体、工程匹配的精确操作", async () => {
    const seen: unknown[] = [];
    const db = {
      client: {
        scadaProjectGrant: {
          findMany: async (query: unknown) => {
            seen.push(query);
            return [{ permission: "version:read" }];
          },
        },
      },
    };
    const guard = new ScadaProjectGuard(db as unknown as PrismaService, new Reflector());
    const request: ScadaAuthenticatedRequest = {
      headers: {},
      params: { projectId: "project-a" },
      scadaPrincipal: principal,
    };
    expect(await guard.canActivate(context(request, "version:read"))).toBe(true);
    await expect(guard.canActivate(context(request, "version:append"))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(seen[0]).toEqual({
      where: {
        tenantId: principal.tenantId,
        projectId: "project-a",
        subjectId: principal.subjectId,
      },
      select: { permission: true },
    });
  });
});
