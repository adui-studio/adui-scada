import { describe, expect, it, vi } from "vite-plus/test";
import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import { createScadaApiClient, ScadaApiError } from "../src/index.ts";

const projectId = waterTreatmentDemoDocument.projectId;
const eventId = "30278ace-e693-45f8-9648-f260d03d6121";
const releasedAt = "2026-11-20T00:00:00.000Z";

function response(value: unknown, status = 200, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl },
  });
}

function fixture(result: Response) {
  const fetcher = vi.fn<typeof fetch>(async () => result);
  return { client: createScadaApiClient({ fetcher }), fetcher };
}

async function published() {
  const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
    revision: 1,
    createdAt: "2026-11-19T00:00:00.000Z",
  });
  return {
    status: "RELEASED" as const,
    projectId,
    releasedRevision: 1,
    releasedContentHash: snapshot.contentHash,
    releaseGeneration: 1,
    eventId,
    lastAction: "PUBLISH",
    releasedAt,
    snapshot,
  };
}

describe("共享 API Client 当前正式发布只读接口", () => {
  it("同源 Cookie GET、禁止缓存、AbortSignal 与独立发布路由均受限制", async () => {
    const expected = { status: "UNRELEASED", projectId, releaseGeneration: 0 };
    const { client, fetcher } = fixture(response(expected));
    const controller = new AbortController();
    await expect(client.readCurrentRelease(projectId, controller.signal)).resolves.toEqual(
      expected,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/" + projectId + "/releases/current",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      }),
    );
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("Authorization");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("headRevision");
  });

  it("已发布响应通过 Core SHA-256 完整性校验后返回不可变快照", async () => {
    const input = await published();
    const { client } = fixture(response(input));
    const value = await client.readCurrentRelease(projectId);
    expect(value).toEqual(input);
    expect(Object.isFrozen(value)).toBe(true);
    if (value.status !== "RELEASED") throw new TypeError("测试未得到正式发布响应");
    expect(Object.isFrozen(value.snapshot.document)).toBe(true);
  });

  it("缺少 no-store、附加编辑 head 和篡改发布摘要全部拒绝", async () => {
    const source = await published();
    for (const result of [
      response(source, 200, "private"),
      response({ ...source, headRevision: 5 }),
      response({ ...source, releasedContentHash: "0".repeat(64) }),
    ]) {
      const { client } = fixture(result);
      await expect(client.readCurrentRelease(projectId)).rejects.toMatchObject({
        kind: "invalid_response",
      });
    }
  });

  it("401、403 和不可区分的 404 均由现有授权失败语义拒绝", async () => {
    for (const [status, kind] of [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "not_found"],
    ] as const) {
      const { client } = fixture(response({ message: "受控拒绝" }, status));
      await expect(client.readCurrentRelease(projectId)).rejects.toMatchObject({ kind, status });
    }
  });

  it("非法工程 ID 在 Fetch 之前拒绝，不能拼接相对路径", async () => {
    const { client, fetcher } = fixture(
      response({ status: "UNRELEASED", projectId, releaseGeneration: 0 }),
    );
    await expect(client.readCurrentRelease("../other")).rejects.toThrow(/工程 ID/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("网络中断保持原网络错误分类，不能伪装成已发布", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("模拟网络中断");
    });
    const client = createScadaApiClient({ fetcher });
    await expect(client.readCurrentRelease(projectId)).rejects.toMatchObject({
      kind: "network",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("当前发布响应比 2 MiB 快照和元数据上限更大时 fail-closed", async () => {
    const huge = "x".repeat(2 * 1024 * 1024 + 4097);
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(huge, {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        }),
    );
    const client = createScadaApiClient({ fetcher });
    await expect(client.readCurrentRelease(projectId)).rejects.toBeInstanceOf(ScadaApiError);
    await expect(client.readCurrentRelease(projectId)).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});
