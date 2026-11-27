import type { Prisma8Transaction } from "../database/prisma8-read-transaction.js";
import {
  nativeTextTransaction,
  type Prisma8TextTransaction,
} from "../database/prisma8-text-transaction.js";

export type Prisma8AuthTransaction = Prisma8TextTransaction;
const INVALID_ROW = "身份事务查询结果缺少有效文本列";

/** 保留原生身份服务的契约和原异常语义。 */
export function nativeAuthTransaction(tx: Prisma8Transaction): Prisma8AuthTransaction {
  return nativeTextTransaction(tx, INVALID_ROW);
}

export interface Prisma8AuthTransactionPort {
  assertWritable(): void;
  read<T>(operation: (tx: Prisma8AuthTransaction) => Promise<T>): Promise<T>;
  write<T>(operation: (tx: Prisma8AuthTransaction) => Promise<T>): Promise<T>;
}
