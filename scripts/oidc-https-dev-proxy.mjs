import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createSecureContext } from "node:tls";

const CALLBACK_PATH = "/api/v1/auth/oidc/callback";
const LOOPBACK_HOST = "127.0.0.1";

/** 只接受本机回环端口，不从客户端地址动态推导任何代理目标。 */
function requirePort(raw, name) {
  const value = Number(raw);
  if (
    typeof raw !== "string" ||
    !/^[1-9][0-9]{0,4}$/.test(raw) ||
    !Number.isSafeInteger(value) ||
    value > 65535
  ) {
    throw new Error(name + " 必须是 1～65535 之间的整数");
  }
  return value;
}

function requireHttpsOrigin(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.hostname === LOOPBACK_HOST &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      parsed.href === parsed.origin + "/"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

/**
 * 仅供本机 Vite serve 使用的临时 HTTPS /api/v1 代理。
 * 不创建 TLS 文件、IdP 身份、数据库连接或工业设备连接。
 * 第三方异常与证书路径均不写入日志。
 */
export function resolveLoopbackOidcHttpsProxy(env, webPort, deps = {}) {
  const flag = env.SCADA_OIDC_DEV_HTTPS_ENABLED ?? "false";
  if (flag === "false") return null;
  if (flag !== "true") {
    throw new Error("SCADA_OIDC_DEV_HTTPS_ENABLED 只能设置为 true 或 false");
  }
  if (env.NODE_ENV === "production") {
    throw new Error("生产环境禁止启用本机 OIDC HTTPS 开发代理");
  }
  if (
    env.SCADA_OIDC_ENABLED !== "true" ||
    env.SCADA_OIDC_ALLOW_INSECURE_LOOPBACK === "true" ||
    env.SCADA_LOCAL_DEMO_API_ENABLED === "true"
  ) {
    throw new Error("HTTPS 联调必须启用可信 OIDC，并关闭 HTTP 测试模式与模拟身份冲突");
  }
  if (env.SCADA_WEB_HOST !== LOOPBACK_HOST || env.SCADA_SERVER_HOST !== LOOPBACK_HOST) {
    throw new Error("OIDC HTTPS 开发代理只允许 Web 与 NestJS 绑定 127.0.0.1");
  }

  const serverPort = requirePort(env.SCADA_SERVER_PORT, "SCADA_SERVER_PORT");
  const reactPort = requirePort(env.SCADA_REACT_DEV_PORT, "SCADA_REACT_DEV_PORT");
  const vuePort = requirePort(env.SCADA_VUE_DEV_PORT, "SCADA_VUE_DEV_PORT");
  if (
    ![reactPort, vuePort].includes(webPort) ||
    reactPort === vuePort ||
    [reactPort, vuePort].includes(serverPort)
  ) {
    throw new Error("Web 与 NestJS 端口必须各自独立并使用受控配置");
  }

  const expectedOrigins = [
    "https://" + LOOPBACK_HOST + ":" + reactPort,
    "https://" + LOOPBACK_HOST + ":" + vuePort,
  ];
  const configuredOrigins = env.SCADA_OIDC_WEB_ORIGINS?.split(",") ?? [];
  if (
    configuredOrigins.length !== expectedOrigins.length ||
    configuredOrigins.some((origin) => !requireHttpsOrigin(origin)) ||
    new Set(configuredOrigins).size !== expectedOrigins.length ||
    expectedOrigins.some((origin) => !configuredOrigins.includes(origin))
  ) {
    throw new Error("OIDC Web Origin 必须精确配置 React 和 Vue 的本机 HTTPS 地址");
  }

  const redirectUri = env.SCADA_OIDC_REDIRECT_URI;
  if (
    typeof redirectUri !== "string" ||
    !expectedOrigins.some((origin) => redirectUri === origin + CALLBACK_PATH)
  ) {
    throw new Error("OIDC 回调必须使用其中一个已登记的本机 HTTPS 地址和固定路径");
  }

  const certificateFile = env.SCADA_OIDC_DEV_HTTPS_CERT_FILE;
  const keyFile = env.SCADA_OIDC_DEV_HTTPS_KEY_FILE;
  if (
    typeof certificateFile !== "string" ||
    typeof keyFile !== "string" ||
    !isAbsolute(certificateFile) ||
    !isAbsolute(keyFile) ||
    certificateFile === keyFile
  ) {
    throw new Error("HTTPS 证书与私钥必须分别使用本机绝对路径");
  }

  let cert;
  let key;
  try {
    const readFile = deps.readFile ?? readFileSync;
    cert = readFile(certificateFile);
    key = readFile(keyFile);
    if (!Buffer.isBuffer(cert) || !Buffer.isBuffer(key) || cert.length === 0 || key.length === 0) {
      throw new TypeError("空证书");
    }
    const verifyTls = deps.verifyTls ?? ((certificate, privateKey) => {
      createSecureContext({ cert: certificate, key: privateKey });
    });
    verifyTls(cert, key);
  } catch {
    throw new Error("本机 HTTPS 证书或私钥无法读取或校验");
  }

  return {
    https: { cert, key },
    apiProxy: {
      target: "http://" + LOOPBACK_HOST + ":" + serverPort,
      changeOrigin: false,
      xfwd: false,
      ws: false,
    },
  };
}
