import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolvePublishedRevocationPreflightTarget } from "./preflight-oidc-published-revocation.mjs";
import { inspectPublishedRevocationTarget } from "./preflight-oidc-published-revocation-target.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const PROJECT_PATTERN =
  /^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ERRORS = new Set([
  "D5b4e 参数仅允许现有独立专用工程 ID，禁止写入模式",
  "D5b4e 只能连接可信本机 OIDC Lab",
  "D5b4e 目标数据库、迁移或可信身份不符合预期",
  "D5b4e 独立工程不存在、不唯一或出现额外工程",
  "D5b4e 独立工程首版、审计或未发布状态不符合预期",
  "D5b4e 独立工程 release:read 权限不符合预期",
  "D5b4e 原 D5b1 工程或授权发生变化",
]);

/** 必须由维护者指定已实际撤权的唯一专用工程；不接受写入参数。 */
export function parsePublishedRevocationAfterArgs(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 2 ||
    args[0] !== "--project-id" ||
    !PROJECT_PATTERN.test(args[1] ?? "")
  ) {
    throw new Error("D5b4e 参数仅允许现有独立专用工程 ID，禁止写入模式");
  }
  return { projectId: args[1] };
}

/** 只公布固定中文错误类别，避免数据库地址、SQL 或身份泄漏。 */
export function describePublishedRevocationAfterFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return "D5b4e 撤权后数据库只读审计失败，内部诊断已脱敏";
}

/** 仅复用已审核的 D5b4c 查询与 READ ONLY/ROLLBACK 生命周期。 */
export async function inspectPublishedRevocationAfter(client, target, projectId) {
  if (!PROJECT_PATTERN.test(projectId)) {
    throw new Error("D5b4e 参数仅允许现有独立专用工程 ID，禁止写入模式");
  }
  return inspectPublishedRevocationTarget(client, target, projectId, "after");
}

async function run() {
  const { projectId } = parsePublishedRevocationAfterArgs(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b4e 只能连接可信本机 OIDC Lab");
  loadEnvFile(ROOT_ENV);
  let target;
  try {
    target = resolvePublishedRevocationPreflightTarget(process.env);
  } catch {
    throw new Error("D5b4e 只能连接可信本机 OIDC Lab");
  }
  const requireServer = createRequire(SERVER_PACKAGE);
  const { Client } = requireServer("pg");
  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  try {
    await client.connect();
    await inspectPublishedRevocationAfter(client, target, projectId);
    process.stdout.write(
      "D5b4e 撤权后只读审计通过：专用工程仅缺少 release:read，其他三项授权和原 D5b1 基线完整。\n",
    );
    process.stdout.write("该状态不能单独证明撤权曾发生；没有执行数据库写入或授权恢复。\n");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describePublishedRevocationAfterFailure(error) + "\n");
    process.exitCode = 1;
  });
}
