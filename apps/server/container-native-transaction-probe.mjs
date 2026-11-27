import { readFileSync } from "node:fs";

let stage = "CONFIG";
try {
  await import("reflect-metadata");
  const { Prisma8Service, prisma8RuntimeStorageHash } = await import(
    new URL("./dist/database/prisma8.service.js", import.meta.url).href
  );
  const { loadDockerReadOnlyConfig, resolveDockerReadOnlyMode, resolveDockerTransactionProbeConfig } =
    await import(new URL("./dist/database/docker-readonly-config.js", import.meta.url).href);
  const { requireDockerTransactionConfirmation, verifyDockerNativeTransactions } = await import(
    new URL("./dist/database/docker-native-transaction-probe.js", import.meta.url).href
  );
  requireDockerTransactionConfirmation(process.argv.slice(2));
  if (!resolveDockerReadOnlyMode(process.env)) throw new Error("临时事务探针仅允许本机只读容器");
  const input = readFileSync(0, "utf8");
  const config = resolveDockerTransactionProbeConfig(input, prisma8RuntimeStorageHash);
  const mounted = loadDockerReadOnlyConfig(prisma8RuntimeStorageHash);
  if (
    config.connectionString !== mounted.connectionString ||
    config.expectedSystemIdentifier !== mounted.expectedSystemIdentifier
  ) {
    throw new Error("临时事务探针与常驻只读绑定不一致");
  }

  // 独立进程仅构造一个原生数据库服务，不装配 HTTP、身份模块或后台任务。
  const service = new Prisma8Service(config);
  let report;
  let failure;
  try {
    stage = "START";
    await service.onModuleInit();
    stage = "TRANSACTION";
    report = await verifyDockerNativeTransactions(service);
  } catch {
    failure = stage;
  }
  stage = "CLOSE";
  await service.onModuleDestroy();
  if (failure || !report) {
    stage = failure ?? "TRANSACTION";
    throw new Error("原生临时事务验证失败");
  }
  process.stdout.write(
    JSON.stringify({ status: "DOCKER_NATIVE_TRANSACTION_READY", ...report, providerClosed: true }) +
      "\n",
  );
} catch {
  // 机器报告仅含固定阶段码，不输出连接串、SQL、凭据或底层异常。
  process.stdout.write(JSON.stringify({ status: "DOCKER_NATIVE_TRANSACTION_FAILED", stage }) + "\n");
  process.exitCode = 1;
}
