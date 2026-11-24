import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolvePrisma7Cli } from "./prisma7-cli.mjs";

function withFixture(manifest, run) {
  const root = mkdtempSync(join(tmpdir(), "scada-prisma7-"));
  try {
    const packageRoot = join(root, "node_modules", "@prisma", "prisma7");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(packageRoot, "cli.js"), "// 本机测试占位入口\n");
    writeFileSync(join(packageRoot, "..", "outside.js"), "// 包外测试占位入口\n");
    run(root, packageRoot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const valid = { name: "@prisma/prisma7", version: "7.10.1", bin: { prisma7: "./cli.js" } };

void describe("Prisma 7 迁移 CLI 与新版隔离", () => {
  void it("从官方兼容包实际清单解析入口", () => {
    withFixture(valid, (root, packageRoot) => {
      assert.equal(resolvePrisma7Cli(root), realpathSync(join(packageRoot, "cli.js")));
    });
  });

  void it("支持标准 npm 字符串形式的入口", () => {
    withFixture({ ...valid, bin: "./cli.js" }, (root, packageRoot) => {
      assert.equal(resolvePrisma7Cli(root), realpathSync(join(packageRoot, "cli.js")));
    });
  });

  void it("拒绝错误包名、新版 CLI、缺失入口及包外路径", () => {
    for (const manifest of [
      { ...valid, name: "prisma" },
      { ...valid, version: "8.0.0" },
      { ...valid, bin: {} },
      { ...valid, bin: "./missing.js" },
      { ...valid, bin: "../outside.js" },
    ]) {
      withFixture(manifest, (root) => {
        assert.throws(() => resolvePrisma7Cli(root), /无法解析 Prisma 7 官方兼容包/);
      });
    }
  });

  void it("缺少兼容包时拒绝回退到新版 Prisma", () => {
    withFixture(valid, (root, packageRoot) => {
      rmSync(packageRoot, { recursive: true, force: true });
      assert.throws(() => resolvePrisma7Cli(root), /无法解析 Prisma 7 官方兼容包/);
    });
  });
});
