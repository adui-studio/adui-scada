import { describe, expect, it } from "vite-plus/test";
import { createProjectSnapshot, waterTreatmentDemoDocument } from "../src/index.ts";
import { parsePublishedRelease } from "../src/published-release.ts";

const projectId = waterTreatmentDemoDocument.projectId;
const eventId = "ec514faa-2b8e-4f39-941b-4a03c67b8fc0";
const releasedAt = "2026-11-20T00:00:00.000Z";

async function fixture(revision = 1, generation = 1, action: "PUBLISH" | "ROLLBACK" = "PUBLISH") {
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
    lastAction: action,
    releasedAt,
    snapshot,
  };
}

describe("共享正式发布响应与快照完整性契约", () => {
  it("未发布必须具有严格三字段和零代次，不允许返回草稿或编辑 head", async () => {
    await expect(parsePublishedRelease({
      status: "UNRELEASED", projectId, releaseGeneration: 0,
    }, projectId)).resolves.toEqual({
      status: "UNRELEASED", projectId, releaseGeneration: 0,
    });
    await expect(parsePublishedRelease({
      status: "UNRELEASED", projectId, releaseGeneration: 0, headRevision: 1,
    }, projectId)).rejects.toThrow(/未知字段/);
    await expect(parsePublishedRelease({
      status: "UNRELEASED", projectId, releaseGeneration: 1,
    }, projectId)).rejects.toThrow(/代次不一致/);
  });

  it("读取正式发布只依赖当前指针且返回深度冻结的 SHA-256 快照", async () => {
    const input = await fixture();
    const actual = await parsePublishedRelease(JSON.parse(JSON.stringify(input)), projectId);
    expect(actual).toEqual(input);
    expect(Object.isFrozen(actual)).toBe(true);
    if (actual.status !== "RELEASED") throw new TypeError("测试缺少正式发布快照");
    expect(Object.isFrozen(actual.snapshot.document.pages[0])).toBe(true);
  });

  it("正式回滚允许指向较低修订，但代次必须是正安全整数", async () => {
    const input = await fixture(1, 3, "ROLLBACK");
    const actual = await parsePublishedRelease(input, projectId);
    expect(actual).toMatchObject({ status: "RELEASED", lastAction: "ROLLBACK", releasedRevision: 1, releaseGeneration: 3 });
    await expect(parsePublishedRelease({ ...input, releaseGeneration: 0 }, projectId)).rejects.toThrow(/正安全整数/);
  });

  it("跨工程、篡改指针摘要和非法事件均拒绝", async () => {
    const input = await fixture();
    await expect(parsePublishedRelease(input, "other-project")).rejects.toThrow(/事件元数据无效/);
    await expect(parsePublishedRelease({ ...input, releasedContentHash: "0".repeat(64) }, projectId))
      .rejects.toThrow(/不可变快照不一致/);
    await expect(parsePublishedRelease({ ...input, eventId: "invalid" }, projectId))
      .rejects.toThrow(/事件元数据无效/);
    await expect(parsePublishedRelease({ ...input, lastAction: "DELETE" }, projectId))
      .rejects.toThrow(/事件元数据无效/);
  });

  it("不可变快照正文和元数据被篡改时拒绝", async () => {
    const input = await fixture();
    const tampered = JSON.parse(JSON.stringify(input));
    tampered.snapshot.document.pages[0].nodes[0].props.text = "伪造画面";
    await expect(parsePublishedRelease(tampered, projectId)).rejects.toThrow(/摘要不匹配/);
    await expect(parsePublishedRelease({
      ...input, snapshot: { ...input.snapshot, revision: 2 },
    }, projectId)).rejects.toThrow(/摘要不匹配/);
  });

  it("拒绝附加编辑字段、非法时间、未知状态、非法工程 ID 和数组响应", async () => {
    const input = await fixture();
    await expect(parsePublishedRelease({ ...input, headRevision: 1 }, projectId))
      .rejects.toThrow(/未知字段/);
    await expect(parsePublishedRelease({ ...input, releasedAt: "2026-11-20" }, projectId))
      .rejects.toThrow(/发布时间/);
    await expect(parsePublishedRelease({ ...input, status: "DRAFT" }, projectId))
      .rejects.toThrow(/状态类型无效/);
    await expect(parsePublishedRelease(input, "../other")).rejects.toThrow(/工程 ID/);
    await expect(parsePublishedRelease([], projectId)).rejects.toThrow(/普通对象/);
  });
});
