import type { PostgresClient, PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.d.js";
import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";
import { historicalAuthTransaction, type Prisma8AuthTransaction } from "./prisma8-auth-transaction-port.js";
import { Prisma8SessionOperations } from "./prisma8-session-operations.js";

type Tx = PostgresTransactionContext<Contract>;
const OPTIONS = { isolationLevel: "ReadCommitted", timeout: 10000 } as const;
const PRINCIPAL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function validPrincipal(
  principal: AuthenticatedProjectPrincipal | null | undefined,
): principal is AuthenticatedProjectPrincipal {
  return (
    principal !== null &&
    principal !== undefined &&
    typeof principal.tenantId === "string" &&
    PRINCIPAL_ID_PATTERN.test(principal.tenantId) &&
    typeof principal.subjectId === "string" &&
    PRINCIPAL_ID_PATTERN.test(principal.subjectId)
  );
}

async function requireBoundary(tx: Tx): Promise<void> {
  const rows = await tx
    .query(
      tx.raw.sql`SELECT current_database()::text AS database_name,
      current_schema()::text AS schema_name,
      current_setting('transaction_read_only') AS read_only,
      current_setting('transaction_isolation') AS isolation`
        .returnsRow({
          database_name: "pg/text@1",
          schema_name: "pg/text@1",
          read_only: "pg/text@1",
          isolation: "pg/text@1",
        })
        .build(),
    )
    .toArray();
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row?.database_name !== "adui_scada_test" ||
    row.schema_name !== "public" ||
    row.read_only !== "off" ||
    row.isolation !== "read committed"
  ) {
    throw new Error("Prisma 8 身份候选仅允许隔离库读已提交事务");
  }
}

function isValidSubject(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 32 || codeUnit > 126) return false;
  }
  return true;
}

/** 历史隔离库候选，保留原连接与主体映射门禁，不接入正式 Provider。 */
export class Prisma8AuthSessionService extends Prisma8SessionOperations {
  constructor(private readonly client: PostgresClient<Contract>) {
    const run = <T>(operation: (tx: Prisma8AuthTransaction) => Promise<T>): Promise<T> =>
      client.transaction(async (tx) => {
        await requireBoundary(tx);
        return operation(historicalAuthTransaction(tx));
      }, OPTIONS);
    super({ assertWritable: () => undefined, read: run, write: run });
  }

  /** 仅在上游已完成 OIDC 验签且固定 Issuer 一致时查询预绑定；不自动创建身份。 */
  async resolveVerifiedExternalIdentity(
    expectedIssuer: string,
    issuer: unknown,
    subject: unknown,
  ): Promise<AuthenticatedProjectPrincipal | null> {
    if (
      typeof issuer !== "string" ||
      issuer !== expectedIssuer ||
      issuer.length === 0 ||
      issuer.length > 512 ||
      !isValidSubject(subject)
    )
      return null;
    return this.client.transaction(async (tx) => {
      await requireBoundary(tx);
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
      if (rows.length !== 1 || !row) return null;
      const principal = { tenantId: row.tenant_id, subjectId: row.subject_id };
      return validPrincipal(principal) ? Object.freeze(principal) : null;
    }, OPTIONS);
  }
}
