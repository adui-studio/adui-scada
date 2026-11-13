import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import { startSseFaultProxy } from "./sse-fault-proxy.mjs";

async function withOrigin(check) {
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("正常");
      return;
    }
    if (request.url !== "/events" && request.url !== "/demo/events") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    response.write('data: {"kind":"snapshot","values":[]}\n\n');
    const interval = setInterval(() => {
      response.write("event: heartbeat\ndata: {}\n\n");
    }, 60);
    response.once("close", () => clearInterval(interval));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port + "/";
  const proxy = await startSseFaultProxy(url);
  try {
    await check(proxy);
  } finally {
    await proxy.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function waitUntil(condition, message, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await pause(20);
  }
  throw new Error(message);
}

await test("故障代理只允许回环 HTTP 地址，不接受外部目标", async () => {
  await assert.rejects(startSseFaultProxy("http://example.com:8080/"), /只允许转发/);
  await assert.rejects(startSseFaultProxy("https://127.0.0.1:8080/"), /只允许转发/);
  await assert.rejects(startSseFaultProxy("http://127.0.0.1:8080/abc"), /只允许转发/);
});

await test("故障代理透传普通 HTTP 页面，不干扰非 SSE 请求", async () => {
  await withOrigin(async (proxy) => {
    const response = await fetch(new URL("health", proxy.url));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "正常");
    assert.equal(proxy.activeSseCount(), 0);
  });
});

await test("代理保持一条 TCP SSE 连接但阻断真实下行字节，不影响另一订阅", async () => {
  await withOrigin(async (proxy) => {
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    try {
      const first = await fetch(new URL("events", proxy.url), { signal: controllers[0].signal });
      assert.equal(first.status, 200);
      const firstReader = first.body.getReader();
      const firstEvent = await firstReader.read();
      assert.match(new TextDecoder().decode(firstEvent.value), /snapshot/);
      assert.equal(proxy.activeSseCount(), 1);
      const frozen = proxy.freezeActiveSse();

      const second = await fetch(new URL("events", proxy.url), { signal: controllers[1].signal });
      assert.equal(second.status, 200);
      const secondReader = second.body.getReader();
      assert.match(new TextDecoder().decode((await secondReader.read()).value), /snapshot/);
      assert.equal(proxy.activeSseCount(), 2);

      await waitUntil(() => proxy.stats(frozen).suppressedBytes > 0, "预期故障代理阻断真实 SSE 字节");
      assert.equal(proxy.stats(frozen).closed, false);
      assert.equal((await secondReader.read()).done, false);

      controllers[0].abort();
      await waitUntil(() => proxy.stats(frozen).closed, "客户端关闭后旧 TCP 连接未释放");
      assert.equal(proxy.activeSseCount(), 1);

      const replacement = await fetch(new URL("events", proxy.url), {
        signal: controllers[2].signal,
      });
      assert.equal(replacement.status, 200);
      const reader = replacement.body.getReader();
      assert.match(new TextDecoder().decode((await reader.read()).value), /snapshot/);
      assert.equal(proxy.activeSseCount(), 2);
    } finally {
      for (const controller of controllers) controller.abort();
      await waitUntil(() => proxy.activeSseCount() === 0, "所有 SSE 客户端关闭后仍留有连接");
    }
  });
});
