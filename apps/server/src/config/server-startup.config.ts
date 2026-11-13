import { z } from "zod";
import { allowLocalOpenApi } from "../openapi/scada-openapi.js";

export type ServerListenHost = "127.0.0.1" | "0.0.0.0";

/** 只校验服务端启动所需的原始环境值，不读取或输出其它环境变量。 */
const serverPortSchema = z
  .union([z.string(), z.number()])
  .transform((value) => Number(value))
  .pipe(z.number().int().min(1).max(65535));

const serverHostSchema = z.enum(["127.0.0.1", "0.0.0.0"]);

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
  const rawPort = env.SCADA_SERVER_PORT ?? env.PORT ?? 3001;
  const portResult = serverPortSchema.safeParse(rawPort);
  if (!portResult.success) {
    // 不暴露 ZodError 或原始环境值，保持已有中文错误契约。
    throw new Error("SCADA_SERVER_PORT 必须是 1～65535 之间的整数");
  }

  const rawHost = env.SCADA_SERVER_HOST ?? env.HOST ?? "127.0.0.1";
  const hostResult = serverHostSchema.safeParse(rawHost);
  if (!hostResult.success) {
    throw new Error("SCADA_SERVER_HOST 只能设置为 127.0.0.1 或 0.0.0.0");
  }

  const port = portResult.data;
  const host = hostResult.data;

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
