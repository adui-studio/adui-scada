import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";
import {
  copyAuthorizationPrincipal,
  isAuthorizationIdentifier,
  isExternalIdentityKey,
  type AuthorizationReadStore,
} from "./authorization-read-store.js";

/** 旧 HTTP 根模块过渡实现，保留原有联合键和授权投影，不连接新原生契约。 */
@Injectable()
export class Prisma7AuthorizationReadStore implements AuthorizationReadStore {
  constructor(private readonly database: PrismaService) {}

  async findActiveExternalIdentity(
    issuer: string,
    subject: string,
  ): Promise<AuthenticatedProjectPrincipal | null> {
    if (!isExternalIdentityKey(issuer, subject)) return null;
    const identity = await this.database.client.scadaExternalIdentity.findUnique({
      where: { issuer_subject: { issuer, subject } },
      select: { tenantId: true, subjectId: true, identity: { select: { status: true } } },
    });
    return identity?.identity.status === "active"
      ? copyAuthorizationPrincipal(identity.tenantId, identity.subjectId)
      : null;
  }

  async readProjectGrants(
    principal: AuthenticatedProjectPrincipal,
    projectId: string,
  ): Promise<readonly { readonly permission: string }[]> {
    const actor = copyAuthorizationPrincipal(principal.tenantId, principal.subjectId);
    if (!actor || !isAuthorizationIdentifier(projectId)) return [];
    return this.database.client.scadaProjectGrant.findMany({
      where: { tenantId: actor.tenantId, projectId, subjectId: actor.subjectId },
      select: { permission: true },
    });
  }
}
