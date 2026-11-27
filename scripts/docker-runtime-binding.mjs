import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDockerDatabaseBinding, requireDockerDatabaseBinding } from "../apps/server/src/database/docker-readonly-config.ts";

const FAILURE = "Docker 正式只读数据库绑定文件不一致或无法读取，保留现场";

/** 只在宿主严格数据库核验成功后建立绑定；既有文件必须完全匹配，绝不覆盖。 */
export function ensureDockerDatabaseBinding(root, input, expectedHash) {
  const binding = requireDockerDatabaseBinding(input, expectedHash);
  const dir = resolve(root, ".local", "docker-runtime");
  const file = resolve(dir, "server-database.json");
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!lstatSync(dir).isDirectory()) throw new Error(FAILURE);
    try {
      writeFileSync(file, JSON.stringify(binding) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    }
    const info = lstatSync(file);
    if (!info.isFile() || info.size > 1024) throw new Error(FAILURE);
    const existing = parseDockerDatabaseBinding(readFileSync(file, "utf8"), expectedHash);
    if (existing.password !== binding.password || existing.systemIdentifier !== binding.systemIdentifier) {
      throw new Error(FAILURE);
    }
  } catch {
    throw new Error(FAILURE);
  }
}
