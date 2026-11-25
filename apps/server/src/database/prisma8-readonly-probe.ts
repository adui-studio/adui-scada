import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { verifyPrisma8HistoryReadOnly } from "../history/prisma8-history-readonly.js";
import { createPrisma8ReadOnlyClient } from "./prisma8-readonly-client.js";
import { requirePrisma8ReadOnlyTestUrl } from "./prisma8-readonly-target.js";

export interface Prisma8ReadOnlyProbeResult {
  sampleStatus: "MATCHED" | "EMPTY";
  missingScopeVerified: true;
  historySampleStatus: "NOT_REQUESTED" | "MATCHED" | "EMPTY";
}

interface ProjectHeadSample {
  tenantId: string;
  projectId: string;
  headRevision: string;
}

/** 独立验收入口，不注册到生产模块，不返回工程数据或数据库连接。 */
export async function probePrisma8ReadOnly(
  testUrl: string | undefined,
  includeHistory = false,
): Promise<Prisma8ReadOnlyProbeResult> {
  const connectionString = requirePrisma8ReadOnlyTestUrl(testUrl);
  let stage = "连接初始化";
  let poolFailed = false;

  try {
    // 所有新连接默认只读；每个探针最多持有一个 PostgreSQL 连接。
    const pool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000,
      options: "-c default_transaction_read_only=on -c statement_timeout=5000",
    });
    pool.on("error", () => {
      poolFailed = true;
    });

    let result: Prisma8ReadOnlyProbeResult;
    try {
      stage = "数据库只读边界核验";
      const boundary = await pool.query<{ databaseName: string; readOnly: string }>(
        `SELECT current_database() AS "databaseName",
                current_setting('transaction_read_only') AS "readOnly"`,
      );
      const identity = boundary.rows[0];
      if (
        boundary.rows.length !== 1 ||
        identity?.databaseName !== "adui_scada_test" ||
        identity.readOnly !== "on"
      ) {
        throw new Error("隔离数据库或只读设置不符合要求");
      }

      // 只取一个已有工程的联合主键和修订号，空库不伪造样本。
      stage = "原始工程样本读取";
      const baseline = await pool.query<ProjectHeadSample>(
        `SELECT tenant_id AS "tenantId", project_id AS "projectId",
                head_revision::text AS "headRevision"
         FROM public.scada_projects
         ORDER BY tenant_id, project_id
         LIMIT 1`,
      );
      const sample = baseline.rows[0];

      stage = "Prisma 8 客户端初始化";
      const db = createPrisma8ReadOnlyClient(pool);
      try {
        const readHead = (tenantId: string, projectId: string) =>
          db.orm.public.ScadaProject.where({ tenantId, projectId })
            .select("tenantId", "projectId", "headRevision")
            .first();

        stage = "不存在工程查询";
        const absentTenant = "prisma8-readonly-" + randomUUID();
        const absentProject = "prisma8-readonly-" + randomUUID();
        if ((await readHead(absentTenant, absentProject)) !== null) {
          throw new Error("不存在工程未返回空结果");
        }

        if (sample) {
          stage = "真实工程修订号和联合主键比对";
          const actual = await readHead(sample.tenantId, sample.projectId);
          if (
            actual === null ||
            actual.tenantId !== sample.tenantId ||
            actual.projectId !== sample.projectId ||
            typeof actual.headRevision !== "bigint" ||
            actual.headRevision.toString() !== sample.headRevision
          ) {
            throw new Error("Prisma 8 工程样本与原始查询不一致");
          }

          stage = "租户与工程联合过滤核验";
          if (
            (await readHead(absentTenant, sample.projectId)) !== null ||
            (await readHead(sample.tenantId, absentProject)) !== null
          ) {
            throw new Error("联合过滤未正确隔离工程");
          }
        }

        stage = "历史归档只读查询对照";
        const historySampleStatus = includeHistory
          ? await verifyPrisma8HistoryReadOnly(pool, db, absentTenant, absentProject)
          : "NOT_REQUESTED";
        result = {
          sampleStatus: sample ? "MATCHED" : "EMPTY",
          missingScopeVerified: true,
          historySampleStatus,
        };
      } finally {
        // Prisma 8 不负责关闭调用方传入的连接池。
        await db.close();
      }
    } finally {
      await pool.end();
    }

    if (poolFailed) {
      stage = "连接池异常";
      throw new Error("只读探针的连接池发生异常");
    }
    return result;
  } catch {
    // 第三方异常可能包含 SQL、连接地址或认证信息，只返回固定阶段。
    throw new Error("Prisma 8 只读探针失败：" + stage);
  }
}
