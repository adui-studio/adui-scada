import { strict as assert } from "node:assert";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { describe, it } from "node:test";
import { createDockerOidcFetch } from "../apps/server/src/auth/docker-oidc-transport.ts";

const ca = rootCertificates.find((pem) => {
  const cert = new X509Certificate(pem);
  return cert.ca && cert.checkIssued(cert) && cert.verify(cert.publicKey);
});
assert.ok(ca, "离线测试必须存在公开自签根证书");
const issuer = "https://127.0.0.1:18443/realms/adui-scada";
const discovery = issuer + "/.well-known/openid-configuration";
const base = issuer + "/protocol/openid-connect";
const failure = /Docker OIDC 固定 HTTPS 传输失败/;
const read = { method: "GET", redirect: "manual", headers: { accept: "application/json" } };
const post = {
  method: "POST",
  redirect: "manual",
  headers: {
    authorization: "Basic dGVzdDpmaXh0dXJl",
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
  },
  body: new URLSearchParams({ grant_type: "authorization_code", code: "fixture-code" }),
};

void describe("正式 Docker OIDC 固定传输", () => {
  void it("固定内部连接且公开 Host 和证书身份不变", async () => {
    let calls = 0;
    const transport = createDockerOidcFetch(new URL(issuer), ca, async (options, body) => {
      calls += 1;
      assert.equal(options.hostname, "keycloak");
      assert.equal(options.port, 8443);
      assert.equal(options.headers.host, "127.0.0.1:18443");
      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.agent, false);
      assert.equal(options.minVersion, "TLSv1.2");
      assert.equal(options.method, "GET");
      assert.equal(options.path, new URL(calls === 1 ? discovery : base + "/certs").pathname);
      assert.equal(body, undefined);
      assert.equal(
        options.checkServerIdentity("keycloak", { subjectaltname: "IP Address:127.0.0.1" }),
        undefined,
      );
      assert.equal(
        options.checkServerIdentity("keycloak", { subjectaltname: "DNS:keycloak" })?.code,
        "ERR_TLS_CERT_ALTNAME_INVALID",
      );
      assert.equal(options.ca, new X509Certificate(ca).toString());
      return new Response("{}", { status: 200 });
    });
    await transport(discovery, read);
    await transport(base + "/certs", read);
    assert.equal(calls, 2);
  });

  void it("只向固定 Token 端点发送 SDK 的授权码表单和 Basic 请求头", async () => {
    const transport = createDockerOidcFetch(new URL(issuer), ca, async (options, body) => {
      assert.equal(options.path, new URL(base + "/token").pathname);
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, post.headers.authorization);
      assert.equal(
        options.headers["content-length"],
        String(Buffer.byteLength(post.body.toString())),
      );
      assert.equal(body, post.body.toString());
      return new Response('{"error":"invalid_grant"}', { status: 400 });
    });
    const response = await transport(base + "/token", post);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_grant" });
  });

  void it("拒绝非固定 Issuer 与无效公开根证书", () => {
    for (const value of [
      issuer + "/",
      issuer + "?x=1",
      issuer + "#x",
      issuer.replace("127.0.0.1", "keycloak"),
      issuer.replace("https:", "http:"),
      "https://user:pass@127.0.0.1:18443/realms/adui-scada",
    ]) {
      assert.throws(() => createDockerOidcFetch(new URL(value), ca), failure);
    }
    assert.throws(() => createDockerOidcFetch(new URL(issuer), "invalid"), failure);
  });

  void it("拒绝非白名单 URL、方法、重定向及请求头且不发起连接", async () => {
    let calls = 0;
    const transport = createDockerOidcFetch(new URL(issuer), ca, async () => {
      calls += 1;
      return new Response("{}");
    });
    for (const url of [
      discovery + "?x=1",
      discovery + "#x",
      base + "/auth",
      "https://example.invalid/token",
      issuer.replace("127.0.0.1", "keycloak") + "/.well-known/openid-configuration",
    ]) {
      await assert.rejects(() => transport(url, read), failure);
    }
    for (const options of [
      { ...read, method: "POST" },
      { ...read, redirect: "follow" },
      { ...read, headers: { cookie: "fixture" } },
      { ...read, headers: { authorization: "Basic fixture" } },
      { ...read, headers: { host: "example.invalid" } },
      { ...read, body: "fixture" },
    ]) {
      await assert.rejects(() => transport(discovery, options), failure);
    }
    assert.equal(calls, 0);
  });

  void it("拒绝其他授权类型、重复授权类型及无 Basic 的 Token 请求", async () => {
    let calls = 0;
    const transport = createDockerOidcFetch(new URL(issuer), ca, async () => {
      calls += 1;
      return new Response("{}");
    });
    for (const options of [
      { ...post, body: new URLSearchParams({ grant_type: "client_credentials" }) },
      {
        ...post,
        body: new URLSearchParams("grant_type=authorization_code&grant_type=refresh_token"),
      },
      { ...post, body: "grant_type=authorization_code" },
      { ...post, headers: { "content-type": "application/x-www-form-urlencoded" } },
      {
        ...post,
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: "x".repeat(17 * 1024),
        }),
      },
    ]) {
      await assert.rejects(() => transport(base + "/token", options), failure);
    }
    assert.equal(calls, 0);
  });

  void it("预先取消不连接，传输异常及非成功只读响应统一脱敏", async () => {
    let calls = 0;
    const transport = createDockerOidcFetch(new URL(issuer), ca, async (options) => {
      calls += 1;
      assert.ok(options.signal instanceof AbortSignal);
      if (calls === 1) throw new Error("禁止回显的测试异常");
      return new Response("{}", { status: 400 });
    });
    await assert.rejects(
      () => transport(discovery, { ...read, signal: AbortSignal.abort() }),
      failure,
    );
    assert.equal(calls, 0);
    await assert.rejects(() => transport(discovery, read), {
      message: "Docker OIDC 固定 HTTPS 传输失败",
    });
    await assert.rejects(() => transport(discovery, read), failure);
    assert.equal(calls, 2);
  });
});
