import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import { parseScadaDocument } from "../src/document.ts";
import { DraftAutoSaveSession } from "../src/draft-repository.ts";
import type { DraftRecord, DraftRepository } from "../src/draft-repository.ts";

function document() {
  return parseScadaDocument(waterTreatmentDemoDocument);
}

function edited(x: number) {
  const source = document();
  source.pages[0]!.nodes[0]!.transform.x += x;
  return source;
}

class MemoryRepository implements DraftRepository {
  record: DraftRecord | null = null;
  writes = 0;
  async get(projectId: string): Promise<DraftRecord | null> {
    return this.record?.projectId === projectId ? this.record : null;
  }
  async save(source: unknown, expectedRevision: number | null): Promise<DraftRecord> {
    const doc = parseScadaDocument(source);
    if ((this.record?.revision ?? null) !== expectedRevision) {
      throw new TypeError("草稿版本已变化，已拒绝覆盖");
    }
    const record: DraftRecord = {
      projectId: doc.projectId,
      revision: (this.record?.revision ?? 0) + 1,
      savedAt: "2026-11-10T08:00:00.000Z",
      document: doc,
    };
    this.record = record;
    this.writes++;
    return record;
  }
  async remove(_projectId: string, _expectedRevision: number | null): Promise<void> {
    this.record = null;
  }
  subscribe(_projectId: string, _listener: (revision: number | null) => void): () => void {
    return () => undefined;
  }
}

test("自动保存会话初始无修改，不写入数据库", async () => {
  const repo = new MemoryRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  expect(session.hasExistingDraft).toBe(false);
  expect(session.isDirty(document())).toBe(false);
  expect(await session.saveIfDirty(document())).toBeNull();
  expect(repo.writes).toBe(0);
});

test("工程变更触发一次写入，重复相同工程不再次保存", async () => {
  const repo = new MemoryRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  const newDoc = edited(4);
  expect((await session.saveIfDirty(newDoc))?.revision).toBe(1);
  expect(await session.saveIfDirty(newDoc)).toBeNull();
  expect(repo.writes).toBe(1);
  expect(session.currentRevision).toBe(1);
});

test("并发提交依次执行，较新工程不会被旧工程覆盖", async () => {
  const repo = new MemoryRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  const result = await Promise.all([session.saveIfDirty(edited(2)), session.saveIfDirty(edited(3))]);
  expect(result.map((item) => item?.revision)).toEqual([1, 2]);
  expect(repo.record?.document.pages[0]?.nodes[0]?.transform.x).toBe(
    edited(3).pages[0]?.nodes[0]?.transform.x,
  );
});

test("停止会话后等待已有写入，新任务不再开始", async () => {
  const repo = new MemoryRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  const ongoing = session.saveIfDirty(edited(1));
  await session.stop();
  await ongoing;
  expect(await session.saveIfDirty(edited(2))).toBeNull();
  expect(repo.writes).toBeLessThanOrEqual(1);
});

test("打开已有草稿后旧版本冲突由仓储拒绝", async () => {
  const repo = new MemoryRepository();
  repo.record = await repo.save(document(), null);
  const session = await DraftAutoSaveSession.open(repo, document());
  expect(session.hasExistingDraft).toBe(true);
  await repo.save(edited(9), 1);
  await expect(session.saveIfDirty(edited(1))).rejects.toThrow(/拒绝覆盖/);
  expect(repo.record?.revision).toBe(2);
});

test("人工保存后可以接收数据库修订号并继续后续编辑", async () => {
  const repo = new MemoryRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  const manual = await repo.save(edited(1), null);
  session.acceptSaved(manual);
  expect(session.isDirty(edited(1))).toBe(false);
  expect((await session.saveIfDirty(edited(2)))?.revision).toBe(2);
});

test("自动保存非法输入统一返回拒绝的 Promise", async () => {
  const repo = new MemoryRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  const invalid = { ...document(), projectId: "another-project" };
  const pending = session.saveIfDirty(invalid);
  await expect(pending).rejects.toThrow(/工程 ID 不一致/);
  expect(repo.writes).toBe(0);
});

test("禁止自动保存跨工程数据或接受跨工程保存结果", async () => {
  const repo = new MemoryRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  const other = { ...document(), projectId: "another-project" };
  expect(() => session.isDirty(other)).toThrow(/工程 ID 不一致/);
  await expect(session.saveIfDirty(other)).rejects.toThrow(/工程 ID 不一致/);
  expect(() =>
    session.acceptSaved({
      projectId: "another-project",
      document: parseScadaDocument(other),
      savedAt: "2026-11-10T08:00:00.000Z",
      revision: 1,
    }),
  ).toThrow(/工程 ID 不一致/);
});
