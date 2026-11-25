import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const allowed = new Set([
  "skills sync",
  "skills list",
  "skills native-list",
  "contract emit",
  "contract native-emit",
  "db native-schema-verify",
]);

/** 从已安装的服务端 Prisma 8 官方包解析入口，不下载依赖、不调用 Shell。 */
function resolveCli() {
  try {
    const packageRoot = realpathSync(join(root, "apps", "server", "node_modules", "prisma"));
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.prisma;
    if (
      manifest.name !== "prisma" ||
      typeof manifest.version !== "string" ||
      !manifest.version.startsWith("8.") ||
      typeof bin !== "string" ||
      !bin ||
      isAbsolute(bin)
    ) {
      throw new Error("Prisma 8 包元数据无效");
    }
    const entry = realpathSync(resolve(packageRoot, bin));
    const location = relative(packageRoot, entry);
    if (
      !location ||
      location === ".." ||
      location.startsWith(".." + sep) ||
      isAbsolute(location) ||
      !statSync(entry).isFile()
    ) {
      throw new Error("Prisma 8 入口不在官方包内");
    }
    return entry;
  } catch {
    throw new Error("无法解析已安装的 Prisma 8 CLI，请先检查锁定依赖");
  }
}

try {
  if (args.length !== 2 || !allowed.has(args.join(" "))) {
    throw new Error("Prisma 8 入口仅允许 Skills 同步、列表、离线契约生成和原生只读结构验证");
  }
  const entry = resolveCli();
  // 独立候选仅映射到固定的离线生成或 Skills 列表命令，不接受自定义配置。
  const nativeEmit = args.join(" ") === "contract native-emit";
  const nativeList = args.join(" ") === "skills native-list";
  const nativeSchemaVerify = args.join(" ") === "db native-schema-verify";
  const native = nativeEmit || nativeList || nativeSchemaVerify;
  const command = nativeEmit
    ? ["contract", "emit"]
    : nativeList
      ? ["skills", "list"]
      : nativeSchemaVerify
        ? ["db", "verify", "--schema-only"]
        : args;
  const config = native ? "prisma8-native.config.ts" : "prisma.config.ts";
  // CLI 按进程工作目录同步和检查 Skills；配置内路径仍相对于服务端配置文件。
  const env = { ...process.env };
  if (nativeSchemaVerify) {
    const { requirePrisma8ReadOnlyTestUrl } = await import(
      "../apps/server/src/database/prisma8-readonly-target.ts"
    );
    const connection = new URL(requirePrisma8ReadOnlyTestUrl(env.SCADA_TEST_DATABASE_URL));
    connection.searchParams.set(
      "options",
      "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c search_path=public",
    );
    env.SCADA_TEST_DATABASE_URL = connection.toString();
  } else {
    // 离线 emit 和 Skills 命令不得继承任何测试数据库连接。
    delete env.SCADA_TEST_DATABASE_URL;
  }
  const result = spawnSync(
    process.execPath,
    [entry, ...command, "--config", join(root, "apps", "server", config)],
    { cwd: root, env, stdio: "inherit" },
  );
  if (result.error || result.status === null) {
    throw new Error("Prisma 8 CLI 进程未正常结束");
  }
  process.exitCode = result.status;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Prisma 8 CLI 执行失败");
  process.exitCode = 1;
}
