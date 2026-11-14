import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { PrismaService } from "../src/database/prisma.service.js";

// OIDC 数据库结构测试只允许连接本机独立测试数据库，不得触碰开发库或生产库。
const testUrl = process.env.SCADA_TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error("OIDC 数据库结构测试必须显式设置 SCADA_TEST_DATABASE_URL");
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(testUrl);
} catch {
  throw new Error("OIDC 数据库结构测试连接字符串格式无效");
}

if (
  !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) ||
  parsedUrl.pathname !== "/adui_scada_test" ||
  !["postgresql:", "postgres:"].includes(parsedUrl.protocol)
) {
  throw new Error("OIDC 数据库结构测试仅允许连接本机 adui_scada_test 隔离数据库");
}

const originalDatabaseUrl = process.env.SCADA_DATABASE_URL;
let service: PrismaService | undefined;

beforeAll(async () => {
  process.env.SCADA_DATABASE_URL = testUrl;
  service = new PrismaService();
  await service.onModuleInit();
});

afterAll(async () => {
  try {
    await service?.onModuleDestroy();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.SCADA_DATABASE_URL;
    else process.env.SCADA_DATABASE_URL = originalDatabaseUrl;
  }
});

describe("OIDC PostgreSQL 增量迁移", () => {
  it("本次 OIDC 增量迁移已由 Prisma 成功登记", async () => {
    const migrations = await service!.client.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null }>
    >`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      WHERE migration_name = '20261114000000_oidc_identity_transactions'
        AND rolled_back_at IS NULL
    `;

    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.finished_at).toBeInstanceOf(Date);
  });

  it("外部身份表与一次性登录事务表均已创建并包含中文表注释", async () => {
    const tables = await service!.client.$queryRaw<
      Array<{ table_name: string; description: string | null }>
    >`
      SELECT c.relname AS table_name,
             obj_description(c.oid, 'pg_class') AS description
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN ('scada_external_identities', 'scada_oidc_transactions')
    `;

    expect(tables.map((row) => row.table_name).sort()).toEqual([
      "scada_external_identities",
      "scada_oidc_transactions",
    ]);
    for (const row of tables) {
      expect(row.description ?? "").toMatch(/[一-龥]/);
    }
  });

  it("OIDC 新增的十五个物理字段均存在中文数据库注释", async () => {
    const columns = await service!.client.$queryRaw<
      Array<{
        table_name: string;
        column_name: string;
        is_nullable: string;
        description: string | null;
      }>
    >`
      SELECT c.relname AS table_name,
             a.attname AS column_name,
             CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
             col_description(c.oid, a.attnum) AS description
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      JOIN pg_attribute AS a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND (
          (c.relname = 'scada_auth_sessions' AND a.attname = 'csrf_token_hash')
          OR c.relname = 'scada_external_identities'
          OR c.relname = 'scada_oidc_transactions'
        )
    `;

    const actual = new Set(columns.map((row) => row.table_name + "." + row.column_name));
    const expected = new Set([
      "scada_auth_sessions.csrf_token_hash",
      "scada_external_identities.issuer",
      "scada_external_identities.subject",
      "scada_external_identities.tenant_id",
      "scada_external_identities.subject_id",
      "scada_external_identities.created_at",
      "scada_oidc_transactions.state_hash",
      "scada_oidc_transactions.issuer",
      "scada_oidc_transactions.nonce",
      "scada_oidc_transactions.verifier_ciphertext",
      "scada_oidc_transactions.browser_binding_hash",
      "scada_oidc_transactions.return_path",
      "scada_oidc_transactions.created_at",
      "scada_oidc_transactions.expires_at",
      "scada_oidc_transactions.consumed_at",
    ]);

    expect(actual).toEqual(expected);
    for (const row of columns) {
      expect(row.description ?? "").toMatch(/[一-龥]/);
    }
    const csrfColumn = columns.find(
      (row) => row.table_name === "scada_auth_sessions" && row.column_name === "csrf_token_hash",
    );
    const consumedColumn = columns.find(
      (row) => row.table_name === "scada_oidc_transactions" && row.column_name === "consumed_at",
    );
    expect(csrfColumn?.is_nullable).toBe("YES");
    expect(consumedColumn?.is_nullable).toBe("YES");
  });

  it("外部身份复合外键与登录事务约束均已创建", async () => {
    const foreignKeys = await service!.client.$queryRaw<Array<{ constraint_name: string }>>`
      SELECT conname AS constraint_name
      FROM pg_constraint
      WHERE conrelid = 'public.scada_external_identities'::regclass
        AND contype = 'f'
    `;
    expect(foreignKeys.map((row) => row.constraint_name)).toContain(
      "scada_external_identities_identity_fkey",
    );

    const constraints = await service!.client.$queryRaw<Array<{ constraint_name: string }>>`
      SELECT conname AS constraint_name
      FROM pg_constraint
      WHERE conrelid = 'public.scada_oidc_transactions'::regclass
        AND contype = 'c'
    `;
    expect(new Set(constraints.map((row) => row.constraint_name))).toEqual(
      new Set([
        "scada_oidc_transactions_state_hash_check",
        "scada_oidc_transactions_binding_hash_check",
        "scada_oidc_transactions_expiry_check",
        "scada_oidc_transactions_return_path_check",
      ]),
    );

    const sessionConstraints = await service!.client.$queryRaw<
      Array<{ constraint_name: string }>
    >`
      SELECT conname AS constraint_name
      FROM pg_constraint
      WHERE conrelid = 'public.scada_auth_sessions'::regclass
        AND contype = 'c'
    `;
    expect(sessionConstraints.map((row) => row.constraint_name)).toContain(
      "scada_auth_sessions_csrf_token_hash_check",
    );
  });

  it("三个新增业务索引均存在中文数据库注释", async () => {
    const indexes = await service!.client.$queryRaw<
      Array<{ index_name: string; description: string | null }>
    >`
      SELECT index_class.relname AS index_name,
             obj_description(index_class.oid, 'pg_class') AS description
      FROM pg_index AS index_info
      JOIN pg_class AS index_class ON index_class.oid = index_info.indexrelid
      JOIN pg_class AS table_class ON table_class.oid = index_info.indrelid
      JOIN pg_namespace AS n ON n.oid = table_class.relnamespace
      WHERE n.nspname = 'public'
        AND index_class.relname IN (
          'scada_external_identities_identity_idx',
          'scada_oidc_transactions_expiry_idx',
          'scada_oidc_transactions_browser_idx'
        )
    `;

    expect(indexes.map((row) => row.index_name).sort()).toEqual([
      "scada_external_identities_identity_idx",
      "scada_oidc_transactions_browser_idx",
      "scada_oidc_transactions_expiry_idx",
    ]);
    for (const row of indexes) {
      expect(row.description ?? "").toMatch(/[一-龥]/);
    }
  });
});
