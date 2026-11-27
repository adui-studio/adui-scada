import "reflect-metadata";
import { describe, expect, it } from "vite-plus/test";
import { AppModule, OidcEnabledAppModule } from "../app.module.js";
import { ScadaAuthController } from "../auth/scada-auth.controller.js";
import { ScadaIdentityModule } from "../auth/scada-identity.module.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { AuthorizationReadStore } from "../auth/authorization-read-store.js";
import { Prisma7AuthorizationReadStore } from "../auth/prisma7-authorization-read-store.js";
import { Prisma8AuthorizationModule } from "../auth/prisma8-authorization.module.js";
import { Prisma8AuthorizationReadStore } from "../auth/prisma8-authorization-read-store.js";
import { Prisma8IdentityModule } from "../auth/prisma8-identity.module.js";
import { OidcLoginTransactionService } from "../auth/oidc-login-transaction.service.js";
import {
  Prisma8RuntimeAuthSessionService,
  Prisma8RuntimeOidcLoginTransactionService,
} from "../auth/prisma8-runtime-identity.service.js";
import { Prisma8DatabaseModule } from "./prisma8-database.module.js";
import { ScadaSessionGuard } from "../auth/scada-session.guard.js";
import { ScadaProjectGuard } from "../auth/scada-project.guard.js";
import { SCADA_OIDC_STARTUP_CONFIG } from "../auth/oidc-provider-discovery.service.js";
import { ScadaSecurityAuditService } from "../security/scada-security-audit.js";
import { ProjectPersistenceModule } from "../projects/project-persistence.module.js";
import { Prisma8ProjectPersistenceModule } from "../projects/prisma8-project-persistence.module.js";
import { Prisma8RuntimeProjectVersionStore } from "../projects/prisma8-runtime-project-version-store.js";
import { Prisma8RuntimeProjectReleaseStore } from "../projects/prisma8-runtime-project-release-store.js";
import { ProjectApiModule } from "../projects/project-api.module.js";
import { ProjectApiController } from "../projects/project-api.controller.js";
import { DatabaseModule } from "./database.module.js";
import { PrismaService } from "./prisma.service.js";

describe("共享 Prisma 数据库模块装配边界", () => {
  it("数据库模块只声明一个 PrismaService 提供方", () => {
    expect(Reflect.getMetadata("providers", DatabaseModule)).toEqual([PrismaService]);
    expect(Reflect.getMetadata("exports", DatabaseModule)).toEqual([PrismaService]);
  });

  it("身份模块只注册认证控制器", () => {
    const controllers = Reflect.getMetadata("controllers", ScadaIdentityModule) as unknown[];
    expect(controllers).toEqual([ScadaAuthController]);
  });

  it("身份模块显式导出工程 Guard 的完整跨模块依赖", () => {
    const exports = Reflect.getMetadata("exports", ScadaIdentityModule) as unknown[];
    for (const provider of [
      DatabaseModule,
      AuthorizationReadStore,
      SCADA_OIDC_STARTUP_CONFIG,
      ScadaSecurityAuditService,
      AuthSessionService,
      ScadaSessionGuard,
      ScadaProjectGuard,
    ]) {
      expect(exports).toContain(provider);
    }
  });

  it("可信身份与工程持久化模块共用相同的数据库模块", () => {
    for (const moduleType of [ScadaIdentityModule, ProjectPersistenceModule]) {
      expect(Reflect.getMetadata("imports", moduleType)).toContain(DatabaseModule);
      expect(Reflect.getMetadata("providers", moduleType)).not.toContain(PrismaService);
    }
  });

  it("启用 OIDC 根模块必须同时注册工程 API 且继续共用身份和持久化模块", () => {
    const rootImports = Reflect.getMetadata("imports", OidcEnabledAppModule) as unknown[];
    expect(rootImports).toContain(ProjectApiModule);
    const projectImports = Reflect.getMetadata("imports", ProjectApiModule) as unknown[];
    expect(projectImports).toEqual([ScadaIdentityModule, ProjectPersistenceModule]);
    const controllers = Reflect.getMetadata("controllers", ProjectApiModule) as unknown[];
    expect(controllers).toEqual([ProjectApiController]);
  });

  it("身份读取端口的两代实现互斥装配，原生模块仅依赖原生数据库", () => {
    expect(Reflect.getMetadata("providers", ScadaIdentityModule)).toContainEqual({
      provide: AuthorizationReadStore,
      useClass: Prisma7AuthorizationReadStore,
    });
    expect(Reflect.getMetadata("imports", Prisma8AuthorizationModule)).toEqual([
      Prisma8DatabaseModule,
    ]);
    expect(Reflect.getMetadata("providers", Prisma8AuthorizationModule)).toEqual([
      { provide: AuthorizationReadStore, useClass: Prisma8AuthorizationReadStore },
    ]);
    expect(Reflect.getMetadata("exports", Prisma8AuthorizationModule)).toEqual([
      AuthorizationReadStore,
    ]);
    expect(Reflect.getMetadata("imports", OidcEnabledAppModule)).not.toContain(
      Prisma8AuthorizationModule,
    );
  });

  it("原生身份模块独立绑定会话和 OIDC，不挂载正式路由或旧数据库模块", () => {
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
    expect(Reflect.getMetadata("exports", Prisma8IdentityModule)).toContain(AuthSessionService);
    expect(Reflect.getMetadata("exports", Prisma8IdentityModule)).toContain(
      OidcLoginTransactionService,
    );
    expect(Reflect.getMetadata("imports", OidcEnabledAppModule)).not.toContain(
      Prisma8IdentityModule,
    );
    expect(Reflect.getMetadata("imports", ScadaIdentityModule)).not.toContain(
      Prisma8IdentityModule,
    );
  });

  it("原生工程读写和发布仓储共享唯一原生数据库且尚未挂载正式控制器", () => {
    expect(Reflect.getMetadata("imports", Prisma8ProjectPersistenceModule)).toEqual([
      Prisma8DatabaseModule,
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
    for (const moduleType of [
      AppModule,
      OidcEnabledAppModule,
      ProjectApiModule,
      ProjectPersistenceModule,
    ]) {
      expect(Reflect.getMetadata("imports", moduleType)).not.toContain(
        Prisma8ProjectPersistenceModule,
      );
    }
  });

  it("默认应用模块不挂载数据库与工程身份能力", () => {
    const imports = Reflect.getMetadata("imports", AppModule) as unknown[];
    expect(imports).not.toContain(DatabaseModule);
    expect(imports).not.toContain(ScadaIdentityModule);
    expect(imports).not.toContain(ProjectPersistenceModule);
    expect(imports).not.toContain(ProjectApiModule);
    const controllers = Reflect.getMetadata("controllers", AppModule) as unknown[];
    expect(controllers.every((controller) => typeof controller === "function")).toBe(true);
  });
});
