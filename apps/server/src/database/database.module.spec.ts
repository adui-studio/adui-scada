import "reflect-metadata";
import { describe, expect, it } from "vite-plus/test";
import { AppModule, OidcEnabledAppModule } from "../app.module.js";
import { ScadaAuthController } from "../auth/scada-auth.controller.js";
import { ScadaIdentityModule } from "../auth/scada-identity.module.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { AuthorizationReadStore } from "../auth/authorization-read-store.js";
import { Prisma8AuthorizationModule } from "../auth/prisma8-authorization.module.js";
import { Prisma8AuthorizationReadStore } from "../auth/prisma8-authorization-read-store.js";
import { Prisma8IdentityModule } from "../auth/prisma8-identity.module.js";
import { OidcLoginTransactionService } from "../auth/oidc-login-transaction.service.js";
import {
  Prisma8RuntimeAuthSessionService,
  Prisma8RuntimeOidcLoginTransactionService,
} from "../auth/prisma8-runtime-identity.service.js";
import { Prisma8DatabaseModule } from "./prisma8-database.module.js";
import { PRISMA8_RUNTIME_CONFIG, Prisma8Service } from "./prisma8.service.js";
import { ScadaSessionGuard } from "../auth/scada-session.guard.js";
import { ScadaProjectGuard } from "../auth/scada-project.guard.js";
import { SCADA_OIDC_STARTUP_CONFIG } from "../auth/oidc-provider-discovery.service.js";
import { ScadaSecurityAuditService } from "../security/scada-security-audit.js";
import { ProjectPersistenceModule } from "../projects/project-persistence.module.js";
import { Prisma8ProjectPersistenceModule } from "../projects/prisma8-project-persistence.module.js";
import { ProjectVersionStore } from "../projects/project-version-store.js";
import { ProjectReleaseStore } from "../projects/project-release-store.js";
import { Prisma8RuntimeProjectVersionStore } from "../projects/prisma8-runtime-project-version-store.js";
import { Prisma8RuntimeProjectReleaseStore } from "../projects/prisma8-runtime-project-release-store.js";
import { ProjectApiModule } from "../projects/project-api.module.js";
import { ProjectApiController } from "../projects/project-api.controller.js";
import { DatabaseModule } from "./database.module.js";
import { PrismaService } from "./prisma.service.js";

describe("正式 Prisma 8 原生数据库模块装配边界", () => {
  it("原生数据库模块只声明一个原生服务与一个受控配置提供方", () => {
    const providers = Reflect.getMetadata("providers", Prisma8DatabaseModule) as unknown[];
    expect(providers).toHaveLength(2);
    expect(providers).toContain(Prisma8Service);
    expect(providers).toContainEqual({
      provide: PRISMA8_RUNTIME_CONFIG,
      useFactory: expect.any(Function),
    });
    expect(providers).not.toContain(PrismaService);
    expect(Reflect.getMetadata("exports", Prisma8DatabaseModule)).toEqual([Prisma8Service]);
  });

  it("正式身份模块仅注册认证控制器并复用原生身份模块", () => {
    expect(Reflect.getMetadata("controllers", ScadaIdentityModule)).toEqual([ScadaAuthController]);
    expect(Reflect.getMetadata("imports", ScadaIdentityModule)).toEqual([Prisma8IdentityModule]);
    expect(Reflect.getMetadata("providers", ScadaIdentityModule)).not.toContain(PrismaService);
  });

  it("正式身份模块显式导出完整跨模块 Guard 依赖", () => {
    const exports = Reflect.getMetadata("exports", ScadaIdentityModule) as unknown[];
    for (const provider of [
      Prisma8IdentityModule,
      ScadaSecurityAuditService,
      ScadaSessionGuard,
      ScadaProjectGuard,
    ]) {
      expect(exports).toContain(provider);
    }
    const identityExports = Reflect.getMetadata("exports", Prisma8IdentityModule) as unknown[];
    expect(identityExports).toContain(SCADA_OIDC_STARTUP_CONFIG);
    expect(identityExports).toContain(AuthSessionService);
    expect(identityExports).toContain(Prisma8AuthorizationModule);
    expect(Reflect.getMetadata("exports", Prisma8AuthorizationModule)).toContain(
      AuthorizationReadStore,
    );
  });

  it("身份、授权与工程仓储复用相同原生数据库模块，不导入旧数据库模块", () => {
    for (const moduleType of [
      Prisma8IdentityModule,
      Prisma8AuthorizationModule,
      Prisma8ProjectPersistenceModule,
    ]) {
      expect(Reflect.getMetadata("imports", moduleType)).toContain(Prisma8DatabaseModule);
      expect(Reflect.getMetadata("imports", moduleType)).not.toContain(DatabaseModule);
      expect(Reflect.getMetadata("providers", moduleType)).not.toContain(PrismaService);
    }
  });

  it("OIDC 根模块注册正式工程 API，保持唯一控制器及原生业务装配", () => {
    expect(Reflect.getMetadata("imports", OidcEnabledAppModule)).toEqual([
      AppModule,
      ProjectApiModule,
    ]);
    expect(Reflect.getMetadata("imports", ProjectApiModule)).toEqual([
      ScadaIdentityModule,
      ProjectPersistenceModule,
    ]);
    expect(Reflect.getMetadata("controllers", ProjectApiModule)).toEqual([ProjectApiController]);
  });

  it("正式授权读取端口只绑定原生实现", () => {
    expect(Reflect.getMetadata("imports", Prisma8AuthorizationModule)).toEqual([
      Prisma8DatabaseModule,
    ]);
    expect(Reflect.getMetadata("providers", Prisma8AuthorizationModule)).toEqual([
      { provide: AuthorizationReadStore, useClass: Prisma8AuthorizationReadStore },
    ]);
    expect(Reflect.getMetadata("exports", Prisma8AuthorizationModule)).toEqual([
      AuthorizationReadStore,
    ]);
  });

  it("原生身份模块绑定会话和登录事务，不重复注册 HTTP 控制器", () => {
    expect(Reflect.getMetadata("imports", Prisma8IdentityModule)).toEqual([
      Prisma8DatabaseModule,
      Prisma8AuthorizationModule,
    ]);
    expect(Reflect.getMetadata("controllers", Prisma8IdentityModule)).toBeUndefined();
    expect(Reflect.getMetadata("providers", Prisma8IdentityModule)).toContainEqual({
      provide: AuthSessionService,
      useClass: Prisma8RuntimeAuthSessionService,
    });
    expect(Reflect.getMetadata("providers", Prisma8IdentityModule)).toContainEqual({
      provide: OidcLoginTransactionService,
      useClass: Prisma8RuntimeOidcLoginTransactionService,
    });
    expect(Reflect.getMetadata("exports", Prisma8IdentityModule)).toContain(
      OidcLoginTransactionService,
    );
  });

  it("正式工程控制器令牌通过同实例引用绑定原生版本与发布仓储", () => {
    expect(Reflect.getMetadata("imports", ProjectPersistenceModule)).toEqual([
      Prisma8ProjectPersistenceModule,
    ]);
    expect(Reflect.getMetadata("providers", ProjectPersistenceModule)).toEqual([
      { provide: ProjectVersionStore, useExisting: Prisma8RuntimeProjectVersionStore },
      { provide: ProjectReleaseStore, useExisting: Prisma8RuntimeProjectReleaseStore },
    ]);
    expect(Reflect.getMetadata("exports", ProjectPersistenceModule)).toEqual([
      Prisma8ProjectPersistenceModule,
      ProjectVersionStore,
      ProjectReleaseStore,
    ]);
    expect(Reflect.getMetadata("providers", Prisma8ProjectPersistenceModule)).toEqual([
      Prisma8RuntimeProjectVersionStore,
      Prisma8RuntimeProjectReleaseStore,
    ]);
    expect(Reflect.getMetadata("exports", Prisma8ProjectPersistenceModule)).toEqual([
      Prisma8RuntimeProjectVersionStore,
      Prisma8RuntimeProjectReleaseStore,
    ]);
    expect(Reflect.getMetadata("controllers", Prisma8ProjectPersistenceModule)).toBeUndefined();
  });

  it("默认应用模块不挂载数据库与工程身份能力", () => {
    const imports = Reflect.getMetadata("imports", AppModule) as unknown[];
    for (const moduleType of [
      DatabaseModule,
      Prisma8DatabaseModule,
      Prisma8IdentityModule,
      Prisma8ProjectPersistenceModule,
      ScadaIdentityModule,
      ProjectPersistenceModule,
      ProjectApiModule,
    ]) {
      expect(imports).not.toContain(moduleType);
    }
    const controllers = Reflect.getMetadata("controllers", AppModule) as unknown[];
    expect(controllers.every((controller) => typeof controller === "function")).toBe(true);
  });
});
