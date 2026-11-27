import type { PostgresClient, PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8-runtime/contract.d.js";
import {
  requirePrisma8RuntimeIdentity,
  type Prisma8RuntimeConfig,
} from "./prisma8-runtime-boundary.js";

export type Prisma8Transaction = PostgresTransactionContext<Contract>;
const OPTIONS = { isolationLevel: "ReadCommitted", timeout: 10000 } as const;

/** 在同一实际事务内验证数据库、角色、标记与连接模式，而不是仅信任启动探针。 */
async function verifyReadBoundary(
  tx: Prisma8Transaction,
  config: Prisma8RuntimeConfig,
  storageHash: string,
): Promise<void> {
  const rows = await tx
    .query(
      tx.raw.sql`SELECT current_database()::text AS database,
        current_user::text AS role, session_user::text AS "sessionRole",
        current_schema()::text AS schema, current_setting('server_version_num') AS version,
        (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier",
        COALESCE((SELECT core_hash::text FROM prisma_contract.marker WHERE space = 'app'), '') AS "storageHash",
        current_setting('transaction_read_only') AS "readOnly",
        current_setting('default_transaction_read_only') AS "defaultReadOnly",
        pg_catalog.pg_is_in_recovery()::text AS recovery,
        current_setting('transaction_isolation') AS isolation`
        .returnsRow({
          database: "pg/text@1",
          role: "pg/text@1",
          sessionRole: "pg/text@1",
          schema: "pg/text@1",
          version: "pg/text@1",
          systemIdentifier: "pg/text@1",
          storageHash: "pg/text@1",
          readOnly: "pg/text@1",
          defaultReadOnly: "pg/text@1",
          recovery: "pg/text@1",
          isolation: "pg/text@1",
        })
        .build(),
    )
    .toArray();
  if (rows.length !== 1 || rows[0]?.isolation !== "read committed") {
    throw new Error("Prisma 8 业务查询事务隔离边界不一致");
  }
  requirePrisma8RuntimeIdentity(
    rows.map((row) => ({ ...row, recovery: row.recovery !== "false" })),
    config,
    storageHash,
  );
}

/** 查询前后在同一事务复核，任一边界异常均不返回业务查询结果。 */
export async function readPrisma8Transaction<T>(
  client: PostgresClient<Contract>,
  config: Prisma8RuntimeConfig,
  storageHash: string,
  operation: (tx: Prisma8Transaction) => Promise<T>,
): Promise<T> {
  return client.transaction(async (tx) => {
    await verifyReadBoundary(tx, config, storageHash);
    const result = await operation(tx);
    await verifyReadBoundary(tx, config, storageHash);
    return result;
  }, OPTIONS);
}

/** 明确拒绝只读配置，不获取连接、不进入业务操作。 */
export function assertPrisma8Writable(config: Prisma8RuntimeConfig): void {
  if (config.readOnly !== false) throw new Error("Prisma 8 只读提供方禁止写入");
}

/** 写事务在业务操作前后复核同一连接边界；后置校验失败由事务回滚。 */
export async function writePrisma8Transaction<T>(
  client: PostgresClient<Contract>,
  config: Prisma8RuntimeConfig,
  storageHash: string,
  operation: (tx: Prisma8Transaction) => Promise<T>,
  timeout: 5000 | 10000 = 10000,
): Promise<T> {
  assertPrisma8Writable(config);
  return client.transaction(
    async (tx) => {
      await verifyReadBoundary(tx, config, storageHash);
      const result = await operation(tx);
      await verifyReadBoundary(tx, config, storageHash);
      return result;
    },
    { ...OPTIONS, timeout },
  );
}
