import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseOidcProbeInput } from "../apps/server/container-oidc-discovery.mjs";
import { readLocalCa } from "./docker-web-https-smoke.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = "apps/server/container-oidc-discovery.mjs";
const TIMEOUT_MS = 25_000;
const FAILURE_MESSAGES = new Map([
  ["INPUT", "探针输入无效"],
  ["CA", "公开根证书无效"],
  ["DISCOVERY_METADATA", "Discovery 元数据不符合固定契约"],
  ["JWKS_KEYS", "JWKS 缺少有效 RS256 签名公钥或公钥集合异常"],
]);
for (const [phase, label] of [["DISCOVERY", "Discovery"], ["JWKS", "JWKS"]]) {
  for (const [category, message] of [
    ["TLS", "证书链或公开 Issuer IP 校验失败"],
    ["TIMEOUT", "请求超时"],
    ["TRANSPORT", "连接失败"],
    ["HTTP", "HTTP 状态、重定向或内容类型异常"],
    ["SIZE", "响应超过大小限制"],
    ["JSON", "响应不是有效 JSON"],
  ]) {
    FAILURE_MESSAGES.set(phase + "_" + category, label + " " + message);
  }
}

export class DockerOidcProbeError extends Error {}

function runHostProbe(input) {
  const result = spawnSync(process.execPath, [SCRIPT, "host"], {
    cwd: ROOT,
    shell: false,
    encoding: "utf8",
    windowsHide: true,
    timeout: TIMEOUT_MS,
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

/** 只接受固定机器报告或已知失败类别，禁止回显任意子进程输出。 */
function requireProbeReport(label, result, issuer) {
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new DockerOidcProbeError(label + " Keycloak 探针未返回有效报告，保留现场");
  }
  if (result.status !== 0) {
    const message = report?.status === "DOCKER_OIDC_DISCOVERY_FAILED" && FAILURE_MESSAGES.get(report.code);
    throw new DockerOidcProbeError(label + " Keycloak 验证失败：" + (message || "未取得有效诊断") + "，保留现场");
  }
  if (
    report?.status !== "DOCKER_OIDC_DISCOVERY_READY" ||
    Object.keys(report).length !== 4 ||
    report.issuer !== issuer ||
    !Number.isSafeInteger(report.signingKeyCount) ||
    report.signingKeyCount < 1 ||
    report.signingKeyCount > 128 ||
    typeof report.signingKeyFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(report.signingKeyFingerprint)
  ) {
    throw new DockerOidcProbeError(label + " Keycloak 探针报告不符合固定契约，保留现场");
  }
  return report;
}

/** 同一公开 Issuer 的两种固定传输视角必须得到一致的 RS256 签名公钥集合。 */
export function verifyDockerOidc(port, run, composeArgs, readCa = readLocalCa, runHost = runHostProbe) {
  let probe;
  try {
    probe = parseOidcProbeInput({ port, ca: readCa().toString("utf8") });
  } catch {
    throw new DockerOidcProbeError("无法读取有效 mkcert 本机公开根证书或端口配置");
  }
  // 仅传递规范化后的公开 CA 与端口，不读取 Docker 随机凭据或叶私钥。
  const input = JSON.stringify({ port: probe.port, ca: probe.ca });
  const host = requireProbeReport("宿主", runHost(input), probe.issuer);
  const container = requireProbeReport(
    "容器",
    run([...composeArgs, "exec", "-T", "server", "node", SCRIPT, "container"], false, input, TIMEOUT_MS),
    probe.issuer,
  );
  if (
    host.signingKeyCount !== container.signingKeyCount ||
    host.signingKeyFingerprint !== container.signingKeyFingerprint
  ) {
    throw new DockerOidcProbeError("宿主与容器 Keycloak RS256 签名公钥集合不一致，保留现场");
  }
  return "宿主与容器 Keycloak Discovery/JWKS 严格只读验证通过；OIDC 登录尚未启用";
}
