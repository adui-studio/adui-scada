import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { appendCommentOperations, buildCommentOperations } from "./prisma8-native-baseline-comments.mjs";
import {
  acceptedMigrationHash,
  candidateFileNames,
  fingerprintCandidateFiles,
  readExactCandidateTree,
  requireMigrationCheck,
  requireOfflineCandidateConfig,
  reviewCandidateFiles,
} from "./prisma8-native-baseline-candidate.mjs";

const packageDirectory = "migrations/app/20261125T0918_scada_native_baseline";
const sourceName = packageDirectory + "/migration.ts";
const manifestName = packageDirectory + "/migration.json";
const operationsName = packageDirectory + "/ops.json";
const config = readFileSync(new URL("../apps/server/prisma8-native-baseline-comments.config.ts", import.meta.url));

function successCheck() {
  return {
    kind: "result",
    commandId: "migration.check",
    envelope: {
      commandId: "migration.check",
      ok: true,
      exitCode: 0,
      diagnostics: [],
      result: { ok: true, failures: [] },
    },
  };
}

function fixture() {
  const source = [
    "import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';",
    "export default class M extends Migration<never, End> {",
    "  override readonly endContractJson = endContract;",
    "  override get operations() {",
    "    return [",
    ...Array.from({ length: 46 }, (_, index) => "      this.createSchema({ index: " + index + " }),"),
    "    ];",
    "  }",
    "}",
    "MigrationCLI.run(import.meta.url, M);",
    "",
  ].join("\n");
  const manifest = { from: null, to: "a".repeat(64), migrationHash: "b".repeat(64), providedInvariants: [] };
  const operations = Array.from({ length: 46 }, (_, index) => ({ id: "ddl." + index, precheck: [{ sql: "SELECT true" }], execute: [{ sql: "SELECT true" }], postcheck: [{ sql: "SELECT true" }] }));
  const preview = Array.from({ length: 119 }, (_, index) => `COMMENT ON TABLE "public"."table_${index}" IS '中文';\n`).join("");
  const audited = { preview, comments: 119 };
  const comments = buildCommentOperations(preview);
  const originalFiles = Object.fromEntries(Object.entries({
    "contract.prisma": "原始契约",
    "contract.json": "{}",
    "contract.d.ts": "原始声明",
    "plan.json": "{}",
    "plan.stderr.txt": "",
    [sourceName]: source,
    [manifestName]: JSON.stringify(manifest),
    [operationsName]: JSON.stringify(operations),
    "migrations/snapshots/hash/contract.json": "{}",
    "migrations/snapshots/hash/contract.d.ts": "原始快照声明",
  }).map(([name, value]) => [name, Buffer.from(value)]));
  const actual = { manifest: { ...manifest, migrationHash: acceptedMigrationHash }, operations: [...operations, ...comments] };
  const files = Object.fromEntries(candidateFileNames(originalFiles).map((name) => [name, originalFiles[name] ?? Buffer.alloc(0)]));
  files[sourceName] = Buffer.from(appendCommentOperations(source, comments));
  files[manifestName] = Buffer.from(JSON.stringify(actual.manifest));
  files[operationsName] = Buffer.from(JSON.stringify(actual.operations));
  files["emit-dry-run.stdout.txt"] = Buffer.from("--- migration.json ---\n" + JSON.stringify(actual.manifest) + "\n--- ops.json ---\n" + JSON.stringify(actual.operations) + "\n");
  files["migration-check.stdout.txt"] = Buffer.from(JSON.stringify(successCheck()));
  return { originalFiles, files, audited, actual };
}

function withTree(files, action) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "scada-candidate-")));
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(directory, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes, { flag: "wx" });
    }
    action(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

void test("独立候选十四文件、固定迁移标识及完整操作审查通过", () => {
  const { originalFiles, files, audited, actual } = fixture();
  withTree(files, (directory) => {
    const read = readExactCandidateTree(directory, candidateFileNames(originalFiles));
    assert.deepEqual(read, files);
    const review = reviewCandidateFiles(originalFiles, read, audited, packageDirectory);
    assert.deepEqual(review.actual, actual);
    assert.equal(review.operations, 165);
    assert.equal(review.signingAllowed, false);
    assert.equal(review.deploymentAllowed, false);
    assert.equal(Object.keys(read).length, 14);
  });
});

void test("拒绝额外文件、额外目录、缺失对象及越界路径", () => {
  const { files, originalFiles } = fixture();
  const names = candidateFileNames(originalFiles);
  withTree(files, (directory) => {
    writeFileSync(join(directory, "extra.txt"), "额外");
    assert.throws(() => readExactCandidateTree(directory, names), /额外或缺失/u);
    rmSync(join(directory, "extra.txt"));
    mkdirSync(join(directory, "migrations", "extra"));
    assert.throws(() => readExactCandidateTree(directory, names), /额外或缺失/u);
    rmSync(join(directory, "migrations", "extra"), { recursive: true });
    rmSync(join(directory, "contract.json"));
    assert.throws(() => readExactCandidateTree(directory, names), /额外或缺失/u);
    assert.throws(() => readExactCandidateTree(directory, ["../outside"]), /相对路径/u);
    assert.throws(() => readExactCandidateTree(directory, ["x", "x"]), /清单重复/u);
  });
});

void test("拒绝候选目录链接和指向同一内容的硬链接", () => {
  const { files, originalFiles } = fixture();
  const names = candidateFileNames(originalFiles);
  withTree(files, (directory) => {
    const alias = join(directory, "alias");
    symlinkSync(directory, alias, "junction");
    assert.throws(() => readExactCandidateTree(alias, names), /目录缺失或包含链接/u);
    rmSync(alias);
    const path = join(directory, "contract.json");
    rmSync(path);
    linkSync(join(directory, "migrations/snapshots/hash/contract.json"), path);
    assert.throws(() => readExactCandidateTree(directory, names), /文件缺失、链接/u);
  });
});

void test("拒绝重排源码、契约及快照字节变化", () => {
  const { originalFiles, files, audited } = fixture();
  for (const name of [sourceName, "contract.prisma", "migrations/snapshots/hash/contract.d.ts"]) {
    assert.throws(() => reviewCandidateFiles(originalFiles, { ...files, [name]: Buffer.concat([files[name], Buffer.from("\n")]) }, audited, packageDirectory), /源码、契约或快照变化/u);
  }
});

void test("拒绝不同迁移标识及原 DDL 预后置检查变化", () => {
  const { originalFiles, files, audited, actual } = fixture();
  const changedManifest = { ...actual.manifest, migrationHash: "c".repeat(64) };
  assert.throws(() => reviewCandidateFiles(originalFiles, { ...files, [manifestName]: Buffer.from(JSON.stringify(changedManifest)) }, audited, packageDirectory), /已验收的官方迁移标识/u);
  for (const phase of ["precheck", "execute", "postcheck"]) {
    const operations = structuredClone(actual.operations);
    operations[0][phase][0].sql = "SELECT false";
    assert.throws(() => reviewCandidateFiles(originalFiles, { ...files, [operationsName]: Buffer.from(JSON.stringify(operations)) }, audited, packageDirectory), /操作与原有/u);
  }
});

void test("拒绝历史干跑证据或官方完整性检查失败", () => {
  const { originalFiles, files, audited } = fixture();
  assert.throws(() => reviewCandidateFiles(originalFiles, { ...files, "emit-dry-run.stdout.txt": Buffer.from("--- migration.json ---\n{}\n--- ops.json ---\n[]\n") }, audited, packageDirectory), /干跑结果不一致/u);
  const bad = successCheck();
  bad.envelope.result.ok = false;
  assert.throws(() => reviewCandidateFiles(originalFiles, { ...files, "migration-check.stdout.txt": Buffer.from(JSON.stringify(bad)) }, audited, packageDirectory), /未确认成功/u);
  for (const invalid of [ { ...successCheck(), commandId: "migration.plan" }, { ...successCheck(), envelope: { ...successCheck().envelope, diagnostics: [{ code: "错误" }] } }, { ...successCheck(), envelope: { ...successCheck().envelope, exitCode: 4 } } ]) {
    assert.throws(() => requireMigrationCheck(JSON.stringify(invalid)), /未确认成功/u);
  }
});

void test("固定离线配置及十四文件指纹不受读取顺序影响", () => {
  const { files } = fixture();
  requireOfflineCandidateConfig(config);
  const report = fingerprintCandidateFiles(files, config);
  const reverse = Object.fromEntries(Object.entries(files).reverse());
  assert.deepEqual(fingerprintCandidateFiles(reverse, config), report);
  assert.equal(report.files.length, 14);
  assert.match(report.fingerprint, /^[a-f0-9]{64}$/u);
  const changed = { ...files, "emit.stderr.txt": Buffer.from("新增诊断") };
  assert.notEqual(fingerprintCandidateFiles(changed, config).fingerprint, report.fingerprint);
  assert.throws(() => fingerprintCandidateFiles(files, Buffer.concat([config, Buffer.from("\n")])), /配置指纹变化/u);
});
