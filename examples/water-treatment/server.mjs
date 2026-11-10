import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { TagStore, WaterTreatmentSimulator, renderSvgPage } from "../../packages/core/src/index.ts";
import { demoDocument } from "./project.mjs";

// 统一使用仓库根目录 .env；Docker 通过明确的进程环境变量传值。
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

// 此服务仅用于诊断，默认监听本机回环地址；只有未向宿主机暴露端口的
// Docker 演示隔离网络才能使用 0.0.0.0。
const host = process.env.SCADA_DEMO_HOST ?? process.env.DEMO_HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "0.0.0.0") {
  throw new Error("SCADA_DEMO_HOST 只能设置为 127.0.0.1 或 0.0.0.0");
}
const port = Number(process.env.SCADA_DEMO_PORT ?? process.env.DEMO_PORT ?? "4178");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("SCADA_DEMO_PORT 必须是 1～65535 之间的整数");
}
const index = readFileSync(new URL("./public/index.html", import.meta.url));
const script = readFileSync(new URL("./public/client.js", import.meta.url));
const style = readFileSync(new URL("./public/style.css", import.meta.url));
const tags = new TagStore();
const simulator = new WaterTreatmentSimulator();
const clients = new Set();

function headers(type) {
  return {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
  };
}

function sendEvent(response, change) {
  if (!response.destroyed) response.write(`data: ${JSON.stringify(change)}\n\n`);
}

tags.subscribe((change) => {
  for (const client of clients) sendEvent(client, change);
});

tags.apply(simulator.next());
let tick = 0;
const interval = setInterval(() => {
  tick++;
  // 每 30 秒故意模拟 8 秒数据中断，以验证 STALE 质量状态的显示。
  if (tick % 30 >= 22) {
    tags.markStale(Date.now(), 2500);
    return;
  }
  const sequences = new Map(tags.snapshot().map((tag) => [tag.tagId, tag.sequence]));
  simulator.resumeAfter(sequences);
  tags.apply(simulator.next());
}, 1000);

const server = createServer((request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" });
    response.end();
    return;
  }
  // 仅允许固定路由，绝不将不可信的请求路径作为文件系统路径。
  const route = (request.url ?? "/").split("?")[0];
  if (route === "/") {
    response.writeHead(200, headers("text/html; charset=utf-8"));
    response.end(index);
  } else if (route === "/client.js") {
    response.writeHead(200, headers("text/javascript; charset=utf-8"));
    response.end(script);
  } else if (route === "/style.css") {
    response.writeHead(200, headers("text/css; charset=utf-8"));
    response.end(style);
  } else if (route === "/project") {
    response.writeHead(200, headers("application/json; charset=utf-8"));
    response.end(JSON.stringify(demoDocument));
  } else if (route === "/snapshot.svg") {
    const snapshot = new Map(tags.snapshot().map((tag) => [tag.tagId, tag]));
    response.writeHead(200, headers("image/svg+xml; charset=utf-8"));
    response.end(renderSvgPage(demoDocument, "main", snapshot));
  } else if (route === "/events") {
    response.writeHead(200, {
      ...headers("text/event-stream; charset=utf-8"),
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    clients.add(response);
    sendEvent(response, { kind: "snapshot", values: tags.snapshot() });
    request.on("close", () => {
      clients.delete(response);
    });
  } else {
    response.writeHead(404, headers("text/plain; charset=utf-8"));
    response.end("请求的资源不存在");
  }
});

server.listen(port, host, () => {
  console.log(`V0.1 模拟服务已启动：http://${host}:${port}`);
  console.log("当前未连接 PLC 或工业网关，将自动模拟断连以验证 STALE 数据质量。");
});

function shutdown() {
  clearInterval(interval);
  for (const client of clients) client.end();
  server.close();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
