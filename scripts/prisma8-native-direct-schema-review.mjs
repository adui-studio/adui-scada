import { requirePrisma8ReadOnlyTestUrl } from "../apps/server/src/database/prisma8-readonly-target.ts";

export class DirectSchemaReviewError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new DirectSchemaReviewError(message);
}

/** 仅在历史验收库使用固定只读启动设置，不接受调用者传入的连接选项。 */
export function directSchemaConnection(input) {
  const message = "直接结构对照仅允许本机历史验收库及有效凭据";
  try {
    requireMatch(typeof input === "string" && !input.includes("\\"), message);
    const url = new URL(requirePrisma8ReadOnlyTestUrl(input));
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    requireMatch(
      url.hostname === "127.0.0.1" &&
        /^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(user) &&
        password.length > 0 &&
        Array.from(password).every((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 && code !== 127;
        }),
      message,
    );
    const sessionSettings = {
      default_transaction_read_only: "on",
      statement_timeout: "5000",
      lock_timeout: "2000",
      search_path: "public",
    };
    url.searchParams.set(
      "options",
      Object.entries(sessionSettings)
        .map(([key, value]) => "-c " + key + "=" + value)
        .join(" "),
    );
    return { connection: url.toString(), options: { connectTimeoutMs: 5000, sessionSettings } };
  } catch {
    throw new DirectSchemaReviewError(message);
  }
}

function allowedPaths(contract) {
  const tables = contract.storage.namespaces.public.entries.table;
  const names = new Set([
    "database",
    "public",
    "table",
    "tables",
    "column",
    "columns",
    "primaryKey",
    "index",
    "indexes",
    "foreignKey",
    "foreignKeys",
    "check",
    "checks",
    "unique",
    "uniques",
    "default",
    "nullable",
    "dataType",
    "typeParams",
    "length",
    "precision",
  ]);
  for (const [name, table] of Object.entries(tables)) {
    names.add(name);
    for (const column of Object.keys(table.columns)) names.add(column);
    for (const item of [
      table.primaryKey,
      ...table.indexes,
      ...table.foreignKeys,
      ...table.checks,
      ...table.uniques,
    ]) {
      if (typeof item?.name === "string") names.add(item.name);
    }
  }
  return names;
}

/** 只返回固定目标、真假结果及契约声明范围内的差异路径，不输出原始诊断。 */
export function summarizeDirectSchemaResult(result, contract, strict) {
  const issues = result?.schema?.issues;
  const warnings = result?.schema?.warnings?.issues;
  requireMatch(
    typeof result?.ok === "boolean" &&
      result.meta?.strict === strict &&
      result.contract?.storageHash === contract.storage.storageHash &&
      Array.isArray(issues) &&
      Array.isArray(warnings) &&
      result.ok === (issues.length === 0),
    "官方直接结构验证结果形状或目标不一致",
  );
  const names = allowedPaths(contract);
  return {
    strict,
    ok: result.ok,
    issueCount: issues.length,
    warningCount: warnings.length,
    issuePaths: issues.map((issue) => {
      const path = issue?.path;
      return Array.isArray(path)
        ? path
            .slice(0, 32)
            .map((segment) =>
              typeof segment === "string" && names.has(segment) ? segment : "[已脱敏]",
            )
        : ["[未取得路径]"];
    }),
  };
}

/** 调用公开 schemaVerify，不调用迁移、签名、marker 读取或任何自定义 SQL。 */
export async function runDirectSchemaReview(createClient, input, contract) {
  const { connection, options } = directSchemaConnection(input);
  let stage = "初始化官方控制客户端";
  let client;
  let report;
  let failure;
  try {
    client = createClient();
    stage = "连接历史验收库";
    await client.connect(connection, options);
    const results = [];
    for (const strict of [false, true]) {
      stage = strict ? "直接严格结构验证" : "直接宽容结构验证";
      const result = await client.schemaVerify({ contract, strict });
      results.push(summarizeDirectSchemaResult(result, contract, strict));
    }
    report = {
      status: "DIRECT_SCHEMA_REVIEW_REQUIRED",
      database: "adui_scada_test",
      results,
      signingAllowed: false,
      deploymentAllowed: false,
    };
  } catch {
    failure = stage + "失败，内部详情已脱敏";
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        const reason = "官方控制客户端关闭失败，内部详情已脱敏";
        failure = failure ? failure + "；" + reason : reason;
      }
    }
  }
  if (failure || !report) throw new DirectSchemaReviewError(failure ?? "未取得直接结构验证结果");
  return report;
}
