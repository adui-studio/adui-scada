import "reflect-metadata";
import { describe, expect, it } from "vite-plus/test";
import { AppModule } from "../app.module.js";
import { ScadaAuthController } from "../auth/scada-auth.controller.js";
import { ScadaIdentityModule } from "../auth/scada-identity.module.js";
import { ProjectPersistenceModule } from "../projects/project-persistence.module.js";
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

  it("可信身份与工程持久化模块共用相同的数据库模块", () => {
    for (const moduleType of [ScadaIdentityModule, ProjectPersistenceModule]) {
      expect(Reflect.getMetadata("imports", moduleType)).toContain(DatabaseModule);
      expect(Reflect.getMetadata("providers", moduleType)).not.toContain(PrismaService);
    }
  });

  it("默认应用模块不挂载数据库与工程身份能力", () => {
    const imports = Reflect.getMetadata("imports", AppModule) as unknown[];
    expect(imports).not.toContain(DatabaseModule);
    expect(imports).not.toContain(ScadaIdentityModule);
    expect(imports).not.toContain(ProjectPersistenceModule);
    const controllers = Reflect.getMetadata("controllers", AppModule) as unknown[];
    expect(controllers.every((controller) => typeof controller === "function")).toBe(true);
  });
});
