/**
 * 仅供 Linux Docker 隔离容器内测试：等待正式 NestJS 进程完成启动。
 * 只访问同一容器的回环地址；不读取数据库、密钥或工业设备地址。
 */
const base = "http://127.0.0.1:3001";
let ready = false;

for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(`${base}/health/ready`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (response.status === 200) {
      const result = await response.json();
      if (
        result.status === "ok" &&
        result.details?.http?.status === "up" &&
        result.details?.http?.dependencies === "not_checked"
      ) {
        ready = true;
        break;
      }
    }
  } catch {
    // 服务端尚未监听时允许短暂等待；最终超时必须明确失败。
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!ready) {
  throw new Error("Linux 容器内的正式 HTTP 服务未能在规定时间内就绪");
}

const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_000) });
const healthBody = await health.json();
if (
  health.status !== 200 ||
  healthBody.status !== "ok" ||
  healthBody.service !== "adui-scada-server"
) {
  throw new Error("Linux 容器内正式服务的存活探针异常");
}

const closedApi = await fetch(`${base}/api/devices/write`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: '{"value":1}',
  signal: AbortSignal.timeout(2_000),
});
if (closedApi.status !== 404) {
  throw new Error("Linux 容器意外开放工业设备写入接口");
}

console.log("Linux 容器内正式服务就绪：存活与就绪接口正常，工业写入接口未开放");
