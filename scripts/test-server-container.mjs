import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * 使用本机 Docker 验证服务端运行镜像；容器不使用外部网络，不映射宿主机端口。
 * 不启动 Compose 演示栈，不使用环境变量或数据库连接字符串。
 */
const root = resolve(import.meta.dirname, "..");
const image = "adui-scada-server-smoke:local";

function docker(args) {
  execFileSync("docker", args, { cwd: root, stdio: "inherit", windowsHide: true });
}

try {
  docker(["build", "-f", "deploy/docker/Dockerfile.server", "-t", image, "."]);
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
  console.log("服务端 Docker 镜像隔离测试通过");
} catch {
  console.error("Docker 服务端镜像测试失败：请检查上方的镜像构建和容器运行结果");
  process.exitCode = 1;
}
