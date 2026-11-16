import { existsSync } from "node:fs";
import { request } from "node:https";
import { resolve as resolvePath } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const LOOPBACK = "127.0.0.1";
const PATH = "/api/v1/auth/me";
const MAX_RESPONSE_BYTES = 8192;
const TIMEOUT_MS = 5000;

function port(raw) {
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,4}$/.test(raw)) {
    throw new Error("HTTPS 联调端口无效");
  }

  const value = Number(raw);
  if (value > 65535) throw new Error("HTTPS 联调端口无效");
  return value;
}

/** 探针只读取显式配置的两套 HTTPS 回环 Origin，不接受任意目标。 */
export function resolveReadonlyProbeOrigins(env) {
  if (env.SCADA_OIDC_DEV_HTTPS_ENABLED !== "true" || env.SCADA_OIDC_ENABLED !== "true") {
    throw new Error("只读 HTTPS 探针要求显式启用可信 OIDC 开发代理");
  }

  if (
    env.NODE_ENV === "production" ||
    env.SCADA_OIDC_ALLOW_INSECURE_LOOPBACK === "true" ||
    env.SCADA_LOCAL_DEMO_API_ENABLED === "true" ||
    env.SCADA_WEB_HOST !== LOOPBACK ||
    env.SCADA_SERVER_HOST !== LOOPBACK
  ) {
    throw new Error("只读 HTTPS 探针只允许安全的本机非生产环境");
  }

  const react = port(env.SCADA_REACT_DEV_PORT);
  const vue = port(env.SCADA_VUE_DEV_PORT);
  const server = port(env.SCADA_SERVER_PORT);
  if (new Set([react, vue, server]).size !== 3) {
    throw new Error("HTTPS 联调端口必须互不相同");
  }

  const origins = [`https://${LOOPBACK}:${react}`, `https://${LOOPBACK}:${vue}`];
  const configured = env.SCADA_OIDC_WEB_ORIGINS?.split(",") ?? [];
  if (
    configured.length !== 2 ||
    new Set(configured).size !== 2 ||
    origins.some((origin) => !configured.includes(origin))
  ) {
    throw new Error("只读探针要求精确配置两个本机 HTTPS Origin");
  }

  if (
    !origins.some(
      (origin) => env.SCADA_OIDC_REDIRECT_URI === `${origin}/api/v1/auth/oidc/callback`,
    )
  ) {
    throw new Error("OIDC 回调必须与已登记的 HTTPS Origin 一致");
  }

  return origins;
}

/** 使用 Node 原生 TLS 校验，仅 GET 未登录身份接口；从不发送身份 Cookie。 */
export function requestAnonymousMe(origin) {
  return new Promise((resolve, reject) => {
    const url = new URL(PATH, origin);
    const req = request(
      url,
      {
        method: "GET",
        timeout: TIMEOUT_MS,
        agent: false,
        rejectUnauthorized: true,
        headers: { Accept: "application/json", "Cache-Control": "no-store" },
      },
      (res) => {
        const chunks = [];
        let length = 0;

        res.on("data", (chunk) => {
          length += chunk.length;
          if (length > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("身份接口响应超出安全大小限制"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            type: res.headers["content-type"],
            body: Buffer.concat(chunks).toString("utf8"),
            location: res.headers.location,
          });
        });
        res.on("error", reject);
      },
    );

    req.on("timeout", () => req.destroy(new Error("本机 HTTPS 连接超时")));
    req.on("error", reject);
    req.end();
  });
}

/** 严格识别 NestJS 的未认证 JSON，不能把 Vite HTML 或 302 当作成功。 */
export function verifyAnonymousMeResponse(response) {
  if (response.status !== 401 || response.location !== undefined) {
    throw new Error("未认证身份接口必须返回 401，且不得发生重定向");
  }
  if (
    typeof response.type !== "string" ||
    !/^application\/json(?:\s*;|$)/i.test(response.type)
  ) {
    throw new Error("未认证身份接口没有返回 JSON，可能命中了页面回退");
  }

  let body;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new Error("未认证身份接口返回了无效 JSON");
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.statusCode !== 401 ||
    body.message !== "缺少有效的身份凭据"
  ) {
    throw new Error("未认证身份接口响应不符合 NestJS 安全契约");
  }
}

export async function verifyReadonlyHttps(env, transport = requestAnonymousMe) {
  const origins = resolveReadonlyProbeOrigins(env);
  for (const origin of origins) {
    const response = await transport(origin);
    verifyAnonymousMeResponse(response);
  }
  return origins.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  try {
    if (existsSync(ROOT_ENV)) loadEnvFile(ROOT_ENV);
    const count = await verifyReadonlyHttps(process.env);
    console.log(`OIDC HTTPS 匿名只读探针通过：${count} 个本机 Web Origin 均返回受控 401 JSON`);
  } catch {
    console.error("OIDC HTTPS 匿名只读探针失败：请检查本机证书信任、两端代理和服务端安全配置");
    process.exitCode = 1;
  }
}
