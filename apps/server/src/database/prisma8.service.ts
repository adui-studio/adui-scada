import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import postgres, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { Pool } from "pg";
import type { Contract } from "../generated/prisma8-runtime/contract.d.js";
import contractJson from "../generated/prisma8-runtime/contract.json" with { type: "json" };
import {
  Prisma8RuntimeLifecycle,
  requirePrisma8RuntimeIdentity,
  resolvePrisma8RuntimeUrl,
  type Prisma8RuntimeConfig,
  type Prisma8RuntimeIdentity,
  type Prisma8RuntimePort,
} from "./prisma8-runtime-boundary.js";

import { readPrisma8Transaction, type Prisma8Transaction } from "./prisma8-read-transaction.js";

export const PRISMA8_RUNTIME_CONFIG = Symbol("PRISMA8_RUNTIME_CONFIG");
export const prisma8RuntimeStorageHash = contractJson.storage.storageHash;
const contract = contractFromJson<Contract>(contractJson);
export type Prisma8Client = PostgresClient<Contract>;

const identitySql = `SELECT current_database()::text AS database,
  current_user::text AS role, session_user::text AS "sessionRole",
  current_schema()::text AS schema, current_setting('server_version_num') AS version,
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier",
  (SELECT core_hash::text FROM prisma_contract.marker WHERE space = 'app') AS "storageHash",
  current_setting('transaction_read_only') AS "readOnly",
  current_setting('default_transaction_read_only') AS "defaultReadOnly",
  pg_catalog.pg_is_in_recovery() AS recovery`;

/** 由 Nest 持有一个连接池，原生契约标记及只读探针成功后才开放客户端。 */
function createRuntime(config: Prisma8RuntimeConfig): Prisma8RuntimePort<Prisma8Client> {
  const connectionString = resolvePrisma8RuntimeUrl(config);
  const pool = new Pool({
    connectionString,
    ssl: false,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    application_name: "adui_scada_prisma8_runtime",
  });
  let runtime: Prisma8Client | undefined;
  let poolFailed = false;
  pool.on("error", () => {
    poolFailed = true;
  });
  const verifyIdentity = async () => {
    if (poolFailed) throw new Error("Prisma 8 数据库连接池异常");
    const result = await pool.query<Prisma8RuntimeIdentity>(identitySql);
    requirePrisma8RuntimeIdentity(result.rows, config, prisma8RuntimeStorageHash);
  };
  return {
    get client() {
      if (!runtime || poolFailed) throw new Error("Prisma 8 数据库连接不可用");
      return runtime;
    },
    async verify() {
      await verifyIdentity();
      runtime = postgres({ contract, pg: pool });
      const scope = "prisma8-provider-" + randomUUID();
      const missing = await runtime.orm.public.ScadaProject.where({
        tenantId: scope,
        projectId: scope,
      })
        .select("tenantId", "projectId", "headRevision")
        .first();
      if (missing !== null) throw new Error("Prisma 8 启动查询结果不符合预期");
      await verifyIdentity();
    },
    async close() {
      let failed = false;
      try {
        await runtime?.close();
      } catch {
        failed = true;
      }
      try {
        await pool.end();
      } catch {
        failed = true;
      }
      if (failed) throw new Error("Prisma 8 运行时或连接池关闭失败");
    },
  };
}

/** 原生 Prisma 8 提供方；正式业务模块尚未导入此独立模块。 */
@Injectable()
export class Prisma8Service implements OnModuleInit, OnModuleDestroy {
  private readonly lifecycle = new Prisma8RuntimeLifecycle<Prisma8Client>();

  constructor(@Inject(PRISMA8_RUNTIME_CONFIG) private readonly config: Prisma8RuntimeConfig) {}

  get client(): Prisma8Client {
    return this.lifecycle.client;
  }

  /** 业务只读仓储使用同一原生事务边界，禁止绕过启动生命周期。 */
  readTransaction<T>(operation: (tx: Prisma8Transaction) => Promise<T>): Promise<T> {
    return readPrisma8Transaction(this.client, this.config, prisma8RuntimeStorageHash, operation);
  }

  async onModuleInit(): Promise<void> {
    await this.lifecycle.start(() => createRuntime(this.config));
  }

  async onModuleDestroy(): Promise<void> {
    await this.lifecycle.stop();
  }
}
