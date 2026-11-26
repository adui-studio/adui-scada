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
    const readonlyTarget = join(server, "src", "database");
    mkdirSync(readonlyTarget, { recursive: true });
    copyFileSync(
      join(import.meta.dirname, "../apps/server/src/database/prisma8-readonly-target.ts"),
      join(readonlyTarget, "prisma8-readonly-target.ts"),
    );
    const launcher = join(root, "scripts", "prisma8-cli.mjs");
    copyFileSync(join(import.meta.dirname, "prisma8-cli.mjs"), launcher);
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify(manifest));
    writeFileSync(
      join(packageRoot, "cli.mjs"),
      [
        "const args = process.argv.slice(2);",
        'const commands = new Set(["skills sync", "skills list", "contract emit"]);',
        'const normal = commands.has(args.slice(0, 2).join(" ")) && args.length === 4 && args[2] === "--config";',
        'const tolerant = args.length === 5 && args.slice(0, 3).join(" ") === "db verify --schema-only" && args[3] === "--config";',
        'const strict = args.length === 7 && args.slice(0, 5).join(" ") === "db verify --schema-only --strict --json" && args[5] === "--config";',
        "const verify = tolerant || strict;",
        "if (!normal && !verify) {",
        "  process.exitCode = 2;",
        "} else {",
        "  const output = { cwd: process.cwd(), args };",
        "  if (verify) output.options = new URL(process.env.SCADA_TEST_DATABASE_URL).searchParams.get('options');",
        "  if (process.env.SCADA_TEST_DATABASE_URL) output.databaseUrlPresent = true;",
        // 模拟进程返回供测试解析的 JSON 协议数据，不输出面向用户的日志。
        "  process.stdout.write(JSON.stringify(output));",
        "  process.exitCode = 7;",
        "}",
        "",
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
      for (const args of [
        ["skills", "sync"],
        ["skills", "list"],
        ["contract", "emit"],
      ]) {
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

  void it("原生候选只映射到独立配置的离线契约生成", () => {
    withFixture(valid, (root, server, launcher) => {
      const result = spawnSync(process.execPath, [launcher, "contract", "native-emit"], {
        cwd: server,
        encoding: "utf8",
      });
      assert.equal(result.status, 7);
      assert.deepEqual(JSON.parse(result.stdout), {
        cwd: root,
        args: ["contract", "emit", "--config", join(server, "prisma8-native.config.ts")],
      });
    });
  });

  void it("原生配置只允许查询根目录 Skills 列表", () => {
    withFixture(valid, (root, server, launcher) => {
      const result = spawnSync(process.execPath, [launcher, "skills", "native-list"], {
        cwd: server,
        encoding: "utf8",
      });
      assert.equal(result.status, 7);
      assert.deepEqual(JSON.parse(result.stdout), {
        cwd: root,
        args: ["skills", "list", "--config", join(server, "prisma8-native.config.ts")],
      });
    });
  });

  void it("拒绝数据库写入命令和额外参数", () => {
    withFixture(valid, (_root, server, launcher) => {
      for (const args of [
        ["db", "sign"],
        ["db", "verify"],
        ["db", "native-schema-verify", "--db", "unsafe"],
        ["db", "native-schema-verify-strict", "--config", "unsafe.ts"],
        ["contract", "infer"],
        ["migration", "plan"],
        ["contract", "native-emit", "--config", "unsafe.ts"],
        ["skills", "sync", "--disable"],
        ["skills", "native-list", "--config", "unsafe.ts"],
        ["skills", "native-sync"],
      ]) {
        const result = spawnSync(process.execPath, [launcher, ...args], {
          cwd: server,
          encoding: "utf8",
        });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /仅允许 Skills 同步、列表、离线契约生成和原生只读结构验证/);
      }
    });
  });

  void it("原生结构验证只允许受限隔离库并强制只读会话", () => {
    withFixture(valid, (root, server, launcher) => {
      const connectionString =
        "postgresql://adui_scada:secret%40pass@127.0.0.1:15432/adui_scada_test?schema=public";
      const result = spawnSync(process.execPath, [launcher, "db", "native-schema-verify"], {
        cwd: server,
        encoding: "utf8",
        env: { ...process.env, SCADA_TEST_DATABASE_URL: connectionString },
      });
      assert.equal(result.status, 7);
      assert.deepEqual(JSON.parse(result.stdout), {
        cwd: root,
        args: [
          "db",
          "verify",
          "--schema-only",
          "--config",
          join(server, "prisma8-native.config.ts"),
        ],
        options:
          "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c search_path=public",
        databaseUrlPresent: true,
      });
      assert.equal(result.stdout.includes("secret"), false);
    });
  });

  void it("严格结构验证只在相同只读验收库运行固定机器输出命令", () => {
    withFixture(valid, (root, server, launcher) => {
      const connectionString =
        "postgresql://adui_scada:secret%40pass@127.0.0.1:15432/adui_scada_test?schema=public";
      const result = spawnSync(process.execPath, [launcher, "db", "native-schema-verify-strict"], {
        cwd: server,
        encoding: "utf8",
        env: { ...process.env, SCADA_TEST_DATABASE_URL: connectionString },
      });
      assert.equal(result.status, 7);
      assert.deepEqual(JSON.parse(result.stdout), {
        cwd: root,
        args: [
          "db",
          "verify",
          "--schema-only",
          "--strict",
          "--json",
          "--config",
          join(server, "prisma8-native.config.ts"),
        ],
        options:
          "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c search_path=public",
        databaseUrlPresent: true,
      });
      assert.equal(result.stdout.includes("secret"), false);
      const rejected = spawnSync(
        process.execPath,
        [launcher, "db", "native-schema-verify-strict"],
        {
          cwd: server,
          encoding: "utf8",
          env: {
            ...process.env,
            SCADA_TEST_DATABASE_URL:
              "postgresql://adui_scada:secret@127.0.0.1:15432/adui_scada_fresh_prisma8_native",
          },
        },
      );
      assert.equal(rejected.status, 1);
      assert.equal(rejected.stdout, "");
      assert.equal(rejected.stderr.includes("secret"), false);
    });
  });

  void it("拒绝非本机、错误库名、错误端口及额外数据库参数", () => {
    withFixture(valid, (_root, server, launcher) => {
      const invalidUrls = [
        undefined,
        "postgresql://adui_scada:secret@example.com:15432/adui_scada_test",
        "postgresql://adui_scada:secret@127.0.0.1:5432/adui_scada_test",
        "postgresql://adui_scada:secret@127.0.0.1:15432/production",
        "postgresql://adui_scada:secret@127.0.0.1:15432/adui_scada_test?schema=private",
        "postgresql://adui_scada:secret@127.0.0.1:15432/adui_scada_test?schema=public&sslmode=require",
      ];
      for (const connectionString of invalidUrls) {
        const env = { ...process.env };
        if (connectionString === undefined) delete env.SCADA_TEST_DATABASE_URL;
        else env.SCADA_TEST_DATABASE_URL = connectionString;
        const result = spawnSync(process.execPath, [launcher, "db", "native-schema-verify"], {
          cwd: server,
          encoding: "utf8",
          env,
        });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr.includes("secret"), false);
      }
    });
  });

  void it("原生离线生成不得继承测试数据库连接", () => {
    withFixture(valid, (root, server, launcher) => {
      const result = spawnSync(process.execPath, [launcher, "contract", "native-emit"], {
        cwd: server,
        encoding: "utf8",
        env: {
          ...process.env,
          SCADA_TEST_DATABASE_URL: "postgresql://adui_scada:secret@127.0.0.1:15432/adui_scada_test",
        },
      });
      assert.equal(result.status, 7);
      assert.deepEqual(JSON.parse(result.stdout), {
        cwd: root,
        args: ["contract", "emit", "--config", join(server, "prisma8-native.config.ts")],
      });
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
