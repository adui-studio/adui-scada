import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const valid = { name: "prisma", version: "8.0.0-rc.35", bin: { prisma: "./cli.mjs" } };

function withFixture(manifest, run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "scada-prisma8-")));
  try {
    const server = join(root, "apps", "server");
    const packageRoot = join(server, "node_modules", "prisma");
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(join(root, "scripts"));
    const launcher = join(root, "scripts", "prisma8-cli.mjs");
    copyFileSync(join(import.meta.dirname, "prisma8-cli.mjs"), launcher);
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify(manifest));
    writeFileSync(
      join(packageRoot, "cli.mjs"),
      [
        'const args = process.argv.slice(2);',
        'const commands = new Set(["skills sync", "skills list", "contract emit"]);',
        'if (!commands.has(args.slice(0, 2).join(" ")) || args.length !== 4 || args[2] !== "--config") {',
        '  process.exitCode = 2;',
        '} else {',
        '  console.log(JSON.stringify({ cwd: process.cwd(), args }));',
        '  process.exitCode = 7;',
        '}',
        '',
      ].join("\n"),
    );
    writeFileSync(join(packageRoot, "..", "outside.mjs"), "// 包外测试占位入口\n");
    run(root, server, launcher);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void describe("Prisma 8 根目录 CLI 与 Skills 统一管理", () => {
  void it("三种入口均以命令在前的顺序在根目录运行并保留配置及退出码", () => {
    withFixture(valid, (root, server, launcher) => {
      for (const args of [["skills", "sync"], ["skills", "list"], ["contract", "emit"]]) {
        const result = spawnSync(process.execPath, [launcher, ...args], {
          cwd: server,
          encoding: "utf8",
        });
        assert.equal(result.status, 7);
        assert.deepEqual(JSON.parse(result.stdout), {
          cwd: root,
          args: [...args, "--config", join(server, "prisma.config.ts")],
        });
      }
    });
  });

  void it("拒绝数据库写入命令和额外参数", () => {
    withFixture(valid, (_root, server, launcher) => {
      for (const args of [["db", "sign"], ["skills", "sync", "--disable"]]) {
        const result = spawnSync(process.execPath, [launcher, ...args], {
          cwd: server,
          encoding: "utf8",
        });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /仅允许 Skills 同步、列表和离线契约生成/);
      }
    });
  });

  void it("拒绝旧版 CLI、错误包名、缺失入口和包外路径", () => {
    for (const manifest of [
      { ...valid, version: "7.10.1" },
      { ...valid, name: "@prisma/prisma7" },
      { ...valid, bin: {} },
      { ...valid, bin: "./missing.mjs" },
      { ...valid, bin: "../outside.mjs" },
    ]) {
      withFixture(manifest, (_root, server, launcher) => {
        const result = spawnSync(process.execPath, [launcher, "skills", "sync"], {
          cwd: server,
          encoding: "utf8",
        });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /无法解析已安装的 Prisma 8 CLI/);
      });
    }
  });
});
