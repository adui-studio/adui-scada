import assert from "node:assert/strict";
import { createDecipheriv, hkdfSync } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  claimReproAttempt,
  encryptReproOutput,
  extractReproSchemaFailure,
  reproConfirmation,
  reproContainer,
  reproDatabase,
  reproFingerprint,
  reproImage,
  reproNetwork,
  reproPasswordVariable,
  reproRole,
  reproVolume,
  requireLocalDocker,
  requireReproContainer,
  requireReproIdentity,
  requireReproRequest,
  saveReproEvidence,
} from "./prisma8-native-isolated-repro.mjs";

const password = "a".repeat(64);
const containerId = "b".repeat(64);
const systemIdentifier = "1234567890123456789";
const args = [reproConfirmation];
const source = { [reproPasswordVariable]: password };
const allowed = new Set(["public", "table"]);
const labels = { "org.adui.scope": "prisma8-native-repro" };
const facts = [
  containerId,
  "/" + reproContainer,
  reproImage,
  true,
  labels,
  [{ Type: "volume", Name: reproVolume, Destination: "/var/lib/postgresql/data", RW: true }],
  { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "15433" }] },
  { [reproNetwork]: {} },
];

const failure = {
  ok: false,
  severity: "error",
  code: "MIGRATION.SCHEMA_VERIFY_FAILED",
  commandId: "db.migrate",
  meta: {
    schemaIssues: [
      { path: ["public", "table"], expected: { secret: "敏感预期值" } },
      { path: ["public", "敏感对象"], actual: { secret: "敏感实际值" } },
    ],
  },
};

void test("固定第四座专用凭据、连接参数和只读预检设置", () => {
  const request = requireReproRequest(args, {
    ...source,
    SCADA_DATABASE_URL: "不能使用的连接",
    SCADA_PRISMA8_NATIVE_BASELINE_DATABASE_URL: "不能使用的第三座连接",
  });
  const url = new URL(request.url);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "15433");
  assert.equal(url.pathname, "/" + reproDatabase);
  assert.equal(url.username, reproRole);
  assert.equal(request.options.database, reproDatabase);
  assert.equal(request.options.port, 15433);
  assert.equal(request.options.password, password);
  assert.match(request.options.options, /default_transaction_read_only=on/u);
});

void test("拒绝错误确认、无效口令及 Docker 环境覆盖", () => {
  for (const input of [[], ["--yes"], [...args, "--extra"]]) {
    assert.throws(() => requireReproRequest(input, source), /明确确认/u);
  }
  for (const value of [undefined, "", password + "\n", "x".repeat(64), password.slice(1)]) {
    assert.throws(
      () => requireReproRequest(args, { [reproPasswordVariable]: value }),
      /随机凭据无效/u,
    );
  }
  for (const key of ["DOCKER_HOST", "docker_context", "DOCKER_CONFIG"]) {
    assert.throws(
      () => requireReproRequest(args, { ...source, [key]: "不允许的覆盖" }),
      /Docker 环境覆盖/u,
    );
  }
});

void test("仅接受实际创建的本机容器、镜像、单一卷、网络及回环端口", () => {
  requireLocalDocker("npipe:////./pipe/dockerDesktopLinuxEngine", "linux");
  assert.throws(() => requireLocalDocker("tcp://example.invalid:2375", "linux"), /本机/u);
  assert.throws(() => requireLocalDocker("npipe:////./pipe/docker_engine", "windows"), /本机/u);
  assert.equal(requireReproContainer(facts), containerId);
  /** @type {[number, unknown][]} 容器边界的独立反例。 */
  const cases = [
    [0, "错误"],
    [1, "/adui-scada-postgres-1"],
    [2, "sha256:" + "c".repeat(64)],
    [3, false],
    [4, { ...labels, "com.docker.compose.project": "adui-scada" }],
    [5, []],
    [6, { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "15433" }] }],
    [7, { [reproNetwork]: {}, lab: {} }],
  ];
  for (const [index, value] of cases) {
    /** @type {unknown[]} 独立修改一个受检字段。 */
    const changed = [...facts];
    changed[index] = value;
    assert.throws(() => requireReproContainer(changed), /固定边界/u);
  }
});

void test("数据库角色、版本及集群标识必须精确匹配", () => {
  const identity = [reproDatabase, reproRole, "170011", systemIdentifier].join("|");
  assert.equal(requireReproIdentity(identity), systemIdentifier);
  for (const changed of [
    identity.replace(reproDatabase, "adui_scada_test"),
    identity.replace(reproRole, "adui_scada"),
    identity.replace("170011", "180000"),
    identity.replace(systemIdentifier, "错误"),
  ]) {
    assert.throws(() => requireReproIdentity(changed), /身份、版本或集群标识/u);
  }
});

void test("一次性记录和报告均独占保存，失败或已有报告不得再次授权", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "adui-repro-")));
  try {
    assert.throws(
      () => claimReproAttempt(directory, "错误", containerId, systemIdentifier),
      /固定证据/u,
    );
    claimReproAttempt(directory, reproFingerprint, containerId, systemIdentifier);
    assert.throws(
      () => claimReproAttempt(directory, reproFingerprint, containerId, systemIdentifier),
      /禁止再次执行/u,
    );
    const receipt = JSON.parse(readFileSync(join(directory, "attempt.json"), "utf8"));
    assert.equal(receipt.fingerprint, reproFingerprint);
    assert.equal(receipt.systemIdentifier, systemIdentifier);
    saveReproEvidence(directory, "report.json", { signingAllowed: false });
    assert.throws(
      () => saveReproEvidence(directory, "report.json", { signingAllowed: true }),
      /EEXIST/u,
    );
    assert.throws(() => saveReproEvidence(directory, "../escape", {}), /文件名称无效/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("旧报告或加密输出存在时拒绝领取新尝试", () => {
  for (const name of ["report.json", "machine-output.encrypted.json"]) {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "adui-repro-")));
    try {
      writeFileSync(join(directory, name), "{}");
      assert.throws(
        () => claimReproAttempt(directory, reproFingerprint, containerId, systemIdentifier),
        /禁止再次执行/u,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

void test("两路机器输出独立解析且跨输出重复诊断拒绝", () => {
  const report = extractReproSchemaFailure("普通日志", JSON.stringify(failure, null, 2), allowed);
  assert.equal(report?.issueCount, 2);
  assert.deepEqual(
    report?.issues.map((issue) => issue.outcome),
    ["not-found", "not-expected"],
  );
  assert.doesNotMatch(JSON.stringify(report), /敏感/u);
  assert.equal(
    extractReproSchemaFailure(JSON.stringify(failure), JSON.stringify(failure), allowed),
    null,
  );
  assert.equal(extractReproSchemaFailure("未知", "", allowed), null);
  assert.equal(extractReproSchemaFailure("x".repeat(16 * 1024 * 1024 + 1), "", allowed), null);
});

void test("加密原始捕获文本可本机认证解密且不回显原始数据", () => {
  const stdout = JSON.stringify(failure);
  const stderr = "敏感错误文本";
  const encrypted = encryptReproOutput(password, stdout, stderr);
  assert.doesNotMatch(JSON.stringify(encrypted), /敏感|SCHEMA_VERIFY_FAILED/u);
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(password, "hex"),
      Buffer.from(encrypted.salt, "hex"),
      "ADui SCADA Prisma8 repro output v1",
      32,
    ),
  );
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "hex"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  assert.deepEqual(JSON.parse(decrypted.toString("utf8")), { stdout, stderr });
  assert.notEqual(encryptReproOutput(password, stdout, stderr).ciphertext, encrypted.ciphertext);
});
