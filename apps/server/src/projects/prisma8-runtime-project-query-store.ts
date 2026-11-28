import { Injectable } from "@nestjs/common";
import { Prisma8Service } from "../database/prisma8.service.js";
import { nativeTextTransaction } from "../database/prisma8-text-transaction.js";
import {
  Prisma8ProjectQueryOperations,
  type Prisma8ProjectQueryTransaction,
} from "./prisma8-project-query-store.js";

/** 原生工程查询使用唯一业务数据库提供方，不挂载正式 HTTP 路由。 */
@Injectable()
export class Prisma8RuntimeProjectQueryStore extends Prisma8ProjectQueryOperations {
  constructor(database: Prisma8Service) {
    const read = <T>(operation: (tx: Prisma8ProjectQueryTransaction) => Promise<T>): Promise<T> =>
      database.readTransaction((tx) => {
        const text = nativeTextTransaction(tx, "工程事务查询结果缺少有效文本列");
        return operation({
          queryText: text.queryText,
          readGrants: async (tenantId, projectId, subjectId) =>
            await tx.orm.public.ScadaProjectGrant.where({ tenantId, projectId, subjectId })
              .select("permission")
              .all(),
        });
      });
    super({
      read,
      locked: <T>(operation: (tx: Prisma8ProjectQueryTransaction) => Promise<T>) => {
        // PostgreSQL 的共享行锁要求非只读事务；禁止为只读烟测绕过锁内授权。
        database.assertWritable();
        return read(operation);
      },
    });
  }
}
