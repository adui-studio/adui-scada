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
  const result = await Promise.all([
    session.saveIfDirty(edited(2)),
    session.saveIfDirty(edited(3)),
  ]);
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

test("停止自动保存时必须等待已经开始的事务完成", async () => {
  let releaseWrite: (() => void) | undefined;
  let notifyStarted: (() => void) | undefined;
  const writing = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  class SlowRepository extends MemoryRepository {
    override async save(source: unknown, revision: number | null): Promise<DraftRecord> {
      notifyStarted?.();
      await writing;
      return super.save(source, revision);
    }
  }
  const repo = new SlowRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  const ongoing = session.saveIfDirty(edited(4));
  await started;
  let stopped = false;
  const stopping = session.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  releaseWrite?.();
  await Promise.all([ongoing, stopping]);
  expect(stopped).toBe(true);
  expect(repo.writes).toBe(1);
  expect(await session.saveIfDirty(edited(9))).toBeNull();
  expect(repo.record?.document).toEqual(edited(4));
});

test("存储写入失败后停止自动保存不悬挂且不产生额外写入", async () => {
  class FailingRepository extends MemoryRepository {
    override async save(_source: unknown, _revision: number | null): Promise<DraftRecord> {
      throw new TypeError("模拟 IndexedDB 草稿写入失败");
    }
  }
  const repo = new FailingRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  await expect(session.saveIfDirty(edited(3))).rejects.toThrow(/模拟 IndexedDB 草稿写入失败/);
  await session.stop();
  expect(await session.saveIfDirty(edited(7))).toBeNull();
  expect(repo.record).toBeNull();
  expect(repo.writes).toBe(0);
});

test("停止自动保存后，已在执行的写入完成而排队中的新写入被取消", async () => {
  let releaseWrite: (() => void) | undefined;
  let notifyStarted: (() => void) | undefined;
  const writing = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  class SlowRepository extends MemoryRepository {
    override async save(source: unknown, revision: number | null): Promise<DraftRecord> {
      notifyStarted?.();
      await writing;
      return super.save(source, revision);
    }
  }

  const repo = new SlowRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  const first = session.saveIfDirty(edited(1));
  await started;
  const queued = session.saveIfDirty(edited(2));
  const stopping = session.stop();
  releaseWrite?.();

  expect((await first)?.revision).toBe(1);
  expect(await queued).toBeNull();
  await stopping;
  expect(repo.writes).toBe(1);
  expect(repo.record?.document).toEqual(edited(1));
  expect(await session.saveIfDirty(edited(3))).toBeNull();
});

test("短暂写入失败不会阻塞队列，下一次保存可以使用原修订号重试", async () => {
  class FlakyRepository extends MemoryRepository {
    private failNext = true;

    override async save(source: unknown, revision: number | null): Promise<DraftRecord> {
      if (this.failNext) {
        this.failNext = false;
        throw new TypeError("模拟 IndexedDB 临时写入失败");
      }
      return super.save(source, revision);
    }
  }

  const repo = new FlakyRepository();
  const session = await DraftAutoSaveSession.open(repo, document());
  await expect(session.saveIfDirty(edited(4))).rejects.toThrow(/临时写入失败/);
  expect(session.currentRevision).toBeNull();
  expect(repo.writes).toBe(0);
  expect((await session.saveIfDirty(edited(4)))?.revision).toBe(1);
  expect(repo.record?.document).toEqual(edited(4));
  await session.stop();
});
