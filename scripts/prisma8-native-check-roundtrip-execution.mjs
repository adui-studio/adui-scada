import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const acceptedPlanFingerprint =
  "17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a";
export const roundTripTarget = Object.freeze({
  container: "adui-scada-prisma8-check-roundtrip",
  volume: "adui-scada-prisma8-check-roundtrip-data",
  network: "adui-scada-prisma8-check-roundtrip-net",
  image: "sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0",
  host: "127.0.0.1",
  port: 15444,
  database: "adui_scada_fresh_prisma8_roundtrip",
  role: "adui_scada_native_roundtrip",
  serverVersionNum: 170011,
});

export class RoundTripExecutionError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new RoundTripExecutionError(message);
}

/** 只接受维护者实际验收的完整计划，不接受重算后自行声明的新指纹。 */
export function requireLockedRoundTripPlan(input) {
  let plan;
  try {
    plan = structuredClone(input);
    const {
      status,
      planFingerprint,
      databaseExecutionAllowed,
      roundTripVerified,
      historicalAdoptionVerified,
      signingAllowed,
      deploymentAllowed,
      ...payload
    } = plan;
    requireMatch(
      status === "NATIVE_CHECK_ROUNDTRIP_PLAN_REVIEW_REQUIRED" &&
        planFingerprint === acceptedPlanFingerprint &&
        createHash("sha256").update(JSON.stringify(payload)).digest("hex") ===
          acceptedPlanFingerprint &&
        [
          databaseExecutionAllowed,
          roundTripVerified,
          historicalAdoptionVerified,
          signingAllowed,
          deploymentAllowed,
        ].every((value) => value === false),
      "往返计划指纹或许可状态不符合已验收证据",
    );
  } catch {
    throw new RoundTripExecutionError("往返计划指纹或许可状态不符合已验收证据");
  }
  return plan;
}

function systemId(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,19}$/u.test(value);
}

function validCollation(value) {
  return (
    value &&
    value.encoding === "UTF8" &&
    ["c", "i", "b"].includes(value.provider) &&
    [value.collate, value.ctype].every(
      (field) => typeof field === "string" && field.length > 0 && field.length <= 256,
    ) &&
    [value.locale, value.version].every(
      (field) =>
        field === null || (typeof field === "string" && field.length > 0 && field.length <= 256),
    )
  );
}

/** 校验模拟采集的隔离事实；此函数不认证来源、不读取 Docker 或数据库。 */
export function requireRoundTripBoundary(input) {
  let facts;
  try {
    facts = structuredClone(input);
  } catch {
    throw new RoundTripExecutionError("独立实例边界事实无效");
  }
  requireMatch(
    facts &&
      isDeepStrictEqual(facts.target, roundTripTarget) &&
      ["npipe:////./pipe/dockerDesktopLinuxEngine", "npipe:////./pipe/docker_engine"].includes(
        facts.dockerEndpoint,
      ) &&
      facts.dockerOs === "linux" &&
      facts.running === true &&
      facts.scope === "prisma8-check-roundtrip" &&
      facts.mountCount === 1 &&
      facts.networkCount === 1 &&
      facts.publishedPortCount === 1 &&
      facts.databaseOwner === true &&
      facts.defaultReadOnly === true &&
      typeof facts.containerId === "string" &&
      /^[a-f0-9]{64}$/u.test(facts.containerId) &&
      systemId(facts.containerSystemIdentifier) &&
      facts.containerSystemIdentifier === facts.tcpSystemIdentifier &&
      Array.isArray(facts.frozenSystemIdentifiers) &&
      facts.frozenSystemIdentifiers.length === 4 &&
      [...facts.frozenSystemIdentifiers].every(systemId) &&
      !facts.frozenSystemIdentifiers.includes(facts.tcpSystemIdentifier) &&
      validCollation(facts.referenceCollation) &&
      isDeepStrictEqual(facts.referenceCollation, facts.targetCollation) &&
      facts.checkedEmptyCategories === 23 &&
      facts.empty === true &&
      facts.otherSessions === 0,
    "独立实例身份、排序规则或空库边界不符合预期",
  );
  return facts;
}

const catalogSql = `SELECT n.nspname AS schema, cl.relname AS "table", c.conname AS name,
  a.attname AS "column", pg_catalog.pg_get_expr(c.conbin, c.conrelid) AS expression,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS "columnType",
  a.attnotnull AS "notNull", c.contype AS "constraintType", c.convalidated AS validated,
  c.conislocal AS local, c.connoinherit AS "noInherit", cl.relkind AS "relationKind",
  cl.relpersistence AS persistence, c.conkey = ARRAY[a.attnum]::smallint[] AS "columnMatches",
  (SELECT count(*)::int FROM pg_catalog.pg_attribute x WHERE x.attrelid = cl.oid AND x.attnum > 0 AND NOT x.attisdropped) AS "columnCount"
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class cl ON cl.oid = c.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = cl.oid AND a.attname = $3 AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = $1 AND cl.relname = $2`;

function requireCommand(result, command) {
  requireMatch(result?.command === command, "事务命令完成状态不符合预期");
}

function expectedCatalog(row) {
  return {
    schema: row.schema,
    table: row.table,
    name: row.name,
    column: row.column,
    expression: row.expectedExpression,
    columnType: row.columnType,
    notNull: row.notNull,
    constraintType: row.constraintType,
    validated: row.validated,
    local: row.local,
    noInherit: false,
    relationKind: "r",
    persistence: "p",
    columnMatches: true,
    columnCount: 1,
  };
}

function classifyInsertError(error, row) {
  if (error?.schema !== row.schema || error.table !== row.table) return "other";
  if (error.code === "23514" && error.constraint === row.name) return "23514";
  if (error.code === "23502" && error.column === row.column) return "23502";
  return "other";
}

/** 在注入的模拟适配器上演练固定事务协议，不提供真实连接或执行授权。 */
export async function simulateRoundTripExecution(input, adapter) {
  const plan = requireLockedRoundTripPlan(input);
  let baseline;
  try {
    baseline = requireRoundTripBoundary(await adapter.readBoundary());
  } catch {
    throw new RoundTripExecutionError("实验初始边界未确认");
  }
  const verifyBoundary = async () => {
    const current = requireRoundTripBoundary(await adapter.readBoundary());
    requireMatch(isDeepStrictEqual(current, baseline), "实验前后独立实例边界发生变化");
  };
  const query = async (sql, params = []) => adapter.query(sql, params);
  const results = [];
  let repairExpression;
  for (const row of plan.rows) {
    const table = '"public"."' + row.table + '"';
    const column = '"' + row.column + '"';
    const expression = row.stage === "replay" ? repairExpression : row.appliedExpression;
    requireMatch(expression === row.appliedExpression, "重放必须使用已核验的实际修复表达式");
    let phase = "实验前边界";
    let failure;
    let attempted = false;
    let rollbackFailed = false;
    let boundaryFailed = false;
    const outcomes = [];
    try {
      await verifyBoundary();
      phase = "启动事务";
      attempted = true;
      requireCommand(await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE"), "BEGIN");
      phase = "创建最小关系";
      requireCommand(
        await query(
          "CREATE TABLE " +
            table +
            " (" +
            column +
            ' character varying(16) NOT NULL, CONSTRAINT "' +
            row.name +
            '" CHECK (' +
            expression +
            "))",
        ),
        "CREATE TABLE",
      );
      phase = "目录原文与约束元数据";
      const catalog = await query(catalogSql, [row.schema, row.table, row.column]);
      requireMatch(
        catalog?.command === "SELECT" &&
          catalog.rows?.length === 1 &&
          isDeepStrictEqual(catalog.rows[0], expectedCatalog(row)),
        "目录反向提取与固定计划不一致",
      );
      if (row.stage === "repair") repairExpression = catalog.rows[0].expression;
      phase = "参数化写入及保存点";
      for (const input of row.inputs) {
        requireCommand(await query("SAVEPOINT roundtrip_input"), "SAVEPOINT");
        let outcome;
        try {
          const result = await query(
            "INSERT INTO " +
              table +
              " (" +
              column +
              ") VALUES ($1) RETURNING " +
              column +
              ' AS "value"',
            [input.value],
          );
          outcome =
            result?.command === "INSERT" &&
            result.rowCount === 1 &&
            isDeepStrictEqual(result.rows, [{ value: input.value }])
              ? "accepted"
              : "other";
        } catch (error) {
          outcome = classifyInsertError(error, row);
        }
        requireCommand(await query("ROLLBACK TO SAVEPOINT roundtrip_input"), "ROLLBACK");
        requireCommand(await query("RELEASE SAVEPOINT roundtrip_input"), "RELEASE");
        requireMatch(outcome === input.expectedOutcome, "写入观察与固定预期不一致");
        outcomes.push(outcome);
      }
    } catch {
      failure = phase;
    }
    if (attempted) {
      try {
        requireCommand(await query("ROLLBACK"), "ROLLBACK");
      } catch {
        rollbackFailed = true;
      }
      try {
        await verifyBoundary();
      } catch {
        boundaryFailed = true;
      }
    }
    requireMatch(
      !failure && !rollbackFailed && !boundaryFailed,
      "模拟阶段失败：" +
        row.stage +
        "；" +
        (failure ?? "操作已完成") +
        (rollbackFailed ? "；事务回滚未确认" : "") +
        (boundaryFailed ? "；回滚后边界未确认" : ""),
    );
    results.push({
      table: row.table,
      stage: row.stage,
      matchedInputs: outcomes.length,
      rollbackConfirmed: true,
    });
  }
  return {
    status: "NATIVE_CHECK_ROUNDTRIP_EXECUTION_SIMULATED",
    planFingerprint: acceptedPlanFingerprint,
    results,
    matchedInputs: results.reduce((sum, row) => sum + row.matchedInputs, 0),
    observationSourceAuthenticated: false,
    databaseExecutionAllowed: false,
    roundTripVerified: false,
    historicalAdoptionVerified: false,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}
