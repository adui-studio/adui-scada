import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  requirePrisma8ReadOnlyReferenceUrl,
  requirePrisma8ReadOnlyTestUrl,
} from "../apps/server/src/database/prisma8-readonly-target.ts";
import {
  loadMigrationBaseline,
  PreflightError,
  readSupplementalMigrationCatalog,
} from "./inspect-prisma8-migration-readiness.mjs";
import {
  collectHistoricalComments,
  reviewCatalogSupplement,
  SupplementError,
} from "./prisma8-native-catalog-supplement.mjs";

async function main() {
  if (process.argv.length !== 2) {
    throw new SupplementError("目录补充核验不接受命令行参数");
  }
  let testUrl;
  let referenceUrl;
  try {
    testUrl = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
    referenceUrl = requirePrisma8ReadOnlyReferenceUrl(
      process.env.SCADA_MIGRATION_REFERENCE_DATABASE_URL,
    );
  } catch {
    throw new SupplementError("必须显式提供本机验收库与独立参考库的两个受控连接");
  }
  const baseline = loadMigrationBaseline();
  const sources = baseline.migrations.map(({ name, checksum }) => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../apps/server/prisma/migrations", name, "migration.sql"),
      "utf8",
    );
    if (createHash("sha256").update(source).digest("hex") !== checksum) {
      throw new SupplementError("历史迁移注释读取期间原文发生变化");
    }
    return source;
  });
  const history = collectHistoricalComments(sources);
  const serverRequire = createRequire(resolve(import.meta.dirname, "../apps/server/package.json"));
  const { Client } = serverRequire("pg");
  const options =
    "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c search_path=public";
  const testClient = new Client({
    connectionString: testUrl,
    connectionTimeoutMillis: 5000,
    options,
  });
  const referenceClient = new Client({
    connectionString: referenceUrl,
    connectionTimeoutMillis: 5000,
    options,
  });
  const { actual, reference } = await readSupplementalMigrationCatalog(
    testClient,
    referenceClient,
    baseline,
  );
  const result = reviewCatalogSupplement(baseline, actual, reference, history);
  console.info("原目录指纹：" + result.legacyFingerprint);
  console.info("补充范围：" + result.scope);
  console.info("补充目录指纹：" + result.fingerprint);
  console.info("主键索引：" + result.primaryIndexes + "；最终中文注释：" + result.comments);
  console.info("对照状态：MATCHED_REVIEW_REQUIRED；签名许可：否");
}

void main().catch((error) => {
  const message =
    error instanceof PreflightError || error instanceof SupplementError
      ? error.message
      : "目录补充核验初始化失败";
  console.error(message);
  process.exitCode = 1;
});
