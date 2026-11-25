import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Contract } from "../generated/prisma8/contract.d.js";
import {
  parsePrisma8ProjectListQuery,
  parsePrisma8VersionQuery,
  Prisma8ProjectQueryStore,
  validatePrisma8ProjectSnapshot,
} from "./prisma8-project-query-store.js";

const actor = { tenantId: "tenant-a", subjectId: "operator-a" };
const projectId = waterTreatmentDemoDocument.projectId;
const createdAt = "2026-11-25T00:00:00.000Z";

describe("Prisma 8 工程查询候选", () => {
  it("工程列表保留默认数量、字符串数量及稳定游标", () => {
    expect(parsePrisma8ProjectListQuery(undefined)).toEqual({ limit: 20 });
    expect(parsePrisma8ProjectListQuery({ limit: "100", afterProjectId: "project-a" })).toEqual({
      limit: 100,
      afterProjectId: "project-a",
    });
  });

  it("工程列表拒绝身份字段、无效游标及越界数量", () => {
    expect(() => parsePrisma8ProjectListQuery({ tenantId: "tenant-b" })).toThrow(
      "工程列表分页只允许 limit 与 afterProjectId 参数",
    );
    expect(() => parsePrisma8ProjectListQuery({ afterProjectId: "../bad" })).toThrow(
      "工程列表游标必须是合法的工程 ID",
    );
    expect(() => parsePrisma8ProjectListQuery({ limit: 101 })).toThrow(
      "工程列表每页数量不能超过 100 条",
    );
    expect(() => parsePrisma8ProjectListQuery({ limit: ["1", "2"] })).toThrow(
      "工程列表每页数量必须是大于零的安全整数",
    );
  });

  it("历史分页接受正安全整数游标并拒绝非法参数", () => {
    expect(parsePrisma8VersionQuery(undefined)).toEqual({ limit: 20 });
    expect(parsePrisma8VersionQuery({ limit: "2", beforeRevision: "12" })).toEqual({
      limit: 2,
      beforeRevision: 12,
    });
    expect(() => parsePrisma8VersionQuery({ beforeRevision: 0 })).toThrow(
      "历史分页修订号必须是大于零的安全整数",
    );
    expect(() => parsePrisma8VersionQuery({ beforeRevision: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      "历史分页修订号必须是大于零的安全整数",
    );
    expect(() => parsePrisma8VersionQuery({ limit: "01" })).toThrow("每页数量必须是正整数");
    expect(() => parsePrisma8VersionQuery({ limit: 101 })).toThrow("每页数量不能超过 100 条");
    expect(() => parsePrisma8VersionQuery({ projectId })).toThrow(
      "工程版本分页只允许 limit 与 beforeRevision 参数",
    );
  });

  it("非法主体、工程、分页或修订号在事务之前拒绝", async () => {
    const transaction = vi.fn<() => Promise<never>>();
    const store = new Prisma8ProjectQueryStore({
      transaction,
    } as unknown as PostgresClient<Contract>);
    await expect(store.list(null)).rejects.toThrow("工程资源不存在或无权访问");
    await expect(store.list(actor, { limit: 101 })).rejects.toThrow(
      "工程列表每页数量不能超过 100 条",
    );
    await expect(store.getProject(actor, "../bad")).rejects.toThrow("工程资源不存在或无权访问");
    await expect(store.listVersions(actor, projectId, null)).rejects.toThrow(
      "工程版本分页参数必须为普通对象",
    );
    await expect(store.read(actor, projectId, 0)).rejects.toThrow(
      "查询修订号必须为大于零的安全整数",
    );
    await expect(store.preflightRelease(actor, projectId, Number.NaN)).rejects.toThrow(
      "发布预检修订号必须为大于零的安全整数",
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("完整快照必须通过共享 SHA-256 校验", async () => {
    const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
      revision: 1,
      createdAt,
    });
    expect(
      await validatePrisma8ProjectSnapshot(projectId, 1, snapshot.contentHash, createdAt, snapshot),
    ).toEqual(snapshot);
    await expect(
      validatePrisma8ProjectSnapshot(projectId, 1, snapshot.contentHash, createdAt, {
        ...snapshot,
        contentHash: "0".repeat(64),
      }),
    ).rejects.toThrow("工程版本快照摘要不匹配，内容可能已被修改");
  });

  it("合法快照也不得掩盖数据库工程、修订、摘要或时间错配", async () => {
    const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
      revision: 1,
      createdAt,
    });
    const message = "数据库工程版本元数据与快照不一致";
    await expect(
      validatePrisma8ProjectSnapshot(
        "different-project",
        1,
        snapshot.contentHash,
        createdAt,
        snapshot,
      ),
    ).rejects.toThrow(message);
    await expect(
      validatePrisma8ProjectSnapshot(projectId, 2, snapshot.contentHash, createdAt, snapshot),
    ).rejects.toThrow(message);
    await expect(
      validatePrisma8ProjectSnapshot(projectId, 1, "0".repeat(64), createdAt, snapshot),
    ).rejects.toThrow(message);
    await expect(
      validatePrisma8ProjectSnapshot(
        projectId,
        1,
        snapshot.contentHash,
        "2026-11-25T00:00:01.000Z",
        snapshot,
      ),
    ).rejects.toThrow(message);
  });
});
