import { expect, test } from "vite-plus/test";
import { TagHistoryBuffer } from "../src/tag-history.ts";
import { TagHistoryArchiveWriter } from "../src/tag-history-persistence.ts";
import type {
  TagHistoryPersistencePort,
  TagHistoryPersistenceReceipt,
  TagHistoryPersistenceRequest,
} from "../src/tag-history-persistence.ts";
import type { TagValue } from "../src/tag-store.ts";

const scope = { projectId: "plant.a", streamId: "writer.1" };
const start = Date.parse("2026-11-24T00:00:00.000Z");
const query = { tagId: "water.level", startMs: start, endMs: start + 1000, maxPoints: 10 };

function sample(offset: number): TagValue {
  return {
    tagId: query.tagId,
    value: offset,
    quality: "GOOD",
    sourceTimestamp: null,
    serverTimestamp: new Date(start + offset).toISOString(),
    sequence: 1,
  };
}

function receipt(request: TagHistoryPersistenceRequest): TagHistoryPersistenceReceipt {
  return {
    formatVersion: request.formatVersion,
    projectId: request.projectId,
    streamId: request.streamId,
    batchSequence: request.batchSequence,
    recordCount: request.records.length,
    status: "COMMITTED",
  };
}

function add(buffer: TagHistoryBuffer, ...offsets: number[]): void {
  buffer.append({ kind: "sample", values: offsets.map(sample) });
}

test("空缓冲及无效批次上限不会调用持久化端口", async () => {
  const buffer = new TagHistoryBuffer(2);
  const requests: TagHistoryPersistenceRequest[] = [];
  const writer = new TagHistoryArchiveWriter(buffer, scope, {
    persist(request) {
      requests.push(request);
      return Promise.resolve(receipt(request));
    },
  });
  expect(await writer.flush(1)).toBe(0);
  await expect(writer.flush(0)).rejects.toThrow(/批次上限无效/);
  expect(requests).toHaveLength(0);
});

test("确认成功才移除前缀，下一批使用递增序号且保留工程范围", async () => {
  const buffer = new TagHistoryBuffer(3);
  add(buffer, 1, 2, 3);
  const requests: TagHistoryPersistenceRequest[] = [];
  const options = { ...scope };
  const writer = new TagHistoryArchiveWriter(buffer, options, {
    persist(request) {
      requests.push(request);
      return Promise.resolve(receipt(request));
    },
  });
  options.projectId = "plant.b";
  expect(await writer.flush(2)).toBe(2);
  expect(buffer.query(query).map((point) => point.value)).toEqual([3]);
  expect(await writer.flush(2)).toBe(1);
  expect(requests.map((request) => request.batchSequence)).toEqual([1, 2]);
  expect(requests.map((request) => request.projectId)).toEqual([scope.projectId, scope.projectId]);
  expect(requests[0].streamId).toBe(scope.streamId);
  expect(Object.isFrozen(requests[0])).toBe(true);
  expect(Object.isFrozen(requests[0].records)).toBe(true);
  expect(buffer.size).toBe(0);
});

test("模拟提交成功但回执丢失，重试复用同一请求并接受已提交回执", async () => {
  const buffer = new TagHistoryBuffer(3);
  add(buffer, 1);
  const requests: TagHistoryPersistenceRequest[] = [];
  const committed: TagHistoryPersistenceRequest[] = [];
  const writer = new TagHistoryArchiveWriter(buffer, scope, {
    persist(request) {
      requests.push(request);
      if (committed.length === 0) {
        committed.push(request);
        return Promise.reject(new Error("模拟提交后回执丢失"));
      }
      return Promise.resolve({ ...receipt(request), status: "ALREADY_COMMITTED" });
    },
  });
  await expect(writer.flush(1)).rejects.toThrow(/回执丢失/);
  expect(buffer.size).toBe(1);
  add(buffer, 2);
  expect(await writer.flush(2)).toBe(1);
  expect(requests[1]).toBe(requests[0]);
  expect(committed).toHaveLength(1);
  expect(buffer.query(query).map((point) => point.value)).toEqual([2]);
});

test("错误工程、写入流、序号、版本、数量、状态与空回执均拒绝确认", async () => {
  const buffer = new TagHistoryBuffer(2);
  add(buffer, 1);
  const invalid: readonly object[] = [
    { projectId: "plant.b" },
    { streamId: "writer.2" },
    { batchSequence: 2 },
    { formatVersion: 2 },
    { recordCount: 0 },
    { status: "PARTIAL" },
  ];
  const requests: TagHistoryPersistenceRequest[] = [];
  const writer = new TagHistoryArchiveWriter(buffer, scope, {
    persist(request) {
      requests.push(request);
      const index = requests.length - 1;
      const response = index === invalid.length ? null : { ...receipt(request), ...invalid[index] };
      return Promise.resolve(response as TagHistoryPersistenceReceipt);
    },
  });
  for (let index = 0; index <= invalid.length; index += 1) {
    await expect(writer.flush(1)).rejects.toThrow(/回执无效或不匹配/);
    expect(buffer.size).toBe(1);
  }
  expect(await writer.flush(1)).toBe(1);
  expect(requests.every((request) => request === requests[0])).toBe(true);
  expect(buffer.size).toBe(0);
});

test("同步端口异常释放并发锁但不推进批次序号", async () => {
  const buffer = new TagHistoryBuffer(2);
  add(buffer, 1);
  const requests: TagHistoryPersistenceRequest[] = [];
  const writer = new TagHistoryArchiveWriter(buffer, scope, {
    persist(request) {
      requests.push(request);
      if (requests.length === 1) throw new Error("模拟写入异常");
      return Promise.resolve(receipt(request));
    },
  });
  await expect(writer.flush(1)).rejects.toThrow(/写入异常/);
  expect(buffer.size).toBe(1);
  expect(await writer.flush(1)).toBe(1);
  expect(requests[1]).toBe(requests[0]);
  expect(requests[1].batchSequence).toBe(1);
});

test("异步提交期间拒绝并发提交，尾部新采样不被确认删除", async () => {
  const buffer = new TagHistoryBuffer(2);
  add(buffer, 1);
  const requests: TagHistoryPersistenceRequest[] = [];
  const writer = new TagHistoryArchiveWriter(buffer, scope, {
    persist(request) {
      requests.push(request);
      return Promise.resolve(receipt(request));
    },
  });
  const first = writer.flush(1);
  const concurrent = writer.flush(1);
  add(buffer, 2);
  await expect(concurrent).rejects.toThrow(/不能并发提交/);
  expect(await first).toBe(1);
  expect(requests).toHaveLength(1);
  expect(buffer.query(query).map((point) => point.value)).toEqual([2]);
});

test("同一缓冲区只允许绑定一个写入者，非法范围不会提前占用", () => {
  const buffer = new TagHistoryBuffer(2);
  const storage: TagHistoryPersistencePort = {
    persist: (request) => Promise.resolve(receipt(request)),
  };
  expect(
    () => new TagHistoryArchiveWriter(buffer, { ...scope, streamId: "../bad" }, storage),
  ).toThrow(/标识无效/);
  expect(() => new TagHistoryArchiveWriter(buffer, { ...scope, projectId: "" }, storage)).toThrow(
    /标识无效/,
  );
  const writer = new TagHistoryArchiveWriter(buffer, scope, storage);
  expect(writer).toBeInstanceOf(TagHistoryArchiveWriter);
  expect(
    () => new TagHistoryArchiveWriter(buffer, { ...scope, streamId: "writer.2" }, storage),
  ).toThrow(/已绑定归档写入者/);
});

test("不同工程及写入流使用独立的复合键空间", async () => {
  const requests: TagHistoryPersistenceRequest[] = [];
  const storage: TagHistoryPersistencePort = {
    persist(request) {
      requests.push(request);
      return Promise.resolve(receipt(request));
    },
  };
  const scopes = [scope, { ...scope, projectId: "plant.b" }, { ...scope, streamId: "writer.2" }];
  for (const current of scopes) {
    const buffer = new TagHistoryBuffer(1);
    add(buffer, 1);
    const writer = new TagHistoryArchiveWriter(buffer, current, storage);
    expect(await writer.flush(1)).toBe(1);
  }
  const keys = requests.map(({ projectId, streamId, batchSequence }) => [
    projectId,
    streamId,
    batchSequence,
  ]);
  expect(keys).toEqual([
    ["plant.a", "writer.1", 1],
    ["plant.b", "writer.1", 1],
    ["plant.a", "writer.2", 1],
  ]);
});

test("待确认批次遭外部改变时拒绝再次提交，不删除后续记录", async () => {
  const buffer = new TagHistoryBuffer(3);
  add(buffer, 1, 2);
  const requests: TagHistoryPersistenceRequest[] = [];
  const writer = new TagHistoryArchiveWriter(buffer, scope, {
    persist(request) {
      requests.push(request);
      return Promise.reject(new Error("模拟持久化失败"));
    },
  });
  await expect(writer.flush(1)).rejects.toThrow(/持久化失败/);
  const batch = buffer.prepareArchive(1);
  if (!batch) throw new Error("测试预期存在待归档批次");
  buffer.confirmArchive(batch);
  await expect(writer.flush(1)).rejects.toThrow(/批次已被外部改变/);
  expect(requests).toHaveLength(1);
  expect(buffer.query(query).map((point) => point.value)).toEqual([2]);
});
