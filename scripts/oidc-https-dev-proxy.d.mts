import type { Buffer } from "node:buffer";

/** 只用于 Vite 本机开发代理的 TLS 与固定 API 配置。 */
export interface LoopbackOidcHttpsProxy {
  readonly https: {
    readonly cert: Buffer;
    readonly key: Buffer;
  };
  readonly apiProxy: {
    readonly target: string;
    readonly changeOrigin: false;
    readonly xfwd: false;
    readonly ws: false;
  };
}

export interface LoopbackOidcHttpsProxyDependencies {
  readonly readFile?: (path: string) => Buffer;
  readonly verifyTls?: (certificate: Buffer, privateKey: Buffer) => void;
}

export function resolveLoopbackOidcHttpsProxy(
  env: Readonly<Record<string, string | undefined>>,
  webPort: number,
  deps?: LoopbackOidcHttpsProxyDependencies,
): LoopbackOidcHttpsProxy | null;
