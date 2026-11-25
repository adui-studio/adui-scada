import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { Client } from "pg";
import {
  inspectMigrationDatabase,
  loadMigrationBaseline,
} from "../../scripts/inspect-prisma8-migration-readiness.mjs";
import {
  expectedReleaseSample,
  reviewReleaseQueries,
} from "../../scripts/prisma8-native-query-review.mjs";
import {
  requireDeclarationHashes,
  reviewRuntimeRelations,
} from "../../scripts/prisma8-native-runtime-review.mjs";
import { requirePrisma8ReadOnlyTestUrl } from "./src/database/prisma8-readonly-target.ts";

const root = resolve(import.meta.dirname, "../..");
const formalPath = resolve(import.meta.dirname, "src/generated/prisma8");
const nativePath = resolve(root, ".artifacts/prisma8-native");
const fingerprint = "73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52";

class QueryReviewError extends Error {}

function loadContract(directory) {
  const json = JSON.parse(readFileSync(resolve(directory, "contract.json"), "utf8"));
  requireDeclarationHashes(readFileSync(resolve(directory, "contract.d.ts"), "utf8"), json);
  return json;
}

function createConnection(connectionString) {
  return new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    options:
      "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c search_path=public",
  });
}

function readerFor(db) {
  const states = db.orm.public.ScadaProjectReleaseState;
  const events = db.orm.public.ScadaProjectReleaseEvent;
  return {
    state: (tenantId, projectId) =>
      states
        .where({ tenantId, projectId })
        .select(
          "tenantId",
          "projectId",
          "releaseGeneration",
          "releasedRevision",
          "releasedContentHash",
          "lastReleaseEventId",
        )
        .include("lastReleaseEvent", (event) =>
          event.select(
            "tenantId",
            "projectId",
            "generation",
            "toRevision",
            "toContentHash",
            "eventId",
            "action",
          ),
        )
        .first(),
    event: (tenantId, projectId, eventId) =>
      events
        .where({ tenantId, projectId, eventId })
        .select(
          "tenantId",
          "projectId",
          "generation",
          "toRevision",
          "toContentHash",
          "eventId",
          "action",
        )
        .first(),
  };
}

async function readSample(client, released) {
  const { rows } = await client.query(
    'SELECT tenant_id AS "tenantId", project_id AS "projectId", release_generation::text AS "releaseGeneration", ' +
      'released_revision::text AS "releasedRevision", released_content_hash AS "releasedContentHash", last_release_event_id::text AS "lastReleaseEventId" ' +
      "FROM public.scada_project_release_state WHERE (release_generation > 0) = $1 ORDER BY tenant_id, project_id LIMIT 1",
    [released],
  );
  const state = rows[0] ?? null;
  if (state === null || state.lastReleaseEventId === null)
    return expectedReleaseSample(state, null);
  const related = await client.query(
    'SELECT tenant_id AS "tenantId", project_id AS "projectId", generation::text AS generation, ' +
      'to_revision::text AS "toRevision", to_content_hash AS "toContentHash", event_id::text AS "eventId", action ' +
      "FROM public.scada_project_release_events WHERE tenant_id = $1 AND project_id = $2 AND generation = $3 " +
      "AND to_revision = $4 AND to_content_hash = $5 AND event_id = $6 LIMIT 2",
    [
      state.tenantId,
      state.projectId,
      state.releaseGeneration,
      state.releasedRevision,
      state.releasedContentHash,
      state.lastReleaseEventId,
    ],
  );
  if (related.rows.length !== 1) throw new Error("末次发布事件六字段 SQL 关联数量不正确");
  return expectedReleaseSample(state, related.rows[0]);
}

async function runQueries(connectionString, formal, native) {
  const client = createConnection(connectionString);
  const clients = [];
  const failures = [];
  let stage = "连接隔离库";
  let began = false;
  let connectionError = false;
  let report;
  client.on("error", () => {
    connectionError = true;
  });
  try {
    await client.connect();
    stage = "开启只读快照";
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    began = true;
    const boundary = await client.query(
      "SELECT current_database() AS db, current_schema() AS schema, current_setting('transaction_read_only') AS readonly, current_setting('transaction_isolation') AS isolation",
    );
    const row = boundary.rows[0];
    if (
      row?.db !== "adui_scada_test" ||
      row.schema !== "public" ||
      row.readonly !== "on" ||
      row.isolation !== "repeatable read"
    ) {
      throw new Error("隔离库只读快照校验失败");
    }
    stage = "读取独立 SQL 样本";
    const unreleased = await readSample(client, false);
    const released = await readSample(client, true);
    const absentTenant = "prisma8-native-probe-" + randomUUID();
    const absentProject = "prisma8-native-probe-" + randomUUID();
    stage = "初始化两份契约";
    clients.push(postgres({ contract: contractFromJson(formal), pg: client }));
    clients.push(postgres({ contract: contractFromJson(native), pg: client }));
    for (const [index, db] of clients.entries()) {
      stage = index === 0 ? "正式契约查询对照" : "原生候选查询对照";
      const reader = readerFor(db);
      await reviewReleaseQueries(reader, unreleased, absentTenant, absentProject);
      await reviewReleaseQueries(reader, released, absentTenant, absentProject);
    }
    report = {
      unreleased: unreleased === null ? "EMPTY" : "MATCHED",
      released: released === null ? "EMPTY" : "MATCHED",
    };
  } catch {
    failures.push(stage + "失败");
  } finally {
    for (const db of clients) {
      try {
        await db.close();
      } catch {
        failures.push("契约客户端释放失败");
      }
    }
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch {
        failures.push("只读快照回滚失败");
      }
    }
    try {
      await client.end();
    } catch {
      failures.push("隔离库连接关闭失败");
    }
  }
  if (connectionError) failures.push("隔离库连接异常");
  if (failures.length > 0 || !report)
    throw new QueryReviewError(failures.join("；") || "查询对照未生成报告");
  return report;
}

async function main() {
  const connectionString = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
  const formal = loadContract(formalPath);
  const native = loadContract(nativePath);
  const status = reviewRuntimeRelations(formal, native);
  const preflight = await inspectMigrationDatabase(
    createConnection(connectionString),
    loadMigrationBaseline(),
  );
  if (preflight.catalogFingerprint !== fingerprint || !preflight.timezoneUtc) {
    throw new QueryReviewError("隔离库已验收目录指纹或时区不一致");
  }
  const report = await runQueries(connectionString, formal, native);
  console.info("未发布样本对照：" + report.unreleased);
  console.info("已发布样本对照：" + report.released);
  console.info("不存在状态查询及实际样本对应的租户工程过滤已核对");
  console.info("反向单值导航仍未在原生候选中提供；禁止签名、迁移和切换正式提供方");
  console.info("评审状态：" + status);
}

void main().catch((error) => {
  console.error(
    error instanceof QueryReviewError
      ? error.message
      : "原生候选只读查询评审失败，请核对隔离库、保留的候选契约及目录指纹",
  );
  process.exitCode = 1;
});
