import { randomInt } from "node:crypto";
import { connect, createServer } from "node:net";
import { connect as connectTls, createServer as createTlsServer } from "node:tls";

/**
 * 只用于本机隔离模拟运行验收的 TCP 代理。可暂停单条 SSE 连接的下行字节，
 * 但保持双方 socket 存活，以复现网络层无 FIN/RST 的传输静默。
 * HTTPS 使用双向 TLS 连接，仅在代理内部识别 HTTP/1.1 请求与阻断解密后的下行字节。
 */
export async function startSseFaultProxy(targetUrl, tlsOptions) {
  const target = new URL(targetUrl);
  const secure = target.protocol === "https:";
  if (
    (target.protocol !== "http:" && !secure) ||
    (secure && (!tlsOptions?.cert || !tlsOptions?.key)) ||
    (!secure && tlsOptions) ||
    target.hostname !== "127.0.0.1" ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    !Number.isInteger(Number(target.port)) ||
    Number(target.port) < 1 ||
    Number(target.port) > 65535
  ) {
    throw new TypeError("故障代理只允许转发到 127.0.0.1 的本机 HTTP 或显式可信 HTTPS 端口");
  }

  const sessions = [];
  const sockets = new Set();
  let nextId = 0;
  const onConnection = (downstream) => {
    const address = { host: "127.0.0.1", port: Number(target.port) };
    const upstream = secure
      ? connectTls({
          ...address,
          rejectUnauthorized: true,
          ALPNProtocols: ["http/1.1"],
          ...(tlsOptions.ca ? { ca: tlsOptions.ca } : {}),
        })
      : connect(address);
    const session = {
      id: ++nextId,
      upstream,
      downstream,
      requestTail: "",
      isSse: false,
      blocked: false,
      suppressedBytes: 0,
      closed: false,
    };
    sessions.push(session);

    const destroy = () => {
      if (session.closed) return;
      session.closed = true;
      if (!downstream.destroyed) downstream.destroy();
      if (!upstream.destroyed) upstream.destroy();
    };

    downstream.on("data", (chunk) => {
      if (!session.isSse) {
        // Chrome/Vue 可能复用 Keep-Alive socket：不能只检查首个 HTTP 请求。
        // 保留尾部以识别跨 TCP 分块的 GET 请求行，不持续保存完整 HTTP 报文。
        const requestBytes = session.requestTail + chunk.toString("latin1");
        const isSseRequest = /(?:^|\r\n)GET \/(?:demo\/)?events(?:\?[^\r\n ]*)? HTTP\/1\.[01]\r\n/;
        if (isSseRequest.test(requestBytes)) session.isSse = true;
        session.requestTail = requestBytes.slice(-256);
      }
      if (!upstream.destroyed && !upstream.write(chunk)) downstream.pause();
    });
    upstream.on("drain", () => downstream.resume());
    upstream.on("data", (chunk) => {
      if (session.isSse && session.blocked) {
        session.suppressedBytes += chunk.length;
        return;
      }
      if (!downstream.destroyed && !downstream.write(chunk)) upstream.pause();
    });
    downstream.on("drain", () => upstream.resume());
    downstream.on("close", destroy);
    upstream.on("close", destroy);
    downstream.on("error", destroy);
    upstream.on("error", destroy);
  };
  let server;
  try {
    server = secure
      ? createTlsServer(
          {
            cert: tlsOptions.cert,
            key: tlsOptions.key,
            ALPNProtocols: ["http/1.1"],
            handshakeTimeout: 5000,
          },
          onConnection,
        )
      : createServer(onConnection);
  } catch {
    throw new Error("故障代理本机 TLS 证书或私钥无法校验");
  }
  // 关闭时也要回收尚未完成 TLS 握手的底层 socket。
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  // Fetch 标准会拒绝部分随机端口；仅在不包含禁用端口的范围监听本机代理。
  // 遇到 Windows 端口保留或并发占用时重新选择，不降级 HTTP 安全检查。
  let listening = false;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const port = randomInt(20_000, 49_152);
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      listening = true;
      break;
    } catch (error) {
      if (error?.code !== "EADDRINUSE" && error?.code !== "EACCES") throw error;
    }
  }
  if (!listening) throw new Error("故障代理未找到可用的本机监听端口");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("故障代理无法读取监听端口");

  return {
    url: target.protocol + "//127.0.0.1:" + address.port + "/",
    activeSseCount() {
      return sessions.filter((session) => session.isSse && !session.closed).length;
    },
    freezeActiveSse() {
      const active = sessions.findLast(
        (session) => session.isSse && !session.closed && !session.blocked,
      );
      if (!active) throw new Error("没有可注入故障的 SSE 连接");
      active.blocked = true;
      return active.id;
    },
    stats(id) {
      const session = sessions.find((item) => item.id === id);
      if (!session) throw new Error("不存在的 SSE 故障注入会话");
      return {
        blocked: session.blocked,
        closed: session.closed,
        suppressedBytes: session.suppressedBytes,
      };
    },
    async close() {
      for (const session of sessions) {
        if (!session.downstream.destroyed) session.downstream.destroy();
        if (!session.upstream.destroyed) session.upstream.destroy();
      }
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
