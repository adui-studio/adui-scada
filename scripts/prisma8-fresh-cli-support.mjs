import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

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

class FreshCliError extends Error {}

function requireCondition(condition, message) {
  if (!condition) throw new FreshCliError(message);
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

function readRegular(path) {
  requireCondition(
    lstatSync(path, { throwIfNoEntry: false })?.isFile() && realpathSync(path) === path,
    "原生工具链文件不存在或包含链接",
  );
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  requireCondition(
    text.length > 0 && Buffer.from(text, "utf8").equals(bytes),
    "原生工具链文件必须为非空 UTF-8 原文",
  );
  return text;
}

/** 从已安装固定版本的包解析 CLI，不调用 Shell 或下载依赖。 */
export function resolveFreshCli(root) {
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
    "原生工具链必须使用已经验收的固定 Prisma 8 版本",
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
