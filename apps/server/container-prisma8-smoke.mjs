import { readFileSync } from "node:fs";
import { verifyPrisma8Provider } from "./prisma8-provider-smoke.mjs";

/** 仅从父进程标准输入接收一次性探针参数，不读取服务进程凭据或开放 HTTP 写入。 */
try {
  const input = readFileSync(0, "utf8");
  if (input.length > 1024) throw new Error("容器原生烟测输入过长");
  const { password, systemIdentifier, storageHash } = JSON.parse(input);
  if (
    typeof password !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(password) ||
    typeof systemIdentifier !== "string" || !/^[1-9][0-9]{0,19}$/u.test(systemIdentifier) ||
    typeof storageHash !== "string" || !/^[a-f0-9]{64}$/u.test(storageHash)
  ) {
    throw new Error("容器原生烟测输入无效");
  }
  const url = new URL("postgresql://adui_scada@postgres:5432/adui_scada?schema=public");
  url.password = password;
  const result = await verifyPrisma8Provider(
    url.toString(),
    systemIdentifier,
    storageHash,
    "docker-readonly",
  );
  process.stdout.write(JSON.stringify({ status: "DOCKER_NATIVE_PROVIDER_READY", ...result }) + "\n");
} catch {
  console.error("容器原生数据库只读烟测失败，内部诊断已脱敏");
  process.exitCode = 1;
}
