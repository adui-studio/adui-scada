import type { Prisma8Transaction } from "../database/prisma8-read-transaction.js";

/** 共享身份操作仅依赖原生参数化 SQL，不依赖两代契约的关系映射或连接对象。 */
export type Prisma8AuthTransaction = Pick<Prisma8Transaction, "raw" | "query" | "execute">;

export interface Prisma8AuthTransactionPort {
  assertWritable(): void;
  read<T>(operation: (tx: Prisma8AuthTransaction) => Promise<T>): Promise<T>;
  write<T>(operation: (tx: Prisma8AuthTransaction) => Promise<T>): Promise<T>;
}
