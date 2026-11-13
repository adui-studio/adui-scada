import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

/**
 * 隔离构建服务端镜像，随后测试模块加载与 Linux 容器内正式进程 SIGTERM。
 * 不映射宿主端口、不连接外部网络、不启动数据库或工业网关。
 */
const root = resolve(import.meta.dirname, "..");
const image = "adui-scada-server-smoke:local";
const containerName = `adui-scada-sigterm-${process.pid}-${randomUUID().slice(0, 8)}`;
let containerCreated = false;

function docker(args, capture = false) {
  const output = execFileSync("docker", args, {
    cwd: root,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
    encoding: "utf8",
  });
  return capture ? output.trim() : undefined;
}

try {
  docker(["build", "-f", "deploy/docker/Dockerfile.server", "-t", image, "."]);

  // 第一阶段：模块加载、固定安全路由及 HTTP 接收边界回归。
  docker([
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    image,
    "apps/server/container-smoke.mjs",
  ]);

  // 第二阶段：正式镜像以 Node 作为 PID 1 启动，并接收 Docker 发送的 SIGTERM。
  // 不启用 --rm，保留退出码用于核对是否因超时被 SIGKILL。
  docker([
    "run",
    "--detach",
    "--name",
    containerName,
    "--network",
    "none",
    "--env",
    "SCADA_SERVER_HOST=127.0.0.1",
    "--env",
    "SCADA_SERVER_PORT=3001",
    "--env",
    "SCADA_API_DOCS_ENABLED=false",
    image,
  ]);
  containerCreated = true;

  // docker exec 与被测进程共用容器回环网络，不从宿主机访问容器端口。
  docker(["exec", containerName, "node", "apps/server/container-signal-probe.mjs"]);
  docker(["stop", "--signal", "SIGTERM", "--timeout", "10", containerName]);

  const exitCode = docker(
    ["inspect", "--format", "{{.State.ExitCode}}", containerName],
    true,
  );
  if (exitCode !== "0") {
    throw new Error(`正式 NestJS 容器收到 SIGTERM 后未正常退出，退出码：${exitCode}`);
  }

  console.log("Linux 容器 PID 1 SIGTERM 退出验证通过：退出码 0，未使用强制终止");
  console.log("服务端 Docker 镜像隔离测试通过");
} catch {
  console.error("Docker 服务端镜像或 Linux SIGTERM 测试失败：请检查上方输出");
  process.exitCode = 1;
} finally {
  if (containerCreated) {
    try {
      docker(["rm", "--force", containerName]);
    } catch {
      console.error("隔离容器清理失败，请核对 Docker 容器列表");
      process.exitCode = 1;
    }
  }
}
