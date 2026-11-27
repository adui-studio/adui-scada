import { readFileSync } from "node:fs";
import type { Prisma8RuntimeConfig } from "./prisma8-runtime-boundary.js";

export const DOCKER_DATABASE_BINDING_PATH = "/run/secrets/adui-scada-server-database.json";
const FAILURE = "Docker 正式只读数据库绑定无效";

export interface DockerDatabaseBinding {
  readonly password: string;
  readonly systemIdentifier: string;
  readonly storageHash: string;
}

/** 只有固定本机容器启动模式可使用该只读绑定；宿主及其他生产模式不改变。 */
export function resolveDockerReadOnlyMode(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const flag = env.SCADA_DOCKER_DB_READONLY;
  if (flag === undefined || flag === "false") return false;
  if (
    flag !== "true" ||
    env.NODE_ENV !== "production" ||
    env.SCADA_SERVER_HOST !== "0.0.0.0" ||
    env.SCADA_OIDC_ENABLED !== "false" ||
    env.SCADA_LOCAL_DEMO_API_ENABLED !== "false" ||
    env.SCADA_DATABASE_URL
  ) {
    throw new Error("Docker 正式只读模式必须与认证、模拟接口及宿主连接配置隔离");
  }
  return true;
}

/** 仅接受严格核验的三项业务库绑定，不接受路径、数据库地址或写入选项。 */
export function requireDockerDatabaseBinding(
  value: unknown,
  expectedHash: string,
): DockerDatabaseBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(FAILURE);
  const record = value as Record<string, unknown>;
  const { password, systemIdentifier, storageHash } = record;
  if (
    Object.keys(record).length !== 3 ||
    !["password", "systemIdentifier", "storageHash"].every((key) => Object.hasOwn(record, key)) ||
    typeof password !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(password) ||
    typeof systemIdentifier !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(systemIdentifier) ||
    typeof storageHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(storageHash) ||
    storageHash !== expectedHash
  ) {
    throw new Error(FAILURE);
  }
  return { password, systemIdentifier, storageHash };
}

export function parseDockerDatabaseBinding(
  text: string,
  expectedHash: string,
): DockerDatabaseBinding {
  try {
    if (Buffer.byteLength(text) > 1024) throw new Error(FAILURE);
    return requireDockerDatabaseBinding(JSON.parse(text), expectedHash);
  } catch {
    throw new Error(FAILURE);
  }
}

/** 固定容器 DNS、端口、角色和库名；连接选项仍由正式运行时边界统一构造。 */
export function resolveDockerReadOnlyConfig(
  text: string,
  expectedHash: string,
): Prisma8RuntimeConfig {
  const binding = parseDockerDatabaseBinding(text, expectedHash);
  const url = new URL("postgresql://adui_scada@postgres:5432/adui_scada?schema=public");
  url.password = binding.password;
  return {
    connectionString: url.toString(),
    readOnly: true,
    expectedSystemIdentifier: binding.systemIdentifier,
    transport: "docker-readonly",
  };
}

/** 仅读取固定单文件挂载，错误不得包含秘密、文件正文或连接字符串。 */
export function loadDockerReadOnlyConfig(expectedHash: string): Prisma8RuntimeConfig {
  try {
    return resolveDockerReadOnlyConfig(
      readFileSync(DOCKER_DATABASE_BINDING_PATH, "utf8"),
      expectedHash,
    );
  } catch {
    throw new Error(FAILURE);
  }
}
