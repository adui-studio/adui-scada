import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { reviewNativeSchemaFailure } from "./prisma8-native-schema-failure-review.mjs";

export const reproContainer = "adui-scada-prisma8-repro";
export const reproVolume = reproContainer + "-data";
export const reproNetwork = reproContainer + "-net";
export const reproDatabase = "adui_scada_fresh_prisma8_repro";
export const reproRole = "adui_scada_native_repro";
export const reproImage =
  "sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0";
export const reproFingerprint =
  "02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e";
export const reproConfirmation = "--confirm-adui-scada-fresh-prisma8-repro-once";
export const reproPasswordVariable = "SCADA_PRISMA8_NATIVE_REPRO_PASSWORD";
export const reproUrlVariable = "SCADA_PRISMA8_NATIVE_REPRO_DATABASE_URL";
const receiptName = "attempt.json";

export class ReproError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new ReproError(message);
}

/** 不接受通用数据库连接串、额外参数或 Docker 远程环境覆盖。 */
export function requireReproRequest(args, source) {
  requireMatch(
    isDeepStrictEqual(args, [reproConfirmation]),
    "必须明确确认第四座独立实例单次迁移，且不得附加参数",
  );
  requireMatch(
    !Object.entries(source).some(
      ([key, value]) =>
        ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"].includes(key.toUpperCase()) && value,
    ),
    "存在 Docker 环境覆盖，禁止独立迁移",
  );
  return reproConnection(source[reproPasswordVariable]);
}

/** 只消费创建实例时生成的独立随机口令，连接目标不可由调用者改变。 */
export function reproConnection(password) {
  requireMatch(
    typeof password === "string" && password.length === 64 && /^[a-f0-9]{64}$/u.test(password),
    "第四座实例专用随机凭据无效",
  );
  return {
    url: "postgresql://" + reproRole + ":" + password + "@127.0.0.1:15433/" + reproDatabase,
    options: {
      host: "127.0.0.1",
      port: 15433,
      database: reproDatabase,
      user: reproRole,
      password,
      ssl: false,
      replication: "false",
      client_encoding: "UTF8",
      application_name: "adui_scada_native_repro_preflight",
      connectionTimeoutMillis: 5000,
      query_timeout: 8000,
      options:
        "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=10000 -c search_path=public -c timezone=UTC -c standard_conforming_strings=on",
    },
  };
}

/** 仅允许本机 Docker Desktop Linux 引擎。 */
export function requireLocalDocker(endpoint, os) {
  requireMatch(
    ["npipe:////./pipe/dockerDesktopLinuxEngine", "npipe:////./pipe/docker_engine"].includes(
      endpoint,
    ) && os === "linux",
    "当前 Docker 不是预期的本机 Windows Linux 容器环境",
  );
}

/** 核对创建日志中固定的镜像、隔离卷、网络和唯一回环端口。 */
export function requireReproContainer(facts) {
  const [id, name, image, running, labels, mounts, ports, networks] = facts;
  requireMatch(
    facts.length === 8 &&
      typeof id === "string" &&
      /^[a-f0-9]{64}$/u.test(id) &&
      name === "/" + reproContainer &&
      image === reproImage &&
      running === true &&
      labels?.["org.adui.scope"] === "prisma8-native-repro" &&
      !labels?.["com.docker.compose.project"] &&
      Array.isArray(mounts) &&
      mounts.length === 1 &&
      mounts[0]?.Type === "volume" &&
      mounts[0].Name === reproVolume &&
      mounts[0].Destination === "/var/lib/postgresql/data" &&
      mounts[0].RW === true &&
      isDeepStrictEqual(ports, { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "15433" }] }) &&
      networks &&
      isDeepStrictEqual(Object.keys(networks), [reproNetwork]),
    "第四座容器镜像、标签、数据卷、网络或端口不符合固定边界",
  );
  return id;
}

export function requireReproIdentity(text) {
  const parts = text.trim().split("|");
  requireMatch(
    parts.length === 4 &&
      parts[0] === reproDatabase &&
      parts[1] === reproRole &&
      parts[2] === "170011" &&
      /^[1-9][0-9]{0,19}$/u.test(parts[3]),
    "第四座容器内数据库身份、版本或集群标识不一致",
  );
  return parts[3];
}

function requireDirectory(path) {
  requireMatch(
    lstatSync(path, { throwIfNoEntry: false })?.isDirectory() && realpathSync(path) === path,
    "第四座实验记录目录不存在或包含链接",
  );
}

/** 即使失败也保留独占尝试记录，不读取旧记录取得新的授权。 */
export function requireUnusedReproDirectory(directory) {
  requireDirectory(directory);
  requireMatch(
    !lstatSync(join(directory, receiptName), { throwIfNoEntry: false }) &&
      !lstatSync(join(directory, "machine-output.encrypted.json"), { throwIfNoEntry: false }) &&
      !lstatSync(join(directory, "report.json"), { throwIfNoEntry: false }),
    "第四座实验记录已存在，禁止再次执行",
  );
}

export function claimReproAttempt(directory, fingerprint, containerId, systemIdentifier) {
  requireMatch(
    fingerprint === reproFingerprint &&
      /^[a-f0-9]{64}$/u.test(containerId) &&
      /^[1-9][0-9]{0,19}$/u.test(systemIdentifier),
    "第四座尝试记录的固定证据或身份无效",
  );
  requireUnusedReproDirectory(directory);
  writeFileSync(
    join(directory, receiptName),
    JSON.stringify({
      scope: "PRISMA8_NATIVE_ISOLATED_REPRO_V1",
      fingerprint,
      containerId,
      systemIdentifier,
    }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}

/** 分别解析两路机器输出，合并完整 JSON 文档以拒绝跨输出的重复诊断。 */
export function extractReproSchemaFailure(stdout, stderr, allowedNames) {
  const streams = [stdout, stderr];
  if (streams.some((value) => typeof value !== "string")) return null;
  if (streams.reduce((size, value) => size + Buffer.byteLength(value, "utf8"), 0) > 16 * 1024 * 1024) {
    return null;
  }
  const documents = streams.flatMap((stream) => {
    try {
      return [JSON.parse(stream)];
    } catch {
      return stream.split(/\r?\n/u).flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    }
  });
  try {
    return reviewNativeSchemaFailure(
      documents.map((document) => JSON.stringify(document)).join("\n"),
      allowedNames,
    );
  } catch {
    return null;
  }
}

/** 原始捕获文本仅加密留在本机，密钥由独立随机凭据派生，不写入报告。 */
export function encryptReproOutput(password, stdout, stderr) {
  reproConnection(password);
  requireMatch(
    typeof stdout === "string" &&
      typeof stderr === "string" &&
      Buffer.byteLength(stdout, "utf8") <= 16 * 1024 * 1024 &&
      Buffer.byteLength(stderr, "utf8") <= 16 * 1024 * 1024,
    "原始机器输出超出捕获限制",
  );
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = Buffer.from(
    hkdfSync("sha256", Buffer.from(password, "hex"), salt, "ADui SCADA Prisma8 repro output v1", 32),
  );
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ stdout, stderr }), "utf8"),
    cipher.final(),
  ]);
  return {
    scope: "PRISMA8_NATIVE_REPRO_ENCRYPTED_OUTPUT_V1",
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function saveReproEvidence(directory, name, value) {
  requireDirectory(directory);
  requireMatch(
    name === "machine-output.encrypted.json" || name === "report.json",
    "第四座实验输出文件名称无效",
  );
  writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
