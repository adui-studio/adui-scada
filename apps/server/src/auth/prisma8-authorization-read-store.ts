import { Injectable } from "@nestjs/common";
import { Prisma8Service } from "../database/prisma8.service.js";
import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";
import {
  copyAuthorizationPrincipal,
  isAuthorizationIdentifier,
  isExternalIdentityKey,
  type AuthorizationReadStore,
} from "./authorization-read-store.js";

/** 使用新原生 Contract 的真实只读仓储，不复用旧隔离库客户端或扩大写入范围。 */
@Injectable()
export class Prisma8AuthorizationReadStore implements AuthorizationReadStore {
  constructor(private readonly database: Prisma8Service) {}

  async findActiveExternalIdentity(
    issuer: string,
    subject: string,
  ): Promise<AuthenticatedProjectPrincipal | null> {
    if (!isExternalIdentityKey(issuer, subject)) return null;
    return this.database.readTransaction(async (tx) => {
      const rows = await tx
        .query(
          tx.raw.sql`SELECT e.tenant_id::text AS tenant_id, e.subject_id::text AS subject_id
          FROM public.scada_external_identities e
          JOIN public.scada_identities i ON i.tenant_id = e.tenant_id AND i.subject_id = e.subject_id
          WHERE e.issuer = ${issuer} AND e.subject = ${subject} AND i.status = 'active'`
            .returnsRow({ tenant_id: "pg/text@1", subject_id: "pg/text@1" })
            .build(),
        )
        .toArray();
      const row = rows[0];
      return rows.length === 1 && row
        ? copyAuthorizationPrincipal(row.tenant_id, row.subject_id)
        : null;
    });
  }

  async readProjectGrants(
    principal: AuthenticatedProjectPrincipal,
    projectId: string,
  ): Promise<readonly { readonly permission: string }[]> {
    const actor = copyAuthorizationPrincipal(principal.tenantId, principal.subjectId);
    if (!actor || !isAuthorizationIdentifier(projectId)) return [];
    return this.database.readTransaction(async (tx) => {
      // 完整权限投影交给原纯策略判断，不能按请求操作预过滤未知权限。
      return await tx.orm.public.ScadaProjectGrant.where({
        tenantId: actor.tenantId,
        projectId,
        subjectId: actor.subjectId,
      })
        .select("permission")
        .all();
    });
  }
}
