import { createHash, createPublicKey, X509Certificate } from "node:crypto";
import { request } from "node:https";
import { resolve } from "node:path";
import { checkServerIdentity } from "node:tls";
import { fileURLToPath } from "node:url";

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 32 * 1024;
const REALM = "/realms/adui-scada";

class OidcProbeError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** 统一中文异常文案和独立机器诊断码，避免把协议码当作提示语。 */
function oidcFailure(code) {
  return new OidcProbeError("Keycloak 只读探针未通过：" + code, code);
}

/** 仅接受固定回环 Issuer 的发布端口与一张公开的自签根证书。 */
export function parseOidcProbeInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    typeof input.port !== "string" ||
    !/^[1-9][0-9]{0,4}$/u.test(input.port) ||
    Number(input.port) > 65535 ||
    typeof input.ca !== "string" ||
    input.ca.length > MAX_INPUT_BYTES
  ) {
    throw oidcFailure("INPUT");
  }
  let root;
  try {
    root = new X509Certificate(input.ca);
    if (!root.ca || !root.checkIssued(root) || !root.verify(root.publicKey)) {
      throw oidcFailure("CA");
    }
  } catch {
    throw oidcFailure("CA");
  }
  const issuer = new URL("https://127.0.0.1:" + input.port).origin + REALM;
  return { port: input.port, ca: root.toString(), issuer };
}

/** 两个网络视角必须声明相同的公开 Issuer、固定端点及所需协议能力。 */
export function verifyOidcMetadata(metadata, issuer) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw oidcFailure("DISCOVERY_METADATA");
  }
  const base = issuer + "/protocol/openid-connect";
  if (
    metadata.issuer !== issuer ||
    metadata.authorization_endpoint !== base + "/auth" ||
    metadata.token_endpoint !== base + "/token" ||
    metadata.jwks_uri !== base + "/certs"
  ) {
    throw oidcFailure("DISCOVERY_METADATA");
  }
  for (const [field, required] of [
    ["response_types_supported", "code"],
    ["code_challenge_methods_supported", "S256"],
    ["id_token_signing_alg_values_supported", "RS256"],
    ["grant_types_supported", "authorization_code"],
    ["scopes_supported", "openid"],
    ["token_endpoint_auth_methods_supported", "client_secret_basic"],
  ]) {
    if (!Array.isArray(metadata[field]) || !metadata[field].includes(required)) {
      throw oidcFailure("DISCOVERY_METADATA");
    }
  }
  if (
    !Array.isArray(metadata.subject_types_supported) ||
    !metadata.subject_types_supported.some((value) => value === "public" || value === "pairwise")
  ) {
    throw oidcFailure("DISCOVERY_METADATA");
  }
}

/** 只比较有效 RS256 签名公钥集合，不输出 kid、公钥正文或任何令牌。 */
export function fingerprintOidcKeys(jwks) {
  if (!Array.isArray(jwks?.keys) || jwks.keys.length > 128) {
    throw oidcFailure("JWKS_KEYS");
  }
  const keys = [];
  const seen = new Set();
  for (const key of jwks.keys) {
    if (key?.use !== "sig" || key?.alg !== "RS256") continue;
    if (
      key.kty !== "RSA" ||
      typeof key.kid !== "string" ||
      !key.kid ||
      key.kid.length > 256 ||
      seen.has(key.kid) ||
      typeof key.n !== "string" ||
      typeof key.e !== "string" ||
      !/^[A-Za-z0-9_-]+$/u.test(key.n) ||
      !/^[A-Za-z0-9_-]+$/u.test(key.e) ||
      ["d", "p", "q", "dp", "dq", "qi", "oth"].some((field) => Object.hasOwn(key, field)) ||
      (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes("verify")))
    ) {
      throw oidcFailure("JWKS_KEYS");
    }
    try {
      const publicKey = createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" });
      const details = publicKey.asymmetricKeyDetails;
      if (
        publicKey.asymmetricKeyType !== "rsa" ||
        (details?.modulusLength ?? 0) < 2048 ||
        (details?.publicExponent ?? 0n) < 3n ||
        (details?.publicExponent ?? 0n) % 2n === 0n
      ) {
        throw oidcFailure("JWKS_KEYS");
      }
      seen.add(key.kid);
      keys.push({ kid: key.kid, spki: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
    } catch {
      throw oidcFailure("JWKS_KEYS");
    }
  }
  if (!keys.length) throw oidcFailure("JWKS_KEYS");
  keys.sort((left, right) => (left.kid < right.kid ? -1 : left.kid > right.kid ? 1 : 0));
  return {
    signingKeyCount: keys.length,
    signingKeyFingerprint: createHash("sha256").update(JSON.stringify(keys)).digest("hex"),
  };
}

/** 只从固定 TLS 连接读取有限 JSON，不发送身份凭据、不跟随重定向。 */
async function requestOidcJson(options) {
  /** @type {import("node:http").IncomingMessage} 当前 HTTPS 响应。 */
  const response = await new Promise((resolveResponse, reject) => {
    const req = request(options, resolveResponse);
    req.on("error", reject);
    req.end();
  });
  if (
    response.statusCode !== 200 ||
    response.headers.location !== undefined ||
    (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() !== "application/json"
  ) {
    response.destroy();
    throw oidcFailure("HTTP");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > MAX_RESPONSE_BYTES) {
      response.destroy();
      throw oidcFailure("SIZE");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw oidcFailure("JSON");
  }
}

/** 按固定阶段和白名单网络错误分类，绝不回显第三方异常或响应正文。 */
async function readStage(stage, options, transport) {
  try {
    return await transport(options);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    let category = "TRANSPORT";
    if (error instanceof OidcProbeError && ["HTTP", "SIZE", "JSON"].includes(error.code)) {
      category = error.code;
    } else if (code === "ABORT_ERR" || code === "ETIMEDOUT") {
      category = "TIMEOUT";
    } else if (
      [
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "UNABLE_TO_GET_ISSUER_CERT",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "ERR_TLS_CERT_ALTNAME_INVALID",
        "CERT_HAS_EXPIRED",
        "CERT_NOT_YET_VALID",
      ].includes(code)
    ) {
      category = "TLS";
    }
    throw oidcFailure(stage + "_" + category);
  }
}

/** 内部路由固定为 keycloak:8443；证书身份始终按公开 Issuer 的回环 IP 校验。 */
export async function probeOidcDiscovery(mode, input, transport = requestOidcJson) {
  if (mode !== "host" && mode !== "container") throw oidcFailure("INPUT");
  const { port, ca, issuer } = parseOidcProbeInput(input);
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw oidcFailure("INPUT");
  const options = (path) => ({
    hostname: mode === "host" ? "127.0.0.1" : "keycloak",
    port: mode === "host" ? Number(port) : 8443,
    path,
    method: "GET",
    headers: { Host: new URL(issuer).host, Accept: "application/json" },
    ca,
    rejectUnauthorized: true,
    checkServerIdentity: (_hostname, certificate) => checkServerIdentity("127.0.0.1", certificate),
    agent: false,
    signal: AbortSignal.timeout(8000),
  });
  const metadata = await readStage("DISCOVERY", options(REALM + "/.well-known/openid-configuration"), transport);
  verifyOidcMetadata(metadata, issuer);
  const jwks = await readStage("JWKS", options(REALM + "/protocol/openid-connect/certs"), transport);
  return { status: "DOCKER_OIDC_DISCOVERY_READY", issuer, ...fingerprintOidcKeys(jwks) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw oidcFailure("INPUT");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > MAX_INPUT_BYTES) throw oidcFailure("INPUT");
      chunks.push(chunk);
    }
    const result = await probeOidcDiscovery(process.argv[2], JSON.parse(Buffer.concat(chunks).toString("utf8")));
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    const code = error instanceof OidcProbeError ? error.code : "UNEXPECTED";
    process.stdout.write(JSON.stringify({ status: "DOCKER_OIDC_DISCOVERY_FAILED", code }) + "\n");
    process.exitCode = 1;
  }
}
