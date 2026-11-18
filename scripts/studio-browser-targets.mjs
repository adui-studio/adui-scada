import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

/** 浏览器测试仅允许本机双框架地址，HTTPS 模式绝不降级为 HTTP。 */
export function resolveStudioBrowserTargets(env) {
  const flag = env.SCADA_OIDC_DEV_HTTPS_ENABLED ?? "false";
  if (flag !== "true" && flag !== "false") {
    throw new Error("浏览器测试的 HTTPS 开关只能为 true 或 false");
  }
  const host = env.SCADA_WEB_HOST || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("浏览器测试只允许本机回环地址");
  }
  const protocol = flag === "true" ? "https:" : "http:";
  return [
    { name: "React", override: env.SCADA_REACT_URL, port: env.SCADA_REACT_DEV_PORT || "15173" },
    { name: "Vue", override: env.SCADA_VUE_URL, port: env.SCADA_VUE_DEV_PORT || "15174" },
  ].map(({ name, override, port }) => {
    if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) {
      throw new Error(name + " 开发端口不合法");
    }
    let parsed;
    try {
      parsed = new URL(override ?? `${protocol}//${host}:${port}/`);
    } catch {
      throw new Error(name + " 浏览器测试地址不合法");
    }
    if (
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      (flag === "true" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !parsed.port
    ) {
      throw new Error(name + " 浏览器测试只能访问本机匹配协议的 Web 首页");
    }
    return { name, url: parsed.href };
  });
}

/**
 * 只读探测当前两套 Web 首页。HTTPS 必须验证证书；
 * .env 在进程启动后载入时，额外根证书通过请求选项显式生效。
 */
export async function verifyStudioBrowserTarget(target, env = process.env) {
  const url = new URL(target.url);
  try {
    if (url.protocol === "https:") {
      const ca = env.NODE_EXTRA_CA_CERTS ? readFileSync(env.NODE_EXTRA_CA_CERTS) : undefined;
      await new Promise((resolve, reject) => {
        const request = httpsRequest(
          url,
          {
            method: "GET",
            timeout: 3000,
            rejectUnauthorized: true,
            ...(ca ? { ca } : {}),
          },
          (response) => {
            response.resume();
            if (response.statusCode === 200) resolve();
            else reject(new Error("首页响应状态异常"));
          },
        );
        request.on("timeout", () => request.destroy(new Error("连接超时")));
        request.on("error", reject);
        request.end();
      });
    } else {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      });
      if (response.status !== 200) throw new Error("首页响应状态异常");
    }
  } catch (error) {
    const code = error && typeof error === "object" ? (error.cause?.code ?? error.code) : undefined;
    if (code === "ENOENT" || code === "EACCES") {
      throw new Error(target.name + " 本机 HTTPS 根证书文件不可读取");
    }
    if (
      [
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "ERR_TLS_CERT_ALTNAME_INVALID",
        "CERT_HAS_EXPIRED",
      ].includes(code)
    ) {
      throw new Error(
        target.name + " 本机 HTTPS 证书校验失败，请配置可信的 NODE_EXTRA_CA_CERTS 或系统 CA",
      );
    }
    throw new Error(target.name + " 开发服务不可访问：" + url.origin + "，请核对协议、端口及证书");
  }
}
