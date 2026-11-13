/** 仅允许显式开启的本机非生产环境挂载只读模拟接口。 */
export interface LocalDemoAccessPolicy {
  readonly enabled: string | undefined;
  readonly nodeEnv: string | undefined;
  readonly host: string;
}

export function allowLocalDemoTelemetry(policy: LocalDemoAccessPolicy): boolean {
  return (
    policy.enabled === "true" && policy.nodeEnv !== "production" && policy.host === "127.0.0.1"
  );
}
