import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const routes = [
  { path: "/", status: 200, type: "text/html" },
  { path: "/api/health", status: 200, type: "application/json" },
  { path: "/demo/project", status: 200, type: "application/json" },
  { path: "/demo/events", status: 200, type: "text/event-stream" },
  { path: "/api/v1/projects", status: 404, type: "" },
  { path: "/api/v1/auth/oidc/callback", status: 404, type: "" },
];

/** 上游与 Nginx 可能同时发送 no-store，只允许重复的相同禁止缓存指令。 */
export function hasOnlyNoStore(value) {
  return value.split(",").every((directive) => directive.trim().toLowerCase() === "no-store");
}

/** 仅使用已验证的本机端口及可信根证书，验证 HTTPS 响应头后关闭连接。 */
export async function verifyDockerWebHttps(port, ca) {
  if (!/^[1-9][0-9]{0,4}$/u.test(port) || Number(port) > 65535 || !ca.length) {
    throw new Error("本机 HTTPS 探测配置无效");
  }
  for (const route of routes) {
    await new Promise((resolveProbe, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: Number(port),
          path: route.path,
          method: "GET",
          ca,
          rejectUnauthorized: true,
          agent: false,
          signal: AbortSignal.timeout(5000),
        },
        (response) => {
          const type = response.headers["content-type"] ?? "";
          const valid =
            response.statusCode === route.status &&
            (!route.type || type.split(";")[0]?.trim() === route.type) &&
            (route.path !== "/demo/events" ||
              hasOnlyNoStore(response.headers["cache-control"] ?? ""));
          // 包括 SSE 在内，探测只观察响应头，不等待流结束或输出业务正文。
          response.destroy();
          if (valid) resolveProbe(undefined);
          else reject(new Error("本机 HTTPS 代理响应异常"));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }
}

/** 从 mkcert 读取公开根证书，不读取根私钥，也不修改证书信任设置。 */
function readLocalCa() {
  const result = spawnSync(process.platform === "win32" ? "mkcert.exe" : "mkcert", ["-CAROOT"], {
    shell: false,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error("无法读取 mkcert 本机可信根证书");
  }
  return readFileSync(join(result.stdout.trim(), "rootCA.pem"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const ports = process.argv.slice(2);
    if (ports.length !== 2 || new Set(ports).size !== 2) {
      throw new Error("本机 HTTPS 探测端口无效");
    }
    const ca = readLocalCa();
    for (const port of ports) await verifyDockerWebHttps(port, ca);
    process.stdout.write("DOCKER_WEB_HTTPS_READY\n");
  } catch {
    console.error("双端 Docker HTTPS 验证失败，请检查本机端口和 mkcert 可信证书；内部诊断已脱敏");
    process.exitCode = 1;
  }
}
