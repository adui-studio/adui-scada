import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";

// 所有目标地址均固定为本机回环地址，不能用自定义 URL 扫描外部服务。
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const proxyMode = process.argv.includes("--proxy");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--proxy");
assert.equal(unknown.length, 0, "不支持的 SSE 验收参数");

function port(name, fallback) {
  const raw = process.env[name] || fallback;
  const value = Number(raw);
  assert.ok(Number.isInteger(value) && value >= 1 && value <= 65535, name + " 端口无效");
  return value;
}

const targets = proxyMode
  ? [
      {
        name: "React Docker Nginx",
        url: "http://127.0.0.1:" + port("SCADA_REACT_PORT", "8080") + "/demo/events",
      },
      {
        name: "Vue Docker Nginx",
        url: "http://127.0.0.1:" + port("SCADA_VUE_PORT", "8081") + "/demo/events",
      },
    ]
  : [
      {
        name: "独立本机模拟服务",
        url: "http://127.0.0.1:" + port("SCADA_DEMO_PORT", "4178") + "/events",
      },
    ];

function parseFrame(source) {
  let kind = "message";
  const data = [];
  for (const line of source.split("\n")) {
    if (line.startsWith("event:")) kind = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  let payload;
  try {
    payload = JSON.parse(data.join("\n"));
  } catch {
    throw new Error("收到无法解析的 SSE JSON 事件");
  }
  return { kind, payload };
}

async function connect(url) {
  const controller = new AbortController();
  const handshake = setTimeout(() => controller.abort(), 7000);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    controller.abort();
    throw new Error("无法访问 " + url + "：" + reason + (cause ? "；" + cause : ""));
  } finally {
    clearTimeout(handshake);
  }
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
    controller.abort();
    throw new Error(
      url + " 响应异常：HTTP " + response.status +
      "，类型：" + (response.headers.get("content-type") || "未提供"),
    );
  }
  if (!response.body) {
    controller.abort();
    throw new Error("SSE 响应不包含可读取流：" + url);
  }
  const client = { controller, events: [], error: null, closed: false, task: null };
  const reader = response.body.getReader();
  client.task = (async () => {
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        // 跨网络分块的 CRLF 也必须被正确归一化。
        pending = pending.replaceAll("\r\n", "\n");
        if (pending.length > 256 * 1024) throw new Error("SSE 单个事件超过 256 KiB 上限");
        let boundary;
        while ((boundary = pending.indexOf("\n\n")) >= 0) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const event = parseFrame(frame);
          if (event) {
            client.events.push(event);
            if (client.events.length > 80) client.events.shift();
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        client.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      client.closed = true;
      reader.releaseLock();
    }
  })();
  client.close = async () => {
    controller.abort();
    await client.task;
  };
  return client;
}

async function waitFor(clients, predicate, description, timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const client of clients) {
      if (client.error) throw new Error(description + "：连接异常：" + client.error);
      if (client.closed) throw new Error(description + "：连接意外关闭");
    }
    if (clients.every(predicate)) return;
    await pause(100);
  }
  throw new Error(
    description +
      " 超时：" +
      JSON.stringify(clients.map((client) => client.events.map((event) => event.kind).slice(-12))),
  );
}

async function verifyTarget(target) {
  const clients = [];
  try {
    for (let index = 0; index < 6; index++) clients.push(await connect(target.url));
    await waitFor(
      clients,
      (client) => {
        const first = client.events.find((event) => event.kind === "message");
        return first?.payload?.kind === "snapshot" && Array.isArray(first.payload.values);
      },
      target.name + " 六路首次快照",
    );

    await waitFor(
      clients,
      (client) => client.events.some((event) => event.kind === "heartbeat"),
      target.name + " 六路具名心跳",
      10_000,
    );

    // 实际断开一条 HTTP 订阅，其他五路仍需继续接收心跳。
    const original = clients[0];
    const remaining = clients.slice(1);
    const baselines = remaining.map((client) =>
      client.events.filter((event) => event.kind === "heartbeat").length,
    );
    await original.close();
    await waitFor(
      remaining,
      (client) => client.events.filter((event) => event.kind === "heartbeat").length >
        baselines[remaining.indexOf(client)],
      target.name + " 单路断开后其他客户端继续收到心跳",
      10_000,
    );

    const replacement = await connect(target.url);
    clients.push(replacement);
    await waitFor(
      [replacement],
      (client) =>
        client.events.find((event) => event.kind === "message")?.payload?.kind === "snapshot",
      target.name + " 新订阅先收到快照",
    );
    assert.equal(clients.slice(1).filter((client) => !client.closed).length, 6);
    process.stdout.write(target.name + "：6 路快照、具名心跳、单路断开隔离与重新订阅通过\n");
  } finally {
    await Promise.all(clients.map((client) => client.close?.()));
  }
}

async function main() {
  process.stdout.write(
    proxyMode ? "开始验证本机 Docker Nginx SSE 代理（不停止或修改容器）\n"
      : "开始验证本机独立 SSE 模拟服务（不自动启动服务）\n",
  );
  for (const target of targets) {
    process.stdout.write("目标：" + target.url + "\n");
    await verifyTarget(target);
  }
  process.stdout.write("SSE 多客户端与连接清理验收完成\n");
}

main().catch((error) => {
  process.stderr.write(
    "SSE 网络验收失败：" + (error instanceof Error ? error.message : String(error)) + "\n",
  );
  process.exitCode = 1;
});
