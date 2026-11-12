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

  it("所有 Prisma 业务表和实际持久化字段都有中文数据库注释", () => {
    for (const match of models) {
      const body = match[2]!;
      const mappedTable = body.match(/@@map\("([^"]+)"\)/)?.[1];
      const tableName = mappedTable ?? match[1]!;
      expect(commentText("TABLE", `"${tableName}"`)).toMatch(chinese);
      for (const field of readModelFields(body)) {
        // 关联属性不对应 PostgreSQL 物理列，只要求 Prisma 中文说明。
        const fieldType = field.line.trim().split(/\s+/)[1]?.replace(/[\[\]?]/g, "");
        const modelTypes = new Set(models.map((entry) => entry[1]));
        if (field.line.includes("@relation(") || modelTypes.has(fieldType ?? "")) continue;
        const columnName = field.line.match(/@map\("([^"]+)"\)/)?.[1] ?? field.name;
        expect(commentText("COLUMN", `"${tableName}"."${columnName}"`)).toMatch(chinese);
      }
    }
  });
});
