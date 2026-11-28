import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const freshStorageHash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
export const freshConnectionVariable = "SCADA_PRISMA8_FRESH_DATABASE_URL";
export const freshConfirmation = "--confirm-initialize-empty-adui-scada";
const commentHash = "06a47418f3477c263cb19c7a3550a6be3810a4ffd9c22afada7ecd28f6322fb7";
const idPattern = /^[a-z_][a-z0-9_]*$/u;
const systemPattern = /^[1-9][0-9]{0,19}$/u;
const versionPattern = /^19[0-9]{4}$/u;
export class FreshInstallError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new FreshInstallError(message);
}

/** 仅允许固定本机业务库，连接凭据由既有 Docker 凭据加载器生成。 */
export function freshConnection(input, readOnly) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new FreshInstallError("全新业务库连接格式无效");
  }
  requireMatch(
    url.protocol === "postgresql:" &&
      url.hostname === "127.0.0.1" &&
      url.port === "15432" &&
      url.username === "adui_scada" &&
      url.pathname === "/adui_scada" &&
      /^[A-Za-z0-9_-]{43}$/u.test(url.password) &&
      !url.hash &&
      isDeepStrictEqual([...url.searchParams.entries()], [["schema", "public"]]),
    "全新安装仅允许本机 15432 端口的 adui_scada 业务库",
  );
  url.search = "";
  url.searchParams.set(
    "options",
    (readOnly ? "-c default_transaction_read_only=on " : "") +
      "-c statement_timeout=30000 -c lock_timeout=5000 -c search_path=public -c timezone=UTC -c standard_conforming_strings=on",
  );
  return url.toString();
}

/** 全新入口只接受明确的生成、只读验收或独立首次初始化动作。 */
export function freshAction(args) {
  for (const [flag, mode] of [
    ["--emit", "emit"],
    ["--preview", "preview"],
    [freshConfirmation, "initialize"],
    ["--status", "status"],
    ["--role-review", "role-review"],
    ["--role-plan", "role-plan"],
    ["--runtime-review", "runtime-review"],
    ["--runtime-emit", "runtime-emit"],
    ["--provider-smoke", "provider-smoke"],
  ]) {
    if (isDeepStrictEqual(args, [flag])) return mode;
  }
  throw new FreshInstallError(
    "必须明确指定全新安装发射、只读预览、首次初始化、验证、运行时评审、提供方验收、角色核查或角色准备预览",
  );
}

/** 核验当前 Git 原生契约发射结果及全部中文注释目标，不执行历史 SQL。 */
export function reviewFreshContract(contract, commentText) {
  const namespaces = contract?.storage?.namespaces;
  const tables = namespaces?.public?.entries?.table;
  requireMatch(
    contract?.targetFamily === "sql" &&
      contract.target === "postgres" &&
      contract.storage?.storageHash === freshStorageHash &&
      namespaces &&
      isDeepStrictEqual(Object.keys(namespaces), ["public"]) &&
      tables &&
      Object.keys(tables).length === 12,
    "全新原生契约存储标识或表清单不一致",
  );
  /** @type {Set<string>} 原生新增对象标识集合 */
  const ids = new Set();
  const keys = new Set();
  let columns = 0;
  let checks = 0;
  let indexes = 0;
  let foreignKeys = 0;
  for (const [name, table] of Object.entries(tables)) {
    requireMatch(name.startsWith("scada_") && idPattern.test(name), "原生契约表名称无效");
    ids.add("table." + name);
    keys.add("TABLE " + name);
    for (const column of Object.keys(table.columns)) {
      requireMatch(idPattern.test(column), "原生契约字段名称无效");
      keys.add("COLUMN " + name + "." + column);
      columns++;
    }
    checks += table.checks.length;
    for (const index of table.indexes) {
      requireMatch(idPattern.test(index.name), "原生契约索引名称无效");
      ids.add("index." + name + "." + index.name);
      keys.add("INDEX " + index.name);
      indexes++;
    }
    for (const key of table.foreignKeys) {
      requireMatch(idPattern.test(key.name), "原生契约外键名称无效");
      ids.add("foreignKey." + name + "." + key.name);
      foreignKeys++;
    }
    if (["scada_tag_history_batches", "scada_tag_history_records"].includes(name)) {
      keys.add("INDEX " + table.primaryKey.name);
    }
  }
  requireMatch(
    columns === 85 &&
      checks === 36 &&
      indexes === 20 &&
      foreignKeys === 13 &&
      ids.size === 45 &&
      keys.size === 119 &&
      createHash("sha256").update(commentText).digest("hex") === commentHash,
    "全新契约结构或初始中文注释指纹不一致",
  );
  const comments = [];
  for (const line of commentText.trimEnd().split("\n")) {
    const match = line.match(
      /^COMMENT ON (TABLE|COLUMN|INDEX) "public"\."(scada_[a-z0-9_]+)"(?:\."([a-z_][a-z0-9_]*)")? IS '((?:''|[^'])*)';$/u,
    );
    requireMatch(match !== null, "初始中文注释不是固定单行语句");
    const [, kind, relation, column, literal] = match;
    const key = kind + " " + relation + (column ? "." + column : "");
    const comment = literal.replaceAll("''", "'");
    requireMatch(
      (kind === "COLUMN") === Boolean(column) &&
        keys.delete(key) &&
        /[\u3400-\u9fff]/u.test(comment) &&
        !comment.includes("\\"),
      "初始中文注释对象重复或不符合契约",
    );
    comments.push({ key, kind, relation, column: column ?? null, comment });
  }
  requireMatch(keys.size === 0 && comments.length === 119, "初始中文注释覆盖范围不完整");
  return {
    ids: [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    comments,
    tables: 12,
    columns,
    checks,
    indexes,
    foreignKeys,
  };
}

function resultOf(document, command) {
  const envelope = document?.envelope;
  requireMatch(
    document?.kind === "result" &&
      document.commandId === command &&
      envelope?.commandId === command &&
      envelope.ok === true &&
      envelope.exitCode === 0 &&
      Array.isArray(envelope.diagnostics) &&
      envelope.diagnostics.every((item) => item?.severity === "info") &&
      envelope.result?.ok === true,
    "Prisma 8 官方机器结果或诊断不符合成功条件",
  );
  return envelope.result;
}

/** 官方实时空库规划必须完整覆盖新增对象，拒绝删除、重命名或权限放宽。 */
export function reviewFreshUpdate(document, ids, mode, previousIds = []) {
  const result = resultOf(document, "db.update");
  const plan = result.plan;
  requireMatch(
    result.mode === mode &&
      plan?.targetId === "postgres" &&
      plan.destination?.storageHash === freshStorageHash &&
      Array.isArray(plan.operations) &&
      plan.operations.every(
        (operation) => operation?.operationClass === "additive" && typeof operation.id === "string",
      ) &&
      [result.appliedStatements, result.temporaryValues].every(
        (items) => Array.isArray(items) && items.length === 0,
      ),
    "官方全新初始化计划包含未知目标或非新增操作",
  );
  const actual = plan.operations
    .map((operation) => operation.id)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const expected = actual.includes("schema.public")
    ? [...ids, "schema.public"].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    : ids;
  requireMatch(isDeepStrictEqual(actual, expected), "官方新增对象清单与原生契约不一致");
  if (mode === "plan") {
    requireMatch(
      [result.dataLoss, result.accessChanges].every(
        (items) => Array.isArray(items) && items.length === 0,
      ) &&
        result.execution === undefined &&
        result.marker === undefined,
      "只读规划包含数据损失、访问变化或实际执行结果",
    );
  } else {
    requireMatch(
      isDeepStrictEqual(actual, previousIds) &&
        result.marker?.storageHash === freshStorageHash &&
        result.execution?.operationsPlanned === actual.length &&
        result.execution?.operationsExecuted === actual.length,
      "官方实际初始化结果与已核对计划或存储标识不一致",
    );
  }
  return actual;
}

/** 只核对官方严格验证成功，不将模拟或预览结果作为实际数据库通过。 */
export function requireFreshVerification(document) {
  resultOf(document, "db.verify");
}

/** 验证容器与宿主 TCP 连接观察到同一业务库、角色、版本和集群。 */
export function requireFreshIdentity(row, expected) {
  requireMatch(
    row?.database === "adui_scada" &&
      row.role === "adui_scada" &&
      row.sessionRole === "adui_scada" &&
      row.version === expected.version &&
      versionPattern.test(row.version) &&
      row.systemIdentifier === expected.systemIdentifier &&
      systemPattern.test(row.systemIdentifier) &&
      row.owner === true &&
      row.recovery === false,
    "本机业务库实际身份、所有者或 PostgreSQL 19 版本不一致",
  );
}

/** 只输出官方诊断码，不转发可能含凭据的原始机器输出。 */
export function freshDiagnosticCodes(...outputs) {
  /** @type {Set<string>} 已脱敏的官方诊断码集合 */
  const codes = new Set();
  for (const output of outputs) {
    if (typeof output !== "string") continue;
    let documents;
    try {
      documents = [JSON.parse(output)];
    } catch {
      documents = output.split(/\r?\n/u).flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    }
    for (const document of documents) {
      const envelope = document?.envelope;
      for (const item of [
        document,
        envelope?.error,
        ...(Array.isArray(envelope?.diagnostics) ? envelope.diagnostics : []),
      ]) {
        if (
          typeof item?.code === "string" &&
          /^[A-Z][A-Z0-9_]{0,40}\.[A-Z][A-Z0-9_]{0,80}$/u.test(item.code)
        )
          codes.add(item.code);
      }
    }
  }
  return [...codes].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
