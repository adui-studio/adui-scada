import type { PostgresClient, PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.d.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import type { OidcProviderDiscoveryService } from "./oidc-provider-discovery.service.js";
import {
  historicalAuthTransaction,
  type Prisma8AuthTransaction,
} from "./prisma8-auth-transaction-port.js";
import { Prisma8OidcLoginOperations } from "./prisma8-oidc-login-operations.js";

const TRANSACTION_DATABASE_TIMEOUT_MS = 5_000;
type Tx = PostgresTransactionContext<Contract>;
const OPTIONS = {
  isolationLevel: "ReadCommitted",
  timeout: TRANSACTION_DATABASE_TIMEOUT_MS,
} as const;
const TEST_ISSUER_PATTERN =
  /^https:\/\/id\.example\.org\/realms\/prisma8-oidc-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
    throw new Error("Prisma 8 OIDC 候选仅允许隔离库读已提交事务");
  }
}

/** 历史隔离库候选继续限制专用测试 Issuer 与原隔离库，禁止借原生端口放宽旧门禁。 */
export class Prisma8OidcLoginTransactionService extends Prisma8OidcLoginOperations {
  constructor(
    client: PostgresClient<Contract>,
    discovery: Pick<OidcProviderDiscoveryService, "getConfiguration">,
    startupConfig: EnabledOidcConfig,
  ) {
    if (!TEST_ISSUER_PATTERN.test(startupConfig.issuer.href)) {
      throw new Error("Prisma 8 OIDC 候选仅允许随机专用测试 Issuer");
    }
    const run = <T>(operation: (tx: Prisma8AuthTransaction) => Promise<T>): Promise<T> =>
      client.transaction(async (tx) => {
        await requireBoundary(tx);
        return operation(historicalAuthTransaction(tx));
      }, OPTIONS);
    super(
      { assertWritable: () => undefined, read: run, write: run },
      discovery,
      startupConfig,
      true,
    );
  }
}
