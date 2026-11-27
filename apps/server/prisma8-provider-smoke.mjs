import { randomBytes, randomUUID } from "node:crypto";
import { FreshRuntimeProbeError } from "../../scripts/prisma8-fresh-runtime-probe.mjs";

/** 加载正式 OIDC 根模块的真实 Nest 测试上下文，强制只读且不监听 HTTP 端口。 */
export async function verifyPrisma8Provider(connectionString, systemIdentifier, storageHash) {
  await import("reflect-metadata");
  const { Test } = await import("@nestjs/testing");
  const { NotFoundException, ServiceUnavailableException } = await import("@nestjs/common");
  const { ModulesContainer } = await import("@nestjs/core");
  // 仅在此探针导入根模块时使用同步静默日志，避免 Pretty 工作线程及机器 JSON 污染。
  const previousNodeEnv = process.env.NODE_ENV;
  const previousLogLevel = process.env.SCADA_LOG_LEVEL;
  let OidcEnabledAppModule;
  try {
    process.env.NODE_ENV = "test";
    process.env.SCADA_LOG_LEVEL = "silent";
    ({ OidcEnabledAppModule } = await import(
      new URL("./dist/app.module.js", import.meta.url).href
    ));
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousLogLevel === undefined) delete process.env.SCADA_LOG_LEVEL;
    else process.env.SCADA_LOG_LEVEL = previousLogLevel;
  }
  const { ProjectVersionStore } = await import(
    new URL("./dist/projects/project-version-store.js", import.meta.url).href
  );
  const { ProjectReleaseStore } = await import(
    new URL("./dist/projects/project-release-store.js", import.meta.url).href
  );
  const { Prisma8AuthorizationReadStore } = await import(
    new URL("./dist/auth/prisma8-authorization-read-store.js", import.meta.url).href
  );
  const { ScadaAuthController } = await import(
    new URL("./dist/auth/scada-auth.controller.js", import.meta.url).href
  );
  const { ProjectApiController } = await import(
    new URL("./dist/projects/project-api.controller.js", import.meta.url).href
  );
  const { Prisma8RuntimeProjectVersionStore } = await import(
    new URL("./dist/projects/prisma8-runtime-project-version-store.js", import.meta.url).href
  );
  const { Prisma8RuntimeProjectReleaseStore } = await import(
    new URL("./dist/projects/prisma8-runtime-project-release-store.js", import.meta.url).href
  );
  const { AuthSessionService } = await import(
    new URL("./dist/auth/auth-session.service.js", import.meta.url).href
  );
  const { OidcLoginTransactionService } = await import(
    new URL("./dist/auth/oidc-login-transaction.service.js", import.meta.url).href
  );
  const { OidcProviderDiscoveryService, SCADA_OIDC_STARTUP_CONFIG } = await import(
    new URL("./dist/auth/oidc-provider-discovery.service.js", import.meta.url).href
  );
  const { Prisma8RuntimeAuthSessionService, Prisma8RuntimeOidcLoginTransactionService } =
    await import(new URL("./dist/auth/prisma8-runtime-identity.service.js", import.meta.url).href);
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
  let discoveryCalled = false;
  // 随机内存配置不读取真实 OIDC 凭据，专用发现替身禁止任何外部网络访问。
  const startupConfig = {
    enabled: true,
    issuer: new URL("https://prisma8-smoke.invalid/realm"),
    clientId: "prisma8-smoke",
    clientSecret: randomBytes(32).toString("base64url"),
    redirectUri: new URL("https://prisma8-smoke.invalid/api/v1/auth/oidc/callback"),
    webOrigins: ["https://prisma8-smoke.invalid"],
    transactionEncryptionKey: randomBytes(32),
  };
  const context = await Test.createTestingModule({
    imports: [OidcEnabledAppModule],
  })
    .overrideProvider(ScadaSecurityAuditService)
    .useValue({ record: (decision) => decisions.push(decision) })
    .overrideProvider(PRISMA8_RUNTIME_CONFIG)
    .useValue({ connectionString, readOnly: true, expectedSystemIdentifier: systemIdentifier })
    .overrideProvider(SCADA_OIDC_STARTUP_CONFIG)
    .useValue(startupConfig)
    .overrideProvider(OidcProviderDiscoveryService)
    .useValue({
      getConfiguration() {
        discoveryCalled = true;
        throw new Error("原生只读烟测禁止身份提供方网络发现");
      },
    })
    .compile();
  let failure;
  let service;
  let stage = "原生模块启动";
  try {
    stage = "正式根模块原生提供方唯一性核验";
    const modules = Array.from(context.get(ModulesContainer).values());
    if (
      modules.some(
        (module) => module.metatype?.name === "DatabaseModule" ||
          [...module.providers.keys()].some((token) => typeof token === "function" && token.name === "PrismaService"),
      )
    ) {
      throw new Error("正式根模块仍注册旧数据库提供方");
    }
    const services = context.get(Prisma8Service, { each: true });
    if (services.length !== 1 || !services[0] || services[0].writable !== false) {
      throw new Error("正式根模块没有唯一严格只读原生提供方");
    }
    service = services[0];
    if (
      !(context.get(ScadaAuthController) instanceof ScadaAuthController) ||
      !(context.get(ProjectApiController) instanceof ProjectApiController) ||
      context.get(ProjectVersionStore) !== context.get(Prisma8RuntimeProjectVersionStore) ||
      context.get(ProjectReleaseStore) !== context.get(Prisma8RuntimeProjectReleaseStore)
    ) {
      throw new Error("正式根模块控制器或仓储绑定异常");
    }
    stage = "正式原生根模块启动";
    await context.init();
    const client = service.client;
    if (context.get(Prisma8Service).client !== client) {
      throw new Error("原生数据库模块没有复用提供方");
    }
    const authorization = context.get(AuthorizationReadStore);
    if (!(authorization instanceof Prisma8AuthorizationReadStore)) {
      throw new Error("正式身份授权端口未绑定原生实现");
    }
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
    stage = "原生会话只读查询及身份写入拒绝核验";
    const sessions = context.get(AuthSessionService);
    const transactions = context.get(OidcLoginTransactionService);
    if (
      !(sessions instanceof Prisma8RuntimeAuthSessionService) ||
      !(transactions instanceof Prisma8RuntimeOidcLoginTransactionService)
    ) {
      throw new Error("原生身份服务未绑定到预期实现");
    }
    const token = "scada_s_" + randomBytes(32).toString("base64url");
    const csrf = "scada_csrf_" + randomBytes(32).toString("base64url");
    const authenticated = await sessions.authenticateCookieSession(token, csrf);
    if (
      (await sessions.authenticateWithSession(token)) !== null ||
      authenticated.authenticated ||
      authenticated.reason !== "invalid_session"
    ) {
      throw new Error("不存在的会话未按预期安全拒绝");
    }
    let writeEntered = false;
    let writeDenied = false;
    try {
      await service.writeTransaction(() => {
        writeEntered = true;
        return Promise.resolve(undefined);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Prisma 8 只读提供方禁止写入") throw error;
      writeDenied = true;
    }
    if (!writeDenied || writeEntered) throw new Error("只读提供方未在写事务前拒绝");
    const state = randomBytes(32).toString("base64url");
    const binding = "scada_oidc_b_" + randomBytes(32).toString("base64url");
    const deniedOperations = [
      {
        run: () => sessions.issueForVerifiedSubject(principal),
        message: "本地身份事务暂时不可用，请稍后重试",
      },
      {
        run: () => sessions.revokeForVerifiedSubject(principal, randomUUID()),
        message: "本地身份事务暂时不可用，请稍后重试",
      },
      { run: () => transactions.start("/"), message: "OIDC 登录事务创建失败，请稍后重试" },
      {
        run: () => transactions.consume(state, binding),
        message: "OIDC 登录事务验证失败，请稍后重试",
      },
      {
        run: () => transactions.cleanupExpiredTransactions(),
        message: "OIDC 登录事务清理失败，请稍后重试",
      },
    ];
    for (const { run, message } of deniedOperations) {
      let rejected = false;
      try {
        await run();
      } catch (error) {
        if (!(error instanceof ServiceUnavailableException) || error.message !== message)
          throw error;
        rejected = true;
      }
      if (!rejected) throw new Error("原生身份写入未被只读门禁拒绝");
    }
    if (discoveryCalled) throw new Error("只读烟测不允许 OIDC 网络发现");
    stage = "原生工程列表与锁事务模式核验";
    const projects = context.get(Prisma8RuntimeProjectVersionStore);
    const projectRows = await projects.list(principal, { limit: 1, afterProjectId: scope });
    if (!Array.isArray(projectRows) || projectRows.length !== 0) {
      throw new Error("不存在主体的工程列表未返回空结果");
    }
    const lockedQueries = [
      () => projects.getProject(principal, scope),
      () => projects.listVersions(principal, scope),
      () => projects.read(principal, scope, 1),
      () => projects.preflightRelease(principal, scope, 1),
    ];
    for (const run of lockedQueries) {
      let lockDenied = false;
      try {
        await run();
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "Prisma 8 只读提供方禁止写入") {
          throw error;
        }
        lockDenied = true;
      }
      if (!lockDenied) throw new Error("原生只读提供方未拒绝需要共享锁的查询");
    }
    stage = "原生工程写入只读拒绝核验";
    const { waterTreatmentDemoDocument } = await import("@adui/scada-core");
    const projectWrites = [
      () => projects.create(principal, { document: waterTreatmentDemoDocument }),
      () =>
        projects.append(principal, waterTreatmentDemoDocument.projectId, {
          expectedRevision: 1,
          document: waterTreatmentDemoDocument,
        }),
    ];
    for (const run of projectWrites) {
      let writeRejected = false;
      try {
        await run();
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "Prisma 8 只读提供方禁止写入") {
          throw error;
        }
        writeRejected = true;
      }
      if (!writeRejected) throw new Error("原生只读提供方未拒绝工程写入");
    }
    stage = "原生发布与回滚只读拒绝核验";
    const releases = context.get(Prisma8RuntimeProjectReleaseStore);
    const sessionId = randomUUID();
    const releaseOperations = [
      () => releases.readCurrent(principal, sessionId, scope),
      () =>
        releases.publish(
          principal,
          sessionId,
          scope,
          {
            expectedHeadRevision: 1,
            targetRevision: 1,
            expectedReleaseGeneration: 0,
          },
          randomUUID(),
        ),
      () =>
        releases.rollback(
          principal,
          sessionId,
          scope,
          {
            targetRevision: 1,
            expectedReleaseGeneration: 2,
          },
          randomUUID(),
        ),
    ];
    for (const run of releaseOperations) {
      let rejected = false;
      try {
        await run();
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "Prisma 8 只读提供方禁止写入") {
          throw error;
        }
        rejected = true;
      }
      if (!rejected) throw new Error("原生只读提供方未拒绝发布锁或写事务");
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
    sessionReadVerified: true,
    identityWriteDenied: true,
    oidcDiscoverySkipped: true,
    projectListReadVerified: true,
    projectLockedReadDenied: true,
    projectWriteDenied: true,
    releaseLockedReadDenied: true,
    releaseWriteDenied: true,
    rollbackWriteDenied: true,
    missingProjectDenied: true,
    nativeRootAssemblyVerified: true,
    singleNativeProviderVerified: true,
    legacyProviderAbsent: true,
    providerSwitched: true,
  };
}
