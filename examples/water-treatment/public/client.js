const status = document.querySelector("#status");
const monitor = document.querySelector("#monitor");
const stream = new EventSource("/events");
let revision = 0;
stream.onmessage = (event) => {
  const change = JSON.parse(event.data);
  revision++;
  const staleCount = change.values.filter((value) => value.quality === "STALE").length;
  status.textContent = `模拟数据 ${change.kind} #${revision} / ${staleCount ? `${staleCount} 个 STALE` : "已接收"}`;
  // SVG endpoint returns only escaped, whitelisted shapes from the shared core.
  monitor.src = `/snapshot.svg?revision=${revision}`;
};
stream.onerror = () => {
  status.textContent = "模拟数据连接中断，等待自动重连";
};
window.addEventListener("pagehide", () => stream.close(), { once: true });
