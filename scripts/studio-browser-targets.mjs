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
