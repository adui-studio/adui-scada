import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** 解析已安装的 Prisma 7 官方兼容包入口，避免误调用 Prisma 8 或经由 Shell 执行。 */
export function resolvePrisma7Cli(serverRoot) {
  try {
    const packageRoot = realpathSync(join(serverRoot, "node_modules", "@prisma", "prisma7"));
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.prisma7;
    if (
      manifest.name !== "@prisma/prisma7" ||
      typeof manifest.version !== "string" ||
      !/^7\./.test(manifest.version) ||
      typeof bin !== "string" ||
      !bin ||
      isAbsolute(bin)
    ) {
      throw new Error("Prisma 7 兼容包元数据无效");
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
      throw new Error("Prisma 7 入口不在兼容包内");
    }
    return entry;
  } catch {
    throw new Error("无法解析 Prisma 7 官方兼容包，请先安装并检查锁定依赖");
  }
}
