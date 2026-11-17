import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
import { describe, expect, it, vi } from "vite-plus/test";
import { ScadaApiError } from "../src/index.ts";
import type { ScadaApiClient } from "../src/index.ts";
import { createStudioServerProjectSession } from "../src/studio-session.ts";

const principal = { tenantId: "tenant-a", subjectId: "user-a" };
const createdAt = "2026-11-16T00:00:00.000Z";

function mockClient() {
  const client = {
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
  } satisfies ScadaApiClient;
  return client;
}

function documentCopy(): ScadaDocument {
  return structuredClone(waterTreatmentDemoDocument);
}

describe("Studio 服务端工程 CAS 会话安全", () => {
  it("仅在服务端明确返回 404 后创建新工程，并记录首个修订号", async () => {
    const api = mockClient();
    api.getProject.mockRejectedValueOnce(
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
    api.getProject.mockResolvedValue({
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
    api.getProject.mockResolvedValue({
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
    api.getMe.mockResolvedValue({
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
    api.appendVersion.mockRejectedValueOnce(new ScadaApiError("工程版本冲突", "conflict", 409));
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({ kind: "conflict" });
    expect(api.appendVersion).toHaveBeenCalledTimes(1);
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
  });

  it("已有 CAS 基线的工程被撤销权限并返回 404 时禁止误创建且清除基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    api.getProject.mockRejectedValueOnce(
      new ScadaApiError("工程不存在或无权访问", "not_found", 404),
    );

    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
      kind: "not_found",
      status: 404,
    });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
    });
    expect(api.getProject).toHaveBeenCalledTimes(2);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("已建立基线后服务端身份过期返回 401 时拒绝保存并丢弃旧主体基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    api.getMe.mockRejectedValueOnce(
      new ScadaApiError("登录已失效，请重新登录", "unauthenticated", 401),
    );

    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
      kind: "unauthenticated",
      status: 401,
    });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
    });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("查看旧工程历史被服务器 403 或 404 拒绝时清除服务端 CAS 基线", async () => {
    for (const denial of [
      new ScadaApiError("当前操作未获得授权", "forbidden", 403),
      new ScadaApiError("工程不存在或无权访问", "not_found", 404),
    ]) {
      const api = mockClient();
      const session = createStudioServerProjectSession(api);
      session.acceptLoadedVersion(
        await session.readVersion(waterTreatmentDemoDocument.projectId, 1),
      );
      api.readVersion.mockRejectedValueOnce(denial);

      await expect(session.readVersion(waterTreatmentDemoDocument.projectId, 1)).rejects.toBe(
        denial,
      );
      expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
      await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
        kind: "forbidden",
        status: 403,
      });
      expect(api.createProject).not.toHaveBeenCalled();
      expect(api.appendVersion).not.toHaveBeenCalled();
    }
  });

  it("重新从授权列表确认载入后清除访问阻断并可正常 CAS 保存", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    api.getProject.mockRejectedValueOnce(
      new ScadaApiError("工程不存在或无权访问", "not_found", 404),
    );
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({ kind: "not_found" });
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({ kind: "forbidden" });

    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    await expect(session.saveDocument(documentCopy())).resolves.toMatchObject({
      revision: 2,
      created: false,
    });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).toHaveBeenCalledTimes(1);
  });

  it("短时网络中断不应清除已确认的 CAS 基线或触发额外创建", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    const networkError = new ScadaApiError("网络请求失败，请检查连接", "network");
    api.getProject.mockRejectedValueOnce(networkError);

    await expect(session.saveDocument(documentCopy())).rejects.toBe(networkError);
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("标签页恢复时没有已确认的服务端基线则不发起身份与工程请求", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    await expect(session.revalidateBaseline(waterTreatmentDemoDocument.projectId)).resolves.toBe(
      "skipped",
    );
    expect(api.getMe).not.toHaveBeenCalled();
    expect(api.getProject).not.toHaveBeenCalled();
  });

  it("标签页重新可见时只读复核身份、项目权限与相同水位，不产生版本写入", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    api.getMe.mockClear();
    api.getProject.mockClear();

    await expect(session.revalidateBaseline(waterTreatmentDemoDocument.projectId)).resolves.toBe(
      "unchanged",
    );
    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(api.getProject).toHaveBeenCalledTimes(1);
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("其他标签页注销后再次激活获得 401 会失效旧 CAS 且禁止误创建", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    api.getMe.mockRejectedValueOnce(
      new ScadaApiError("登录已失效，请重新登录", "unauthenticated", 401),
    );

    await expect(
      session.revalidateBaseline(waterTreatmentDemoDocument.projectId),
    ).rejects.toMatchObject({
      kind: "unauthenticated",
      status: 401,
    });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({ kind: "forbidden" });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("其他标签页撤销本工程 ACL 后再次激活获得 404 则清除旧基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    api.getProject.mockRejectedValueOnce(
      new ScadaApiError("工程不存在或无权访问", "not_found", 404),
    );

    await expect(
      session.revalidateBaseline(waterTreatmentDemoDocument.projectId),
    ).rejects.toMatchObject({
      kind: "not_found",
      status: 404,
    });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({ kind: "forbidden" });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("切换为另一个已认证主体也必须清除上一主体的 CAS 基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    api.getMe.mockResolvedValueOnce({
      authenticated: true,
      principal: { tenantId: principal.tenantId, subjectId: "user-b" },
    });

    await expect(
      session.revalidateBaseline(waterTreatmentDemoDocument.projectId),
    ).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
    });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    expect(api.getProject).toHaveBeenCalledTimes(1);
  });

  it("另一标签页推进修订号时再次激活应提示 CAS 冲突并清除旧水位", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    api.getProject.mockResolvedValueOnce({
      projectId: waterTreatmentDemoDocument.projectId,
      headRevision: 2,
      createdAt,
      updatedAt: createdAt,
    });

    await expect(
      session.revalidateBaseline(waterTreatmentDemoDocument.projectId),
    ).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("恢复可见时网络故障不得误判为撤权或删除原来的保存基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));
    const failure = new ScadaApiError("网络请求失败，请检查连接", "network");
    api.getProject.mockRejectedValueOnce(failure);

    await expect(session.revalidateBaseline(waterTreatmentDemoDocument.projectId)).rejects.toBe(
      failure,
    );
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("恢复可见的迟到验证结果不能清空后来重新载入的合法基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(waterTreatmentDemoDocument.projectId, 1);
    session.acceptLoadedVersion(version);
    let release: (() => void) | undefined;
    api.getMe.mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<ScadaApiClient["getMe"]>>>((_resolve, reject) => {
          release = () => reject(new ScadaApiError("登录已失效，请重新登录", "unauthenticated", 401));
        }),
    );
    const pending = session.revalidateBaseline(waterTreatmentDemoDocument.projectId);
    session.reset();
    session.acceptLoadedVersion(version);
    release?.();

    await expect(pending).resolves.toBe("skipped");
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
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
    api.getMe.mockImplementationOnce(
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
