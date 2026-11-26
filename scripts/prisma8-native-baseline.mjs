import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const nativeHash = "6eec3e7459bdfa2646dc156bd6eaf22ffe60b0a0eac309622262b9742a0c68cc";
const approval = "--confirm-offline-baseline";
const files = ["contract.prisma", "contract.json", "contract.d.ts"];
const allowedEnvironment = new Set([
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
]);

export class BaselineError extends Error {}

function requireCondition(condition, message) {
  if (!condition) throw new BaselineError(message);
}

/** 只接受一次明确的离线生成确认，不转发维护者提供的任意参数。 */
export function requireBaselineApproval(args) {
  requireCondition(args.length === 1 && args[0] === approval, "必须明确确认仅生成离线原生基线候选");
}

/** 子进程只继承必要系统路径，不继承数据库、令牌或 Node 注入配置。 */
export function offlineEnvironment(source) {
  return {
    ...Object.fromEntries(
      Object.entries(source).filter(([key]) => allowedEnvironment.has(key.toUpperCase())),
    ),
    CI: "true",
    NO_COLOR: "1",
  };
}

function requireDirectory(path) {
  requireCondition(
    lstatSync(path, { throwIfNoEntry: false })?.isDirectory() && realpathSync(path) === path,
    "离线基线路径不存在或包含链接",
  );
}

function readRegular(path) {
  requireCondition(
    lstatSync(path, { throwIfNoEntry: false })?.isFile() && realpathSync(path) === path,
    "离线基线文件不存在或包含链接",
  );
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  requireCondition(
    text.length > 0 && Buffer.from(text, "utf8").equals(bytes),
    "离线基线文件必须为非空 UTF-8 原文",
  );
  return text;
}

/** 读取保留候选和正式生成物；仅明确的复验模式允许已有真实目录。 */
export function readBaselineInputs(root, reviewExisting = false) {
  const artifacts = join(root, ".artifacts");
  const native = join(artifacts, "prisma8-native");
  const output = join(artifacts, "prisma8-native-baseline");
  const formal = join(root, "apps", "server", "src", "generated", "prisma8");
  requireDirectory(artifacts);
  requireDirectory(native);
  requireDirectory(formal);
  if (reviewExisting) requireDirectory(output);
  else
    requireCondition(
      !lstatSync(output, { throwIfNoEntry: false }),
      "独立基线输出已存在，禁止覆盖或自动清理",
    );
  return {
    native: files.map((name) => readRegular(join(native, name))),
    formal: files.slice(1).map((name) => readRegular(join(formal, name))),
    config: readRegular(join(root, "apps", "server", "prisma8-native-baseline.config.ts")),
  };
}

/** 从已安装固定版本的包解析 CLI，不调用 Shell 或下载依赖。 */
export function resolveBaselineCli(root) {
  const server = join(root, "apps", "server", "node_modules");
  const cli = realpathSync(join(server, "prisma"));
  const manifest = JSON.parse(readRegular(join(cli, "package.json")));
  const orm = realpathSync(join(server, "@prisma", "orm-postgres"));
  const provider = JSON.parse(readRegular(join(orm, "package.json")));
  requireCondition(
    manifest.name === "prisma" &&
      manifest.version === "8.0.0-rc.35" &&
      provider.name === "@prisma/orm-postgres" &&
      provider.version === "8.0.0-rc.25",
    "离线基线必须使用已经验收的固定 Prisma 8 版本",
  );
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.prisma;
  requireCondition(
    typeof bin === "string" && bin.length > 0 && !isAbsolute(bin),
    "固定 Prisma 8 CLI 入口无效",
  );
  const entry = realpathSync(resolve(cli, bin));
  const location = relative(cli, entry);
  requireCondition(
    location &&
      location !== ".." &&
      !location.startsWith(".." + sep) &&
      !isAbsolute(location) &&
      lstatSync(entry).isFile(),
    "固定 Prisma 8 CLI 入口不在包内",
  );
  return entry;
}

/** 验证生成前后的原件与隔离副本一致；不尝试恢复被改动的文件。 */
export function requirePreservedInputs(root, inputs) {
  const native = join(root, ".artifacts", "prisma8-native");
  const output = join(root, ".artifacts", "prisma8-native-baseline");
  const formal = join(root, "apps", "server", "src", "generated", "prisma8");
  requireCondition(
    isDeepStrictEqual(
      files.map((name) => readRegular(join(native, name))),
      inputs.native,
    ) &&
      isDeepStrictEqual(
        files.slice(1).map((name) => readRegular(join(formal, name))),
        inputs.formal,
      ) &&
      isDeepStrictEqual(
        files.map((name) => readRegular(join(output, name))),
        inputs.native,
      ) &&
      readRegular(join(root, "apps", "server", "prisma8-native-baseline.config.ts")) ===
        inputs.config,
    "正式生成物、保留候选、独立配置或隔离副本发生变化",
  );
}

/** 只在新建独立目录复制原件，固定空起点规划；无论成功失败保留原始诊断。 */
export function runBaselinePlanner(root, inputs, entry) {
  const output = join(root, ".artifacts", "prisma8-native-baseline");
  requireCondition(
    isDeepStrictEqual(readBaselineInputs(root), inputs),
    "离线基线输入在规划前发生变化",
  );
  mkdirSync(output);
  for (const [index, name] of files.entries())
    writeFileSync(join(output, name), inputs.native[index], { flag: "wx" });
  const result = spawnSync(
    process.execPath,
    [
      entry,
      "migration",
      "plan",
      "--from",
      "@empty",
      "--name",
      "scada_native_baseline",
      "--json",
      "--no-interactive",
      "--config",
      join(root, "apps", "server", "prisma8-native-baseline.config.ts"),
    ],
    {
      cwd: root,
      env: offlineEnvironment(process.env),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  requireDirectory(output);
  writeFileSync(join(output, "plan.json"), result.stdout ?? "", { flag: "wx" });
  writeFileSync(join(output, "plan.stderr.txt"), result.stderr ?? "", { flag: "wx" });
  requirePreservedInputs(root, inputs);
  requireCondition(
    !result.error && result.status === 0,
    "离线规划失败，保留独立目录及原始诊断，禁止自动重试",
  );
  return inspectBaselinePackage(root, inputs.native[1]);
}

function directoryNames(path) {
  requireDirectory(path);
  return readdirSync(path);
}

function requireNames(path, expected) {
  const actual = directoryNames(path);
  requireCondition(
    actual.length === expected.length && expected.every((name) => actual.includes(name)),
    "离线迁移图存在缺失或额外对象",
  );
}

/** 固定 RC 的机器输出必须是成功的规划封装，不接受旧模拟结构或失败诊断。 */
export function parseBaselinePlan(document) {
  return parseOfflinePlan(document, nativeHash);
}

function parseOfflinePlan(document, targetHash) {
  const envelope = document?.envelope;
  requireCondition(
    document?.kind === "result" &&
      document.commandId === "migration.plan" &&
      envelope?.commandId === "migration.plan" &&
      envelope.ok === true &&
      envelope.exitCode === 0 &&
      Array.isArray(envelope.diagnostics) &&
      envelope.diagnostics.length === 0,
    "官方离线规划封装或诊断不符合成功条件",
  );
  const plan = envelope.result;
  requireCondition(
    plan?.ok === true && plan.noOp === false && plan.from === null && plan.to === targetHash,
    "官方离线规划起点、目标或结果不一致",
  );
  requireCondition(
    !Object.hasOwn(plan, "pendingPlaceholders") || plan.pendingPlaceholders === false,
    "官方离线规划包含未填充占位符或未知状态",
  );
  requireCondition(
    [plan.appliedStatements, plan.temporaryValues, plan.emittedExtensionDirs].every(
      (items) => Array.isArray(items) && items.length === 0,
    ),
    "离线规划包含已应用语句、临时值或扩展目录",
  );
  requireCondition(
    Array.isArray(plan.operations) &&
      plan.operations.length > 0 &&
      plan.operations.every(
        (operation) =>
          typeof operation?.id === "string" &&
          operation.id.length > 0 &&
          typeof operation.label === "string" &&
          operation.label.length > 0 &&
          operation.operationClass === "additive",
      ) &&
      new Set(plan.operations.map((operation) => operation.id)).size === plan.operations.length,
    "离线规划包含非新增操作、重复标识或空清单",
  );
  requireCondition(
    Array.isArray(plan.preview?.statements) &&
      plan.preview.statements.length > 0 &&
      plan.preview.statements.every(
        (statement) =>
          statement?.language === "sql" &&
          typeof statement.text === "string" &&
          statement.text.trim().length > 0,
      ),
    "离线规划缺少有效 SQL 预览",
  );
  return plan;
}

/** 对照官方计划和实际操作清单；这里只验证一致性，不判定 SQL 可部署。 */
function requireMatchingOperations(plan, ops) {
  requireCondition(
    Array.isArray(ops) &&
      ops.length === plan.operations.length &&
      ops.every(
        (operation) =>
          operation?.operationClass === "additive" &&
          operation.target?.id === "postgres" &&
          Array.isArray(operation.precheck) &&
          Array.isArray(operation.postcheck) &&
          Array.isArray(operation.execute) &&
          operation.execute.length > 0 &&
          operation.execute.every(
            (statement) =>
              typeof statement?.sql === "string" &&
              statement.sql.trim().length > 0 &&
              (!Object.hasOwn(statement, "params") ||
                (Array.isArray(statement.params) && statement.params.length === 0)),
          ),
      ),
    "离线基线实际操作类型、目标或执行语句不一致",
  );
  requireCondition(
    isDeepStrictEqual(
      ops.map(({ id, label, operationClass }) => ({ id, label, operationClass })),
      plan.operations,
    ),
    "离线基线计划与操作摘要不一致",
  );
  requireCondition(
    isDeepStrictEqual(
      ops.flatMap((operation) =>
        operation.execute.map(({ sql }) => ({ text: sql, language: "sql" })),
      ),
      plan.preview.statements,
    ),
    "离线基线预览与实际执行语句不一致",
  );
}

/** 复验已经保留的候选，不启动规划器、不写入任何文件。 */
export function reviewExistingBaseline(root, inputs) {
  requireCondition(
    isDeepStrictEqual(readBaselineInputs(root, true), inputs),
    "离线基线复验输入发生变化",
  );
  requirePreservedInputs(root, inputs);
  const result = inspectBaselinePackage(root, inputs.native[1]);
  requirePreservedInputs(root, inputs);
  return result;
}

/** 仅验收生成物形状、空起点及目标内容；完整 DDL、注释及哈希算法另行评审。 */
export function inspectBaselinePackage(root, nativeText) {
  const output = join(root, ".artifacts", "prisma8-native-baseline");
  return inspectOfflinePackage(root, output, nativeText, nativeHash, /^\d{8}T\d{4}_scada_native_baseline$/);
}

/** 仅检查独立离线规划产物；调用者仍须核验固定契约和目录证据。 */
export function inspectOfflinePackage(root, output, nativeText, targetHash, directoryPattern) {
  requireNames(output, [...files, "migrations", "plan.json", "plan.stderr.txt"]);
  const plan = parseOfflinePlan(JSON.parse(readRegular(join(output, "plan.json"))), targetHash);
  const graph = join(output, "migrations");
  requireNames(graph, ["app", "snapshots"]);
  const app = join(graph, "app");
  const entries = directoryNames(app);
  const packages = entries.filter((name) => name !== "refs");
  if (entries.includes("refs")) requireNames(join(app, "refs"), []);
  requireCondition(
    packages.length === 1 && directoryPattern.test(packages[0]),
    "离线迁移图必须只有一个独立空起点基线包",
  );
  const migration = join(app, packages[0]);
  requireCondition(
    typeof plan.dir === "string" && resolve(root, plan.dir) === migration,
    "规划返回路径与实际独立基线包不一致",
  );
  requireNames(migration, ["migration.ts", "migration.json", "ops.json"]);
  const manifest = JSON.parse(readRegular(join(migration, "migration.json")));
  requireCondition(
    manifest.from === null &&
      manifest.to === targetHash &&
      Array.isArray(manifest.providedInvariants) &&
      manifest.providedInvariants.length === 0 &&
      typeof manifest.migrationHash === "string" &&
      /^(?:sha256:)?[a-f0-9]{64}$/.test(manifest.migrationHash),
    "离线基线起点、目标或迁移标识不一致",
  );
  const authoring = readRegular(join(migration, "migration.ts"));
  requireCondition(!/\bplaceholder\s*\(/.test(authoring), "离线基线包含未填充占位符");
  const ops = JSON.parse(readRegular(join(migration, "ops.json")));
  requireMatchingOperations(plan, ops);
  const snapshots = join(graph, "snapshots");
  requireNames(snapshots, [targetHash]);
  const snapshot = join(snapshots, targetHash);
  requireNames(snapshot, ["contract.json", "contract.d.ts"]);
  requireCondition(
    isDeepStrictEqual(
      JSON.parse(readRegular(join(snapshot, "contract.json"))),
      JSON.parse(nativeText),
    ),
    "基线目标快照与保留原生契约不一致",
  );
  readRegular(join(snapshot, "contract.d.ts"));
  return {
    status: "BASELINE_ARTIFACT_REVIEW_REQUIRED",
    migrationHash: manifest.migrationHash,
    contractHash: targetHash,
    contractContentHash: createHash("sha256").update(nativeText).digest("hex"),
    operations: plan.operations.length,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}
