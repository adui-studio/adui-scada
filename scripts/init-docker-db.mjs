import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLabSecrets } from "./prepare-oidc-lab.mjs";
import { validateDockerEnv } from "./docker-stack.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 从 Git 忽略的本机随机凭据安全创建数据库 URL，不输出密码。 */
export function createDockerDatabaseUrl(envText, secretsText) {
  validateDockerEnv(envText);
  const secrets = validateLabSecrets(secretsText);
  const env = new Map();
  for (const line of envText.split(/\r?\n/)) {
    const found = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (found) env.set(found[1], found[2]);
  }
  const port = env.get("SCADA_LAB_POSTGRES_PORT") ?? "15433";
  const url = new URL(`postgresql://127.0.0.1:${port}/adui_scada`);
  url.username = "adui_scada";
  url.password = secrets.SCADA_LAB_DB_PASSWORD;
  url.searchParams.set("schema", "public");
  return url.toString();
}

/** 始终指向全新本机业务库，Prisma migrate deploy 可安全重复执行。 */
export function initializeDockerDatabase(root = ROOT, run = spawnSync) {
  const envFile = join(root, ".env");
  const secretFile = join(root, ".local", "docker", "secrets.env");
  if (!existsSync(envFile) || !existsSync(secretFile)) {
    throw new Error("缺少本机 Docker 配置或随机凭据，请先执行 docker:up");
  }
  const url = createDockerDatabaseUrl(
    readFileSync(envFile, "utf8"),
    readFileSync(secretFile, "utf8"),
  );
  const server = resolve(root, "apps", "server");
  const serverRequire = createRequire(join(server, "package.json"));
  const prismaCli = serverRequire.resolve("prisma/build/index.js");
  const result = run(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--config", "prisma.config.ts"],
    {
      cwd: server,
      env: {
        ...process.env,
        NODE_ENV: "development",
        SCADA_DATABASE_URL: url,
        SCADA_DB_HOST: "127.0.0.1",
        SCADA_DB_PORT: new URL(url).port,
        SCADA_DB_NAME: "adui_scada",
        SCADA_DB_USER: "adui_scada",
        SCADA_DB_PASSWORD: new URL(url).password,
      },
      shell: false,
      windowsHide: true,
      stdio: "inherit",
      timeout: 120_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error("Docker 本机业务数据库 Prisma 迁移失败，请检查 PostgreSQL 状态");
  }
  return "全新业务数据库 Prisma 迁移完成";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(initializeDockerDatabase());
  } catch (error) {
    const safe = [
      "缺少本机 Docker 配置或随机凭据，请先执行 docker:up",
      "Docker 本机业务数据库 Prisma 迁移失败，请检查 PostgreSQL 状态",
    ];
    console.error(error instanceof Error && safe.includes(error.message)
      ? error.message : "本机数据库迁移准备失败，不输出数据库密钥");
    process.exitCode = 1;
  }
}
