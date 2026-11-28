import assert from "node:assert/strict";
import { test } from "node:test";
import {
  B4_OIDC_CLEANUP_BATCH_SIZE,
  buildB4OidcCleanupBody,
  cleanupB4ExpiredOidc,
} from "../apps/server/src/database/prisma8-b4-oidc-cleanup.ts";
import { nativeTextTransaction } from "../apps/server/src/database/prisma8-text-transaction.ts";

const issuer = "https://127.0.0.1:18443/realms/adui-scada";

function fixture(rows, failed = false) {
  const plans = [];
  const tx = {
    raw: {
      sql(strings, ...parameters) {
        return { returnsRow: (columns) => ({ build: () => ({ text: strings.join("?"), parameters, columns }) }) };
      },
    },
    query(plan) {
      plans.push(plan);
      if (failed) throw new Error("模拟例程不存在");
      return { toArray: () => Promise.resolve(rows) };
    },
    execute() { throw new Error("禁止回退直接删除"); },
  };
  return { plans, port: nativeTextTransaction(tx, "OIDC 清理结果文本列无效") };
}

void test("固定清理函数体只使用规范化本机 Issuer、数据库时钟及固定批次", () => {
  const body = buildB4OidcCleanupBody(issuer);
  assert.equal(B4_OIDC_CLEANUP_BATCH_SIZE, 128);
  assert.equal(body.split(issuer).length - 1, 2);
  assert.equal((body.match(/expires_at <= CURRENT_TIMESTAMP/gu) ?? []).length, 2);
  assert.match(body, /LIMIT 128/u);
  assert.notEqual(body, buildB4OidcCleanupBody("https://127.0.0.1:18444/realms/adui-scada"));
  assert.match(buildB4OidcCleanupBody("https://127.0.0.1/realms/adui-scada"), /https:\/\/127\.0\.0\.1\/realms\/adui-scada/u);
});

void test("拒绝非本机、非规范端口、其他 Realm、注入及显式默认端口", async () => {
  for (const invalid of ["https://id.example.org/realms/scada", "http://127.0.0.1:18443/realms/adui-scada", "https://127.0.0.1:65536/realms/adui-scada", "https://127.0.0.1:443/realms/adui-scada", "https://127.0.0.1:018443/realms/adui-scada", issuer + "?x=1", issuer + "'", issuer + "/", issuer.replace("adui-scada", "other")]) {
    const h = fixture([{ deleted: "0" }]);
    await assert.rejects(() => cleanupB4ExpiredOidc(h.port, invalid), { message: "OIDC 清理例程 Issuer 未绑定固定本机部署" });
    assert.equal(h.plans.length, 0);
  }
});

void test("调用清理前在同一语句绑定精确函数体及安全属性", async () => {
  for (const count of [0, 1, 128]) {
    const h = fixture([{ deleted: String(count) }]);
    assert.equal(await cleanupB4ExpiredOidc(h.port, issuer), count);
    assert.equal(h.plans.length, 1);
    const [plan] = h.plans;
    assert.deepEqual(plan.parameters, [buildB4OidcCleanupBody(issuer)]);
    assert.deepEqual(plan.columns, { deleted: "pg/text@1" });
    assert.match(plan.text, /^SELECT CASE WHEN EXISTS \(/u);
    assert.match(plan.text, /p\.pronargs = 0/u);
    assert.match(plan.text, /p\.prosecdef/u);
    assert.match(plan.text, /r\.rolname = 'adui_scada_oidc_cleanup_owner' AND NOT r\.rolcanlogin/u);
    assert.match(plan.text, /p\.prosrc = \?::text\s+\) THEN public\.scada_cleanup_expired_oidc\(\)::text ELSE 'BINDING_MISMATCH' END AS deleted/u);
    assert.doesNotMatch(plan.text, /DELETE FROM/u);
  }
});

void test("异常计数、绑定漂移、缺失例程及无效列均拒绝且不回退", async () => {
  for (const rows of [[], [{ deleted: "129" }], [{ deleted: "-1" }], [{ deleted: "01" }], [{ deleted: "1.0" }], [{ deleted: "BINDING_MISMATCH" }], [{ deleted: "1" }, { deleted: "2" }]]) {
    const h = fixture(rows);
    await assert.rejects(() => cleanupB4ExpiredOidc(h.port, issuer), { message: "OIDC 清理例程绑定或返回行数异常" });
    assert.equal(h.plans.length, 1);
  }
  const malformed = fixture([{ deleted: null }]);
  await assert.rejects(() => cleanupB4ExpiredOidc(malformed.port, issuer), { message: "OIDC 清理结果文本列无效" });
  const missing = fixture([], true);
  await assert.rejects(() => cleanupB4ExpiredOidc(missing.port, issuer), { message: "模拟例程不存在" });
  assert.equal(missing.plans.length, 1);
});
