import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_PATTERN =
  /^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATABASE_CHECKS = {
  before: "preflight-oidc-published-revocation-target.mjs",
  after: "preflight-oidc-published-revocation-after.mjs",
};
const BROWSER_CHECK = "test-oidc-published-revocation-readonly.mjs";
const SAFE_ERRORS = new Set([
  "D5b4f 只允许明确阶段与独立专用工程，禁止任何写入或自动撤权",
  "D5b4f 首次数据库只读检查未通过，已停止",
  "D5b4f React/Vue 真实只读浏览器验收未通过，已停止",
  "D5b4f 末次数据库只读复核未通过，已停止",
]);

/** 阶段必须由维护者手动指定；不允许创建、撤权、恢复或跨阶段串行执行。 */
export function parseD5b4fSequenceArgs(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 4 ||
    args[0] !== "--phase" ||
    !Object.hasOwn(DATABASE_CHECKS, args[1]) ||
    args[2] !== "--project-id" ||
    !PROJECT_PATTERN.test(args[3] ?? "")
  ) {
    throw new Error("D5b4f 只允许明确阶段与独立专用工程，禁止任何写入或自动撤权");
  }
  return { phase: args[1], projectId: args[3] };
}

/** 三个步骤使用同一个固定 ID：只读数据库、真实双框架 GET、再次只读数据库。 */
export function planD5b4fSequence(mode) {
  if (
    !mode ||
    !Object.hasOwn(DATABASE_CHECKS, mode.phase) ||
    !PROJECT_PATTERN.test(mode.projectId ?? "")
  ) {
    throw new Error("D5b4f 只允许明确阶段与独立专用工程，禁止任何写入或自动撤权");
  }
  const databaseScript = DATABASE_CHECKS[mode.phase];
  const databaseArgs = ["--project-id", mode.projectId];
  return [
    {
      script: databaseScript,
      args: databaseArgs,
      failure: "D5b4f 首次数据库只读检查未通过，已停止",
      name: "首次数据库只读检查",
    },
    {
      script: BROWSER_CHECK,
      args: ["--phase", mode.phase, "--project-id", mode.projectId],
      failure: "D5b4f React/Vue 真实只读浏览器验收未通过，已停止",
      name: "React/Vue 双框架真实只读验收",
    },
    {
      script: databaseScript,
      args: databaseArgs,
      failure: "D5b4f 末次数据库只读复核未通过，已停止",
      name: "末次数据库只读复核",
    },
  ];
}

/** 当前阶段内只串行调用固定的三个无写入入口，遇到失败立即停止。 */
export async function runD5b4fSequence(mode, launch) {
  const steps = planD5b4fSequence(mode);
  for (const step of steps) {
    const result = await launch(step.script, step.args);
    if (result !== 0) throw new Error(step.failure);
  }
  return true;
}

/** 所有异常均映射为固定中文类别，不打印子进程异常正文或参数。 */
export function describeD5b4fSequenceFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return "D5b4f 真实只读验收编排失败，内部信息已脱敏";
}

function launchFixedReadOnlyScript(script, args) {
  const filename = fileURLToPath(new URL("./" + script, import.meta.url));
  const command = spawnSync(process.execPath, [filename, ...args], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "inherit",
    shell: false,
  });
  return command.error || command.signal !== null ? 1 : command.status;
}

async function run() {
  const mode = parseD5b4fSequenceArgs(process.argv.slice(2));
  const steps = planD5b4fSequence(mode);
  let index = 0;
  await runD5b4fSequence(mode, (script, args) => {
    const step = steps[index];
    index += 1;
    process.stdout.write("D5b4f：" + step.name + "，正在执行。\n");
    return launchFixedReadOnlyScript(script, args);
  });
  process.stdout.write(
    "D5b4f 本阶段三项只读检查通过；不代表两个阶段均完成或已实际撤销 ACL。\n",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describeD5b4fSequenceFailure(error) + "\n");
    process.exitCode = 1;
  });
}
