import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import acceptedEvidence from "../../scripts/prisma8-native-baseline-accepted-evidence.json" with { type: "json" };
import { loadMigrationBaseline } from "../../scripts/inspect-prisma8-migration-readiness.mjs";
import {
  offlineEnvironment,
  readBaselineInputs,
  requirePreservedInputs,
  resolveBaselineCli,
} from "../../scripts/prisma8-native-baseline.mjs";
import {
  fingerprintCandidateFiles,
  readCandidateRegular,
  readExactCandidateTree,
} from "../../scripts/prisma8-native-baseline-candidate.mjs";
import { requireLockedCandidateEvidence } from "../../scripts/prisma8-native-baseline-comment-emission.mjs";
import {
  inspectReproEmptyDatabase,
  NativePreflightError,
  requireAcceptedCandidateEvidence,
} from "../../scripts/prisma8-native-baseline-preflight.mjs";
import {
  migrationArguments,
  NativeMigrationError,
  requireMigrationResult,
  requireNativeAppliedResult,
  requireNativeMigrationPath,
} from "../../scripts/prisma8-native-baseline-migrate.mjs";
import { describeNativeChildFailure } from "../../scripts/prisma8-native-baseline-recovery.mjs";
import { allowedPaths } from "../../scripts/prisma8-native-direct-schema-review.mjs";
import {
  claimReproAttempt,
  encryptReproOutput,
  extractReproSchemaFailure,
  ReproError,
  reproContainer,
  reproDatabase,
  reproNetwork,
  reproPasswordVariable,
  reproRole,
  reproUrlVariable,
  reproVolume,
  requireLocalDocker,
  requireReproContainer,
  requireReproIdentity,
  requireReproRequest,
  requireUnusedReproDirectory,
  saveReproEvidence,
} from "../../scripts/prisma8-native-isolated-repro.mjs";

let stage = "第四座实例执行授权";
let claimed = false;

function requireMatch(condition, message) {
  if (!condition) throw new ReproError(message);
}

function requireDirectory(path) {
  requireMatch(
    lstatSync(path, { throwIfNoEntry: false })?.isDirectory() && realpathSync(path) === path,
    "独立复现目录不存在或包含链接",
  );
}

async function main() {
  const request = requireReproRequest(process.argv.slice(2), process.env);
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  const server = join(root, "apps", "server");
  const lab = join(root, ".artifacts", "prisma8-native-repro");
  const candidate = join(server, ".artifacts", "prisma8-native-repro-candidate");
  const source = join(server, ".artifacts", "prisma8-native-baseline-comments");
  const config = join(server, "prisma8-native-repro.config.ts");
  requireUnusedReproDirectory(lab);
  requireDirectory(dirname(candidate));
  requireMatch(
    !lstatSync(candidate, { throwIfNoEntry: false }),
    "第四座独立候选副本已存在，禁止覆盖或自动清理",
  );
  const env = offlineEnvironment(process.env);
  const runChild = (args, childEnv = env) =>
    spawnSync(process.execPath, args, {
      cwd: root,
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
  const docker = (args) => {
    const child = spawnSync("docker", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    requireMatch(!child.error && child.status === 0, "本机 Docker 只读身份检查失败");
    return child.stdout.trim();
  };
  const inspectDocker = () => {
    const context = docker(["context", "show"]);
    requireMatch(/^[a-zA-Z0-9_.-]+$/u.test(context), "本机 Docker 上下文名称无效");
    const endpoint = docker([
      "context",
      "inspect",
      context,
      "--format",
      "{{.Endpoints.docker.Host}}",
    ]);
    const run = (args) => docker(["--context", context, ...args]);
    requireLocalDocker(endpoint, run(["info", "--format", "{{.OSType}}"]));
    const fields = [
      ".Id",
      ".Name",
      ".Image",
      ".State.Running",
      ".Config.Labels",
      ".Mounts",
      ".NetworkSettings.Ports",
      ".NetworkSettings.Networks",
    ];
    const facts = run([
      "inspect",
      "--type",
      "container",
      "--format",
      fields.map((field) => "{{json " + field + "}}").join("\n"),
      reproContainer,
    ])
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const containerId = requireReproContainer(facts);
    const label = '{{index .Labels "org.adui.scope"}}';
    requireMatch(
      run(["volume", "inspect", "--format", label, reproVolume]) === "prisma8-native-repro" &&
        run(["network", "inspect", "--format", label, reproNetwork]) === "prisma8-native-repro",
      "第四座实例的独立卷或网络标签不一致",
    );
    const systemIdentifier = requireReproIdentity(
      run([
        "exec",
        containerId,
        "sh",
        "-c",
        'PGPASSWORD="$POSTGRES_PASSWORD" exec psql "$@"',
        "sh",
        "-X",
        "-w",
        "-h",
        "127.0.0.1",
        "-U",
        reproRole,
        "-d",
        reproDatabase,
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "SELECT current_database(), current_user, current_setting('server_version_num'), system_identifier::text FROM pg_catalog.pg_control_system();",
      ]),
    );
    return { containerId, systemIdentifier };
  };

  stage = "固定 RC 与原包、独立候选离线复验";
  const entry = resolveBaselineCli(root);
  const inputs = readBaselineInputs(root, true);
  const history = loadMigrationBaseline();
  const fingerprint = requireLockedCandidateEvidence(root);
  const originalConfig = readCandidateRegular(config);
  const review = runChild([
    join(server, "prisma8-native-baseline-plan.mjs"),
    "--review-comment-candidate",
  ]);
  requireMatch(!review.error && review.status === 0, "固定候选官方离线复验未通过");
  const names = acceptedEvidence.files.map((item) => item.path);
  const offlineConfig = readCandidateRegular(
    join(server, "prisma8-native-baseline-comments.config.ts"),
  );
  const files = readExactCandidateTree(source, names);
  requireAcceptedCandidateEvidence(fingerprintCandidateFiles(files, offlineConfig));

  stage = "第四座实例独立副本与证据固定";
  mkdirSync(candidate);
  for (const name of names) {
    const target = join(candidate, name);
    mkdirSync(dirname(target), { recursive: true });
    requireDirectory(dirname(target));
    writeFileSync(target, files[name], { flag: "wx" });
  }
  const requirePreserved = () => {
    requirePreservedInputs(root, inputs);
    const current = loadMigrationBaseline();
    requireMatch(
      isDeepStrictEqual(current.migrations, history.migrations) &&
        current.contractHash === history.contractHash &&
        requireLockedCandidateEvidence(root) === fingerprint &&
        readCandidateRegular(config).equals(originalConfig) &&
        isDeepStrictEqual(readExactCandidateTree(candidate, names), files),
      "原件、固定迁移候选、独立副本或配置发生变化",
    );
  };
  requirePreserved();
  const pathNames = allowedPaths(JSON.parse(files["contract.json"].toString("utf8")));
  const childEnv = { ...env, [reproUrlVariable]: request.url };
  stage = "第四座容器与宿主 TCP 集群身份、严格空库检查";
  const identity = inspectDocker();
  const { Client } = createRequire(import.meta.url)("pg");
  const preflight = async () => {
    requirePreserved();
    requireMatch(
      isDeepStrictEqual(inspectDocker(), identity),
      "第四座容器或 PostgreSQL 集群标识发生变化",
    );
    await inspectReproEmptyDatabase(new Client(request.options), identity.systemIdentifier);
    requirePreserved();
  };
  await preflight();
  console.info("第四座实际集群身份及二十三类严格空库检查通过");

  stage = "官方在线唯一空起点迁移边预览";
  const preview = runChild(migrationArguments(entry, config, "预览"), childEnv);
  requireMatch(
    !preview.error && preview.status === 0,
    describeNativeChildFailure(preview, "db.migrate"),
  );
  requireNativeMigrationPath(requireMigrationResult(preview.stdout, "db.migrate"), false);
  console.info("第四座官方在线预览确认唯一固定空起点迁移边");

  stage = "写入前再次复核并登记一次性尝试";
  await preflight();
  claimReproAttempt(lab, fingerprint, identity.containerId, identity.systemIdentifier);
  claimed = true;
  console.info("第四座一次性尝试已登记；无论结果如何均禁止自动重试");
  stage = "第四座单次官方原生迁移及取证";
  const child = runChild(migrationArguments(entry, config, "迁移"), childEnv);
  let operations = null;
  let diagnostic = null;
  let schemaFailure = null;
  if (!child.error && child.status === 0) {
    try {
      operations = requireNativeAppliedResult(requireMigrationResult(child.stdout, "db.migrate"));
    } catch {
      diagnostic = "官方应用响应未确认唯一固定迁移边，保留现场";
    }
  } else {
    diagnostic = describeNativeChildFailure(child, "db.migrate");
  }
  if (operations === null) {
    schemaFailure = extractReproSchemaFailure(child.stdout, child.stderr, pathNames);
  }
  // 即使迁移失败或证据复核异常，也独立尝试保存捕获文本和脱敏报告。
  let encryptedOutputSaved = false;
  try {
    saveReproEvidence(
      lab,
      "machine-output.encrypted.json",
      encryptReproOutput(process.env[reproPasswordVariable], child.stdout ?? "", child.stderr ?? ""),
    );
    encryptedOutputSaved = true;
  } catch {
    console.error("第四座原始捕获文本加密保存失败，不允许重试");
  }
  let evidencePreserved = false;
  try {
    requirePreserved();
    evidencePreserved = true;
  } catch {
    console.error("第四座迁移后固定证据复核失败，保留现场");
  }
  let identityPreserved = false;
  try {
    identityPreserved = isDeepStrictEqual(inspectDocker(), identity);
  } catch {
    console.error("第四座迁移后容器身份复核失败，保留现场");
  }
  const passed =
    operations !== null && encryptedOutputSaved && evidencePreserved && identityPreserved;
  const report = {
    status: passed
      ? "NATIVE_ISOLATED_REPRO_APPLIED_REVIEW_REQUIRED"
      : "NATIVE_ISOLATED_REPRO_REVIEW_REQUIRED",
    fingerprint,
    officialExitCode: child.status,
    captureInterrupted: Boolean(child.error || child.signal),
    operationsExecuted: operations,
    diagnostic,
    schemaFailure,
    encryptedOutputSaved,
    evidencePreserved,
    identityPreserved,
    attemptConsumed: true,
    signingAllowed: false,
    deploymentAllowed: false,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  saveReproEvidence(lab, "report.json", report);
  process.exitCode = passed ? 0 : 1;
}

try {
  await main();
} catch (error) {
  const reason =
    error instanceof ReproError ||
    error instanceof NativePreflightError ||
    error instanceof NativeMigrationError
      ? "；" + error.message
      : "；内部详情已脱敏";
  console.error("第四座独立复现阶段失败：" + stage + reason);
  if (claimed) {
    console.error("一次性尝试已消耗，数据库可能已发生变化；禁止重试、重置或清理");
  }
  process.exitCode = 1;
}
