import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const generated = "// GENERATED FILE - DO NOT EDIT\n";
const candidate = "apps/server/.artifacts/prisma8-native-repro-candidate";
const snapshot = candidate + "/migrations/snapshots/example/contract.d.ts";
const repair = "apps/server/.artifacts/prisma8-native-check-repair-package";

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "adui-messages-"));
  const write = (path, content) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  try {
    for (const path of [
      ".env.example",
      ".editorconfig",
      ".gitattributes",
      ".gitignore",
      ".dockerignore",
      "vite.config.ts",
    ]) {
      write(path, "");
    }
    const script = join(root, "scripts", "check-chinese-messages.mjs");
    mkdirSync(dirname(script));
    copyFileSync(join(import.meta.dirname, "check-chinese-messages.mjs"), script);
    write(candidate + "/contract.d.ts", generated);
    write(snapshot, generated);
    write(repair + "/plan/contract.d.ts", generated);
    write(repair + "/complete/migrations/snapshots/example/contract.d.ts", generated);
    write("apps/server/.artifacts/prisma8-native-baseline-comments/contract.d.ts", generated);
    const check = () => {
      const child = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(child.error, undefined);
      return { ...child, stderr: child.stderr.replaceAll("\\", "/") };
    };
    run({ root, write, check });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void test("仅跳过固定生成候选及其快照，不改写保留证据", () => {
  withFixture(({ root, check, write }) => {
    write("apps/server/src/service.ts", "// 自有中文注释\n");
    const result = check();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /中文文案检查通过/u);
    assert.equal(readFileSync(join(root, candidate, "contract.d.ts"), "utf8"), generated);
    assert.equal(readFileSync(join(root, snapshot), "utf8"), generated);
    assert.equal(readFileSync(join(root, repair, "plan/contract.d.ts"), "utf8"), generated);
    assert.equal(readFileSync(join(root, repair, "complete/migrations/snapshots/example/contract.d.ts"), "utf8"), generated);
  });
});

void test("仍检查自有源码和名称相近的其他目录，不扩大排除范围", () => {
  withFixture(({ write, check }) => {
    const own = "apps/server/src/service.ts";
    const sibling = candidate + "-other/contract.d.ts";
    write(own, "// English comment\n");
    write(sibling, generated);
    const repairSibling = repair + "-other/contract.d.ts";
    write(repairSibling, generated);
    const result = check();
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(own + ":1：注释缺少中文"));
    assert.ok(result.stderr.includes(sibling + ":1：注释缺少中文"));
    assert.ok(result.stderr.includes(repairSibling + ":1：注释缺少中文"));
    assert.match(result.stderr, /发现 3 处待处理内容/u);
  });
});
