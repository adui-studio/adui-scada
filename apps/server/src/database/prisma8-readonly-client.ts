import postgres, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import type { Pool } from "pg";
import type { Contract } from "../generated/prisma8/contract.d.js";
import contractJson from "../generated/prisma8/contract.json" with { type: "json" };

const contract = contractFromJson<Contract>(contractJson);

/** 复用调用方已核验的只读连接池，不接管连接池或数据库迁移。 */
export function createPrisma8ReadOnlyClient(pool: Pool): Prisma8ReadOnlyClient {
  return postgres({ contract, pg: pool });
}

export type Prisma8ReadOnlyClient = PostgresClient<Contract>;
