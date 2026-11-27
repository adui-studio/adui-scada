import type { PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import type { Contract as HistoricalContract } from "../generated/prisma8/contract.d.js";
import type { Prisma8Transaction } from "../database/prisma8-read-transaction.js";

type TextColumns = Readonly<Record<string, "pg/text@1">> & { readonly __proto__?: never };
type TextRow<Columns extends TextColumns> = { [Key in keyof Columns]: string };
type SqlParameter = string | number;

/** 共享身份操作只依赖参数化文本查询和影响行数，不暴露任何一代 SDK 契约。 */
export interface Prisma8AuthTransaction {
  queryText<Columns extends TextColumns>(
    columns: Columns,
  ): (strings: TemplateStringsArray, ...parameters: SqlParameter[]) => Promise<TextRow<Columns>[]>;
  executeCount(
    strings: TemplateStringsArray,
    ...parameters: SqlParameter[]
  ): Promise<{ affectedRows: number }>;
}

function isTextRow<Columns extends TextColumns>(
  row: unknown,
  columns: Columns,
): row is TextRow<Columns> {
  return (
    typeof row === "object" &&
    row !== null &&
    Object.keys(columns).every(
      (key) => Object.hasOwn(row, key) && typeof Reflect.get(row, key) === "string",
    )
  );
}

function requireTextRows<Columns extends TextColumns>(
  rows: readonly unknown[],
  columns: Columns,
): TextRow<Columns>[] {
  return rows.map((row) => {
    if (!isTextRow(row, columns)) throw new Error("身份事务查询结果缺少有效文本列");
    return row;
  });
}

/** 历史候选使用其自身生成的契约构造计划，始终在调用方已校验的事务内执行。 */
export function historicalAuthTransaction(
  tx: PostgresTransactionContext<HistoricalContract>,
): Prisma8AuthTransaction {
  return {
    queryText: (columns) => async (strings, ...parameters) =>
      requireTextRows(
        await tx.query(tx.raw.sql(strings, ...parameters).returnsRow(columns).build()).toArray(),
        columns,
      ),
    executeCount: (strings, ...parameters) =>
      tx.execute(tx.raw.sql(strings, ...parameters).affectedCount().build()),
  };
}

/** 原生候选使用原生契约构造计划，不转换为历史契约或获得独立连接。 */
export function nativeAuthTransaction(tx: Prisma8Transaction): Prisma8AuthTransaction {
  return {
    queryText: (columns) => async (strings, ...parameters) =>
      requireTextRows(
        await tx.query(tx.raw.sql(strings, ...parameters).returnsRow(columns).build()).toArray(),
        columns,
      ),
    executeCount: (strings, ...parameters) =>
      tx.execute(tx.raw.sql(strings, ...parameters).affectedCount().build()),
  };
}

export interface Prisma8AuthTransactionPort {
  assertWritable(): void;
  read<T>(operation: (tx: Prisma8AuthTransaction) => Promise<T>): Promise<T>;
  write<T>(operation: (tx: Prisma8AuthTransaction) => Promise<T>): Promise<T>;
}
