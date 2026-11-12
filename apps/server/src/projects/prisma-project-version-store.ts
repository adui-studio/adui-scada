import { Injectable } from "@nestjs/common";
import type { ProjectSnapshot } from "@adui/scada-core";
import {
  createProjectSnapshot,
  parseServerProjectSaveRequest,
  readProjectSnapshot,
} from "@adui/scada-core";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { hasProjectPermission } from "./project-access-policy.js";
import type {
  AuthenticatedProjectPrincipal,
  ProjectAccessAction,
} from "./project-access-policy.js";

/** 未授权与工程不存在统一拒绝，不向外暴露工程是否存在。 */
export class ProjectVersionAccessDeniedError extends Error {
  constructor() {
    super("当前主体无权访问该工程版本");
    this.name = "ProjectVersionAccessDeniedError";
  }
}

/** 预期修订号不匹配；调用方必须重新读取后显式决定如何处理。 */
export class ProjectRevisionConflictError extends Error {
  constructor() {
    super("工程版本已变化，请重新获取最新修订号");
    this.name = "ProjectRevisionConflictError";
  }
}

/** 已授权工程中查询不到指定历史修订号。 */
export class ProjectRevisionNotFoundError extends Error {
  constructor() {
    super("指定工程版本不存在");
    this.name = "ProjectRevisionNotFoundError";
  }
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const TRANSACTION_OPTIONS = { maxWait: 2000, timeout: 10000 };

function requirePrincipal(
  principal: AuthenticatedProjectPrincipal | null,
): asserts principal is AuthenticatedProjectPrincipal {
  if (
    !principal ||
    typeof principal.tenantId !== "string" ||
    !ID_PATTERN.test(principal.tenantId) ||
    typeof principal.subjectId !== "string" ||
    !ID_PATTERN.test(principal.subjectId)
  ) {
    throw new ProjectVersionAccessDeniedError();
  }
}

function requireProjectId(projectId: string): void {
  if (typeof projectId !== "string" || !ID_PATTERN.test(projectId)) {
    throw new ProjectVersionAccessDeniedError();
  }
}

/**
 * 服务端专用事务仓储，不是对外 API。
 * principal 必须由未来的受信身份层提供，不能来自客户端请求体。
 */
@Injectable()
export class PrismaProjectVersionStore {
  constructor(private readonly database: PrismaService) {}

  /** 在同一数据库事务内校验授权、CAS、追加快照、推进水位并保存成功审计。 */
  async append(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    input: unknown,
  ): Promise<ProjectSnapshot> {
    requirePrincipal(principal);
    requireProjectId(projectId);
    const request = parseServerProjectSaveRequest(input, projectId);

    return this.database.client.$transaction(async (tx) => {
      // 使用参数化查询锁住工程行；授权撤销也必须遵循相同锁顺序。
      const projects = await tx.$queryRaw<Array<{ head_revision: bigint }>>`
          SELECT head_revision FROM scada_projects
          WHERE tenant_id = ${principal.tenantId} AND project_id = ${projectId}
          FOR UPDATE
        `;
      if (projects.length !== 1) throw new ProjectVersionAccessDeniedError();

      const grants = await tx.scadaProjectGrant.findMany({
        where: {
          tenantId: principal.tenantId,
          projectId,
          subjectId: principal.subjectId,
        },
        select: { permission: true },
      });
      const permissions = grants.map((grant) => grant.permission as ProjectAccessAction);
      if (
        !hasProjectPermission(
          principal,
          { tenantId: principal.tenantId, projectId },
          {
            tenantId: principal.tenantId,
            projectId,
            subjectId: principal.subjectId,
            permissions,
          },
          "version:append",
        )
      ) {
        throw new ProjectVersionAccessDeniedError();
      }

      const head = projects[0]?.head_revision;
      if (typeof head !== "bigint" || head < 0n) {
        throw new TypeError("数据库工程修订号异常");
      }
      if (head !== BigInt(request.expectedRevision ?? 0)) {
        throw new ProjectRevisionConflictError();
      }
      if (head >= BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError("工程修订号超出安全整数范围");
      }

      const revision = Number(head + 1n);
      const snapshot = await createProjectSnapshot(request.document, {
        revision,
        createdAt: new Date().toISOString(),
      });
      // Prisma JSONB 需要可序列化的可写 JSON，不直接传入冻结的 Core 快照对象。
      const snapshotData = JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
      await tx.scadaProjectVersion.create({
        data: {
          tenantId: principal.tenantId,
          projectId,
          revision: BigInt(revision),
          snapshot: snapshotData,
          contentHash: snapshot.contentHash,
          createdBy: principal.subjectId,
          createdAt: new Date(snapshot.createdAt),
        },
      });
      await tx.scadaProject.update({
        where: { tenantId_projectId: { tenantId: principal.tenantId, projectId } },
        data: { headRevision: BigInt(revision) },
      });
      await tx.scadaProjectAudit.create({
        data: {
          tenantId: principal.tenantId,
          projectId,
          revision: BigInt(revision),
          actorId: principal.subjectId,
          action: "version:append",
        },
      });
      return snapshot;
    }, TRANSACTION_OPTIONS);
  }

  /** 读取时同样在工程锁内复查权限，并验证 JSONB 快照及数据库元数据。 */
  async read(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    revision: number,
  ): Promise<ProjectSnapshot> {
    requirePrincipal(principal);
    requireProjectId(projectId);
    if (!Number.isSafeInteger(revision) || revision <= 0) {
      throw new TypeError("查询修订号必须为大于零的安全整数");
    }

    return this.database.client.$transaction(async (tx) => {
      const projects = await tx.$queryRaw<Array<{ head_revision: bigint }>>`
          SELECT head_revision FROM scada_projects
          WHERE tenant_id = ${principal.tenantId} AND project_id = ${projectId}
          FOR SHARE
        `;
      if (projects.length !== 1) throw new ProjectVersionAccessDeniedError();

      const grants = await tx.scadaProjectGrant.findMany({
        where: {
          tenantId: principal.tenantId,
          projectId,
          subjectId: principal.subjectId,
        },
        select: { permission: true },
      });
      const permissions = grants.map((grant) => grant.permission as ProjectAccessAction);
      if (
        !hasProjectPermission(
          principal,
          { tenantId: principal.tenantId, projectId },
          {
            tenantId: principal.tenantId,
            projectId,
            subjectId: principal.subjectId,
            permissions,
          },
          "version:read",
        )
      ) {
        throw new ProjectVersionAccessDeniedError();
      }

      const row = await tx.scadaProjectVersion.findUnique({
        where: {
          tenantId_projectId_revision: {
            tenantId: principal.tenantId,
            projectId,
            revision: BigInt(revision),
          },
        },
      });
      if (!row) throw new ProjectRevisionNotFoundError();
      const snapshot = await readProjectSnapshot(row.snapshot);
      if (
        snapshot.projectId !== projectId ||
        snapshot.revision !== revision ||
        snapshot.contentHash !== row.contentHash ||
        snapshot.createdAt !== row.createdAt.toISOString()
      ) {
        throw new TypeError("数据库工程版本元数据与快照不一致");
      }
      return snapshot;
    }, TRANSACTION_OPTIONS);
  }
}
