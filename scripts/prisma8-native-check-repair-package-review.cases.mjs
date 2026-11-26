import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import evidence from "./prisma8-native-check-repair-package-accepted-evidence.json" with { type: "json" };
import {
  acceptedRepairFingerprint,
  requireAcceptedRepairEvidence,
  requireRepairFileEvidence,
  requireRepairReviewProcess,
  runPreservedRepairReview,
  runRepairOfficialRechecks,
} from "./prisma8-native-check-repair-package-review.mjs";

void test("真实验收的二十四文件及两份配置清单指纹固定", () => {
  assert.equal(requireAcceptedRepairEvidence(evidence), acceptedRepairFingerprint);
  assert.equal(evidence.files.filter((entry) => entry.path.startsWith("plan/")).length, 10);
  assert.equal(evidence.files.filter((entry) => entry.path.startsWith("complete/")).length, 14);
  assert.equal(evidence.configs.length, 2);
});

void test("即使重新计算哈希也拒绝改写固定清单", () => {
  for (const change of [
    (copy) => {
      copy.files[0].path = "../outside";
    },
    (copy) => {
      copy.files[0].sha256 = "a".repeat(64);
    },
    (copy) => {
      copy.files.push(copy.files[0]);
    },
    (copy) => {
      copy.configs.reverse();
    },
  ]) {
    const copy = structuredClone(evidence);
    change(copy);
    const { fingerprint: _fingerprint, ...payload } = copy;
    copy.fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    assert.throws(() => requireAcceptedRepairEvidence(copy), /真实验收指纹不一致/u);
  }
});

void test("实际字节核验接受原文并拒绝同长度篡改、缺失及额外文件", () => {
  const bytes = Buffer.from("原始证据");
  const entries = [
    {
      path: "original",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  ];
  requireRepairFileEvidence(entries, { original: bytes });
  const changed = Buffer.from(bytes);
  changed[0] ^= 1;
  assert.throws(() => requireRepairFileEvidence(entries, { original: changed }), /字节或 SHA-256/u);
  assert.throws(() => requireRepairFileEvidence(entries, {}), /文件集合/u);
  assert.throws(
    () => requireRepairFileEvidence(entries, { original: bytes, extra: bytes }),
    /文件集合/u,
  );
  assert.throws(
    () => requireRepairFileEvidence([entries[0], entries[0]], { original: bytes, extra: bytes }),
    /文件集合/u,
  );
});

void test("重复离线阶段均在动作前后复核证据", () => {
  const events = [];
  const preserve = () => {
    events.push("复核");
  };
  const action = () => {
    events.push("执行");
    return 165;
  };
  assert.equal(runPreservedRepairReview(preserve, action, "官方干跑"), 165);
  assert.equal(runPreservedRepairReview(preserve, action, "官方完整性"), 165);
  assert.deepEqual(events, ["复核", "执行", "复核", "复核", "执行", "复核"]);
});

void test("前置证据不符时不启动官方动作", () => {
  let calls = 0;
  assert.throws(
    () =>
      runPreservedRepairReview(
        () => {
          throw new Error("固定证据不一致");
        },
        () => {
          calls++;
        },
        "官方干跑",
      ),
    /固定证据不一致/u,
  );
  assert.equal(calls, 0);
});

void test("子进程失败仍复核证据且不回显任意异常", () => {
  let calls = 0;
  assert.throws(
    () =>
      runPreservedRepairReview(
        () => {
          calls++;
        },
        () => {
          throw new Error("敏感原始诊断");
        },
        "官方干跑",
      ),
    { message: "修复包离线复验失败：官方干跑；阶段未通过；禁止继续操作" },
  );
  assert.equal(calls, 2);
});

void test("证据漂移拒绝成功结果并保留双重失败分类", () => {
  for (const fail of [false, true]) {
    let calls = 0;
    assert.throws(
      () =>
        runPreservedRepairReview(
          () => {
            if (++calls === 2) throw new Error("敏感证据详情");
          },
          () => {
            if (fail) throw new Error("敏感执行详情");
            return 165;
          },
          "官方完整性",
        ),
      {
        message:
          "修复包离线复验失败：官方完整性" +
          (fail ? "；阶段未通过" : "") +
          "；原件或固定证据复核失败；禁止继续操作",
      },
    );
    assert.equal(calls, 2);
  }
});

void test("只接受无错误无信号且无标准错误的成功官方输出", () => {
  const result = { status: 0, signal: null, stdout: "{}", stderr: "" };
  assert.equal(requireRepairReviewProcess(result), "{}");
  for (const patch of [
    { status: 1 },
    { signal: "SIGTERM" },
    { error: new Error("敏感详情") },
    { stderr: "敏感详情" },
    { stdout: "" },
  ]) {
    assert.throws(() => requireRepairReviewProcess({ ...result, ...patch }), {
      message: "官方修复包离线子进程未确认成功",
    });
  }
});

void test("官方复验仅按顺序执行两条固定离线命令", () => {
  const calls = [];
  const verified = [];
  const options = {
    preserve: () => {},
    execute: (args) => {
      calls.push(args);
      return "固定官方输出";
    },
    verifyDryRun: (text) => {
      verified.push(text);
    },
    verifyMigrationCheck: (text) => {
      verified.push(text);
    },
    migrationPath: "migration.ts",
    configPath: "offline.config.ts",
    cliPath: "cli.mjs",
  };
  runRepairOfficialRechecks(options);
  runRepairOfficialRechecks(options);
  const expected = [
    ["migration.ts", "--config", "offline.config.ts", "--dry-run"],
    ["cli.mjs", "migration", "check", "--space", "app", "--json", "--config", "offline.config.ts"],
  ];
  assert.deepEqual(calls, [...expected, ...expected]);
  assert.equal(verified.length, 4);
});

void test("官方干跑校验失败后不进入完整性命令", () => {
  const calls = [];
  let preserved = 0;
  assert.throws(
    () =>
      runRepairOfficialRechecks({
        preserve: () => {
          preserved++;
        },
        execute: (args) => {
          calls.push(args);
          return "固定官方输出";
        },
        verifyDryRun: () => {
          throw new Error("固定干跑不一致");
        },
        verifyMigrationCheck: () => {
          assert.fail("不得执行后续完整性验证");
        },
        migrationPath: "migration.ts",
        configPath: "offline.config.ts",
        cliPath: "cli.mjs",
      }),
    /官方干跑；阶段未通过/u,
  );
  assert.equal(calls.length, 1);
  assert.equal(preserved, 2);
});
