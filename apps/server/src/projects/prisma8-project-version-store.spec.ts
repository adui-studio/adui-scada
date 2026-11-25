import { describe, expect, it, vi } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.d.js";
import {
  preparePrisma8ProjectAppend,
  preparePrisma8ProjectCreation,
  Prisma8ProjectVersionStore,
} from "./prisma8-project-version-store.js";

const actor = { tenantId: "tenant-a", subjectId: "operator-a" };
const projectId = waterTreatmentDemoDocument.projectId;
const input = { expectedRevision: 1, document: waterTreatmentDemoDocument };

describe("Prisma 8 工程版本候选请求边界", () => {
  it("创建仅接受文档并复制可信主体", () => {
    const mutable = { ...actor };
    const prepared = preparePrisma8ProjectCreation(mutable, { document: input.document });
    mutable.tenantId = "tenant-b";
    expect(prepared.actor).toEqual(actor);
    expect(Object.isFrozen(prepared.actor)).toBe(true);
    expect(prepared.document.projectId).toBe(projectId);
  });

  it("拒绝伪造身份及多余创建字段", () => {
    expect(() =>
      preparePrisma8ProjectCreation(actor, { document: input.document, tenantId: "tenant-b" }),
    ).toThrow("工程创建请求只允许 document 字段");
    expect(() => preparePrisma8ProjectCreation(actor, [])).toThrow("工程创建请求必须为普通对象");
  });

  it("追加保留有效 CAS 并拒绝非法修订号", () => {
    expect(preparePrisma8ProjectAppend(actor, projectId, input).request.expectedRevision).toBe(1);
    expect(
      preparePrisma8ProjectAppend(actor, projectId, { ...input, expectedRevision: null }).request
        .expectedRevision,
    ).toBeNull();
    expect(() =>
      preparePrisma8ProjectAppend(actor, projectId, { ...input, expectedRevision: 0 }),
    ).toThrow("工程预期修订号必须为 null 或大于零的安全整数");
    expect(() =>
      preparePrisma8ProjectAppend(actor, projectId, {
        ...input,
        expectedRevision: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow("工程预期修订号必须为 null 或大于零的安全整数");
  });

  it("拒绝不一致工程和无效主体", () => {
    expect(() => preparePrisma8ProjectAppend(actor, "different-project", input)).toThrow(
      "请求工程 ID 与路由工程 ID 不一致",
    );
    expect(() => preparePrisma8ProjectAppend(null, projectId, input)).toThrow(
      "工程资源不存在或无权访问",
    );
    expect(() =>
      preparePrisma8ProjectCreation({ ...actor, tenantId: "../bad" }, { document: input.document }),
    ).toThrow("工程资源不存在或无权访问");
  });

  it("非法输入不启动数据库事务", async () => {
    const transaction = vi.fn<() => Promise<never>>();
    const store = new Prisma8ProjectVersionStore({
      transaction,
    } as unknown as PostgresClient<Contract>);
    await expect(store.create(null, { document: input.document })).rejects.toThrow(
      "工程资源不存在或无权访问",
    );
    await expect(store.append(actor, projectId, { ...input, actorId: "forged" })).rejects.toThrow(
      "工程保存请求只允许 expectedRevision 与 document 字段",
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
