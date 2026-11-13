import { connect, createServer } from "node:net";

/**
 * 只用于本机自动化的透明 TCP 代理。可暂停单条 SSE 连接的下行字节，
 * 但保持双方 socket 存活，以复现网络层无 FIN/RST 的传输静默。
 */
export async function startSseFaultProxy(targetUrl) {
  const target = new URL(targetUrl);
  if (
    target.protocol !== "http:" ||
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
    throw new TypeError("故障代理只允许转发到 127.0.0.1 上的本机 HTTP 端口");
  }

  const sessions = [];
  let nextId = 0;
  const server = createServer((downstream) => {
    const upstream = connect({ host: "127.0.0.1", port: Number(target.port) });
    const session = {
      id: ++nextId,
      upstream,
      downstream,
      requestStart: "",
      classified: false,
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
      if (!session.classified) {
        session.requestStart += chunk.toString("latin1");
        const firstLineEnd = session.requestStart.indexOf("\r\n");
        if (firstLineEnd !== -1) {
          const line = session.requestStart.slice(0, firstLineEnd);
          session.isSse = /^GET \/(?:demo\/)?events(?:\?[^ ]*)? HTTP\/1\.[01]$/.test(line);
          session.classified = true;
          session.requestStart = "";
        } else if (session.requestStart.length > 8192) {
          destroy();
          return;
        }
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
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("故障代理无法读取监听端口");

  return {
    url: "http://127.0.0.1:" + address.port + "/",
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
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
