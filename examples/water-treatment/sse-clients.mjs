/** 本机只读 SSE 模拟服务的连接上限，不作为正式网关容量配置。 */
export const DEMO_SSE_MAX_CLIENTS = 32;
/** 单客户端最多允许积压 64 KiB 待发送字节，超限时主动断开慢连接。 */
export const DEMO_SSE_MAX_PENDING_BYTES = 64 * 1024;

/**
 * 只对独立水处理模拟服务器的 SSE 响应做资源隔离。
 * 服务端不缓存历史 Tag，不尝试补发旧增量；客户端重连必须重新接收快照。
 */
export class DemoSseClients {
  constructor(maxClients = DEMO_SSE_MAX_CLIENTS, maxPendingBytes = DEMO_SSE_MAX_PENDING_BYTES) {
    if (!Number.isSafeInteger(maxClients) || maxClients < 1) {
      throw new RangeError("SSE 客户端上限必须是正整数");
    }
    if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes < 1) {
      throw new RangeError("SSE 待发送字节上限必须是正整数");
    }
    this.maxClients = maxClients;
    this.maxPendingBytes = maxPendingBytes;
    this.clients = new Set();
  }

  get size() {
    return this.clients.size;
  }

  hasCapacity() {
    return this.clients.size < this.maxClients;
  }

  add(response) {
    if (!this.hasCapacity() || response.destroyed || response.writableEnded) return false;
    this.clients.add(response);
    const release = () => this.clients.delete(response);
    // 监听响应的关闭而非请求完成；GET 请求结束不代表 SSE 订阅结束。
    response.once("close", release);
    response.once("error", release);
    return true;
  }

  drop(response) {
    this.clients.delete(response);
    if (!response.destroyed) response.destroy();
  }

  send(response, payload) {
    if (!this.clients.has(response)) return false;
    if (response.destroyed || response.writableEnded) {
      this.clients.delete(response);
      return false;
    }
    // writableLength 为 Node 的待发送缓冲长度；写入失败不做无界重试。
    if (response.writableLength + Buffer.byteLength(payload, "utf8") > this.maxPendingBytes) {
      this.drop(response);
      return false;
    }
    try {
      if (!response.write(payload)) {
        // write(false) 表示底层已出现背压，立即断开，避免心跳累积成无限队列。
        this.drop(response);
        return false;
      }
    } catch {
      this.drop(response);
      return false;
    }
    return true;
  }

  broadcast(payload) {
    for (const response of this.clients) this.send(response, payload);
  }

  closeAll() {
    for (const response of this.clients) {
      try {
        response.end();
      } catch {
        if (!response.destroyed) response.destroy();
      }
    }
    this.clients.clear();
  }
}
