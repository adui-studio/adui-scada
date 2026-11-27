import { X509Certificate } from "node:crypto";
import { request } from "node:https";
import type { RequestOptions } from "node:https";
import { checkServerIdentity } from "node:tls";
import type { CustomFetch } from "openid-client";

const REALM = "/realms/adui-scada";
const MAX_BYTES = 256 * 1024;
const REQUEST_TIMEOUT = 10_000;
const FAILURE = "Docker OIDC 固定 HTTPS 传输失败";

type Exchange = (options: RequestOptions, body: string | undefined) => Promise<Response>;

/** 保留完整响应体供 openid-client 验证；只接受有限、未压缩的 JSON，不跟随跳转。 */
export async function exchangeDockerOidc(
  options: RequestOptions,
  body: string | undefined,
): Promise<Response> {
  const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const req = request(options, resolve);
    req.on("error", reject);
    req.end(body);
  });
  const status = response.statusCode ?? 0;
  const contentType = response.headers["content-type"] ?? "";
  if (
    (status !== 200 && status !== 400 && status !== 401) ||
    response.headers.location !== undefined ||
    response.headers["content-encoding"] !== undefined ||
    contentType.split(";")[0]?.trim().toLowerCase() !== "application/json"
  ) {
    response.destroy();
    throw new Error(FAILURE);
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response) {
    if (!Buffer.isBuffer(chunk)) {
      response.destroy();
      throw new Error(FAILURE);
    }
    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      response.destroy();
      throw new Error(FAILURE);
    }
    chunks.push(chunk);
  }
  const headers = new Headers({ "content-type": contentType });
  const challenge = response.headers["www-authenticate"];
  if (challenge !== undefined) headers.set("www-authenticate", challenge);
  return new Response(Uint8Array.from(Buffer.concat(chunks)), { status, headers });
}

/** 创建仅供受信 Docker 运行时使用的固定 Realm 传输，不接受动态主机、证书文件或代理。 */
export function createDockerOidcFetch(
  issuer: URL,
  ca: string,
  exchange: Exchange = exchangeDockerOidc,
): CustomFetch {
  const origin = issuer.origin;
  if (
    issuer.protocol !== "https:" ||
    issuer.hostname !== "127.0.0.1" ||
    issuer.href !== origin + REALM ||
    typeof ca !== "string" ||
    ca.length > 32 * 1024 ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  ) {
    throw new Error(FAILURE);
  }
  let trustedCa: string;
  try {
    const root = new X509Certificate(ca);
    if (!root.ca || !root.checkIssued(root) || !root.verify(root.publicKey)) {
      throw new Error(FAILURE);
    }
    trustedCa = root.toString();
  } catch {
    throw new Error(FAILURE);
  }
  const discovery = origin + REALM + "/.well-known/openid-configuration";
  const base = origin + REALM + "/protocol/openid-connect";
  const host = issuer.host;

  return async (url, options) => {
    try {
      const token = url === base + "/token" && options.method === "POST";
      const read = (url === discovery || url === base + "/certs") && options.method === "GET";
      if ((!token && !read) || options.redirect !== "manual" || options.signal?.aborted) {
        throw new Error(FAILURE);
      }
      const headers = new Headers(options.headers);
      // 只转发 SDK 所需请求头，公开 Host 固定，禁止 Cookie 和任意代理头。
      for (const name of headers.keys()) {
        if (!["accept", "user-agent", "content-type", "authorization"].includes(name)) {
          throw new Error(FAILURE);
        }
      }
      let body: string | undefined;
      if (token) {
        if (
          !(options.body instanceof URLSearchParams) ||
          options.body.getAll("grant_type").length !== 1 ||
          options.body.get("grant_type") !== "authorization_code" ||
          !headers.get("authorization")?.startsWith("Basic ") ||
          headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
            "application/x-www-form-urlencoded"
        ) {
          throw new Error(FAILURE);
        }
        body = options.body.toString();
        if (Buffer.byteLength(body) > 16 * 1024) throw new Error(FAILURE);
        headers.set("content-length", String(Buffer.byteLength(body)));
      } else if (
        (options.body !== undefined && options.body !== null) ||
        headers.has("authorization") ||
        headers.has("content-type")
      ) {
        throw new Error(FAILURE);
      }
      headers.set("host", host);
      const deadline = AbortSignal.timeout(REQUEST_TIMEOUT);
      const response = await exchange(
        {
          hostname: "keycloak",
          port: 8443,
          path: new URL(url).pathname,
          method: options.method,
          headers: Object.fromEntries(headers),
          ca: trustedCa,
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
          checkServerIdentity: (_hostname, certificate) =>
            checkServerIdentity("127.0.0.1", certificate),
          agent: false,
          signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline,
        },
        body,
      );
      if (read && response.status !== 200) throw new Error(FAILURE);
      return response;
    } catch {
      // 授权码、凭据、Token 响应和第三方异常原文不得进入日志。
      throw new Error(FAILURE);
    }
  };
}
