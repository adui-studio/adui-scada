import { createHash } from "node:crypto";
import { reviewCheckRepairContract } from "./prisma8-native-check-repair.mjs";

const oldHash = "6eec3e7459bdfa2646dc156bd6eaf22ffe60b0a0eac309622262b9742a0c68cc";
const newHash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
const evidenceFingerprint = "13360ad35e8a1742f7d6a8eea99162fc11f33aea4d45d2075390ce4d2bef9a86";
const cases = [
  {
    table: "scada_identities",
    name: "scada_identities_status_check",
    column: "status",
    values: ["active", "disabled"],
  },
  {
    table: "scada_project_release_events",
    name: "scada_project_release_event_action_check",
    column: "action",
    values: ["PUBLISH", "ROLLBACK"],
  },
];

export class CheckRoundTripError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new CheckRoundTripError(message);
}

function fingerprint(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** 仅从两份固定契约推导计划，不连接数据库或生成可执行迁移。 */
export function buildCheckRoundTripPlan(original, candidate) {
  const review = reviewCheckRepairContract(original, candidate);
  requireMatch(
    review.originalHash === oldHash && review.candidateHash === newHash,
    "往返计划必须绑定已验收契约",
  );
  const oldTables = original.storage.namespaces.public.entries.table;
  const newTables = candidate.storage.namespaces.public.entries.table;
  const rows = cases.flatMap(({ table, name, column, values }) => {
    const field = newTables[table].columns[column];
    requireMatch(
      field?.dataType === "pg/varchar" &&
        field.typeParams?.length === 16 &&
        field.nullable === false,
      "目标列类型或非空属性已变化",
    );
    const before = oldTables[table].checks.find((check) => check.name === name).expression;
    const after = newTables[table].checks.find((check) => check.name === name).expression;
    const inputs = [
      ...values.map((value) => ({ value, expectedOutcome: "accepted" })),
      { value: values[0] === "active" ? "ACTIVE" : "publish", expectedOutcome: "23514" },
      { value: values[1] === "disabled" ? "DISABLED" : "rollback", expectedOutcome: "23514" },
      { value: "", expectedOutcome: "23514" },
      { value: "unknown", expectedOutcome: "23514" },
      { value: values[0] + " ", expectedOutcome: "23514" },
      { value: null, expectedOutcome: "23502" },
    ];
    return [
      { stage: "legacy", appliedExpression: before },
      { stage: "repair", appliedExpression: after },
      { stage: "replay", appliedExpression: after },
    ].map((step) => ({
      schema: "public",
      table,
      name,
      column,
      ...step,
      expectedExpression: after,
      columnType: "character varying(16)",
      notNull: true,
      constraintType: "c",
      validated: true,
      local: true,
      inputs: structuredClone(inputs),
    }));
  });
  const payload = {
    scope: "NATIVE_CHECK_ROUNDTRIP_PLAN_V1",
    originalHash: oldHash,
    candidateHash: newHash,
    evidenceFingerprint,
    serverVersionNum: 170011,
    providerVersion: "8.0.0-rc.25",
    catalogExpression: "pg_get_expr(c.conbin, c.conrelid)",
    rows,
  };
  return {
    status: "NATIVE_CHECK_ROUNDTRIP_PLAN_REVIEW_REQUIRED",
    ...payload,
    planFingerprint: fingerprint(payload),
    databaseExecutionAllowed: false,
    roundTripVerified: false,
    historicalAdoptionVerified: false,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}

/** 只判定提交的观察值是否符合固定预期，不证明来源真实或授权执行。 */
export function reviewCheckRoundTripObservations(original, candidate, observation) {
  const plan = buildCheckRoundTripPlan(original, candidate);
  requireMatch(
    exactKeys(observation, ["planFingerprint", "serverVersionNum", "rows"]) &&
      observation.planFingerprint === plan.planFingerprint &&
      observation.serverVersionNum === plan.serverVersionNum &&
      Array.isArray(observation.rows) &&
      observation.rows.length === plan.rows.length,
    "往返观察范围、版本或数量不一致",
  );
  const results = plan.rows.map((expected, index) => {
    const row = observation.rows[index];
    requireMatch(
      exactKeys(row, [
        "schema",
        "table",
        "name",
        "column",
        "stage",
        "appliedExpression",
        "expression",
        "columnType",
        "notNull",
        "constraintType",
        "validated",
        "local",
        "outcomes",
      ]) &&
        row.schema === expected.schema &&
        row.table === expected.table &&
        row.name === expected.name &&
        row.column === expected.column &&
        row.stage === expected.stage &&
        [row.appliedExpression, row.expression, row.columnType, row.constraintType].every(
          (value) => typeof value === "string" && value.length > 0 && value.length <= 4096,
        ) &&
        [row.notNull, row.validated, row.local].every((value) => typeof value === "boolean") &&
        Array.isArray(row.outcomes) &&
        row.outcomes.length === expected.inputs.length &&
        [...row.outcomes].every((outcome) =>
          ["accepted", "23514", "23502", "other"].includes(outcome),
        ),
      "往返观察字段或阶段无效",
    );
    const appliedMatches = row.appliedExpression === expected.appliedExpression;
    const expressionMatches = row.expression === expected.expectedExpression;
    const metadataMatches =
      row.columnType === expected.columnType &&
      row.notNull === expected.notNull &&
      row.constraintType === expected.constraintType &&
      row.validated === expected.validated &&
      row.local === expected.local;
    const outcomeMismatchCount = expected.inputs.filter(
      ({ expectedOutcome }, inputIndex) => row.outcomes[inputIndex] !== expectedOutcome,
    ).length;
    return {
      table: expected.table,
      stage: expected.stage,
      appliedMatches,
      expressionMatches,
      metadataMatches,
      outcomeMismatchCount,
    };
  });
  return {
    status: "NATIVE_CHECK_ROUNDTRIP_OBSERVATIONS_REVIEW_REQUIRED",
    planFingerprint: plan.planFingerprint,
    observationsMatch: results.every(
      (row) =>
        row.appliedMatches &&
        row.expressionMatches &&
        row.metadataMatches &&
        row.outcomeMismatchCount === 0,
    ),
    results,
    observationSourceAuthenticated: false,
    databaseExecutionAllowed: false,
    roundTripVerified: false,
    historicalAdoptionVerified: false,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}
