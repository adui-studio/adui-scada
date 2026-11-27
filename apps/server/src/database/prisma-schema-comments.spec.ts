import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

/** 全新原生数据库的模型注释与 SQL 注释必须共同保留。 */
const schema = readFileSync(new URL("../../prisma/contract.prisma", import.meta.url), "utf8");
const comments = readFileSync(
  new URL("../../prisma/initial-comments.sql", import.meta.url),
  "utf8",
);

describe("全新原生契约中文注释", () => {
  it("模型和字段均有中文说明", () => {
    let previous = "";
    let model = false;
    let count = 0;
    for (const line of schema.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (/^model \w+ \{/.test(line)) {
        expect(previous).toMatch(/^\/\/\/.*[一-龥]/);
        count += 1;
        model = true;
      } else if (trimmed === "}") {
        model = false;
      } else if (model && /^\w+\s+\S/.test(trimmed)) {
        expect(previous).toMatch(/^\/\/\/.*[一-龥]/);
      }
      if (trimmed) previous = trimmed;
    }
    expect(count).toBe(12);
  });
  it("表、字段及约束中文注释和约束总数保持完整", () => {
    const statements = comments.split(/\r?\n/).filter((line) => line.startsWith("COMMENT ON "));
    expect(statements).toHaveLength(119);
    expect(statements.every((line) => /[一-龥]/.test(line))).toBe(true);
    expect(schema.match(/^  @@check\(/gm)).toHaveLength(36);
  });
});
