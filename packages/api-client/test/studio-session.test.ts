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
          release = () =>
            reject(new ScadaApiError("登录已失效，请重新登录", "unauthenticated", 401));
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

  it("迟到的 401 不能清除相同工程重新确认的合法 CAS 基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(waterTreatmentDemoDocument.projectId, 1);
    session.acceptLoadedVersion(version);

    let rejectRead: ((reason: ScadaApiError) => void) | undefined;
    api.getMe.mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<ScadaApiClient["getMe"]>>>((_resolve, reject) => {
          rejectRead = (reason) => reject(reason);
        }),
    );
    const pending = session.readVersion(waterTreatmentDemoDocument.projectId, 1);
    session.reset();
    session.acceptLoadedVersion(version);
    rejectRead?.(new ScadaApiError("登录已失效，请重新登录", "unauthenticated", 401));

    await expect(pending).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(1);
    await expect(session.saveDocument(documentCopy())).resolves.toMatchObject({
      revision: 2,
      created: false,
    });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).toHaveBeenCalledTimes(1);
  });

  it("恢复本地工程后迟到的旧 404 不得阻断新的首次创建", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(waterTreatmentDemoDocument.projectId, 1));

    let rejectRead: ((reason: ScadaApiError) => void) | undefined;
    api.readVersion.mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<ScadaApiClient["readVersion"]>>>((_resolve, reject) => {
          rejectRead = (reason) => reject(reason);
        }),
    );
    const pending = session.readVersion(waterTreatmentDemoDocument.projectId, 1);
    await Promise.resolve();
    expect(api.readVersion).toHaveBeenCalledTimes(2);
    session.reset();
    rejectRead?.(new ScadaApiError("工程不存在或无权访问", "not_found", 404));

    await expect(pending).rejects.toMatchObject({ kind: "conflict", status: 409 });
    api.getProject.mockRejectedValueOnce(
      new ScadaApiError("工程不存在或无权访问", "not_found", 404),
    );
    await expect(session.saveDocument(documentCopy())).resolves.toMatchObject({
      revision: 1,
      created: true,
    });
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("上下文切换后迟到的有效快照也不能作为新版本返回", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(waterTreatmentDemoDocument.projectId, 1);
    session.acceptLoadedVersion(version);

    let releaseRead: (() => void) | undefined;
    api.readVersion.mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<ScadaApiClient["readVersion"]>>>((resolve) => {
          releaseRead = () => resolve(version.snapshot);
        }),
    );
    const pending = session.readVersion(waterTreatmentDemoDocument.projectId, 1);
    await Promise.resolve();
    expect(api.readVersion).toHaveBeenCalledTimes(2);
    session.reset();
    releaseRead?.();

    await expect(pending).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    expect(api.getProject).toHaveBeenCalledTimes(1);
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

  it("保存身份请求迟到 401 不得清除重新确认的合法 CAS 基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(waterTreatmentDemoDocument.projectId, 1);
    session.acceptLoadedVersion(version);
    api.getProject.mockClear();

    let rejectIdentity: (() => void) | undefined;
    api.getMe.mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<ScadaApiClient["getMe"]>>>((_resolve, reject) => {
          rejectIdentity = () =>
            reject(new ScadaApiError("登录已失效，请重新登录", "unauthenticated", 401));
        }),
    );

    const pending = session.saveDocument(documentCopy());
    session.reset();
    session.acceptLoadedVersion(version);
    rejectIdentity?.();

    await expect(pending).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(1);
    expect(api.getProject).not.toHaveBeenCalled();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("保存水位查询迟到 404 不得自动创建，明确重新保存仍可创建", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    let notifyRequested: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => {
      notifyRequested = resolve;
    });
    let rejectDetail: (() => void) | undefined;
    api.getProject.mockImplementationOnce(() => {
      notifyRequested?.();
      return new Promise<Awaited<ReturnType<ScadaApiClient["getProject"]>>>((_resolve, reject) => {
        rejectDetail = () => reject(new ScadaApiError("工程不存在或无权访问", "not_found", 404));
      });
    });
    const pending = session.saveDocument(documentCopy());
    await requested;
    session.reset();
    rejectDetail?.();

    await expect(pending).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();

    api.getProject.mockRejectedValueOnce(
      new ScadaApiError("工程不存在或无权访问", "not_found", 404),
    );
    await expect(session.saveDocument(documentCopy())).resolves.toMatchObject({
      revision: 1,
      created: true,
    });
    expect(api.createProject).toHaveBeenCalledTimes(1);
  });

  it("工程创建已发出后切换上下文，不得凭迟到成功响应重建旧基线", async () => {
    const api = mockClient();
    api.getProject.mockRejectedValueOnce(
      new ScadaApiError("工程不存在或无权访问", "not_found", 404),
    );
    const session = createStudioServerProjectSession(api);
    let notifyRequested: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => {
      notifyRequested = resolve;
    });
    let resolveCreated: (() => void) | undefined;
    api.createProject.mockImplementationOnce((document) => {
      notifyRequested?.();
      return new Promise<Awaited<ReturnType<ScadaApiClient["createProject"]>>>((resolve) => {
        resolveCreated = () =>
          resolve({
            projectId: document.projectId,
            headRevision: 1,
            createdAt,
            updatedAt: createdAt,
          });
      });
    });
    const pending = session.saveDocument(documentCopy());
    await requested;
    session.reset();
    resolveCreated?.();

    await expect(pending).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      message: "服务端保存期间工程上下文已变化，写入可能已生效，请重新读取最新版本",
    });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBeNull();
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("旧版本追加成功响应迟到，不得覆盖随后重新载入的 CAS 基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(waterTreatmentDemoDocument.projectId, 1);
    session.acceptLoadedVersion(version);
    let notifyRequested: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => {
      notifyRequested = resolve;
    });
    let resolveAppended: (() => void) | undefined;
    api.appendVersion.mockImplementationOnce((_projectId, expectedRevision) => {
      notifyRequested?.();
      return new Promise<Awaited<ReturnType<ScadaApiClient["appendVersion"]>>>((resolve) => {
        resolveAppended = () =>
          resolve(
            createProjectSnapshot(waterTreatmentDemoDocument, {
              revision: expectedRevision + 1,
              createdAt,
            }),
          );
      });
    });
    const pending = session.saveDocument(documentCopy());
    await requested;
    session.reset();
    session.acceptLoadedVersion(version);
    resolveAppended?.();

    await expect(pending).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      message: "服务端保存期间工程上下文已变化，写入可能已生效，请重新读取最新版本",
    });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).toHaveBeenCalledTimes(1);
  });

  it("旧保存成功回包滞留期间重新载入更高水位，新基线可继续安全追加", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    const projectId = waterTreatmentDemoDocument.projectId;
    session.acceptLoadedVersion(await session.readVersion(projectId, 1));
    expect(session.getBaselineRevision(projectId)).toBe(1);

    let notifyRequested: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => {
      notifyRequested = resolve;
    });
    let releaseOldReply: (() => void) | undefined;
    api.appendVersion.mockImplementationOnce((_projectId, expectedRevision) => {
      notifyRequested?.();
      return new Promise<Awaited<ReturnType<ScadaApiClient["appendVersion"]>>>((resolve) => {
        releaseOldReply = () =>
          resolve(
            createProjectSnapshot(waterTreatmentDemoDocument, {
              revision: expectedRevision + 1,
              createdAt,
            }),
          );
      });
    });

    const oldSave = session.saveDocument(documentCopy());
    await requested;
    expect(api.appendVersion).toHaveBeenCalledTimes(1);

    // 模拟另一会话将真实服务器水位推进到 3，再由用户主动重新载入最新快照。
    session.reset();
    api.getProject.mockResolvedValue({
      projectId,
      headRevision: 3,
      createdAt,
      updatedAt: createdAt,
    });
    const refreshed = await session.readVersion(projectId, 3);
    session.acceptLoadedVersion(refreshed);
    expect(session.getBaselineRevision(projectId)).toBe(3);

    releaseOldReply?.();
    await expect(oldSave).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      message: "服务端保存期间工程上下文已变化，写入可能已生效，请重新读取最新版本",
    });
    expect(session.getBaselineRevision(projectId)).toBe(3);
    expect(api.appendVersion).toHaveBeenCalledTimes(1);

    api.appendVersion.mockResolvedValueOnce(
      await createProjectSnapshot(waterTreatmentDemoDocument, { revision: 4, createdAt }),
    );
    await expect(session.saveDocument(documentCopy())).resolves.toMatchObject({
      revision: 4,
      created: false,
    });
    expect(api.appendVersion).toHaveBeenNthCalledWith(1, projectId, 1, expect.any(Object));
    expect(api.appendVersion).toHaveBeenNthCalledWith(2, projectId, 3, expect.any(Object));
    expect(session.getBaselineRevision(projectId)).toBe(4);
  });

  it("旧版本追加冲突迟到，不得清除随后重新确认的 CAS 基线", async () => {
    const api = mockClient();
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(waterTreatmentDemoDocument.projectId, 1);
    session.acceptLoadedVersion(version);
    let notifyRequested: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => {
      notifyRequested = resolve;
    });
    let rejectAppended: (() => void) | undefined;
    api.appendVersion.mockImplementationOnce(() => {
      notifyRequested?.();
      return new Promise<Awaited<ReturnType<ScadaApiClient["appendVersion"]>>>(
        (_resolve, reject) => {
          rejectAppended = () => reject(new ScadaApiError("工程版本冲突", "conflict", 409));
        },
      );
    });
    const pending = session.saveDocument(documentCopy());
    await requested;
    session.reset();
    session.acceptLoadedVersion(version);
    rejectAppended?.();

    await expect(pending).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      message: "服务端保存期间工程上下文已变化，写入可能已生效，请重新读取最新版本",
    });
    expect(session.getBaselineRevision(waterTreatmentDemoDocument.projectId)).toBe(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).toHaveBeenCalledTimes(1);
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
  it("冲突恢复只读预览最新版本不写入、不建立 CAS 基线", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
      revision: 3,
      createdAt,
    });
    api.getProject.mockResolvedValue({
      projectId,
      headRevision: 3,
      createdAt,
      updatedAt: createdAt,
    });
    api.readVersion.mockResolvedValue(snapshot);
    const session = createStudioServerProjectSession(api);

    const result = await session.previewLatestVersion(projectId);
    expect(result).toMatchObject({
      snapshot: { projectId, revision: 3 },
      headRevision: 3,
      principal,
    });
    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(api.getProject).toHaveBeenCalledTimes(2);
    expect(api.readVersion).toHaveBeenCalledWith(projectId, 3);
    expect(session.getBaselineRevision(projectId)).toBeNull();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("已有旧基线时只读预览不自动接受最新水位，旧 CAS 保存仍被拒绝", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(projectId, 1));
    expect(session.getBaselineRevision(projectId)).toBe(1);

    api.getProject.mockResolvedValue({
      projectId,
      headRevision: 2,
      createdAt,
      updatedAt: createdAt,
    });
    await expect(session.previewLatestVersion(projectId)).resolves.toMatchObject({
      headRevision: 2,
      snapshot: { revision: 2 },
    });
    expect(session.getBaselineRevision(projectId)).toBe(1);
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
    expect(session.getBaselineRevision(projectId)).toBeNull();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("核验期间远端修订继续推进时拒绝展示已经过期的最新预览", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    api.getProject
      .mockResolvedValueOnce({ projectId, headRevision: 2, createdAt, updatedAt: createdAt })
      .mockResolvedValueOnce({ projectId, headRevision: 3, createdAt, updatedAt: createdAt });
    const session = createStudioServerProjectSession(api);
    await expect(session.previewLatestVersion(projectId)).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      message: "只读核验期间服务端版本已变化，请重新查询最新版本",
    });
    expect(api.readVersion).toHaveBeenCalledWith(projectId, 2);
    expect(session.getBaselineRevision(projectId)).toBeNull();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("预览请求迟到 404 不能撤销随后重新确认的有效 CAS 基线", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const version = await createProjectSnapshot(waterTreatmentDemoDocument, {
      revision: 1,
      createdAt,
    });
    const session = createStudioServerProjectSession(api);
    let signalRequested: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => {
      signalRequested = resolve;
    });
    let rejectRead: (() => void) | undefined;
    api.readVersion.mockImplementationOnce(() => {
      signalRequested?.();
      return new Promise<Awaited<ReturnType<ScadaApiClient["readVersion"]>>>((_resolve, reject) => {
        rejectRead = () => reject(new ScadaApiError("工程不存在或无权访问", "not_found", 404));
      });
    });
    const pending = session.previewLatestVersion(projectId);
    await requested;
    session.reset();
    session.acceptLoadedVersion({ snapshot: version, headRevision: 1, principal });
    rejectRead?.();

    await expect(pending).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(session.getBaselineRevision(projectId)).toBe(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("只读预览遇到真实权限拒绝时清空旧基线并阻断误创建", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(projectId, 1));
    api.getProject.mockRejectedValueOnce(
      new ScadaApiError("工程不存在或无权访问", "not_found", 404),
    );
    await expect(session.previewLatestVersion(projectId)).rejects.toMatchObject({
      kind: "not_found",
      status: 404,
    });
    expect(session.getBaselineRevision(projectId)).toBeNull();
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
    });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("只读预览网络失败时保留原合法基线且不写服务端", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const session = createStudioServerProjectSession(api);
    session.acceptLoadedVersion(await session.readVersion(projectId, 1));
    api.getProject.mockRejectedValueOnce(new ScadaApiError("服务端暂时不可用", "network", 503));
    await expect(session.previewLatestVersion(projectId)).rejects.toMatchObject({
      kind: "network",
      status: 503,
    });
    expect(session.getBaselineRevision(projectId)).toBe(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("用户确认后最新水位和身份未变才允许重建 CAS 基线", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(projectId, 1);

    await expect(session.revalidateConfirmedLoad(version)).resolves.toBeUndefined();
    expect(session.getBaselineRevision(projectId)).toBeNull();
    expect(api.getMe).toHaveBeenCalledTimes(2);
    expect(api.getProject).toHaveBeenCalledTimes(2);
    expect(api.readVersion).toHaveBeenCalledTimes(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();

    session.acceptLoadedVersion(version);
    expect(session.getBaselineRevision(projectId)).toBe(1);
  });

  it("显式选择早期历史版本可确认载入但不能冒充最新 CAS", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    api.getProject.mockResolvedValue({
      projectId,
      headRevision: 3,
      createdAt,
      updatedAt: createdAt,
    });
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(projectId, 1);

    await expect(session.revalidateConfirmedLoad(version)).resolves.toBeUndefined();
    session.acceptLoadedVersion(version);
    expect(session.getBaselineRevision(projectId)).toBeNull();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("确认框期间服务端水位从 1 推进到 2 时拒绝载入旧快照", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(projectId, 1);
    api.getProject.mockResolvedValue({
      projectId,
      headRevision: 2,
      createdAt,
      updatedAt: createdAt,
    });

    await expect(session.revalidateConfirmedLoad(version)).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      message: "确认载入时服务端版本已变化，请重新只读预览最新版本",
    });
    expect(session.getBaselineRevision(projectId)).toBeNull();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("确认期间的远端水位漂移必须撤销同工程原有旧基线", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(projectId, 1);
    session.acceptLoadedVersion(version);
    api.getProject.mockResolvedValue({
      projectId,
      headRevision: 2,
      createdAt,
      updatedAt: createdAt,
    });

    await expect(session.revalidateConfirmedLoad(version)).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
    expect(session.getBaselineRevision(projectId)).toBeNull();
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({ kind: "conflict" });
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("确认载入时登录主体变化必须拒绝并阻断同工程误创建", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(projectId, 1);
    session.acceptLoadedVersion(version);
    api.getMe.mockResolvedValue({
      authenticated: true,
      principal: { tenantId: "tenant-a", subjectId: "user-b" },
    });

    await expect(session.revalidateConfirmedLoad(version)).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
    });
    expect(session.getBaselineRevision(projectId)).toBeNull();
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
    });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("确认载入时服务器撤权 404 必须阻断旧 CAS 和误创建", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(projectId, 1);
    session.acceptLoadedVersion(version);
    api.getProject.mockRejectedValueOnce(
      new ScadaApiError("工程不存在或无权访问", "not_found", 404),
    );

    await expect(session.revalidateConfirmedLoad(version)).rejects.toMatchObject({
      kind: "not_found",
      status: 404,
    });
    expect(session.getBaselineRevision(projectId)).toBeNull();
    await expect(session.saveDocument(documentCopy())).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
    });
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("确认载入时网络 503 不能误删原有合法保存基线", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(projectId, 1);
    session.acceptLoadedVersion(version);
    api.getProject.mockRejectedValueOnce(new ScadaApiError("服务端暂时不可用", "network", 503));

    await expect(session.revalidateConfirmedLoad(version)).rejects.toMatchObject({
      kind: "network",
      status: 503,
    });
    expect(session.getBaselineRevision(projectId)).toBe(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });

  it("上下文恢复后迟到的 404 不能清除重新建立的相同工程基线", async () => {
    const api = mockClient();
    const projectId = waterTreatmentDemoDocument.projectId;
    const session = createStudioServerProjectSession(api);
    const version = await session.readVersion(projectId, 1);
    let signalRequested: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => {
      signalRequested = resolve;
    });
    let rejectHead: (() => void) | undefined;
    api.getProject.mockImplementationOnce(() => {
      signalRequested?.();
      return new Promise<Awaited<ReturnType<ScadaApiClient["getProject"]>>>((_resolve, reject) => {
        rejectHead = () => reject(new ScadaApiError("工程不存在或无权访问", "not_found", 404));
      });
    });

    const pending = session.revalidateConfirmedLoad(version);
    await requested;
    session.reset();
    session.acceptLoadedVersion(version);
    rejectHead?.();

    await expect(pending).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(session.getBaselineRevision(projectId)).toBe(1);
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.appendVersion).not.toHaveBeenCalled();
  });
});
