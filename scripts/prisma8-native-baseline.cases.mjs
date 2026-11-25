import { strict as assert } from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  inspectBaselinePackage,
  nativeHash,
  offlineEnvironment,
  readBaselineInputs,
  requireBaselineApproval,
  requirePreservedInputs,
  resolveBaselineCli,
  runBaselinePlanner,
} from "./prisma8-native-baseline.mjs";

function fixture(run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "scada-baseline-")));
  try {
    const native = join(root, ".artifacts", "prisma8-native");
    const output = join(root, ".artifacts", "prisma8-native-baseline");
    const formal = join(root, "apps", "server", "src", "generated", "prisma8");
    const cli = join(root, "apps", "server", "node_modules", "prisma");
    const orm = join(root, "apps", "server", "node_modules", "@prisma", "orm-postgres");
    for (const path of [native, formal, cli, orm]) mkdirSync(path, { recursive: true });
    writeFileSync(
      join(root, "apps", "server", "prisma8-native-baseline.config.ts"),
      "// 独立配置测试占位\n",
    );
    writeFileSync(join(native, "contract.prisma"), "// 原生候选测试源码\n");
    writeFileSync(
      join(native, "contract.json"),
      JSON.stringify({ storage: { storageHash: nativeHash } }),
    );
    writeFileSync(join(native, "contract.d.ts"), "// 原生候选测试声明\n");
    writeFileSync(join(formal, "contract.json"), '{"formal":true}');
    writeFileSync(join(formal, "contract.d.ts"), "// 正式契约测试声明\n");
    writeFileSync(
      join(cli, "package.json"),
      JSON.stringify({ name: "prisma", version: "8.0.0-rc.35", bin: { prisma: "./cli.mjs" } }),
    );
    writeFileSync(
      join(orm, "package.json"),
      JSON.stringify({ name: "@prisma/orm-postgres", version: "8.0.0-rc.25" }),
    );
    // 模拟固定 CLI 的输出形状，不调用真实 Prisma 或连接数据库。
    writeFileSync(
      join(cli, "cli.mjs"),
      [
        'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "const root = process.cwd();",
        'const expected = ["migration", "plan", "--from", "@empty", "--name", "scada_native_baseline", "--json", "--no-interactive", "--config", join(root, "apps", "server", "prisma8-native-baseline.config.ts")];',
        "if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected) || process.env.DATABASE_URL || process.env.SCADA_TEST_DATABASE_URL || process.env.NODE_OPTIONS) process.exit(2);",
        'const output = join(root, ".artifacts", "prisma8-native-baseline");',
        'const hash = JSON.parse(readFileSync(join(output, "contract.json"), "utf8")).storage.storageHash;',
        'const dir = join(output, "migrations", "app", "20261125T0900_scada_native_baseline");',
        'const snapshot = join(output, "migrations", "snapshots", hash);',
        "mkdirSync(dir, { recursive: true });",
        "mkdirSync(snapshot, { recursive: true });",
        'writeFileSync(join(dir, "migration.json"), JSON.stringify({ from: null, to: hash, migrationHash: "a".repeat(64) }));',
        'writeFileSync(join(dir, "ops.json"), JSON.stringify([{ operationClass: "additive" }]));',
        'writeFileSync(join(dir, "migration.ts"), "// 模拟生成源码\\n");',
        'for (const name of ["contract.json", "contract.d.ts"]) writeFileSync(join(snapshot, name), readFileSync(join(output, name)));',
        'process.stdout.write(JSON.stringify({ dir, pendingPlaceholders: false, operations: [{ operationClass: "additive" }], preview: { statements: ["CREATE TABLE example ()"] } }));',
      ].join("\n"),
    );
    run({ root, native, output, formal, cli, orm });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void test("仅接受明确的离线生成确认并拒绝附加参数", () => {
  requireBaselineApproval(["--confirm-offline-baseline"]);
  for (const args of [
    [],
    ["--confirm"],
    ["--confirm-offline-baseline", "--db"],
    ["migration", "plan"],
  ]) {
    assert.throws(() => requireBaselineApproval(args), /明确确认/);
  }
});

void test("离线环境白名单拒绝连接、令牌和注入变量", () => {
  assert.deepEqual(
    offlineEnvironment({
      Path: "测试路径",
      SYSTEMROOT: "系统目录",
      SCADA_TEST_DATABASE_URL: "测试连接",
      DATABASE_URL: "测试连接",
      PGHOST: "测试主机",
      NODE_OPTIONS: "测试注入",
      GITHUB_TOKEN: "测试令牌",
      CI: "false",
    }),
    { Path: "测试路径", SYSTEMROOT: "系统目录", CI: "true", NO_COLOR: "1" },
  );
});

void test("拒绝已有基线输出及链接目录且不删除旧文件", () => {
  fixture(({ root, output, native }) => {
    mkdirSync(output);
    writeFileSync(join(output, "old.txt"), "旧证据");
    assert.throws(() => readBaselineInputs(root), /禁止覆盖/);
    assert.equal(readFileSync(join(output, "old.txt"), "utf8"), "旧证据");
    rmSync(output, { recursive: true });
    symlinkSync(native, output, "junction");
    assert.throws(() => readBaselineInputs(root), /禁止覆盖/);
    assert.equal(readFileSync(join(native, "contract.prisma"), "utf8"), "// 原生候选测试源码\n");
  });
});

void test("拒绝非固定版本和逃逸包外 CLI 入口", () => {
  fixture(({ root, cli, orm }) => {
    assert.equal(resolveBaselineCli(root), join(cli, "cli.mjs"));
    writeFileSync(
      join(orm, "package.json"),
      JSON.stringify({ name: "@prisma/orm-postgres", version: "8.0.0" }),
    );
    assert.throws(() => resolveBaselineCli(root), /固定 Prisma 8 版本/);
    writeFileSync(
      join(orm, "package.json"),
      JSON.stringify({ name: "@prisma/orm-postgres", version: "8.0.0-rc.25" }),
    );
    writeFileSync(join(cli, "..", "outside.mjs"), "// 包外占位文件\n");
    writeFileSync(
      join(cli, "package.json"),
      JSON.stringify({ name: "prisma", version: "8.0.0-rc.35", bin: "../outside.mjs" }),
    );
    assert.throws(() => resolveBaselineCli(root), /不在包内/);
  });
});

void test("模拟规划真实启动子进程并保留原件及独立候选证据", () => {
  fixture(({ root, output }) => {
    const inputs = readBaselineInputs(root);
    const result = runBaselinePlanner(root, inputs, resolveBaselineCli(root));
    assert.equal(result.status, "BASELINE_ARTIFACT_REVIEW_REQUIRED");
    assert.equal(result.contractHash, nativeHash);
    assert.match(result.contractContentHash, /^[a-f0-9]{64}$/);
    assert.equal(result.operations, 1);
    assert.equal(result.signingAllowed, false);
    assert.equal(result.deploymentAllowed, false);
    requirePreservedInputs(root, inputs);
    assert.equal(readFileSync(join(output, "contract.json"), "utf8"), inputs.native[1]);
    assert.throws(() => runBaselinePlanner(root, inputs, resolveBaselineCli(root)), /禁止覆盖/);
  });
});

void test("拒绝占位符、非新增操作及缺少预览", () => {
  fixture(({ root, output }) => {
    const inputs = readBaselineInputs(root);
    runBaselinePlanner(root, inputs, resolveBaselineCli(root));
    const path = join(output, "plan.json");
    const original = JSON.parse(readFileSync(path, "utf8"));
    for (const patch of [
      { pendingPlaceholders: true },
      { operations: [{ operationClass: "destructive" }] },
      { operations: [{ operationClass: "data" }] },
      { operations: [{ operationClass: "widening" }] },
      { preview: { statements: [] } },
    ]) {
      writeFileSync(path, JSON.stringify({ ...original, ...patch }));
      assert.throws(
        () => inspectBaselinePackage(root, inputs.native[1]),
        /未填充、非新增操作或缺少预览/,
      );
    }
  });
});

void test("拒绝错误起点、目标、路径、额外迁移和快照漂移", () => {
  fixture(({ root, output }) => {
    const inputs = readBaselineInputs(root);
    runBaselinePlanner(root, inputs, resolveBaselineCli(root));
    const planPath = join(output, "plan.json");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const manifestPath = join(plan.dir, "migration.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const patch of [{ from: nativeHash }, { to: "wrong" }]) {
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...patch }));
      assert.throws(() => inspectBaselinePackage(root, inputs.native[1]), /起点、目标或迁移标识/);
    }
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(planPath, JSON.stringify({ ...plan, dir: root }));
    assert.throws(() => inspectBaselinePackage(root, inputs.native[1]), /规划返回路径/);
    writeFileSync(planPath, JSON.stringify(plan));
    const extra = join(output, "migrations", "app", "extra");
    mkdirSync(extra);
    assert.throws(() => inspectBaselinePackage(root, inputs.native[1]), /只有一个/);
    rmSync(extra, { recursive: true });
    writeFileSync(
      join(output, "migrations", "snapshots", nativeHash, "contract.json"),
      '{"changed":true}',
    );
    assert.throws(() => inspectBaselinePackage(root, inputs.native[1]), /目标快照/);
  });
});

void test("规划失败保留诊断并阻止重试，原件变化必须拒绝", () => {
  fixture(({ root, output, native, cli }) => {
    const inputs = readBaselineInputs(root);
    writeFileSync(
      join(cli, "cli.mjs"),
      'process.stderr.write("模拟规划失败"); process.exitCode = 2;',
    );
    assert.throws(() => runBaselinePlanner(root, inputs, resolveBaselineCli(root)), /离线规划失败/);
    assert.equal(readFileSync(join(output, "plan.stderr.txt"), "utf8"), "模拟规划失败");
    requirePreservedInputs(root, inputs);
    writeFileSync(join(native, "contract.prisma"), "// 模拟原件被修改\n");
    assert.throws(() => requirePreservedInputs(root, inputs), /发生变化/);
  });
});

void test("拒绝非空引用、额外输出及源码占位符", () => {
  fixture(({ root, output }) => {
    const inputs = readBaselineInputs(root);
    runBaselinePlanner(root, inputs, resolveBaselineCli(root));
    const plan = JSON.parse(readFileSync(join(output, "plan.json"), "utf8"));
    const refs = join(output, "migrations", "app", "refs");
    mkdirSync(refs);
    writeFileSync(join(refs, "db.json"), "{}");
    assert.throws(() => inspectBaselinePackage(root, inputs.native[1]), /缺失或额外对象/);
    rmSync(refs, { recursive: true });
    const extra = join(output, "unexpected.txt");
    writeFileSync(extra, "额外证据");
    assert.throws(() => inspectBaselinePackage(root, inputs.native[1]), /缺失或额外对象/);
    rmSync(extra);
    writeFileSync(join(plan.dir, "migration.ts"), 'placeholder("测试占位");');
    assert.throws(() => inspectBaselinePackage(root, inputs.native[1]), /未填充占位符/);
  });
});
