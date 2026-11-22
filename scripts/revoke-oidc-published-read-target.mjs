import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolvePublishedRevocationPreflightTarget } from "./preflight-oidc-published-revocation.mjs";
import {
  assertPublishedRevocationAfterRows,
  assertPublishedRevocationTargetRows,
  inspectPublishedRevocationTarget,
  readPublishedRevocationRows,
} from "./preflight-oidc-published-revocation-target.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const PROJECT_PATTERN =
  /^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ERRORS = new Set([
  "D5b4g 仅允许独立专用工程的只读预检或完整双重确认",
  "D5b4g 只能使用可信本机 OIDC Lab",
  "D5b4g 单条 release:read 撤权事务未能确认，禁止自动重试或恢复",
]);

/** 默认只读；目标 ID 必须重复确认，才允许进入撤权事务。 */
export function parseD5b4gRevocationMode(args) {
  if (
    !Array.isArray(args) ||
    args[0] !== "--project-id" ||
    !PROJECT_PATTERN.test(args[1] ?? "")
  ) {
    throw new Error("D5b4g 仅允许独立专用工程的只读预检或完整双重确认");
  }
  if (args.length === 2) return { projectId: args[1], apply: false };
  if (
    args.length === 7 &&
    args[2] === "--apply" &&
    args[3] === "--confirm-lab" &&
    args[4] === "adui_scada" &&
    args[5] === "--confirm-project" &&
    args[6] === args[1]
  ) {
    return { projectId: args[1], apply: true };
  }
  throw new Error("D5b4g 仅允许独立专用工程的只读预检或完整双重确认");
}

/** 只允许固定类别出现在 CLI，不公开 SQL、连接串或异常正文。 */
export function describeD5b4gRevocationFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return "D5b4g 独立撤权候选未通过，内部信息已脱敏";
}

/**
 * 只限经独立授权的新 D5b4 工程，且只删除创建者的一条 release:read。
 * 独立只读预检通过后在 SERIALIZABLE 锁内重新核对全部 D5b4c 基线，
 * 删除后在事务内核对 D5b4e 基线，再提交并以新只读事务核对结果。
 * 返回 true 代表在当前数据库连接中确实已观察到撤权后状态。
 */
export async function revokeD5b4PublishedRead(client, target, projectId) {
  if (!PROJECT_PATTERN.test(projectId)) {
    throw new Error("D5b4g 仅允许独立专用工程的只读预检或完整双重确认");
  }
  const failure = "D5b4g 单条 release:read 撤权事务未能确认，禁止自动重试或恢复";
  await inspectPublishedRevocationTarget(client, target, projectId);
  let committed = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      const scope = ["lab-tenant", projectId];
      const locked = await client.query(
        "SELECT head_revision FROM public.scada_projects " +
          "WHERE tenant_id = $1 AND project_id = $2 FOR UPDATE",
        scope,
      );
      if (locked.rows.length !== 1 || String(locked.rows[0].head_revision) !== "1") {
        throw new Error(failure);
      }
      const before = await readPublishedRevocationRows(client, target, projectId);
      assertPublishedRevocationTargetRows(before, projectId);
      const deleted = await client.query(
        "DELETE FROM public.scada_project_grants " +
          "WHERE tenant_id = $1 AND project_id = $2 AND subject_id = $3 " +
          "AND permission = 'release:read' RETURNING subject_id, permission",
        ["lab-tenant", projectId, "lab-engineer"],
      );
      if (
        deleted.rows.length !== 1 ||
        deleted.rows[0].subject_id !== "lab-engineer" ||
        deleted.rows[0].permission !== "release:read"
      ) {
        throw new Error(failure);
      }
      const after = await readPublishedRevocationRows(client, target, projectId);
      assertPublishedRevocationAfterRows(after, projectId);
      await client.query("COMMIT");
      committed = true;
    } catch {
      if (!committed) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // 提交状态可能不确定，禁止自动重试或补偿写入。
        }
      }
      throw new Error(failure);
    }
    await inspectPublishedRevocationTarget(client, target, projectId, "after");
    return true;
  } catch {
    throw new Error(failure);
  }
}

async function run() {
  const mode = parseD5b4gRevocationMode(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b4g 只能使用可信本机 OIDC Lab");
  loadEnvFile(ROOT_ENV);
  let target;
  try {
    target = resolvePublishedRevocationPreflightTarget(process.env);
  } catch {
    throw new Error("D5b4g 只能使用可信本机 OIDC Lab");
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
    if (!mode.apply) {
      await inspectPublishedRevocationTarget(client, target, mode.projectId);
      process.stdout.write("D5b4g 只读预检通过；未执行单条 ACL 撤销。\n");
      return;
    }
    await revokeD5b4PublishedRead(client, target, mode.projectId);
    process.stdout.write(
      "D5b4g 单条 release:read 撤销与撤权后数据库只读审计通过。\n",
    );
    process.stdout.write("尚未执行 React/Vue 双框架真实撤权后验收，不自动恢复授权。\n");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeD5b4gRevocationFailure(error) + "\n");
    process.exitCode = 1;
  });
}
