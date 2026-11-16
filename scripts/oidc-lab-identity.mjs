import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReadonlyProbeOrigins } from "./verify-oidc-https-readonly.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const LAB_DATABASE = "adui_scada_oidc_lab";
const LAB_DATABASE_USER = "adui_scada_oidc_lab";
const REQUIRED_MIGRATION = "20261114000000_oidc_identity_transactions";
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const KEYCLOAK_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ERRORS = new Set([
  "必须明确指定本机租户、主体和 Keycloak 用户 UUID",
  "身份绑定参数不允许重复或包含未知选项",
  "本地租户或主体标识格式无效",
  "Keycloak 用户标识必须是从管理后台核对的 UUID",
  "执行写入必须明确确认独立 OIDC Lab 数据库",
  "只读预览不能携带写入确认参数",
  "身份绑定工具仅允许可信非生产回环 OIDC Lab",
  "OIDC Lab 数据库连接配置与实际隔离目标不一致",
  "Keycloak Issuer 与本机受控 Realm 不一致",
  "隔离数据库缺少已完成的 OIDC 身份迁移",
  "外部 Keycloak 主体已绑定其他本地身份，拒绝覆盖",
  "本地主体已停用，拒绝重新激活",
  "本地主体已有其他外部身份，拒绝追加绑定",
  "本地主体已有工程 ACL，拒绝隐式关联授权",
]);

/** 默认仅读取现有绑定，只有双重显式确认才能新增本机测试身份。 */
export function parseLabIdentityArgs(args) {
  const fields = new Map();
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--apply") {
      if (apply) throw new Error("身份绑定参数不允许重复或包含未知选项");
      apply = true;
      continue;
    }
    if (
      !["--tenant", "--subject", "--keycloak-sub", "--confirm-lab"].includes(flag) ||
      fields.has(flag) ||
      index + 1 >= args.length ||
      args[index + 1]?.startsWith("--")
    ) {
      throw new Error("身份绑定参数不允许重复或包含未知选项");
    }
    fields.set(flag, args[++index]);
  }
  const tenantId = fields.get("--tenant");
  const subjectId = fields.get("--subject");
  const keycloakSub = fields.get("--keycloak-sub");
  if (!tenantId || !subjectId || !keycloakSub) {
    throw new Error("必须明确指定本机租户、主体和 Keycloak 用户 UUID");
  }
  if (!ID_PATTERN.test(tenantId) || !ID_PATTERN.test(subjectId)) {
    throw new Error("本地租户或主体标识格式无效");
  }
  if (!KEYCLOAK_UUID_PATTERN.test(keycloakSub)) {
    throw new Error("Keycloak 用户标识必须是从管理后台核对的 UUID");
  }
  if (apply && fields.get("--confirm-lab") !== LAB_DATABASE) {
    throw new Error("执行写入必须明确确认独立 OIDC Lab 数据库");
  }
  if (!apply && fields.has("--confirm-lab")) {
    throw new Error("只读预览不能携带写入确认参数");
  }
  return Object.freeze({ tenantId, subjectId, keycloakSub: keycloakSub.toLowerCase(), apply });
}

/** 不接受任何生产、远程、普通开发库或陌生身份提供方目标。 */
export function resolveLabIdentityTarget(env) {
  if (
    env.NODE_ENV === "production" ||
    env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    env.SCADA_OIDC_ALLOW_INSECURE_LOOPBACK !== "false" ||
    env.SCADA_LOCAL_DEMO_API_ENABLED !== "false"
  ) {
    throw new Error("身份绑定工具仅允许可信非生产回环 OIDC Lab");
  }

  try {
    resolveReadonlyProbeOrigins(env);
  } catch {
    throw new Error("身份绑定工具仅允许可信非生产回环 OIDC Lab");
  }

  const keycloakPort = env.SCADA_LAB_KEYCLOAK_PORT;
  if (
    typeof keycloakPort !== "string" ||
    !/^[1-9][0-9]{0,4}$/.test(keycloakPort) ||
    Number(keycloakPort) > 65535 ||
    env.SCADA_OIDC_ISSUER !== `https://127.0.0.1:${keycloakPort}/realms/adui-scada`
  ) {
    throw new Error("Keycloak Issuer 与本机受控 Realm 不一致");
  }

  let url;
  try {
    url = new URL(env.SCADA_DATABASE_URL);
  } catch {
    throw new Error("OIDC Lab 数据库连接配置与实际隔离目标不一致");
  }
  const port = env.SCADA_LAB_POSTGRES_PORT;
  const validPort =
    typeof port === "string" &&
    /^[1-9][0-9]{0,4}$/.test(port) &&
    Number(port) <= 65535;
  const options = [...url.searchParams];
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    !validPort ||
    url.port !== port ||
    url.pathname !== `/${LAB_DATABASE}` ||
    url.username !== LAB_DATABASE_USER ||
    !url.password ||
    url.hash ||
    options.length !== 1 ||
    options[0]?.[0] !== "schema" ||
    options[0]?.[1] !== "public" ||
    env.SCADA_DB_HOST !== "127.0.0.1" ||
    env.SCADA_DB_PORT !== port ||
    env.SCADA_DB_NAME !== LAB_DATABASE ||
    env.SCADA_DB_USER !== LAB_DATABASE_USER
  ) {
    throw new Error("OIDC Lab 数据库连接配置与实际隔离目标不一致");
  }
  return Object.freeze({ connectionString: url.href, issuer: env.SCADA_OIDC_ISSUER });
}

/**
 * 仅操作经过硬编码 Lab 目标校验的受控数据库。
 * 预览永远 ROLLBACK；写入只允许新建 active 测试主体与一条映射，绝不写工程授权。
 */
export async function reconcileLabIdentity(client, target, binding) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const migration = await client.query(
      'SELECT 1 FROM public."_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1',
      [REQUIRED_MIGRATION],
    );
    if (migration.rows.length !== 1) {
      throw new Error("隔离数据库缺少已完成的 OIDC 身份迁移");
    }

    const external = await client.query(
      "SELECT tenant_id, subject_id FROM public.scada_external_identities WHERE issuer = $1 AND subject = $2 FOR UPDATE",
      [target.issuer, binding.keycloakSub],
    );
    const identity = await client.query(
      "SELECT status FROM public.scada_identities WHERE tenant_id = $1 AND subject_id = $2 FOR UPDATE",
      [binding.tenantId, binding.subjectId],
    );
    if (
      external.rows.length > 0 &&
      (external.rows[0].tenant_id !== binding.tenantId ||
        external.rows[0].subject_id !== binding.subjectId)
    ) {
      throw new Error("外部 Keycloak 主体已绑定其他本地身份，拒绝覆盖");
    }
    if (identity.rows.length > 0 && identity.rows[0].status !== "active") {
      throw new Error("本地主体已停用，拒绝重新激活");
    }
    if (external.rows.length === 0) {
      const existing = await client.query(
        "SELECT 1 FROM public.scada_external_identities WHERE tenant_id = $1 AND subject_id = $2 LIMIT 1",
        [binding.tenantId, binding.subjectId],
      );
      if (existing.rows.length > 0) {
        throw new Error("本地主体已有其他外部身份，拒绝追加绑定");
      }
      const grants = await client.query(
        "SELECT 1 FROM public.scada_project_grants WHERE tenant_id = $1 AND subject_id = $2 LIMIT 1",
        [binding.tenantId, binding.subjectId],
      );
      if (grants.rows.length > 0) {
        throw new Error("本地主体已有工程 ACL，拒绝隐式关联授权");
      }
    }

    if (!binding.apply) {
      await client.query("ROLLBACK");
      return external.rows.length === 1 ? "已存在匹配的可信预绑定，仅完成只读核对" : "只读预览完成：未发现冲突，未写入数据库";
    }

    if (external.rows.length === 0) {
      if (identity.rows.length === 0) {
        await client.query(
          "INSERT INTO public.scada_identities (tenant_id, subject_id, status, updated_at) VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)",
          [binding.tenantId, binding.subjectId],
        );
      }
      await client.query(
        "INSERT INTO public.scada_external_identities (issuer, subject, tenant_id, subject_id) VALUES ($1, $2, $3, $4)",
        [target.issuer, binding.keycloakSub, binding.tenantId, binding.subjectId],
      );
    }
    await client.query("COMMIT");
    return external.rows.length === 1 ? "已有匹配的可信身份预绑定，未新增记录" : "本机测试身份预绑定已提交，未授予任何工程权限";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** 连接始终回收，数据库错误不会在终端暴露用户名、凭据或 SQL 参数。 */
export async function runLabIdentityBinding(env, args, Client) {
  const binding = parseLabIdentityArgs(args);
  const target = resolveLabIdentityTarget(env);
  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  try {
    await client.connect();
    return await reconcileLabIdentity(client, target, binding);
  } finally {
    await client.end();
  }
}

export function describeLabIdentityFailure(error) {
  return error instanceof Error && SAFE_ERRORS.has(error.message)
    ? error.message
    : "本机身份绑定操作失败，请检查数据库或配置，不会输出原始异常";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!existsSync(ROOT_ENV)) throw new Error("身份绑定工具仅允许可信非生产回环 OIDC Lab");
    loadEnvFile(ROOT_ENV);
    const serverRequire = createRequire(SERVER_PACKAGE);
    const { Client } = serverRequire("pg");
    console.log(await runLabIdentityBinding(process.env, process.argv.slice(2), Client));
  } catch (error) {
    console.error("OIDC Lab 身份绑定失败：" + describeLabIdentityFailure(error));
    process.exitCode = 1;
  }
}
