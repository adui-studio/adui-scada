import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import { describe, expect, it, vi } from "vite-plus/test";
import { ScadaApiError } from "../src/index.ts";
import type { ScadaApiClient } from "../src/index.ts";
import { readCurrentServerReleasePreflight } from "../src/server-release-preflight.ts";

const projectId = waterTreatmentDemoDocument.projectId;
const createdAt = "2026-11-18T00:00:00.000Z";

async function fixture() {
  const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
    revision: 2,
    createdAt,
  });
  const summary = {
    projectId,
    headRevision: 2,
    createdAt,
    updatedAt: createdAt,
  };
  const report = {
    projectId,
    revision: 2,
    headRevision: 2,
    contentHash: snapshot.contentHash,
    passed: true,
    issues: [],
  };
  const api = {
    getProject: vi.fn<ScadaApiClient["getProject"]>(async () => summary),
    readVersion: vi.fn<ScadaApiClient["readVersion"]>(async () => snapshot),
    preflightRelease: vi.fn<ScadaApiClient["preflightRelease"]>(async () => report),
  };
  return { api, snapshot, report };
}

describe("Studio 共享服务端只读发布预检编排", () => {
  it("依次检查当前版本、可信快照、服务端报告及第二次水位，且零写入", async () => {
    const { api, snapshot, report } = await fixture();
    await expect(readCurrentServerReleasePreflight(api, projectId)).resolves.toEqual({
      snapshot,
      report,
    });
    expect(api.getProject).toHaveBeenCalledTimes(2);
    expect(api.readVersion).toHaveBeenCalledWith(projectId, 2);
    expect(api.preflightRelease).toHaveBeenCalledWith(projectId, 2);
    expect(Object.keys(api).sort()).toEqual(["getProject", "preflightRelease", "readVersion"]);
  });

  it("请求期间另一个标签页推进水位必须拒绝显示过期报告", async () => {
    const { api } = await fixture();
    api.getProject.mockResolvedValueOnce({
      projectId,
      headRevision: 2,
      createdAt,
      updatedAt: createdAt,
    });
    api.getProject.mockResolvedValueOnce({
      projectId,
      headRevision: 3,
      createdAt,
      updatedAt: createdAt,
    });
    await expect(readCurrentServerReleasePreflight(api, projectId)).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
  });

  it("预检摘要与已保存快照不一致时拒绝伪造一致性", async () => {
    const { api, report } = await fixture();
    api.preflightRelease.mockResolvedValueOnce({
      ...report,
      contentHash: "0".repeat(64),
    });
    await expect(readCurrentServerReleasePreflight(api, projectId)).rejects.toMatchObject({
      kind: "invalid_response",
    });
    expect(api.getProject).toHaveBeenCalledTimes(1);
  });

  it("读取快照的工程 ID 或修订号不一致时不调用预检接口", async () => {
    const { api, snapshot } = await fixture();
    api.readVersion.mockResolvedValueOnce({ ...snapshot, revision: 1 });
    await expect(readCurrentServerReleasePreflight(api, projectId)).rejects.toBeInstanceOf(
      ScadaApiError,
    );
    expect(api.preflightRelease).not.toHaveBeenCalled();
  });

  it("授权拒绝与服务端版本冲突原样传播，不能转成允许发布", async () => {
    for (const [kind, status] of [
      ["not_found", 404],
      ["unauthenticated", 401],
      ["conflict", 409],
    ] as const) {
      const { api } = await fixture();
      api.getProject.mockRejectedValueOnce(new ScadaApiError("受控读取失败", kind, status));
      await expect(readCurrentServerReleasePreflight(api, projectId)).rejects.toMatchObject({
        kind,
        status,
      });
      expect(api.readVersion).not.toHaveBeenCalled();
    }
  });
});
