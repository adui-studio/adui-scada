import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { PrismaService } from "../src/database/prisma.service.js";

// 发布 Schema 数据库测试只允许连接本机独立测试数据库，不得触碰开发库或生产库。
const testUrl = process.env.SCADA_TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error("发布 Schema 数据库测试必须显式设置 SCADA_TEST_DATABASE_URL");
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(testUrl);
} catch {
  throw new Error("发布 Schema 数据库测试连接字符串格式无效");
}

if (
  !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) ||
  parsedUrl.pathname !== "/adui_scada_test" ||
  !["postgresql:", "postgres:"].includes(parsedUrl.protocol)
) {
  throw new Error("发布 Schema 数据库测试仅允许连接本机 adui_scada_test 隔离数据库");
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

describe("正式发布 PostgreSQL 增量迁移", () => {
  it("本次正式发布增量迁移已由 Prisma 成功登记", async () => {
    const migrations = await service!.client.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null }>
    >`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      WHERE migration_name = '20261118000000_release_state_and_events'
        AND rolled_back_at IS NULL
    `;

    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.finished_at).toBeInstanceOf(Date);
  });

  it("发布状态与发布事件表均已创建并包含中文表、字段注释", async () => {
    const tables = await service!.client.$queryRaw<
      Array<{ table_name: string; description: string | null }>
    >`
      SELECT c.relname AS table_name,
             obj_description(c.oid, 'pg_class') AS description
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN ('scada_project_release_state', 'scada_project_release_events')
    `;

    expect(tables.map((row) => row.table_name).sort()).toEqual([
      "scada_project_release_events",
      "scada_project_release_state",
    ]);
    for (const row of tables) {
      expect(row.description ?? "").toMatch(/[一-龥]/);
    }

    const columns = await service!.client.$queryRaw<
      Array<{ table_name: string; column_name: string; description: string | null }>
    >`
      SELECT c.relname AS table_name,
             a.attname AS column_name,
             col_description(c.oid, a.attnum) AS description
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      JOIN pg_attribute AS a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND c.relname IN ('scada_project_release_state', 'scada_project_release_events')
    `;

    expect(columns).toHaveLength(20);
    expect(columns.every((row) => /[一-龥]/.test(row.description ?? ""))).toBe(true);
  });

  it("发布状态、事件代次、幂等和权限约束均已建立", async () => {
    const stateConstraints = await service!.client.$queryRaw<Array<{ constraint_name: string }>>`
      SELECT conname AS constraint_name
      FROM pg_constraint
      WHERE conrelid = 'public.scada_project_release_state'::regclass
    `;
    expect(new Set(stateConstraints.map((row) => row.constraint_name))).toEqual(
      new Set([
        "scada_project_release_state_pkey",
        "scada_project_release_state_generation_check",
        "scada_project_release_state_revision_check",
        "scada_project_release_state_hash_pair_check",
        "scada_project_release_state_hash_check",
        "scada_project_release_state_project_fkey",
        "scada_project_release_state_version_fkey",
        "scada_project_release_state_last_event_fkey",
      ]),
    );

    const eventConstraints = await service!.client.$queryRaw<Array<{ constraint_name: string }>>`
      SELECT conname AS constraint_name
      FROM pg_constraint
      WHERE conrelid = 'public.scada_project_release_events'::regclass
    `;
    expect(new Set(eventConstraints.map((row) => row.constraint_name))).toEqual(
      new Set([
        "scada_project_release_events_pkey",
        "scada_project_release_event_generation_check",
        "scada_project_release_event_action_check",
        "scada_project_release_event_from_revision_check",
        "scada_project_release_event_hash_pair_check",
        "scada_project_release_event_from_hash_check",
        "scada_project_release_event_to_revision_check",
        "scada_project_release_event_to_hash_check",
        "scada_project_release_event_idempotency_key_check",
        "scada_project_release_event_semantic_hash_check",
        "scada_project_release_event_project_fkey",
        "scada_project_release_event_from_version_fkey",
        "scada_project_release_event_to_version_fkey",
      ]),
    );

    const grantConstraint = await service!.client.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.scada_project_grants'::regclass
        AND conname = 'scada_project_grants_permission_check'
    `;
    expect(grantConstraint).toHaveLength(1);
    expect(grantConstraint[0]?.definition).toContain("release:publish");
    expect(grantConstraint[0]?.definition).toContain("release:rollback");
  });

  it("正式发布业务索引均存在并具备中文数据库注释", async () => {
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
          'scada_project_release_state_last_event_key',
          'scada_project_release_event_generation_key',
          'scada_project_release_event_idempotency_key',
          'scada_project_release_event_project_created_idx',
          'scada_project_release_event_actor_created_idx'
        )
    `;

    expect(indexes.map((row) => row.index_name).sort()).toEqual([
      "scada_project_release_event_actor_created_idx",
      "scada_project_release_event_generation_key",
      "scada_project_release_event_idempotency_key",
      "scada_project_release_event_project_created_idx",
      "scada_project_release_state_last_event_key",
    ]);
    for (const row of indexes) {
      expect(row.description ?? "").toMatch(/[一-龥]/);
    }
  });

  it("迁移后的每个工程都有唯一 generation=0 的未发布状态且没有发布事件", async () => {
    const [projects, states, events] = await Promise.all([
      service!.client.scadaProject.count(),
      service!.client.scadaProjectReleaseState.count(),
      service!.client.scadaProjectReleaseEvent.count(),
    ]);

    expect(states).toBe(projects);
    expect(events).toBe(0);

    const invalidStates = await service!.client.scadaProjectReleaseState.count({
      where: {
        OR: [
          { releaseGeneration: { not: 0n } },
          { releasedRevision: { not: null } },
          { releasedContentHash: { not: null } },
          { lastReleaseEventId: { not: null } },
        ],
      },
    });
    expect(invalidStates).toBe(0);
  });
});
