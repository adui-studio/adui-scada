import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

/**
 * 模型中文说明由 Prisma 的 /// 文档注释维护；Navicat 展示的数据库注释
 * 必须另外通过迁移 SQL 的 COMMENT ON TABLE / COLUMN 写入 PostgreSQL。
 * 本测试校验当前全部模型和持久化字段，未来新建表时也会自动纳入检查。
 */
const prismaRoot = new URL("../../prisma/", import.meta.url);
const schema = readFileSync(new URL("schema.prisma", prismaRoot), "utf8");
const migrationsRoot = new URL("migrations/", prismaRoot);
const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readFileSync(new URL(`${entry.name}/migration.sql`, migrationsRoot), "utf8"))
  .join("\n");
const releaseMigration = readFileSync(
  new URL("20261118000000_release_state_and_events/migration.sql", migrationsRoot),
  "utf8",
);
const releaseIntegrityMigration = readFileSync(
  new URL("20261119000000_release_state_event_integrity/migration.sql", migrationsRoot),
  "utf8",
);

const chinese = /[一-龥]/;
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];

function readModelFields(body: string) {
  const lines = body.split("\n");
  const fields: Array<{ name: string; line: string; description: string }> = [];
  let description = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("///")) {
      description = trimmed;
      continue;
    }
    const field = line.match(/^  (\w+)\s+\S+/);
    if (field) {
      fields.push({ name: field[1]!, line, description });
    }
    description = "";
  }
  return fields;
}

function commentText(kind: "TABLE" | "COLUMN", identifier: string): string | null {
  // 只读取真实 COMMENT ON 语句；不把普通 SQL 注释误认为数据库元数据。
  const statement = migrations
    .split("\n")
    .find((line) => line.startsWith(`COMMENT ON ${kind} ${identifier} IS '`));
  if (!statement) return null;
  return statement.slice(statement.indexOf(" IS '") + 5, statement.lastIndexOf("'"));
}

describe("Prisma 模型及 PostgreSQL 数据库中文注释约束", () => {
  it("每个业务模型和全部模型属性都有中文文档说明", () => {
    expect(models.length).toBeGreaterThan(0);
    for (const match of models) {
      const previousLine = schema.slice(0, match.index).trimEnd().split("\n").at(-1);
      expect(previousLine).toMatch(chinese);
      expect(previousLine?.trim().startsWith("///")).toBe(true);
      for (const field of readModelFields(match[2]!)) {
        expect(field.description).toMatch(chinese);
        expect(field.description.startsWith("///")).toBe(true);
      }
    }
  });

  it("正式发布迁移的哈希约束完整且 DDL 使用单一事务", () => {
    const hashChecks = releaseMigration
      .split("\n")
      .filter((line) =>
        /release_event_(?:from|to|semantic)_hash_check|release_state_hash_check/.test(line),
      );

    expect(hashChecks).toHaveLength(4);
    expect(hashChecks.every((line) => line.includes("~ '^[0-9a-f]{64}$')"))).toBe(true);
    expect(releaseMigration.match(/^CREATE TABLE /gm)).toHaveLength(2);
    expect(releaseMigration).toContain("\nBEGIN;\n");
    expect(releaseMigration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
  it("失败迁移遗留的旧工程权限约束会被完整替换", () => {
    const dropStatement = 'DROP CONSTRAINT IF EXISTS "scada_project_grants_permission_check"';
    const addStatement = 'ADD CONSTRAINT "scada_project_grants_permission_check"';
    const permissionCheck =
      "CHECK (\"permission\" IN ('project:read', 'version:read', 'version:append', 'release:publish', 'release:rollback'))";

    expect(releaseMigration).toContain(dropStatement);
    expect(releaseMigration).toContain(addStatement);
    expect(releaseMigration).toContain(permissionCheck);
    expect(releaseMigration.indexOf(dropStatement)).toBeLessThan(
      releaseMigration.indexOf(addStatement),
    );
  });

  it("Prisma 字段级关联属性必须完整写在单行", () => {
    const relationLines = schema.split(/\r?\n/).filter((line) => line.includes("@relation("));
    expect(relationLines.length).toBeGreaterThan(0);
    expect(relationLines.every((line) => line.includes(")"))).toBe(true);
  });

  it("发布状态、事件与不可变版本通过复合外键保持租户工程代次和摘要闭包", () => {
    expect(schema).toContain(
      '@@unique([tenantId, projectId, revision, contentHash], map: "scada_project_versions_snapshot_reference_key")',
    );
    expect(schema).toContain(
      '@@unique([tenantId, projectId, generation, toRevision, toContentHash, eventId], map: "scada_project_release_event_state_reference_key")',
    );
    expect(schema).toContain(
      'lastReleaseEventId  String?                 @unique(map: "scada_project_release_state_last_event_key") @map("last_release_event_id") @db.Uuid',
    );
    expect(schema).toContain(
      'lastReleaseEvent ScadaProjectReleaseEvent? @relation("ScadaProjectReleaseStateLastEvent", fields: [lastReleaseEventId], references: [eventId], onDelete: Restrict, onUpdate: Cascade)',
    );
    expect(releaseIntegrityMigration).toContain(
      'FOREIGN KEY ("tenant_id", "project_id", "released_revision", "released_content_hash")',
    );
    // 仅忽略 SQL 排版空白，仍校验约束名称、六字段顺序、引用目标和删除/更新规则。
    const normalizedIntegrityMigration = releaseIntegrityMigration.replace(/\s+/g, "");
    const lastReleaseEventForeignKey = [
      'ADD CONSTRAINT "scada_project_release_state_last_event_fkey"',
      'FOREIGN KEY ("tenant_id", "project_id", "release_generation", "released_revision", "released_content_hash", "last_release_event_id")',
      'REFERENCES "scada_project_release_events" ("tenant_id", "project_id", "generation", "to_revision", "to_content_hash", "event_id")',
      "ON DELETE RESTRICT ON UPDATE CASCADE;",
    ]
      .join(" ")
      .replace(/\s+/g, "");
    expect(normalizedIntegrityMigration).toContain(lastReleaseEventForeignKey);
    expect(releaseIntegrityMigration).toContain(
      'FOREIGN KEY ("tenant_id", "project_id", "from_revision", "from_content_hash")',
    );
    expect(releaseIntegrityMigration).toContain(
      'FOREIGN KEY ("tenant_id", "project_id", "to_revision", "to_content_hash")',
    );
    expect(releaseIntegrityMigration.match(/^CREATE (?:UNIQUE )?INDEX /gm)).toHaveLength(5);
    expect(releaseIntegrityMigration).toContain("BEGIN;");
    expect(releaseIntegrityMigration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("所有 Prisma 业务表和实际持久化字段都有中文数据库注释", () => {
    for (const match of models) {
      const body = match[2]!;
      const mappedTable = body.match(/@@map\("([^"]+)"\)/)?.[1];
      const tableName = mappedTable ?? match[1]!;
      expect(commentText("TABLE", `"${tableName}"`)).toMatch(chinese);
      for (const field of readModelFields(body)) {
        // 关联属性不对应 PostgreSQL 物理列，只要求 Prisma 中文说明。
        const fieldType = field.line
          .trim()
          .split(/\s+/)[1]
          ?.replace(/[[\]?]/g, "");
        const modelTypes = new Set(models.map((entry) => entry[1]));
        if (field.line.includes("@relation(") || modelTypes.has(fieldType ?? "")) continue;
        const columnName = field.line.match(/@map\("([^"]+)"\)/)?.[1] ?? field.name;
        expect(commentText("COLUMN", `"${tableName}"."${columnName}"`)).toMatch(chinese);
      }
    }
  });
});
