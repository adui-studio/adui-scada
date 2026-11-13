import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoSseClients, DEMO_SSE_MAX_CLIENTS } from "./sse-clients.mjs";

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  messages = [];
  backpressure = false;
  throwOnWrite = false;

  write(payload) {
    if (this.throwOnWrite) throw new Error("模拟写入失败");
    this.messages.push(payload);
    return !this.backpressure;
  }

  end() {
    this.writableEnded = true;
    this.emit("close");
  }

  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
}

await test("模拟 SSE 客户端容量限制拒绝超额订阅，关闭连接后可再次接入", () => {
  assert.equal(DEMO_SSE_MAX_CLIENTS, 32);
  const clients = new DemoSseClients(2);
  const first = new FakeResponse();
  const second = new FakeResponse();
  const third = new FakeResponse();

  assert.equal(clients.add(first), true);
  assert.equal(clients.add(second), true);
  assert.equal(clients.hasCapacity(), false);
  assert.equal(clients.add(third), false);
  assert.equal(clients.size, 2);

  first.destroy();
  assert.equal(clients.size, 1);
  assert.equal(clients.add(third), true);
  clients.closeAll();
  assert.equal(clients.size, 0);
  assert.equal(second.writableEnded, true);
  assert.equal(third.writableEnded, true);
});

await test("模拟 SSE 广播互不干扰，断开的客户端不再收到心跳和增量", () => {
  const clients = new DemoSseClients(3);
  const first = new FakeResponse();
  const second = new FakeResponse();
  clients.add(first);
  clients.add(second);
  clients.broadcast("event: heartbeat\ndata: {}\n\n");
  first.destroy();
  clients.broadcast('data: {"kind":"delta","values":[]}\n\n');

  assert.equal(first.messages.length, 1);
  assert.equal(second.messages.length, 2);
  assert.equal(clients.size, 1);
  clients.closeAll();
});

await test("写入返回背压信号后及时断开慢客户端，健康客户端继续接收数据", () => {
  const clients = new DemoSseClients(3);
  const slow = new FakeResponse();
  const healthy = new FakeResponse();
  slow.backpressure = true;
  clients.add(slow);
  clients.add(healthy);

  clients.broadcast("event: heartbeat\ndata: {}\n\n");
  assert.equal(slow.destroyed, true);
  assert.equal(healthy.destroyed, false);
  assert.equal(healthy.messages.length, 1);
  assert.equal(clients.size, 1);
  clients.closeAll();
});

await test("待写缓冲达到字节上限后直接终止，不再写入额外负载", () => {
  const clients = new DemoSseClients(2, 12);
  const slow = new FakeResponse();
  slow.writableLength = 11;
  clients.add(slow);
  assert.equal(clients.send(slow, "超"), false);
  assert.equal(slow.destroyed, true);
  assert.deepEqual(slow.messages, []);
  assert.equal(clients.size, 0);
});

await test("断开的连接写入错误会被隔离，广播不影响其他客户端", () => {
  const clients = new DemoSseClients(2);
  const faulty = new FakeResponse();
  const healthy = new FakeResponse();
  faulty.throwOnWrite = true;
  clients.add(faulty);
  clients.add(healthy);
  clients.broadcast("event: heartbeat\ndata: {}\n\n");

  assert.equal(faulty.destroyed, true);
  assert.equal(healthy.messages.length, 1);
  assert.equal(clients.size, 1);
  clients.closeAll();
});

await test("客户端容量和字节限制拒绝非法参数", () => {
  assert.throws(() => new DemoSseClients(0), /SSE 客户端上限/);
  assert.throws(() => new DemoSseClients(1, 0), /SSE 待发送字节上限/);
  assert.throws(() => new DemoSseClients(1.2), /SSE 客户端上限/);
});

await test("真实回环 HTTP 同时容纳 32 路 SSE，超额返回 503 且断开后可恢复容量", async () => {
  const clients = new DemoSseClients();
  const server = createServer((_request, response) => {
    if (!clients.hasCapacity()) {
      response.writeHead(503, { "Retry-After": "5", "Content-Type": "text/plain" });
      response.end("本机 SSE 模拟订阅数量已达到上限");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    if (clients.add(response)) {
      clients.send(response, 'data: {"kind":"snapshot","values":[]}\n\n');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = "http://127.0.0.1:" + server.address().port + "/events";
  const controllers = [];

  try {
    for (let index = 0; index < 32; index++) {
      const controller = new AbortController();
      const response = await fetch(address, { signal: controller.signal });
      assert.equal(response.status, 200);
      controllers.push(controller);
    }
    assert.equal(clients.size, 32);
    const rejected = await fetch(address);
    assert.equal(rejected.status, 503);
    assert.equal(rejected.headers.get("retry-after"), "5");

    controllers[0].abort();
    for (let attempt = 0; attempt < 40 && clients.size !== 31; attempt++) {
      await pause(50);
    }
    assert.equal(clients.size, 31);

    const nextController = new AbortController();
    const resumed = await fetch(address, { signal: nextController.signal });
    controllers.push(nextController);
    assert.equal(resumed.status, 200);
    assert.equal(clients.size, 32);
  } finally {
    for (const controller of controllers) controller.abort();
    clients.closeAll();
    await new Promise((resolve) => server.close(resolve));
  }
});

await test("响应主动触发 error 时销毁连接且不影响其他订阅", () => {
  const clients = new DemoSseClients(2);
  const faulty = new FakeResponse();
  const healthy = new FakeResponse();
  clients.add(faulty);
  clients.add(healthy);
  faulty.emit("error", new Error("模拟底层 socket 写入异常"));
  assert.equal(faulty.destroyed, true);
  assert.equal(clients.size, 1);
  clients.broadcast("event: heartbeat\ndata: {}\n\n");
  assert.equal(healthy.messages.length, 1);
  clients.closeAll();
});
