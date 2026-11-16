import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
import { describe, expect, it, vi } from "vite-plus/test";
import { ScadaApiError } from "../src/index.ts";
import type { ScadaApiClient } from "../src/index.ts";
import { createStudioServerProjectSession } from "../src/studio-session.ts";

const principal = { tenantId: "tenant-a", subjectId: "user-a" };
const createdAt = "2026-11-16T00:00:00.000Z";

function mockClient() {
  const client: ScadaApiClient = {
    getMe: vi.fn<ScadaApiClient["getMe"]>(async () => ({
      authenticated: true,
      principal,
    })),
    logout: vi.fn<ScadaApiClient["logout"]>(async () => undefined),
    createProject: vi.fn<ScadaApiClient["createProject"]>(async (document) => ({
      projectId: document.projectId,
      headRevision: 1,
      createdAt,
      updatedAt: createdAt,
    })),
    listProjects: vi.fn<ScadaApiClient["listProjects"]>(async () => []),
    getProject: vi.fn<ScadaApiClient["getProject"]>(async (projectId) => ({
      projectId,
      headRevision: 1,
      createdAt,
      updatedAt: createdAt,
    })),
    listVersions: vi.fn<ScadaApiClient["listVersions"]>(async () => []),
    readVersion: vi.fn<ScadaApiClient["readVersion"]>(async (_projectId, revision) =>
      createProjectSnapshot(waterTreatmentDemoDocument, { revision, createdAt }),
    ),
    appendVersion: vi.fn<ScadaApiClient["appendVersion"]>(async (_projectId, expectedRevision) =>
      createProjectSnapshot(waterTreatmentDemoDocument, {
        revision: expectedRevision + 1,
        createdAt,
      }),
    ),
  };
  return client;
}

function documentCopy(): ScadaDocument {
  return structuredClone(waterTreatmentDemoDocument);
}

describe("Studio 服务端工程 CAS 会话安全", () => {
  it("仅在服务端明确返回 404 后创建新工程，并记录首个修订号", async () => {
    const api = mockClient();
    vi.mocked(api.getProject).mockRejectedValueOnce(
      new ScadaApiError("工程不存在或无权访问", "not_found", 404),
    );
    const session = createStudioServerProjectSession(api);
    await expect(session.saveDocument(documentCopy())).resolves.toMatchObject({
      revision: 1,
      created: true,
    });
    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.appendVersion).not.toHaveBeenCalled();
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(1);
  });

  it("已有服务端工程但没有显式载入基线时拒绝追加", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("显式载入最新版本后按旧水位 CAS 追加，并推进当前会话基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(waterTreatmentDemoDocument.projectId, 1);
    session.acceptLoadedVersion(version);
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(1);
    await expect(session.saveDocument(documentCopy())).resolves.toMatchObject({
      revision: 2,
      created: false,
    });
    expect(api.appendVersion).toHaveBeenCalledWith(
      waterTreatmentDemoDocument.projectId,
      1,
      expect.objectContaining({ projectId: waterTreatmentDemoDocument.projectId }),
    );
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(2);
  });

  it("载入的不是最新修订号时不允许用旧画布覆盖服务端", async () => {
    const api = mockClient();
    vi.mocked(api.getProject).mockResolvedValue({
      projectId: waterTreatmentDemoDocument.projectId,
      headRevision: 3,
      createdAt,
      updatedAt: createdAt,
    });
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({ kind: "conflict" });
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("其他标签页推进服务器修订号后清除基线并拒绝写入", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    vi.mocked(api.getProject).mockResolvedValue({
      projectId: waterTreatmentDemoDocument.projectId,
      headRevision: 2,
      createdAt,
      updatedAt: createdAt,
    });
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({ kind: "conflict" });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("身份主体变化后禁止使用上一用户的工程保存基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    vi.mocked(api.getMe).mockResolvedValue({
      authenticated: true,
      principal: { tenantId: "tenant-a", subjectId: "user-b" },
    });
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({ kind: "conflict" });
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("服务端 CAS 返回冲突后丢弃过期基线且不自动重试", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    vi.mocked(api.appendVersion).mockRejectedValueOnce(
      new ScadaApiError("工程版本冲突", "conflict", 409),
    );
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({ kind: "conflict" });
    expect(api.appendVersion).toHaveBeenCalledTimes(1);
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
  });

  it("本地草稿恢复或 JSON 导入显式清除服务端修订号基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    session.reset();
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("同一会话保存中的重复提交不发送第二个网络写入", async () => {
    const api = mockClient();
    let release: (() => void) | undefined;
    vi.mocked(api.getMe).mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<ScadaApiClient["getMe"]>>>((resolve) => {
          release = () => resolve({ authenticated: true, principal });
        }),
    );
    const session = createStudioServerProjectSession(api);
    const first = session.saveDocument(documentCopy()).catch((error: unknown) => error);
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
      kind: "conflict",
    });
    release?.();
    const failure = await first;
    expect(failure).toMatchObject({ kind: "conflict" });
    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(api.appendVersion).not.toHaveBeenCalled();
  });
});
