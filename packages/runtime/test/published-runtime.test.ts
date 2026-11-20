import { describe, expect, it, vi } from "vite-plus/test";
import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import { PublishedRuntime, initialPublishedRuntimeState } from "../src/published-runtime.ts";
import type { PublishedReleaseReader, PublishedRuntimeState } from "../src/published-runtime.ts";

const projectId = waterTreatmentDemoDocument.projectId;
const releasedAt = "2026-11-20T00:00:00.000Z";

async function published(
  revision = 1,
  generation = 1,
  eventId = "8ab20dc6-7b2c-4baf-85cd-089625a8413d",
) {
  const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
    revision,
    createdAt: "2026-11-19T00:00:00.000Z",
  });
  return {
    status: "RELEASED" as const,
    projectId,
    releasedRevision: revision,
    releasedContentHash: snapshot.contentHash,
    releaseGeneration: generation,
    eventId,
    lastAction: "PUBLISH" as const,
    releasedAt,
    snapshot,
  };
}

function fixture(reader: PublishedReleaseReader) {
  const states: PublishedRuntimeState[] = [];
  const runtime = new PublishedRuntime((state) => states.push(state), reader);
  return { states, runtime };
}

describe("共享正式发布 Runtime 只读加载状态", () => {
  it("未发布工程明确显示未发布，不读取编辑 head 或本地演示数据", async () => {
    const reader = {
      readCurrentRelease: vi.fn<PublishedReleaseReader["readCurrentRelease"]>(async () => ({
        status: "UNRELEASED",
        projectId,
        releaseGeneration: 0,
      })),
    };
    const { runtime, states } = fixture(reader);
    await runtime.load(projectId);
    expect(states.map((state) => state.status)).toEqual(["loading", "unreleased"]);
    expect(runtime.snapshot()).toMatchObject({
      status: "unreleased",
      snapshot: null,
      releaseGeneration: 0,
      tagQuality: "UNAVAILABLE",
    });
    expect(reader.readCurrentRelease).toHaveBeenCalledWith(projectId, expect.any(AbortSignal));
  });

  it("只在发布响应及快照摘要校验后显示已验证状态，Tag 质量仍不可用", async () => {
    const data = await published();
    const reader: PublishedReleaseReader = {
      async readCurrentRelease() {
        return data;
      },
    };
    const { runtime } = fixture(reader);
    await runtime.load(projectId);
    expect(runtime.snapshot()).toMatchObject({
      status: "verified",
      releaseGeneration: 1,
      projectId,
      tagQuality: "UNAVAILABLE",
      snapshot: { contentHash: data.releasedContentHash, revision: 1 },
    });
    expect(Object.isFrozen(runtime.snapshot().snapshot?.document)).toBe(true);
  });

  it("断网时立即撤去可显示的发布快照，不把旧画面伪装成在线画面", async () => {
    const data = await published();
    const readCurrentRelease = vi
      .fn<PublishedReleaseReader["readCurrentRelease"]>()
      .mockResolvedValueOnce(data)
      .mockRejectedValueOnce({ kind: "network" });
    const { runtime } = fixture({ readCurrentRelease });
    await runtime.load(projectId);
    expect(runtime.snapshot().status).toBe("verified");
    await runtime.load(projectId);
    expect(runtime.snapshot()).toMatchObject({
      status: "offline",
      snapshot: null,
      releaseGeneration: null,
      tagQuality: "UNAVAILABLE",
    });
  });

  it("401、403、404 均清除发布快照与授权会话水位，不保留跨主体内容", async () => {
    for (const kind of ["unauthenticated", "forbidden", "not_found"]) {
      const data = await published(1, 4);
      const next = await published(1, 1);
      const readCurrentRelease = vi
        .fn<PublishedReleaseReader["readCurrentRelease"]>()
        .mockResolvedValueOnce(data)
        .mockRejectedValueOnce({ kind })
        .mockResolvedValueOnce(next);
      const { runtime } = fixture({ readCurrentRelease });
      await runtime.load(projectId);
      await runtime.load(projectId);
      expect(runtime.snapshot()).toMatchObject({ status: "denied", snapshot: null });
      // 新授权主体只有在全新服务端响应通过校验后才能显示发布内容。
      await runtime.load(projectId);
      expect(runtime.snapshot()).toMatchObject({ status: "verified", releaseGeneration: 1 });
    }
  });

  it("快照摘要错误时不可保留先前校验通过的正文", async () => {
    const data = await published();
    const changed = JSON.parse(JSON.stringify(data));
    changed.snapshot.document.pages[0].nodes[0].props.text = "篡改显示";
    const readCurrentRelease = vi
      .fn<PublishedReleaseReader["readCurrentRelease"]>()
      .mockResolvedValueOnce(data)
      .mockResolvedValueOnce(changed);
    const { runtime } = fixture({ readCurrentRelease });
    await runtime.load(projectId);
    await runtime.load(projectId);
    expect(runtime.snapshot()).toMatchObject({ status: "error", snapshot: null });
    expect(runtime.snapshot().message).not.toContain("篡改显示");
  });

  it("同一会话拒绝发布代次回退、同代次变更以及已发布回退到未发布", async () => {
    const current = await published(2, 3);
    const older = await published(1, 2);
    const changed = await published(1, 3);
    const unreleased = { status: "UNRELEASED", projectId, releaseGeneration: 0 };
    for (const invalid of [older, changed, unreleased]) {
      const readCurrentRelease = vi
        .fn<PublishedReleaseReader["readCurrentRelease"]>()
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(invalid);
      const { runtime } = fixture({ readCurrentRelease });
      await runtime.load(projectId);
      await runtime.load(projectId);
      expect(runtime.snapshot()).toMatchObject({ status: "error", snapshot: null });
    }
  });

  it("新代次的合法回滚允许恢复较低修订号，但不使实时 Tag 质量变为 GOOD", async () => {
    const current = await published(2, 2);
    const earlier = await published(1, 3, "b19da691-9f02-4451-a517-49b1f19b2530");
    const rollback = { ...earlier, lastAction: "ROLLBACK" };
    const readCurrentRelease = vi
      .fn<PublishedReleaseReader["readCurrentRelease"]>()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(rollback);
    const { runtime } = fixture({ readCurrentRelease });
    await runtime.load(projectId);
    await runtime.load(projectId);
    expect(runtime.snapshot()).toMatchObject({
      status: "verified",
      releaseGeneration: 3,
      tagQuality: "UNAVAILABLE",
      snapshot: { revision: 1 },
    });
  });

  it("切换工程时取消旧请求，迟到的旧发布快照不能覆盖新工程", async () => {
    const first = await published();
    const secondProjectId = "another-project";
    const document = { ...waterTreatmentDemoDocument, projectId: secondProjectId };
    const snapshot = await createProjectSnapshot(document, {
      revision: 1,
      createdAt: "2026-11-19T00:00:00.000Z",
    });
    let completeOld: ((value: unknown) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    const readCurrentRelease = vi.fn<PublishedReleaseReader["readCurrentRelease"]>((id, signal) => {
      if (id === projectId) {
        oldSignal = signal;
        return new Promise<unknown>((resolve) => {
          completeOld = resolve;
        });
      }
      return Promise.resolve({
        status: "RELEASED",
        projectId: secondProjectId,
        releasedRevision: 1,
        releasedContentHash: snapshot.contentHash,
        releaseGeneration: 1,
        eventId: "ad02b824-51c4-401c-8a7f-a1b4e3bd0858",
        lastAction: "PUBLISH",
        releasedAt,
        snapshot,
      });
    });
    const { runtime } = fixture({ readCurrentRelease });
    const pending = runtime.load(projectId);
    await runtime.load(secondProjectId);
    expect(oldSignal?.aborted).toBe(true);
    const before = runtime.snapshot();
    completeOld?.(first);
    await pending;
    expect(runtime.snapshot()).toEqual(before);
    expect(runtime.snapshot()).toMatchObject({ status: "verified", projectId: secondProjectId });
  });

  it("离开运行页立即清除内存快照、取消请求，并拒绝迟到数据恢复", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const reader: PublishedReleaseReader = {
      readCurrentRelease(_projectId, signal) {
        receivedSignal = signal;
        return new Promise<unknown>((resolve) => {
          resolveRequest = resolve;
        });
      },
    };
    const { runtime, states } = fixture(reader);
    const pending = runtime.load(projectId);
    runtime.stop();
    expect(receivedSignal?.aborted).toBe(true);
    expect(runtime.snapshot()).toEqual(initialPublishedRuntimeState);
    const total = states.length;
    resolveRequest?.(await published());
    await pending;
    expect(states).toHaveLength(total);
    expect(runtime.snapshot()).toEqual(initialPublishedRuntimeState);
  });

  it("非法工程 ID 在请求发出前拒绝，不读取外部地址或任意资源", async () => {
    const readCurrentRelease = vi.fn<PublishedReleaseReader["readCurrentRelease"]>();
    const { runtime } = fixture({ readCurrentRelease });
    await expect(runtime.load("../other")).rejects.toThrow(/工程 ID/);
    expect(readCurrentRelease).not.toHaveBeenCalled();
  });
});
