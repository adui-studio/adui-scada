import type { Prisma8Transaction } from "./prisma8-read-transaction.js";
import type { Prisma8Service } from "./prisma8.service.js";

export const DOCKER_TRANSACTION_CONFIRMATION = "--confirm-temp-transaction-probe";

const FAILURE = "原生临时事务探针未通过";
type ProbeDatabase = Pick<Prisma8Service, "writable" | "readTransaction" | "writeTransaction">;

export function requireDockerTransactionConfirmation(args: readonly string[]): void {
  if (args.length !== 1 || args[0] !== DOCKER_TRANSACTION_CONFIRMATION) {
    throw new Error("临时事务探针需要单独明确确认");
  }
}

/** 每次均核对同一 PostgreSQL 后端会话与本会话临时关系，拒绝跨连接假阳性。 */
async function verifySession(
  tx: Prisma8Transaction,
  present: boolean,
  expectedPid?: string,
): Promise<string> {
  const rows = await tx
    .query(
      tx.raw.sql`SELECT pg_catalog.pg_backend_pid()::text AS pid,
        EXISTS (SELECT 1 FROM pg_catalog.pg_class
          WHERE relnamespace = pg_catalog.pg_my_temp_schema()
            AND relname = 'adui_scada_native_tx_probe')::text AS present`
        .returnsRow({ pid: "pg/text@1", present: "pg/text@1" })
        .build(),
    )
    .toArray();
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    !/^[1-9][0-9]*$/u.test(row.pid) ||
    row.present !== String(present) ||
    (expectedPid !== undefined && row.pid !== expectedPid)
  ) {
    throw new Error(FAILURE);
  }
  return row.pid;
}

async function verifyValue(tx: Prisma8Transaction, expected: string): Promise<void> {
  const rows = await tx
    .query(
      tx.raw.sql`SELECT value::text AS value FROM pg_temp.adui_scada_native_tx_probe`
        .returnsRow({ value: "pg/text@1" })
        .build(),
    )
    .toArray();
  if (rows.length !== 1 || rows[0]?.value !== expected) throw new Error(FAILURE);
}

/** 只写当前会话临时表，跨事务验证提交、回滚及清理；不触碰正式业务表。 */
export async function verifyDockerNativeTransactions(database: ProbeDatabase) {
  if (!database.writable) throw new Error("原生临时事务探针需要独立可写连接");
  const committed = "提交夹具";
  const reverted = "回滚夹具";
  const pid = await database.writeTransaction(async (tx) => {
    const current = await verifySession(tx, false);
    await tx.execute(
      tx.raw.sql`CREATE TEMP TABLE pg_temp.adui_scada_native_tx_probe
        (value text NOT NULL) ON COMMIT PRESERVE ROWS`
        .affectedCount()
        .build(),
    );
    await verifySession(tx, true, current);
    const inserted = await tx.execute(
      tx.raw.sql`INSERT INTO pg_temp.adui_scada_native_tx_probe (value) VALUES (${committed})`
        .affectedCount()
        .build(),
    );
    if (inserted.affectedRows !== 1) throw new Error(FAILURE);
    await verifyValue(tx, committed);
    return current;
  });
  await database.readTransaction(async (tx) => {
    await verifySession(tx, true, pid);
    await verifyValue(tx, committed);
  });

  // 仅接受本次主动抛出的同一异常；任意连接、SQL 或边界错误均不得当作回滚成功。
  const rollback = new Error("主动回滚临时事务");
  let rollbackObserved = false;
  try {
    await database.writeTransaction(async (tx) => {
      await verifySession(tx, true, pid);
      const updated = await tx.execute(
        tx.raw.sql`UPDATE pg_temp.adui_scada_native_tx_probe SET value = ${reverted}
          WHERE value = ${committed}`
          .affectedCount()
          .build(),
      );
      if (updated.affectedRows !== 1) throw new Error(FAILURE);
      await verifyValue(tx, reverted);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
    rollbackObserved = true;
  }
  if (!rollbackObserved) throw new Error(FAILURE);
  await database.readTransaction(async (tx) => {
    await verifySession(tx, true, pid);
    await verifyValue(tx, committed);
  });

  await database.writeTransaction(async (tx) => {
    await verifySession(tx, true, pid);
    await tx.execute(
      tx.raw.sql`DROP TABLE pg_temp.adui_scada_native_tx_probe`.affectedCount().build(),
    );
    await verifySession(tx, false, pid);
  });
  await database.readTransaction(async (tx) => {
    await verifySession(tx, false, pid);
  });
  return {
    commitVerified: true,
    rollbackVerified: true,
    sameBackendVerified: true,
    temporaryTableRemoved: true,
    businessDataWritten: false,
  } as const;
}
