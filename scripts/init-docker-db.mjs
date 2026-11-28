import { validateLabSecrets } from "./prepare-oidc-lab.mjs";
import { validateDockerEnv } from "./docker-stack.mjs";

/** 从 Git 忽略的本机随机凭据安全创建数据库 URL，不输出密码。 */
export function createDockerDatabaseUrl(envText, secretsText) {
  validateDockerEnv(envText);
  const secrets = validateLabSecrets(secretsText);
  const env = new Map();
  for (const line of envText.split(/\r?\n/)) {
    const found = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (found) env.set(found[1], found[2]);
  }
  const port = env.get("SCADA_LAB_POSTGRES_PORT") ?? "15432";
  const url = new URL(`postgresql://127.0.0.1:${port}/adui_scada`);
  url.username = "adui_scada";
  url.password = secrets.SCADA_LAB_DB_PASSWORD;
  url.searchParams.set("schema", "public");
  return url.toString();
}

/** 本机 Docker 随机凭据优先于根目录 .env 和终端残留的同名变量。 */
export function createDockerPrismaEnvironment(envText, secretsText, inherited = process.env) {
  const url = createDockerDatabaseUrl(envText, secretsText);
  const connection = new URL(url);
  return {
    ...inherited,
    NODE_ENV: "development",
    SCADA_DATABASE_URL: url,
    SCADA_DB_HOST: "127.0.0.1",
    SCADA_DB_PORT: connection.port,
    SCADA_DB_NAME: "adui_scada",
    SCADA_DB_USER: "adui_scada",
    SCADA_DB_PASSWORD: decodeURIComponent(connection.password),
  };
}
