import { readFileSync } from "node:fs";
import { verifyPrisma8Provider } from "./prisma8-provider-smoke.mjs";

/** 固定容器网络上的 HTTP 回归，不执行登录或写请求。 */
async function verifyWeb(host) {
  const base = "http://" + host + ":8080";
  // Compose 对 Web 容器只核验运行状态，短暂等待 Nginx 实际监听。
  let health;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      health = await fetch(base + "/api/health", {
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (
    !health ||
    health.status !== 200 ||
    !(health.headers.get("content-type") ?? "").includes("application/json")
  ) {
    throw new Error("双端 HTTP 健康代理未就绪");
  }
  const state = await health.json();
  if (state.status !== "ok" || state.service !== "adui-scada-server") {
    throw new Error("双端 HTTP 健康代理返回异常");
  }
  const index = await fetch(base + "/", { redirect: "error", signal: AbortSignal.timeout(3000) });
  if (index.status !== 200 || !(index.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error("双端 Web 入口未就绪");
  }
  await index.body?.cancel();
  const demo = await fetch(base + "/demo/project", {
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  if (
    demo.status !== 200 ||
    !(demo.headers.get("content-type") ?? "").includes("application/json")
  ) {
    throw new Error("双端模拟工程代理未就绪");
  }
  const document = await demo.json();
  if (typeof document.projectId !== "string" || !Array.isArray(document.pages)) {
    throw new Error("双端模拟工程返回异常");
  }
  const events = await fetch(base + "/demo/events", {
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  if (
    events.status !== 200 ||
    !(events.headers.get("content-type") ?? "").includes("text/event-stream")
  ) {
    throw new Error("双端模拟实时事件代理未就绪");
  }
  await events.body?.cancel();
  for (const route of ["/api/v1/projects", "/api/v1/auth/me", "/api/health/database"]) {
    const denied = await fetch(base + route, {
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (denied.status !== 404) {
      await denied.body?.cancel();
      throw new Error("HTTP 演示意外开放受保护接口或内部数据库探针");
    }
    await denied.body?.cancel();
  }
}

/** 通过常驻 HTTP 进程自己的 Prisma8Service 复核真实数据库边界，不替换注入配置。 */
async function verifyRunningDatabase() {
  const port = process.env.SCADA_SERVER_PORT;
  if (typeof port !== "string" || !/^[1-9][0-9]{0,4}$/u.test(port) || Number(port) > 65535) {
    throw new Error("常驻服务端口配置无效");
  }
  const base = "http://127.0.0.1:" + port;
  const get = (path) =>
    fetch(base + path, {
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  const response = await get("/health/database");
  if (
    response.status !== 200 ||
    !(response.headers.get("content-type") ?? "").includes("application/json")
  ) {
    await response.body?.cancel();
    throw new Error("常驻服务原生只读连接未就绪");
  }
  const state = await response.json();
  if (
    state?.status !== "ok" ||
    state.mode !== "docker-readonly" ||
    Object.keys(state).length !== 2 ||
    response.headers.get("cache-control") !== "no-store"
  ) {
    throw new Error("常驻服务原生只读连接报告异常");
  }
  for (const route of ["/api/v1/auth/oidc/start", "/api/v1/auth/me", "/api/v1/projects"]) {
    const denied = await get(route);
    if (denied.status !== 404) {
      await denied.body?.cancel();
      throw new Error("常驻只读服务意外开放认证或工程接口");
    }
    await denied.body?.cancel();
  }
}

/** 仅从父进程标准输入接收一次性探针参数，不读取服务进程凭据或开放 HTTP 写入。 */
try {
  const input = readFileSync(0, "utf8");
  if (input.length > 1024) throw new Error("容器原生烟测输入过长");
  const { password, systemIdentifier, storageHash } = JSON.parse(input);
  if (
    typeof password !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(password) ||
    typeof systemIdentifier !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(systemIdentifier) ||
    typeof storageHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(storageHash)
  ) {
    throw new Error("容器原生烟测输入无效");
  }
  const url = new URL("postgresql://adui_scada@postgres:5432/adui_scada?schema=public");
  url.password = password;
  const result = await verifyPrisma8Provider(
    url.toString(),
    systemIdentifier,
    storageHash,
    "docker-readonly",
  );
  await verifyRunningDatabase();
  await verifyWeb("web-react");
  await verifyWeb("web-vue");
  process.stdout.write(
    JSON.stringify({
      status: "DOCKER_NATIVE_PROVIDER_READY",
      ...result,
      runningDatabaseReadOnlyVerified: true,
      reactHttpVerified: true,
      vueHttpVerified: true,
    }) + "\n",
  );
} catch {
  console.error("容器原生数据库只读烟测失败，内部诊断已脱敏");
  process.exitCode = 1;
}
