import { allowLocalOpenApi } from "../openapi/scada-openapi.js";

export type ServerListenHost = "127.0.0.1" | "0.0.0.0";

export interface ServerStartupConfig {
  readonly port: number;
  readonly host: ServerListenHost;
  readonly localDocs: boolean;
}

/**
 * 集中解析服务端启动配置，不访问数据库或工业设备，也不回显环境变量内容。
 * 根目录 .env 必须在调用前加载；Docker 可直接通过进程环境变量注入配置。
 */
export function resolveServerStartupConfig(
  env: Readonly<Record<string, string | undefined>>,
): ServerStartupConfig {
  const rawPort = env.SCADA_SERVER_PORT ?? env.PORT;
  const port = rawPort === undefined ? 3001 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SCADA_SERVER_PORT 必须是 1～65535 之间的整数");
  }

  const host = env.SCADA_SERVER_HOST ?? env.HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0") {
    throw new Error("SCADA_SERVER_HOST 只能设置为 127.0.0.1 或 0.0.0.0");
  }

  return {
    port,
    host,
    localDocs: allowLocalOpenApi({
      enabled: env.SCADA_API_DOCS_ENABLED,
      nodeEnv: env.NODE_ENV,
      host,
    }),
  };
}
