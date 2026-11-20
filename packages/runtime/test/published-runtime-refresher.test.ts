import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import { describe, expect, it, vi } from "vite-plus/test";
import { PublishedRuntime } from "../src/published-runtime.ts";
import { PublishedRuntimeRefresher } from "../src/published-runtime-refresher.ts";
import type { PublishedRefreshSchedule } from "../src/published-runtime-refresher.ts";
import type { PublishedReleaseReader } from "../src/published-runtime.ts";

const projectId = waterTreatmentDemoDocument.projectId;
const createdAt = "2026-11-19T00:00:00.000Z";
const releasedAt = "2026-11-20T00:00:00.000Z";

async function published(
  revision = 1,
  releaseGeneration = 1,
  eventId = "f0a48e94-5f11-4b07-8dde-340c6f7b61ce",
  requestedProjectId = projectId,
) {
  const snapshot = await createProjectSnapshot(
    { ...waterTreatmentDemoDocument, projectId: requestedProjectId },
    { revision, createdAt },
  );
  return {
    status: "RELEASED" as const,
    projectId: requestedProjectId,
    releasedRevision: revision,
    releasedContentHash: snapshot.contentHash,
    releaseGeneration,
    eventId,
    lastAction: "PUBLISH" as const,
    releasedAt,
    snapshot,
  };
}

function manualClock() {
  const tasks: Array<{
    readonly callback: () => void;
    readonly delay: number;
    active: boolean;
  }> = [];
  const schedule: PublishedRefreshSchedule = (callback, delay) => {
    const task = { callback, delay, active: true };
    tasks.push(task);
    return () => {
      task.active = false;
    };
  };
  const pendingDelays = () => tasks.filter((task) => task.active).map((task) => task.delay);
  const fireNext = () => {
    const task = tasks.find((candidate) => candidate.active);
    if (!task) throw new TypeError("测试时钟缺少待执行的刷新任务");
    task.active = false;
    task.callback();
  };
  return { schedule, tasks, pendingDelays, fireNext };
}

function fixture(
  reader: PublishedReleaseReader,
  schedule: PublishedRefreshSchedule,
  intervalMs = 1_000,
  maxOfflineIntervalMs = 4_000,
) {
  const runtime = new PublishedRuntime(() => {}, reader);
  const refresher = new PublishedRuntimeRefresher(runtime, {
    intervalMs,
    maxOfflineIntervalMs,
    schedule,
  });
  return { runtime, refresher };
}

describe("正式发布 Runtime 指针刷新与失效保护", () => {
  it("启动后只读已发布指针，并在下一次刷新切换到新发布代次", async () => {
    const first = await published();
    const second = await published(2, 2, "cded6f7d-e5a8-4300-88d3-a7a2927f7691");
    const readCurrentRelease = vi
      .fn<PublishedReleaseReader["readCurrentRelease"]>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);

    await refresher.start(projectId);
    expect(runtime.snapshot()).toMatchObject({
      status: "verified",
      releaseGeneration: 1,
      snapshot: { revision: 1 },
      tagQuality: "UNAVAILABLE",
    });
    expect(clock.pendingDelays()).toEqual([1_000]);

    clock.fireNext();
    await vi.waitFor(() => {
      expect(runtime.snapshot()).toMatchObject({
        status: "verified",
        releaseGeneration: 2,
        snapshot: { revision: 2 },
      });
    });
    expect(readCurrentRelease).toHaveBeenCalledTimes(2);
    expect(clock.pendingDelays()).toEqual([1_000]);
    refresher.stop();
  });

  it("发布指针未变化时仍重新校验服务器授权及摘要，不复用旧请求结果", async () => {
    const sameRelease = await published();
    const readCurrentRelease = vi.fn<PublishedReleaseReader["readCurrentRelease"]>(
      async () => sameRelease,
    );
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);
    await refresher.start(projectId);
    clock.fireNext();
    await vi.waitFor(() => {
      expect(readCurrentRelease).toHaveBeenCalledTimes(2);
      expect(runtime.snapshot().status).toBe("verified");
    });
    expect(runtime.snapshot().tagQuality).toBe("UNAVAILABLE");
    refresher.stop();
  });

  it("离线按有上限的退避重试，恢复时仅展示重新验证的正式发布快照", async () => {
    const data = await published();
    const readCurrentRelease = vi
      .fn<PublishedReleaseReader["readCurrentRelease"]>()
      .mockRejectedValueOnce({ kind: "network" })
      .mockRejectedValueOnce({ kind: "network" })
      .mockRejectedValueOnce({ kind: "network" })
      .mockRejectedValueOnce({ kind: "network" })
      .mockResolvedValueOnce(data);
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);

    await refresher.start(projectId);
    expect(runtime.snapshot()).toMatchObject({ status: "offline", snapshot: null });
    expect(clock.pendingDelays()).toEqual([1_000]);

    for (const delay of [2_000, 4_000, 4_000, 1_000]) {
      clock.fireNext();
      await vi.waitFor(() => {
        expect(clock.pendingDelays()).toEqual([delay]);
      });
    }
    expect(runtime.snapshot()).toMatchObject({
      status: "verified",
      snapshot: { revision: 1 },
      tagQuality: "UNAVAILABLE",
    });
    expect(readCurrentRelease).toHaveBeenCalledTimes(5);
    refresher.stop();
  });

  it("正式发布读取权限撤销后清除快照且停止自动请求", async () => {
    const data = await published();
    const readCurrentRelease = vi
      .fn<PublishedReleaseReader["readCurrentRelease"]>()
      .mockResolvedValueOnce(data)
      .mockRejectedValueOnce({ kind: "forbidden" });
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);
    await refresher.start(projectId);
    clock.fireNext();
    await vi.waitFor(() => {
      expect(runtime.snapshot()).toMatchObject({ status: "denied", snapshot: null });
    });
    expect(clock.pendingDelays()).toEqual([]);
    expect(readCurrentRelease).toHaveBeenCalledTimes(2);
    refresher.stop();
  });

  it("发布摘要损坏后清空运行画面，禁止自动循环请求损坏正文", async () => {
    const data = await published();
    const tampered = { ...data, releasedContentHash: "0".repeat(64) };
    const readCurrentRelease = vi
      .fn<PublishedReleaseReader["readCurrentRelease"]>()
      .mockResolvedValueOnce(data)
      .mockResolvedValueOnce(tampered);
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);
    await refresher.start(projectId);
    clock.fireNext();
    await vi.waitFor(() => {
      expect(runtime.snapshot()).toMatchObject({ status: "error", snapshot: null });
    });
    expect(clock.pendingDelays()).toEqual([]);
    refresher.stop();
  });

  it("刷新期间隐藏页面立即清空画面、取消请求和任务，重显必须重新读指针", async () => {
    const old = await published(1, 1);
    const current = await published(2, 2, "888e8cb1-fad2-410b-a9ed-f778a929c44b");
    let resolveOld: ((value: unknown) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    const readCurrentRelease = vi
      .fn<PublishedReleaseReader["readCurrentRelease"]>()
      .mockImplementationOnce(async () => old)
      .mockImplementationOnce(
        (_id, signal) =>
          new Promise<unknown>((resolve) => {
            resolveOld = resolve;
            oldSignal = signal;
          }),
      )
      .mockImplementationOnce(async () => current);
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);

    await refresher.start(projectId);
    clock.fireNext();
    expect(runtime.snapshot()).toMatchObject({ status: "loading", snapshot: null });
    await refresher.setVisible(false);
    expect(oldSignal?.aborted).toBe(true);
    expect(runtime.snapshot()).toMatchObject({ status: "idle", snapshot: null });
    expect(clock.pendingDelays()).toEqual([]);

    await refresher.setVisible(true);
    expect(runtime.snapshot()).toMatchObject({ status: "verified", releaseGeneration: 2 });
    resolveOld?.(old);
    await Promise.resolve();
    expect(runtime.snapshot()).toMatchObject({
      status: "verified",
      releaseGeneration: 2,
      snapshot: { revision: 2 },
    });
    expect(readCurrentRelease).toHaveBeenCalledTimes(3);
    refresher.stop();
  });

  it("手动刷新与自动刷新同一时刻只发一条 GET，旧的计划任务被取消", async () => {
    const data = await published();
    let finish: ((value: unknown) => void) | undefined;
    const readCurrentRelease = vi
      .fn<PublishedReleaseReader["readCurrentRelease"]>()
      .mockResolvedValueOnce(data)
      .mockImplementationOnce(
        () => new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
      );
    const clock = manualClock();
    const { refresher, runtime } = fixture({ readCurrentRelease }, clock.schedule);
    await refresher.start(projectId);
    const first = refresher.refresh();
    const second = refresher.refresh();
    expect(clock.pendingDelays()).toEqual([10_000]);
    expect(readCurrentRelease).toHaveBeenCalledTimes(2);
    finish?.(data);
    await Promise.all([first, second]);
    expect(runtime.snapshot()).toMatchObject({ status: "verified", releaseGeneration: 1 });
    expect(clock.pendingDelays()).toEqual([1_000]);
    refresher.stop();
  });

  it("单次读取悬挂超过超时上限后立即离线并安全重试，旧响应不得回填", async () => {
    const stale = await published(1, 1);
    const current = await published(2, 2, "f279cd50-ebf4-41bd-a7e7-9200387a32b6");
    let finishStale: ((value: unknown) => void) | undefined;
    let staleSignal: AbortSignal | undefined;
    const readCurrentRelease = vi.fn<PublishedReleaseReader["readCurrentRelease"]>(
      (_id, signal) => {
        if (!finishStale) {
          staleSignal = signal;
          return new Promise<unknown>((resolve) => {
            finishStale = resolve;
          });
        }
        return Promise.resolve(current);
      },
    );
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);
    const initial = refresher.start(projectId);
    expect(runtime.snapshot()).toMatchObject({ status: "loading", snapshot: null });
    expect(clock.pendingDelays()).toEqual([10_000]);

    clock.fireNext();
    await initial;
    expect(staleSignal?.aborted).toBe(true);
    expect(runtime.snapshot()).toMatchObject({ status: "offline", snapshot: null });
    expect(clock.pendingDelays()).toEqual([1_000]);

    clock.fireNext();
    await vi.waitFor(() => {
      expect(runtime.snapshot()).toMatchObject({
        status: "verified",
        releaseGeneration: 2,
        snapshot: { revision: 2 },
        tagQuality: "UNAVAILABLE",
      });
    });
    finishStale?.(stale);
    await Promise.resolve();
    expect(runtime.snapshot()).toMatchObject({
      status: "verified",
      releaseGeneration: 2,
      snapshot: { revision: 2 },
    });
    expect(readCurrentRelease).toHaveBeenCalledTimes(2);
    refresher.stop();
  });

  it("停止时清理仍在悬挂的超时任务，超时旧回调不得再请求或显示", async () => {
    const data = await published();
    let finish: ((value: unknown) => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const readCurrentRelease = vi.fn<PublishedReleaseReader["readCurrentRelease"]>(
      (_id, signal) => {
        receivedSignal = signal;
        return new Promise<unknown>((resolve) => {
          finish = resolve;
        });
      },
    );
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);
    const pending = refresher.start(projectId);
    const timeoutCallback = clock.tasks[0]?.callback;
    expect(clock.pendingDelays()).toEqual([10_000]);
    refresher.stop();
    expect(receivedSignal?.aborted).toBe(true);
    expect(clock.pendingDelays()).toEqual([]);
    timeoutCallback?.();
    finish?.(data);
    await pending;
    expect(runtime.snapshot()).toMatchObject({ status: "idle", snapshot: null });
    expect(readCurrentRelease).toHaveBeenCalledTimes(1);
  });

  it("切换工程的旧响应和已取消定时回调无法覆盖新工程", async () => {
    const firstProject = await published();
    const otherProjectId = "second-project";
    const secondProject = await published(
      1,
      1,
      "6d73d75e-4a7a-4454-b107-0c3bc3f34fc9",
      otherProjectId,
    );
    const readCurrentRelease = vi.fn<PublishedReleaseReader["readCurrentRelease"]>(
      async (id) => id === projectId ? firstProject : secondProject,
    );
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);
    await refresher.start(projectId);
    const staleCallback = clock.tasks[0]?.callback;
    await refresher.start(otherProjectId);
    staleCallback?.();
    await Promise.resolve();
    expect(runtime.snapshot()).toMatchObject({
      status: "verified",
      projectId: otherProjectId,
    });
    expect(readCurrentRelease).toHaveBeenCalledTimes(2);
    refresher.stop();
  });

  it("同代次更换快照、代次倒退及已发布退回未发布均停止自动轮询", async () => {
    const first = await published(2, 3);
    const invalid = [
      await published(1, 3, "0b41df5a-37f7-4ea2-a169-423b9097df3c"),
      await published(1, 2),
      { status: "UNRELEASED", projectId, releaseGeneration: 0 },
    ];
    for (const replacement of invalid) {
      const readCurrentRelease = vi
        .fn<PublishedReleaseReader["readCurrentRelease"]>()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(replacement);
      const clock = manualClock();
      const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);
      await refresher.start(projectId);
      clock.fireNext();
      await vi.waitFor(() => {
        expect(runtime.snapshot()).toMatchObject({ status: "error", snapshot: null });
      });
      expect(clock.pendingDelays()).toEqual([]);
      refresher.stop();
    }
  });

  it("更高代次允许合法版本回滚，但只能显示验证过的发布修订", async () => {
    const first = await published(2, 2);
    const older = await published(1, 3, "c1215904-9a1e-4ee5-a0cb-f3423a4c9745");
    const rollback = { ...older, lastAction: "ROLLBACK" };
    const readCurrentRelease = vi
      .fn<PublishedReleaseReader["readCurrentRelease"]>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(rollback);
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);
    await refresher.start(projectId);
    clock.fireNext();
    await vi.waitFor(() => {
      expect(runtime.snapshot()).toMatchObject({
        status: "verified",
        releaseGeneration: 3,
        snapshot: { revision: 1 },
        tagQuality: "UNAVAILABLE",
      });
    });
    refresher.stop();
  });

  it("停止后清理全部定时任务，已触发但迟到的回调也不能恢复快照", async () => {
    const data = await published();
    const readCurrentRelease = vi.fn<PublishedReleaseReader["readCurrentRelease"]>(
      async () => data,
    );
    const clock = manualClock();
    const { runtime, refresher } = fixture({ readCurrentRelease }, clock.schedule);
    await refresher.start(projectId);
    const callback = clock.tasks[0]?.callback;
    refresher.stop();
    callback?.();
    await Promise.resolve();
    expect(runtime.snapshot()).toMatchObject({ status: "idle", snapshot: null });
    expect(readCurrentRelease).toHaveBeenCalledTimes(1);
    expect(clock.pendingDelays()).toEqual([]);
  });

  it("异常刷新间隔和非法工程 ID 在请求前拒绝，不建立定时任务", async () => {
    const clock = manualClock();
    const readCurrentRelease = vi.fn<PublishedReleaseReader["readCurrentRelease"]>();
    const runtime = new PublishedRuntime(() => {}, { readCurrentRelease });
    expect(
      () => new PublishedRuntimeRefresher(runtime, { schedule: clock.schedule, intervalMs: 0 }),
    ).toThrow(/1000～300000/);
    expect(
      () => new PublishedRuntimeRefresher(runtime, {
        schedule: clock.schedule,
        intervalMs: 10_000,
        maxOfflineIntervalMs: 1_000,
      }),
    ).toThrow(/不得小于/);
    expect(
      () => new PublishedRuntimeRefresher(runtime, {
        schedule: clock.schedule,
        requestTimeoutMs: 0,
      }),
    ).toThrow(/1000～300000/);
    const refresher = new PublishedRuntimeRefresher(runtime, {
      schedule: clock.schedule,
    });
    await expect(refresher.start("../bad")).rejects.toThrow(/工程 ID/);
    expect(readCurrentRelease).not.toHaveBeenCalled();
    expect(clock.pendingDelays()).toEqual([]);
    expect(runtime.snapshot().status).toBe("idle");
  });
});
