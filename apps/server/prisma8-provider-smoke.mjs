/** 使用真实 Nest 测试应用上下文执行新提供方生命周期，不挂载 HTTP 路由。 */
export async function verifyPrisma8Provider(connectionString, systemIdentifier, storageHash) {
  await import("reflect-metadata");
  const { Test } = await import("@nestjs/testing");
  const { Prisma8DatabaseModule } = await import(
    new URL("./dist/database/prisma8-database.module.js", import.meta.url).href
  );
  const { Prisma8Service, PRISMA8_RUNTIME_CONFIG, prisma8RuntimeStorageHash } = await import(
    new URL("./dist/database/prisma8.service.js", import.meta.url).href
  );
  if (prisma8RuntimeStorageHash !== storageHash) {
    throw new Error("构建后的原生运行时契约与已验证数据库不一致");
  }
  const context = await Test.createTestingModule({ imports: [Prisma8DatabaseModule] })
    .overrideProvider(PRISMA8_RUNTIME_CONFIG)
    .useValue({ connectionString, readOnly: true, expectedSystemIdentifier: systemIdentifier })
    .compile();
  let failed = false;
  let service;
  try {
    service = context.get(Prisma8Service);
    await context.init();
    const client = service.client;
    if (context.get(Prisma8Service).client !== client) {
      throw new Error("原生数据库模块没有复用提供方");
    }
  } catch {
    failed = true;
  }
  try {
    await context.close();
  } catch {
    failed = true;
  }
  if (failed || !service) throw new Error("原生数据库模块启动或关闭失败");
  let closed = false;
  try {
    void service.client;
  } catch {
    closed = true;
  }
  if (!closed) throw new Error("原生数据库模块关闭后仍提供客户端");
  return { providerReady: true, providerClosed: true, readOnlyBoundaryVerified: true };
}
