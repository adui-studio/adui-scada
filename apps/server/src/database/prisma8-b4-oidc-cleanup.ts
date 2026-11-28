import type { Prisma8TextTransaction } from "./prisma8-text-transaction.js";

export const B4_OIDC_CLEANUP_BATCH_SIZE = 128;

/** 固定部署 Issuer 必须是已规范化的回环 HTTPS Realm，不能接受任意 SQL 字符。 */
export function buildB4OidcCleanupBody(issuer: string): string {
  const match = /^https:\/\/127\.0\.0\.1(?::([1-9][0-9]{0,4}))?\/realms\/adui-scada$/u.exec(issuer);
  if (!match || Number(match[1] ?? 443) > 65535 || new URL(issuer).href !== issuer) {
    throw new Error("OIDC 清理例程 Issuer 未绑定固定本机部署");
  }
  return `
WITH deleted AS (
  DELETE FROM public.scada_oidc_transactions t
  WHERE t.issuer = '${issuer}' AND t.expires_at <= CURRENT_TIMESTAMP
    AND t.state_hash IN (
      SELECT s.state_hash FROM public.scada_oidc_transactions s
      WHERE s.issuer = '${issuer}' AND s.expires_at <= CURRENT_TIMESTAMP
      ORDER BY s.expires_at ASC, s.state_hash ASC LIMIT ${B4_OIDC_CLEANUP_BATCH_SIZE}
    ) RETURNING 1
)
SELECT count(*) FROM deleted
`;
}

/** 同一语句检查已安装零参数例程与当前 Issuer 对应的完整固定函数体；不匹配不调用删除。 */
export async function cleanupB4ExpiredOidc(
  tx: Prisma8TextTransaction,
  issuer: string,
): Promise<number> {
  const body = buildB4OidcCleanupBody(issuer);
  const rows = await tx.queryText({ deleted: "pg/text@1" })`SELECT CASE WHEN EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND p.proname = 'scada_cleanup_expired_oidc'
      AND p.pronargs = 0 AND p.prokind = 'f' AND p.prorettype = 'pg_catalog.int8'::regtype
      AND p.prosecdef AND NOT p.proisstrict AND NOT p.proretset
      AND NOT p.proleakproof AND p.provolatile = 'v' AND p.proparallel = 'u'
      AND p.provariadic = 0 AND p.pronargdefaults = 0 AND p.prosupport = 0
      AND p.prosqlbody IS NULL AND p.probin IS NULL AND p.protrftypes IS NULL
      AND r.rolname = 'adui_scada_oidc_cleanup_owner' AND NOT r.rolcanlogin
      AND l.lanname = 'sql'
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp', 'row_security=on']::text[]
      AND pg_catalog.cardinality(p.proconfig) = 2
      AND p.prosrc = ${body}::text
  ) THEN public.scada_cleanup_expired_oidc()::text ELSE 'BINDING_MISMATCH' END AS deleted`;
  const count = rows[0]?.deleted;
  if (
    rows.length !== 1 || typeof count !== "string" || !/^(0|[1-9][0-9]{0,2})$/u.test(count) ||
    Number(count) > B4_OIDC_CLEANUP_BATCH_SIZE
  ) {
    throw new Error("OIDC 清理例程绑定或返回行数异常");
  }
  return Number(count);
}
