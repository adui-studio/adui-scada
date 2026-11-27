import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  fingerprintOidcKeys,
  parseOidcProbeInput,
  probeOidcDiscovery,
  verifyOidcMetadata,
} from "../apps/server/container-oidc-discovery.mjs";
import { verifyDockerOidc } from "./docker-oidc-probe.mjs";

// 使用 Node 自带公开信任根作为离线输入夹具，不读取本机密钥或发出网络请求。
const ca = rootCertificates.find((pem) => {
  const cert = new X509Certificate(pem);
  return cert.ca && cert.checkIssued(cert) && cert.verify(cert.publicKey);
});
assert.ok(ca, "离线测试必须存在自签公开根证书");
const input = { port: "18443", ca };
const issuer = "https://127.0.0.1:18443/realms/adui-scada";
const base = issuer + "/protocol/openid-connect";
const metadata = {
  issuer,
  authorization_endpoint: base + "/auth",
  token_endpoint: base + "/token",
  jwks_uri: base + "/certs",
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  id_token_signing_alg_values_supported: ["RS256"],
  grant_types_supported: ["authorization_code"],
  scopes_supported: ["openid"],
  token_endpoint_auth_methods_supported: ["client_secret_basic"],
  subject_types_supported: ["public"],
};
const makeKey = (kid, modulusLength = 2048) => ({
  ...generateKeyPairSync("rsa", { modulusLength }).publicKey.export({ format: "jwk" }),
  kid,
  use: "sig",
  alg: "RS256",
});
const key = makeKey("first");
const second = makeKey("second");
const jwks = { keys: [key, second] };
const report = {
  status: "DOCKER_OIDC_DISCOVERY_READY",
  issuer,
  ...fingerprintOidcKeys(jwks),
};
const successful = { status: 0, stdout: JSON.stringify(report) };
const formalReport = { ...report, formalClientVerified: true };
const formalSuccessful = { status: 0, stdout: JSON.stringify(formalReport) };
const readCa = () => Buffer.from(ca);

void describe("Docker Keycloak 公开 Discovery 与 JWKS 只读门禁", () => {
  void it("仅允许回环发布端口及有效公开根证书", () => {
    assert.equal(parseOidcProbeInput(input).issuer, issuer);
    for (const port of ["0", "65536", "018443", "18443/path", 18443]) {
      assert.throws(() => parseOidcProbeInput({ port, ca }), /INPUT/);
    }
    assert.throws(() => parseOidcProbeInput({ ...input, issuer }), /INPUT/);
    assert.throws(() => parseOidcProbeInput({ ...input, ca: "invalid" }), /CA/);
  });

  void it("精确核验公开 Issuer、固定端点和协议能力", () => {
    verifyOidcMetadata(metadata, issuer);
    for (const change of [
      { issuer: "https://keycloak:8443/realms/adui-scada" },
      { authorization_endpoint: "https://example.invalid/auth" },
      { token_endpoint: base + "/token?extra=1" },
      { jwks_uri: base + "/certs#fragment" },
      { code_challenge_methods_supported: ["plain"] },
      { id_token_signing_alg_values_supported: ["HS256"] },
      { token_endpoint_auth_methods_supported: ["none"] },
      { subject_types_supported: [] },
    ]) {
      assert.throws(
        () => verifyOidcMetadata({ ...metadata, ...change }, issuer),
        /DISCOVERY_METADATA/,
      );
    }
  });

  void it("RS256 公钥指纹与排序无关但必须随公钥内容变化", () => {
    assert.deepEqual(
      fingerprintOidcKeys({ keys: [second, { ...key, use: "enc" }, key] }),
      fingerprintOidcKeys(jwks),
    );
    assert.notEqual(
      fingerprintOidcKeys({ keys: [{ ...second, kid: key.kid }] }).signingKeyFingerprint,
      fingerprintOidcKeys({ keys: [key] }).signingKeyFingerprint,
    );
  });

  void it("拒绝无签名键、重复 kid、私钥字段、弱 RSA 或无效公钥", () => {
    for (const keys of [
      [],
      [{ ...key, alg: "HS256" }],
      [key, key],
      [{ ...key, d: "secret" }],
      [makeKey("weak", 1024)],
      [{ ...key, n: "a" }],
      [{ ...key, key_ops: ["encrypt"] }],
    ]) {
      assert.throws(() => fingerprintOidcKeys({ keys }), /JWKS_KEYS/);
    }
  });

  void it("两个视角仅请求固定 GET 路径且保持公开 Host 和 TLS 身份", async () => {
    for (const [mode, hostname, port] of [
      ["host", "127.0.0.1", 18443],
      ["container", "keycloak", 8443],
    ]) {
      const paths = [];
      const result = await probeOidcDiscovery(mode, input, async (options) => {
        assert.equal(options.hostname, hostname);
        assert.equal(options.port, port);
        assert.equal(options.method, "GET");
        assert.deepEqual(options.headers, { Host: "127.0.0.1:18443", Accept: "application/json" });
        assert.equal(options.rejectUnauthorized, true);
        assert.equal(options.agent, false);
        assert.equal(
          options.checkServerIdentity(hostname, { subjectaltname: "IP Address:127.0.0.1" }),
          undefined,
        );
        assert.equal(
          options.checkServerIdentity(hostname, { subjectaltname: "DNS:keycloak" })?.code,
          "ERR_TLS_CERT_ALTNAME_INVALID",
        );
        paths.push(options.path);
        return paths.length === 1 ? metadata : jwks;
      });
      assert.deepEqual(paths, [
        "/realms/adui-scada/.well-known/openid-configuration",
        "/realms/adui-scada/protocol/openid-connect/certs",
      ]);
      assert.deepEqual(result, report);
    }
  });

  void it("发现元数据异常时禁止继续读取任何 JWKS 地址", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        probeOidcDiscovery("container", input, async () => {
          calls += 1;
          return { ...metadata, jwks_uri: "https://example.invalid/keys" };
        }),
      /DISCOVERY_METADATA/,
    );
    assert.equal(calls, 1);
  });

  void it("区分 Discovery 与 JWKS 连接失败并隐藏底层敏感错误", async () => {
    const failure = Object.assign(new Error("禁止输出的底层异常"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
    await assert.rejects(
      () =>
        probeOidcDiscovery("host", input, async () => {
          throw failure;
        }),
      { message: "Keycloak 只读探针未通过：DISCOVERY_TLS" },
    );
    await assert.rejects(
      () =>
        probeOidcDiscovery("container", input, async (options) => {
          if (options.path.endsWith("/certs")) throw failure;
          return metadata;
        }),
      { message: "Keycloak 只读探针未通过：JWKS_TLS" },
    );
  });

  void it("宿主和容器只经标准输入接收相同公开 CA 与端口", () => {
    let hostInput;
    const result = verifyDockerOidc(
      "18443",
      (args, showOutput, value, timeout) => {
        assert.deepEqual(args, [
          "compose",
          "exec",
          "-T",
          "server",
          "node",
          "apps/server/container-oidc-discovery.mjs",
          "container",
        ]);
        assert.equal(showOutput, false);
        assert.equal(timeout, 25_000);
        assert.equal(value, hostInput);
        return formalSuccessful;
      },
      ["compose"],
      readCa,
      (value) => {
        hostInput = value;
        assert.deepEqual(JSON.parse(value), {
          port: input.port,
          ca: parseOidcProbeInput(input).ca,
        });
        return successful;
      },
    );
    assert.match(result, /严格只读验证通过/);
  });

  void it("独立进程非法输入必须以非零退出码和固定机器诊断拒绝", () => {
    const script = fileURLToPath(
      new URL("../apps/server/container-oidc-discovery.mjs", import.meta.url),
    );
    const result = spawnSync(process.execPath, [script, "host"], {
      input: JSON.stringify({ port: "0", ca: "禁止输出的测试数据" }),
      encoding: "utf8",
      shell: false,
      timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: "DOCKER_OIDC_DISCOVERY_FAILED",
      code: "INPUT",
    });
    assert.equal(result.stderr, "");
  });

  void it("报告不完整、公钥不一致或探针失败时拒绝成功且不泄露错误原文", () => {
    let containerCalls = 0;
    const run = () => {
      containerCalls += 1;
      return formalSuccessful;
    };
    for (const failure of [
      { status: 0, stdout: "{}" },
      {
        status: 1,
        stdout: JSON.stringify({ status: "DOCKER_OIDC_DISCOVERY_FAILED", code: "secret-raw" }),
      },
    ]) {
      assert.throws(
        () => verifyDockerOidc("18443", run, [], readCa, () => failure),
        /宿主 Keycloak/,
      );
    }
    assert.equal(containerCalls, 0);
    // 旧镜像只返回原始探针结果时必须拒绝，不得冒充正式客户端已执行。
    assert.throws(
      () => verifyDockerOidc("18443", () => successful, [], readCa, () => successful),
      /容器 Keycloak 探针报告不符合固定契约/,
    );
    assert.throws(
      () =>
        verifyDockerOidc(
          "18443",
          () => ({
            status: 0,
            stdout: JSON.stringify({ ...formalReport, signingKeyFingerprint: "f".repeat(64) }),
          }),
          [],
          readCa,
          () => successful,
        ),
      /公钥集合不一致/,
    );
    assert.throws(
      () =>
        verifyDockerOidc(
          "18443",
          () => ({
            status: 1,
            stdout: JSON.stringify({ status: "DOCKER_OIDC_DISCOVERY_FAILED", code: "JWKS_TLS" }),
          }),
          [],
          readCa,
          () => successful,
        ),
      /容器 Keycloak 验证失败：JWKS 证书链或公开 Issuer IP 校验失败/,
    );
    assert.throws(
      () =>
        verifyDockerOidc(
          "18443",
          () => ({
            status: 1,
            stdout: JSON.stringify({ status: "DOCKER_OIDC_DISCOVERY_FAILED", code: "secret-raw" }),
          }),
          [],
          readCa,
          () => successful,
        ),
      { message: "容器 Keycloak 验证失败：未取得有效诊断，保留现场" },
    );
  });
});
