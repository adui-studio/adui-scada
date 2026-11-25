import { randomUUID } from "node:crypto";
import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { PostgresClient, PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Contract } from "../generated/prisma8/contract.d.js";
import { denyPrisma8Release, parsePrisma8PublishRequest, Prisma8ProjectReleaseStore } from "./prisma8-project-release-store.js";

const actor = { tenantId: "tenant-a", subjectId: "operator-a" };
const projectId = waterTreatmentDemoDocument.projectId;
const request = { expectedHeadRevision: 1, targetRevision: 1, expectedReleaseGeneration: 0 };
const key = randomUUID();

describe("Prisma 8 工程发布候选", () => {
  it("发布请求保留双 CAS 和幂等标识", () => {
    expect(parsePrisma8PublishRequest(request, key)).toEqual({ ...request, idempotencyKey: key });
  });

  it("拒绝客户端指定主体、摘要和额外字段", () => {
    expect(() => parsePrisma8PublishRequest({ ...request, tenantId: actor.tenantId }, key))
      .toThrow("正式发布请求只允许 expectedHeadRevision、targetRevision 和 expectedReleaseGeneration");
    expect(() => parsePrisma8PublishRequest({ ...request, contentHash: "0".repeat(64) }, key))
      .toThrow("正式发布请求只允许 expectedHeadRevision、targetRevision 和 expectedReleaseGeneration");
  });

  it("拒绝错误修订号、代次和非 UUID v4 幂等键", () => {
    expect(() => parsePrisma8PublishRequest({ ...request, targetRevision: 2 }, key))
      .toThrow("首次正式发布目标必须等于预期工程 head 修订号");
    expect(() => parsePrisma8PublishRequest({ ...request, expectedHeadRevision: 0 }, key))
      .toThrow("预期工程修订号必须是大于零的安全整数");
    expect(() => parsePrisma8PublishRequest({ ...request, expectedReleaseGeneration: -1 }, key))
      .toThrow("预期发布代次必须是非负安全整数");
    expect(() => parsePrisma8PublishRequest(request, "invalid"))
      .toThrow("Idempotency-Key 必须为服务端生成的 UUID v4");
  });

  it("非法主体、工程和请求不会开启事务", async () => {
    const transaction = vi.fn<() => Promise<never>>();
    const store = new Prisma8ProjectReleaseStore({ transaction } as unknown as PostgresClient<Contract>);
    await expect(store.readCurrent(null, null, projectId)).rejects.toThrow("工程资源不存在或无权访问");
    await expect(store.readCurrent(actor, key, "../bad")).rejects.toThrow("工程资源不存在或无权访问");
    await expect(store.publish(actor, key, projectId, request, "invalid")).rejects.toThrow("Idempotency-Key 必须为服务端生成的 UUID v4");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("默认门禁保持正式安全拒绝且返回固定阻塞类别", async () => {
    const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
      revision: 1, createdAt: "2026-11-25T00:00:00.000Z",
    });
    const tx = {} as PostgresTransactionContext<Contract>;
    await expect(denyPrisma8Release(tx, snapshot, {
      tenantId: actor.tenantId, actorId: actor.subjectId, projectId,
    })).rejects.toMatchObject({
      message: "正式发布安全门禁尚未完成，当前请求已被安全拒绝",
      blocks: expect.arrayContaining([
        { code: "RUNTIME_ADMISSION_UNAVAILABLE", path: "runtime" },
        { code: "INDUSTRIAL_READ_POLICY_UNAVAILABLE", path: "industrial" },
      ]),
    });
  });
});
