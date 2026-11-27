export interface Prisma8RuntimeConfig {
  readonly connectionString: string | undefined;
  readonly readOnly: boolean;
  readonly expectedSystemIdentifier?: string;
  /** 仅供受控容器烟测和常驻只读服务使用，不允许正式可写连接。 */
  readonly transport?: "docker-readonly";
}

export interface Prisma8RuntimeIdentity {
  readonly database: string;
  readonly role: string;
  readonly sessionRole: string;
  readonly schema: string;
  readonly version: string;
  readonly systemIdentifier: string;
  readonly storageHash: string | null;
  readonly readOnly: string;
  readonly defaultReadOnly: string;
  readonly recovery: boolean;
}

/** 当前提供方仅面向已初始化的本机业务库，不接受历史库或调用方连接选项。 */
export function resolvePrisma8RuntimeUrl(config: Prisma8RuntimeConfig): string {
  const input = config.connectionString;
  const message = "Prisma 8 运行时仅允许已初始化的本机业务库";
  if (
    !input ||
    Array.from(input).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 32 || code === 127;
    })
  ) {
    throw new Error(message);
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(message);
  }
  const parameters = [...url.searchParams.entries()];
  const dockerReadOnly = config.transport === "docker-readonly";
  if (
    url.protocol !== "postgresql:" ||
    (config.transport !== undefined && !dockerReadOnly) ||
    (dockerReadOnly &&
      (config.readOnly !== true || config.expectedSystemIdentifier === undefined)) ||
    url.hostname !== (dockerReadOnly ? "postgres" : "127.0.0.1") ||
    url.port !== (dockerReadOnly ? "5432" : "15432") ||
    url.username !== "adui_scada" ||
    url.pathname !== "/adui_scada" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(url.password) ||
    url.hash ||
    parameters.length !== 1 ||
    parameters[0]?.[0] !== "schema" ||
    parameters[0]?.[1] !== "public" ||
    typeof config.readOnly !== "boolean" ||
    (config.expectedSystemIdentifier !== undefined &&
      !/^[1-9][0-9]{0,19}$/u.test(config.expectedSystemIdentifier))
  ) {
    throw new Error(message);
  }
  url.search = "";
  url.searchParams.set(
    "options",
    "-c default_transaction_read_only=" +
      (config.readOnly ? "on" : "off") +
      " -c statement_timeout=30000 -c lock_timeout=5000 -c search_path=public -c timezone=UTC -c standard_conforming_strings=on",
  );
  return url.toString();
}

/** 标记不匹配必须拒绝启动，不能依赖官方运行时的告警代替硬门禁。 */
export function requirePrisma8RuntimeIdentity(
  rows: readonly Prisma8RuntimeIdentity[],
  config: Prisma8RuntimeConfig,
  storageHash: string,
): void {
  const row = rows[0];
  const mode = config.readOnly ? "on" : "off";
  if (
    rows.length !== 1 ||
    !row ||
    row.database !== "adui_scada" ||
    row.role !== "adui_scada" ||
    row.sessionRole !== "adui_scada" ||
    row.schema !== "public" ||
    !/^19[0-9]{4}$/u.test(row.version) ||
    !/^[1-9][0-9]{0,19}$/u.test(row.systemIdentifier) ||
    (config.expectedSystemIdentifier !== undefined &&
      row.systemIdentifier !== config.expectedSystemIdentifier) ||
    row.storageHash !== storageHash ||
    !/^[a-f0-9]{64}$/u.test(storageHash) ||
    row.readOnly !== mode ||
    row.defaultReadOnly !== mode ||
    row.recovery !== false
  ) {
    throw new Error("Prisma 8 运行时数据库身份、标记或连接边界不一致");
  }
}

export interface Prisma8RuntimePort<Client> {
  readonly client: Client;
  verify(): Promise<void>;
  close(): Promise<void>;
}

/** 单次启动和幂等关闭；校验前及关闭后均不提供客户端。 */
export class Prisma8RuntimeLifecycle<Client> {
  private port: Prisma8RuntimePort<Client> | undefined;
  private startup: Promise<void> | undefined;
  private shutdown: Promise<void> | undefined;
  private ready = false;
  private stopped = false;
  private releaseFailed = false;

  get client(): Client {
    if (!this.ready || this.stopped || !this.port) {
      throw new Error("Prisma 8 数据库提供方尚未就绪或已关闭");
    }
    return this.port.client;
  }

  start(create: () => Prisma8RuntimePort<Client>): Promise<void> {
    if (this.startup || this.stopped) {
      return Promise.reject(new Error("Prisma 8 数据库提供方不允许重复启动"));
    }
    this.startup = this.initialize(create);
    return this.startup;
  }

  private async initialize(create: () => Prisma8RuntimePort<Client>): Promise<void> {
    try {
      this.port = create();
      await this.port.verify();
      if (this.stopped) throw new Error("Prisma 8 数据库提供方已停止");
      this.ready = true;
    } catch {
      this.ready = false;
      this.stopped = true;
      try {
        await this.release();
      } catch {
        throw new Error("Prisma 8 数据库启动校验及关闭失败");
      }
      throw new Error("Prisma 8 数据库启动校验失败");
    }
  }

  stop(): Promise<void> {
    this.ready = false;
    this.stopped = true;
    this.shutdown ??= this.finish();
    return this.shutdown;
  }

  private async finish(): Promise<void> {
    try {
      await this.startup;
    } catch {
      // 启动路径已负责释放并报告失败，不重新启动或关闭同一资源。
    }
    await this.release();
    if (this.releaseFailed) throw new Error("Prisma 8 数据库提供方关闭失败");
  }

  private async release(): Promise<void> {
    const port = this.port;
    this.port = undefined;
    if (!port) return;
    try {
      await port.close();
    } catch {
      this.releaseFailed = true;
      throw new Error("Prisma 8 数据库提供方关闭失败");
    }
  }
}
