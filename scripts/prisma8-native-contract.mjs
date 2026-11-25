import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  requirePrisma8ReadOnlyReferenceUrl,
  requirePrisma8ReadOnlyTestUrl,
} from "../apps/server/src/database/prisma8-readonly-target.ts";
import {
  loadMigrationBaseline,
  PreflightError,
  readNativeContractCatalog,
} from "./inspect-prisma8-migration-readiness.mjs";
import {
  materializeNativeContract,
  nativeChecks,
  NativeContractReviewError,
  reviewNativeContract,
} from "./prisma8-native-contract-review.mjs";

const root = resolve(import.meta.dirname, "..");
const server = join(root, "apps", "server");
const artifact = join(root, ".artifacts", "prisma8-native");
const reviewedFingerprint = "73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52";
const reviewedContract = "054113c40b1e6f3b7609641e09868e45c0e969d8035e6e1376d10ac3e5148424";

function requireCondition(condition, message) {
  if (!condition) throw new PreflightError(message);
}

async function main() {
  requireCondition(process.argv.length === 2, "原生候选评审不接受额外参数");
  let testUrl;
  let referenceUrl;
  try {
    testUrl = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
    referenceUrl = requirePrisma8ReadOnlyReferenceUrl(
      process.env.SCADA_MIGRATION_REFERENCE_DATABASE_URL,
    );
  } catch {
    throw new PreflightError("原生候选评审必须显式提供两个本机隔离库连接");
  }
  requireCondition(!existsSync(artifact), "原生候选输出目录已存在，请先手工保留旧评审结果");
  const baseline = loadMigrationBaseline();
  requireCondition(baseline.contractHash === reviewedContract, "正式契约已变化，必须重新审查");
  for (const { name, version } of [
    { name: "prisma", version: "8.0.0-rc.35" },
    { name: "@prisma/orm-postgres", version: "8.0.0-rc.25" },
  ]) {
    const manifest = JSON.parse(
      readFileSync(join(server, "node_modules", name, "package.json"), "utf8"),
    );
    requireCondition(
      manifest.name === name && manifest.version === version,
      "原生候选必须使用已审查的固定 Prisma 8 版本",
    );
  }
  const { Client } = createRequire(join(server, "package.json"))("pg");
  const client = (connectionString) =>
    new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      options:
        "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c search_path=public",
    });
  const { report, catalog } = await readNativeContractCatalog(
    client(testUrl),
    client(referenceUrl),
    baseline,
  );
  requireCondition(
    report.catalogFingerprint === reviewedFingerprint && report.signingAllowed === false,
    "目录指纹已变化，禁止生成原生候选",
  );

  const checks = nativeChecks(baseline, catalog);
  requireCondition(checks.length === 36, "原生 CHECK 必须完整覆盖三十六项");
  const template = readFileSync(join(server, "prisma", "native-contract.template.prisma"), "utf8");
  const source = materializeNativeContract(template, baseline, checks);
  const formalPath = join(server, "src", "generated", "prisma8");
  const formalJson = readFileSync(join(formalPath, "contract.json"), "utf8");
  const formalTypes = readFileSync(join(formalPath, "contract.d.ts"), "utf8");
  mkdirSync(join(root, ".artifacts"), { recursive: true });
  mkdirSync(artifact);
  writeFileSync(join(artifact, "contract.prisma"), source, { flag: "wx" });
  // 候选生成子进程不需要任何数据库连接配置。
  const env = { ...process.env };
  delete env.SCADA_TEST_DATABASE_URL;
  delete env.SCADA_MIGRATION_REFERENCE_DATABASE_URL;
  delete env.SCADA_DATABASE_URL;
  delete env.DATABASE_URL;
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts", "prisma8-cli.mjs"), "contract", "native-emit"],
    {
      cwd: root,
      env,
      stdio: "inherit",
      timeout: 120000,
    },
  );
  requireCondition(
    readFileSync(join(formalPath, "contract.json"), "utf8") === formalJson &&
      readFileSync(join(formalPath, "contract.d.ts"), "utf8") === formalTypes,
    "正式契约生成物发生变化，停止评审",
  );
  requireCondition(
    !result.error && result.status === 0,
    "原生 PSL 生成失败，保留候选文件供人工评审",
  );
  requireCondition(
    readFileSync(join(artifact, "contract.d.ts"), "utf8").length > 0,
    "候选类型生成物为空",
  );
  const candidate = JSON.parse(readFileSync(join(artifact, "contract.json"), "utf8"));
  const review = reviewNativeContract(JSON.parse(formalJson), candidate, baseline, checks);
  console.info("原生候选物理结构检查通过，CHECK 数量：" + review.checks);
  console.info("候选存储哈希：" + candidate.storage.storageHash);
  console.info("正式契约生成物保持不变");
  for (const difference of review.runtimeDifferences) {
    console.info("运行时兼容性阻塞：" + difference);
  }
  console.info("候选状态：" + review.status + "；签名许可：否");
}

void main().catch((error) => {
  const message =
    error instanceof PreflightError || error instanceof NativeContractReviewError
      ? error.message
      : "原生候选生成或物理结构评审失败";
  console.error(message);
  process.exitCode = 1;
});
