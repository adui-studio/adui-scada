import { randomBytes, X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SECRETS = [
  "SCADA_LAB_DB_PASSWORD",
  "SCADA_LAB_KEYCLOAK_ADMIN_PASSWORD",
  "SCADA_LAB_CLIENT_SECRET",
  "SCADA_LAB_TRANSACTION_ENCRYPTION_KEY",
];
const LOCAL_ONLY = /^SCADA_LAB_(?:KEYCLOAK|POSTGRES|REDIS)_PORT$/;

function parseSimpleEnv(content) {
  const result = Object.create(null);
  for (const line of content.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const match = text.match(/^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/);
    if (!match || Object.hasOwn(result, match[1])) {
      throw new Error("本机 Docker 环境文件格式无效或存在重复配置");
    }
    result[match[1]] = match[2];
  }
  return result;
}

function assertValidLabEnvironment(env) {
  for (const key of [
    "SCADA_LAB_KEYCLOAK_PORT",
    "SCADA_LAB_POSTGRES_PORT",
    "SCADA_LAB_REDIS_PORT",
  ]) {
    if (!LOCAL_ONLY.test(key) || !/^[1-9][0-9]{0,4}$/.test(env[key] ?? "")) {
      throw new Error("Docker 本机端口配置无效");
    }
    const port = Number(env[key]);
    if (port > 65535) throw new Error("Docker 本机端口配置无效");
  }
  const ports = [
    env.SCADA_LAB_KEYCLOAK_PORT,
    env.SCADA_LAB_POSTGRES_PORT,
    env.SCADA_LAB_REDIS_PORT,
  ];
  if (new Set(ports).size !== ports.length) {
    throw new Error("OIDC Lab 三个本机端口不得重复");
  }
  if (env.SCADA_WEB_HOST !== "127.0.0.1" || env.SCADA_SERVER_HOST !== "127.0.0.1") {
    throw new Error("OIDC Lab 仅允许与本机回环 Web 和 NestJS 配合使用");
  }
  if (
    env.SCADA_OIDC_ALLOW_INSECURE_LOOPBACK === "true" ||
    env.NODE_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  ) {
    throw new Error("Docker 禁止生产和不安全的 OIDC 测试模式");
  }
}

function ensureLocalTls(certFile, keyFile, runMkcert = spawnSync) {
  const hasCert = existsSync(certFile);
  const hasKey = existsSync(keyFile);
  if (hasCert !== hasKey) throw new Error("本机证书文件不完整，请人工检查，不会自动覆盖已有私钥");
  if (!hasCert) {
    const program = process.platform === "win32" ? "mkcert.exe" : "mkcert";
    const result = runMkcert(
      program,
      ["-cert-file", certFile, "-key-file", keyFile, "127.0.0.1", "localhost", "::1"],
      { shell: false, encoding: "utf8", timeout: 60_000, windowsHide: true },
    );
    if (result.error || result.status !== 0) {
      throw new Error("无法创建本机 TLS 证书，请先安装 mkcert 并执行 mkcert -install");
    }
  }
  try {
    const cert = readFileSync(certFile);
    const key = readFileSync(keyFile);
    const parsed = new X509Certificate(cert);
    if (!parsed.subjectAltName?.includes("IP Address:127.0.0.1")) {
      throw new Error("本机证书缺少 127.0.0.1 IP SAN");
    }
    createSecureContext({ cert, key });
  } catch {
    throw new Error("本机 TLS 证书与私钥无效，请人工检查，原文件未被覆盖");
  }
}

/** 首次生成本机随机凭据；旧 OIDC 凭据文件保持原状，绝不覆盖。 */
export function makeLabSecrets() {
  return Object.fromEntries(SECRETS.map((name) => [name, randomBytes(32).toString("base64url")]));
}

/** 严格检查现有秘密文件；损坏时拒绝重置，避免误断开已有数据卷。 */
export function validateLabSecrets(raw) {
  const values = parseSimpleEnv(raw);
  if (
    Object.keys(values).length !== SECRETS.length ||
    SECRETS.some((name) => !/^[A-Za-z0-9_-]{43}$/.test(values[name] ?? ""))
  ) {
    throw new Error("本机 Docker 凭据文件不完整，拒绝自动重置");
  }
  return values;
}

export function prepareOidcLab(root = DEFAULT_ROOT, dependencies = {}) {
  const input = join(root, ".env");
  if (!existsSync(input)) throw new Error("请先将根目录 .env.example 复制为 .env");
  const env = parseSimpleEnv(readFileSync(input, "utf8"));
  assertValidLabEnvironment(env);
  const dir = resolve(root, ".local", "docker");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const certFile = join(dir, "localhost.pem");
  const keyFile = join(dir, "localhost-key.pem");
  (dependencies.ensureTls ?? ensureLocalTls)(certFile, keyFile);
  const secretFile = join(dir, "secrets.env");
  if (!existsSync(secretFile)) {
    const secrets = (dependencies.generateSecrets ?? makeLabSecrets)();
    const value = SECRETS.map((key) => `${key}=${secrets[key]}`).join("\n") + "\n";
    validateLabSecrets(value);
    try {
      writeFileSync(secretFile, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      if (!existsSync(secretFile)) throw error;
    }
  }
  const secrets = validateLabSecrets(readFileSync(secretFile, "utf8"));
  const composeEnv = join(dir, "compose.env");
  const certDir = dir.replaceAll("\\", "/");
  const value =
    [...SECRETS.map((key) => `${key}=${secrets[key]}`), `SCADA_LAB_CERT_DIR=${certDir}`].join(
      "\n",
    ) + "\n";
  writeFileSync(composeEnv, value, { encoding: "utf8", mode: 0o600 });
  return { composeEnv };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    prepareOidcLab();
    console.log("Docker 本机证书与独立随机凭据准备完成；不会改写仓库根目录 .env");
  } catch (error) {
    const message =
      (error instanceof Error && error.message.startsWith("本机 ")) ||
      (error instanceof Error && error.message.startsWith("Docker ")) ||
      (error instanceof Error && error.message.startsWith("请先将")) ||
      (error instanceof Error && error.message.startsWith("无法创建"))
        ? error.message
        : "本机 Docker 准备失败，请检查环境文件与文件权限";
    console.error(message);
    process.exitCode = 1;
  }
}
