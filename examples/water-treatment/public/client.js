const status = document.querySelector("#status");
const monitor = document.querySelector("#monitor");
const stream = new EventSource("/events");
let revision = 0;
stream.onmessage = (event) => {
  const change = JSON.parse(event.data);
  revision++;
  const staleCount = change.values.filter((value) => value.quality === "STALE").length;
  const kindLabel = change.kind === "snapshot" ? "快照" : change.kind === "delta" ? "增量" : "未知事件";
  status.textContent = `模拟数据${kindLabel} 第 ${revision} 次 / ${staleCount ? `${staleCount} 个数据已过期` : "已接收"}`;
  // SVG 接口仅返回共享 Core 生成的白名单图形和经过安全转义的文本。
  monitor.src = `/snapshot.svg?revision=${revision}`;
};
stream.onerror = () => {
  status.textContent = "模拟数据连接中断，等待自动重连";
};
window.addEventListener("pagehide", () => stream.close(), { once: true });
