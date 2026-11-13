import { EventEmitter } from "node:events";
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

test("模拟 SSE 客户端容量限制拒绝超额订阅，关闭连接后可再次接入", () => {
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

test("模拟 SSE 广播互不干扰，断开的客户端不再收到心跳和增量", () => {
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

test("写入返回背压信号后及时断开慢客户端，健康客户端继续接收数据", () => {
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

test("待写缓冲达到字节上限后直接终止，不再写入额外负载", () => {
  const clients = new DemoSseClients(2, 12);
  const slow = new FakeResponse();
  slow.writableLength = 11;
  clients.add(slow);
  assert.equal(clients.send(slow, "超"), false);
  assert.equal(slow.destroyed, true);
  assert.deepEqual(slow.messages, []);
  assert.equal(clients.size, 0);
});

test("断开的连接写入错误会被隔离，广播不影响其他客户端", () => {
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

test("客户端容量和字节限制拒绝非法参数", () => {
  assert.throws(() => new DemoSseClients(0), /SSE 客户端上限/);
  assert.throws(() => new DemoSseClients(1, 0), /SSE 待发送字节上限/);
  assert.throws(() => new DemoSseClients(1.2), /SSE 客户端上限/);
});
