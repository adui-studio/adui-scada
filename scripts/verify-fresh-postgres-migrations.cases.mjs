import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildFreshDatabaseUrl } from "./verify-fresh-postgres-migrations.mjs";

const source =
  "postgresql://test-user:example-password@127.0.0.1:15432/adui_scada?schema=public";

void describe("全新 PostgreSQL 空库校验保护", () => {
  void it("只替换受控数据库名称并保持本机地址、账号和参数", () => {
    const actual = buildFreshDatabaseUrl(source, "adui_scada_fresh_20261116", "15432");
    const url = new URL(actual);
    assert.equal(url.pathname, "/adui_scada_fresh_20261116");
    assert.equal(url.port, "15432");
    assert.equal(url.searchParams.get("schema"), "public");
    assert.equal(url.username, "test-user");
  });

  void it("拒绝直接使用开发库和已复验的隔离测试库", () => {
    assert.throws(() => buildFreshDatabaseUrl(source, "adui_scada", "15432"), /受控测试名称/);
    assert.throws(
      () => buildFreshDatabaseUrl(source, "adui_scada_test", "15432"),
      /受控测试名称/,
    );
  });

  void it("拒绝非本机地址和不一致的端口", () => {
    assert.throws(
      () => buildFreshDatabaseUrl(
        source.replace("127.0.0.1", "db.example.org"),
        "adui_scada_fresh_a",
        "15432",
      ),
      /只允许/,
    );
    assert.throws(() => buildFreshDatabaseUrl(source, "adui_scada_fresh_a", "5432"), /只允许/);
  });

  void it("拒绝用已切换到测试库的连接再次推导目标", () => {
    assert.throws(
      () => buildFreshDatabaseUrl(
        source.replace("/adui_scada?", "/adui_scada_test?"),
        "adui_scada_fresh_a",
        "15432",
      ),
      /只允许/,
    );
  });

  void it("拒绝非 public Schema 和嵌入的其他连接参数", () => {
    assert.throws(
      () => buildFreshDatabaseUrl(
        source.replace("schema=public", "schema=internal"),
        "adui_scada_fresh_a",
        "15432",
      ),
      /只允许/,
    );
    assert.throws(
      () => buildFreshDatabaseUrl(source + "&options=unsafe", "adui_scada_fresh_a", "15432"),
      /只允许/,
    );
  });

  void it("拒绝不规范的数据库名称与非 PostgreSQL 地址", () => {
    assert.throws(
      () => buildFreshDatabaseUrl(source, "adui_scada_fresh_;DROP TABLE", "15432"),
      /受控测试名称/,
    );
    assert.throws(
      () => buildFreshDatabaseUrl(
        "https://127.0.0.1:15432/adui_scada",
        "adui_scada_fresh_a",
        "15432",
      ),
      /只允许/,
    );
  });
});
