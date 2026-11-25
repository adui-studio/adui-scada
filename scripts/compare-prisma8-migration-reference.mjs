import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  requirePrisma8ReadOnlyReferenceUrl,
  requirePrisma8ReadOnlyTestUrl,
} from "../apps/server/src/database/prisma8-readonly-target.ts";
import {
  compareMigrationDatabases,
  loadMigrationBaseline,
  PreflightError,
} from "./inspect-prisma8-migration-readiness.mjs";

async function main() {
  if (process.argv.length !== 2) {
    throw new PreflightError("迁移参考库对照不接受命令行参数");
  }
  let testUrl;
  let referenceUrl;
  try {
    testUrl = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
    referenceUrl = requirePrisma8ReadOnlyReferenceUrl(
      process.env.SCADA_MIGRATION_REFERENCE_DATABASE_URL,
    );
  } catch {
    throw new PreflightError("必须显式提供本机验收库与独立参考库的两个受控连接");
  }

  const baseline = loadMigrationBaseline();
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
  const result = await compareMigrationDatabases(testClient, referenceClient, baseline);
  console.info("验收库与独立参考库的受检目录定义逐项一致");
  console.info("契约存储哈希：" + result.contractHash);
  console.info("验收库目录指纹：" + result.catalogFingerprint);
  console.info("参考库目录指纹：" + result.referenceFingerprint);
  console.info("对照状态：MATCHED_REVIEW_REQUIRED；签名许可：否");
}

void main().catch((error) => {
  const message = error instanceof PreflightError ? error.message : "迁移参考库对照初始化失败";
  console.error(message);
  process.exitCode = 1;
});
