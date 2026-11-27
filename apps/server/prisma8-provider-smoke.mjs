import { randomUUID } from "node:crypto";
import { FreshRuntimeProbeError } from "../../scripts/prisma8-fresh-runtime-probe.mjs";

/** 使用真实 Nest 测试应用上下文执行新提供方与原生授权仓储，不挂载 HTTP 路由。 */
export async function verifyPrisma8Provider(connectionString, systemIdentifier, storageHash) {
  await import("reflect-metadata");
  const { Test } = await import("@nestjs/testing");
  const { NotFoundException } = await import("@nestjs/common");
  const { Prisma8AuthorizationModule } = await import(
    new URL("./dist/auth/prisma8-authorization.module.js", import.meta.url).href
  );
  const { AuthorizationReadStore } = await import(
    new URL("./dist/auth/authorization-read-store.js", import.meta.url).href
  );
  const { ScadaProjectGuard, SCADA_PROJECT_PERMISSION } = await import(
    new URL("./dist/auth/scada-project.guard.js", import.meta.url).href
  );
  const { ScadaSecurityAuditService } = await import(
    new URL("./dist/security/scada-security-audit.js", import.meta.url).href
  );
  const { Prisma8Service, PRISMA8_RUNTIME_CONFIG, prisma8RuntimeStorageHash } = await import(
    new URL("./dist/database/prisma8.service.js", import.meta.url).href
  );
  if (prisma8RuntimeStorageHash !== storageHash) {
    throw new FreshRuntimeProbeError("构建后的原生运行时契约与已验证数据库不一致");
  }
  const decisions = [];
  const context = await Test.createTestingModule({
    imports: [Prisma8AuthorizationModule],
    providers: [
      ScadaProjectGuard,
      {
        provide: ScadaSecurityAuditService,
        useValue: { record: (decision) => decisions.push(decision) },
      },
    ],
  })
    .overrideProvider(PRISMA8_RUNTIME_CONFIG)
    .useValue({ connectionString, readOnly: true, expectedSystemIdentifier: systemIdentifier })
    .compile();
  let failure;
  let service;
  let stage = "原生模块启动";
  try {
    service = context.get(Prisma8Service);
    await context.init();
    const client = service.client;
    if (context.get(Prisma8Service).client !== client) {
      throw new Error("原生数据库模块没有复用提供方");
    }
    const authorization = context.get(AuthorizationReadStore);
    const scope = "prisma8-auth-smoke-" + randomUUID();
    const principal = Object.freeze({ tenantId: scope, subjectId: scope });
    stage = "原生身份映射与工程 ACL 只读查询";
    const identity = await authorization.findActiveExternalIdentity(
      "https://" + scope + ".invalid/",
      scope,
    );
    const grants = await authorization.readProjectGrants(principal, scope);
    if (identity !== null || !Array.isArray(grants) || grants.length !== 0) {
      throw new Error("不存在的身份或工程授权查询结果异常");
    }
    stage = "原生工程 Guard 拒绝核验";
    const guard = context.get(ScadaProjectGuard);
    const handler = () => undefined;
    class SmokeRoute {}
    Reflect.defineMetadata(SCADA_PROJECT_PERMISSION, "version:read", handler);
    const request = { headers: {}, params: { projectId: scope }, scadaPrincipal: principal };
    let denied = false;
    try {
      await guard.canActivate({
        getType: () => "http",
        getHandler: () => handler,
        getClass: () => SmokeRoute,
        switchToHttp: () => ({ getRequest: () => request }),
      });
    } catch (error) {
      if (!(error instanceof NotFoundException) || error.getStatus() !== 404) throw error;
      denied = true;
    }
    if (
      !denied ||
      decisions.length !== 1 ||
      decisions[0]?.action !== "project.authorize" ||
      decisions[0]?.outcome !== "denied" ||
      decisions[0]?.reason !== "permission_denied"
    ) {
      throw new Error("不存在工程未按预期安全拒绝");
    }
  } catch {
    failure = new FreshRuntimeProbeError("原生提供方烟测失败：" + stage);
  }
  try {
    await context.close();
  } catch {
    failure ??= new FreshRuntimeProbeError("原生数据库模块关闭失败");
  }
  if (failure) throw failure;
  if (!service) throw new FreshRuntimeProbeError("原生数据库提供方未创建");
  let closed = false;
  try {
    void service.client;
  } catch {
    closed = true;
  }
  if (!closed) throw new FreshRuntimeProbeError("原生数据库模块关闭后仍提供客户端");
  return {
    providerReady: true,
    providerClosed: true,
    readOnlyBoundaryVerified: true,
    authorizationReadVerified: true,
    missingProjectDenied: true,
  };
}
