import type { Prisma8Transaction } from "./prisma8-read-transaction.js";

type TextColumns = Readonly<Record<string, "pg/text@1">> & { readonly __proto__?: never };
type TextRow<Columns extends TextColumns> = { [Key in keyof Columns]: string };
type SqlParameter = string | number | bigint;

/** 原生仓储共用的参数化文本查询和影响行数端口，不暴露具体 SDK 契约。 */
export interface Prisma8TextTransaction {
  readonly queryText: <Columns extends TextColumns>(
    columns: Columns,
  ) => (
    strings: TemplateStringsArray,
    ...parameters: SqlParameter[]
  ) => Promise<TextRow<Columns>[]>;
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
  invalidRowMessage: string,
): TextRow<Columns>[] {
  return rows.map((row) => {
    if (!isTextRow(row, columns)) throw new Error(invalidRowMessage);
    return row;
  });
}

/** 原生事务使用当前契约构造参数化计划，不另建连接。 */
export function nativeTextTransaction(
  tx: Prisma8Transaction,
  invalidRowMessage: string,
): Prisma8TextTransaction {
  return {
    queryText:
      (columns) =>
      async (strings, ...parameters) =>
        requireTextRows(
          await tx
            .query(
              tx.raw
                .sql(strings, ...parameters)
                .returnsRow(columns)
                .build(),
            )
            .toArray(),
          columns,
          invalidRowMessage,
        ),
    executeCount: (strings, ...parameters) =>
      tx.execute(
        tx.raw
          .sql(strings, ...parameters)
          .affectedCount()
          .build(),
      ),
  };
}
