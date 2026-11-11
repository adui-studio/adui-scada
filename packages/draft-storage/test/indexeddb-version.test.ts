import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { expect, test } from "vite-plus/test";
import { parseScadaDocument, waterTreatmentDemoDocument } from "@adui/scada-core";
import {
  DexieProjectVersionRepository,
  ProjectVersionConflictError,
} from "../src/version-repository.ts";

let nextDatabase = 0;
const newName = () => `scada-version-test-${++nextDatabase}`;
const createdAt = "2026-11-11T08:00:00.000Z";

function repository(name = newName()) {
  return new DexieProjectVersionRepository({ name, indexedDB, IDBKeyRange });
}

function document(projectId = "water-demo") {
  const value = parseScadaDocument(waterTreatmentDemoDocument);
  value.projectId = projectId;
  return value;
}

test("首次追加历史版本分配修订号 1 并保存完整快照", async () => {
  const db = repository();
  try {
    expect(await db.getHeadRevision("water-demo")).toBeNull();
    expect(await db.list("water-demo")).toEqual([]);
    const first = await db.append(document(), null, createdAt);
    expect(first.revision).toBe(1);
    expect(first.createdAt).toBe(createdAt);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await db.getHeadRevision("water-demo")).toBe(1);
    expect(await db.get("water-demo", 1)).toEqual(first);
  } finally {
    db.close();
  }
});

test("追加新版本只增加修订号，不覆盖旧版本内容", async () => {
  const db = repository();
  try {
    const first = await db.append(document(), null, createdAt);
    const edited = document();
    edited.pages[0]!.nodes[0]!.transform.x += 19;
    const second = await db.append(edited, 1, "2026-11-11T08:01:00.000Z");
    expect(second.revision).toBe(2);
    expect(second.document.pages[0]?.nodes[0]?.transform.x).toBe(
      first.document.pages[0]!.nodes[0]!.transform.x + 19,
    );
    expect((await db.get("water-demo", 1))?.contentHash).toBe(first.contentHash);
    expect((await db.get("water-demo", 1))?.document).toEqual(first.document);
    expect(await db.getHeadRevision("water-demo")).toBe(2);
  } finally {
    db.close();
  }
});

test("关闭并重新打开同名 IndexedDB 后历史版本与当前修订号仍存在", async () => {
  const name = newName();
  const first = repository(name);
  const original = await first.append(document(), null, createdAt);
  first.close();
  const reopened = repository(name);
  try {
    expect(await reopened.getHeadRevision("water-demo")).toBe(1);
    expect(await reopened.get("water-demo", 1)).toEqual(original);
    expect((await reopened.append(document(), 1)).revision).toBe(2);
  } finally {
    reopened.close();
  }
});

test("不同工程使用独立的修订号和历史列表", async () => {
  const db = repository();
  try {
    await db.append(document("project-a"), null);
    await db.append(document("project-a"), 1);
    await db.append(document("project-b"), null);
    expect(await db.getHeadRevision("project-a")).toBe(2);
    expect(await db.getHeadRevision("project-b")).toBe(1);
    expect((await db.list("project-a")).map((item) => item.revision)).toEqual([2, 1]);
    expect((await db.list("project-b")).map((item) => item.revision)).toEqual([1]);
    expect(await db.get("project-a", 3)).toBeNull();
    expect(await db.get("project-b", 2)).toBeNull();
  } finally {
    db.close();
  }
});

test("版本列表按修订号倒序分页，游标不重复返回边界版本", async () => {
  const db = repository();
  try {
    for (let index = 0; index < 5; index += 1) {
      await db.append(document(), index === 0 ? null : index);
    }
    const first = await db.list("water-demo", { limit: 2 });
    const second = await db.list("water-demo", { limit: 2, beforeRevision: 4 });
    const third = await db.list("water-demo", { limit: 2, beforeRevision: 2 });
    expect(first.map((item) => item.revision)).toEqual([5, 4]);
    expect(second.map((item) => item.revision)).toEqual([3, 2]);
    expect(third.map((item) => item.revision)).toEqual([1]);
    expect(
      (await db.list("water-demo", { limit: 2, beforeRevision: 5 })).map((item) => item.revision),
    ).toEqual([4, 3]);
    expect(await db.list("water-demo", { beforeRevision: 1 })).toEqual([]);
    expect(first[0]).toEqual({
      projectId: "water-demo",
      revision: 5,
      createdAt: expect.any(String),
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect("document" in first[0]!).toBe(false);
  } finally {
    db.close();
  }
});

test("两个实例同时创建同一个工程历史时只能有一个成功", async () => {
  const name = newName();
  const left = repository(name);
  const right = repository(name);
  try {
    const results = await Promise.allSettled([
      left.append(document(), null),
      right.append(document(), null),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      results.some(
        (result) =>
          result.status === "rejected" && result.reason instanceof ProjectVersionConflictError,
      ),
    ).toBe(true);
    expect(await left.getHeadRevision("water-demo")).toBe(1);
    expect((await right.list("water-demo")).map((item) => item.revision)).toEqual([1]);
  } finally {
    left.close();
    right.close();
  }
});

test("两个实例从相同修订号并发追加，只允许一个成功且旧版保留", async () => {
  const name = newName();
  const left = repository(name);
  const right = repository(name);
  try {
    const first = await left.append(document(), null);
    const changed = document();
    changed.pages[0]!.nodes[0]!.transform.x += 2;
    const results = await Promise.allSettled([
      left.append(changed, 1),
      right.append(document(), 1),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await right.getHeadRevision("water-demo")).toBe(2);
    expect(await right.get("water-demo", 1)).toEqual(first);
    expect((await left.list("water-demo")).map((item) => item.revision)).toEqual([2, 1]);
  } finally {
    left.close();
    right.close();
  }
});

test("过期修订号不得追加或覆盖历史版本", async () => {
  const db = repository();
  try {
    const first = await db.append(document(), null);
    await db.append(document(), 1);
    await expect(db.append(document(), 1)).rejects.toThrow(ProjectVersionConflictError);
    await expect(db.append(document(), null)).rejects.toThrow(ProjectVersionConflictError);
    expect(await db.get("water-demo", 1)).toEqual(first);
    expect(await db.getHeadRevision("water-demo")).toBe(2);
  } finally {
    db.close();
  }
});

test("非法工程、版本参数和创建时间不得写入历史索引", async () => {
  const db = repository();
  try {
    await expect(db.append({ ...document(), schemaVersion: "0.1.0" }, null)).rejects.toThrow(
      /不支持的版本/,
    );
    await expect(db.append(document(), 0)).rejects.toThrow(/修订号/);
    await expect(db.append(document(), null, "非法时间")).rejects.toThrow(/创建时间/);
    expect(await db.getHeadRevision("water-demo")).toBeNull();
    expect(await db.list("water-demo")).toEqual([]);
  } finally {
    db.close();
  }
});

test("非法工程 ID、历史修订号和分页参数必须拒绝", async () => {
  const db = repository();
  try {
    await expect(db.getHeadRevision("../other")).rejects.toThrow(/工程 ID/);
    await expect(db.get("water-demo", 0)).rejects.toThrow(/修订号/);
    await expect(db.list("water-demo", { limit: 0 })).rejects.toThrow(/每页数量/);
    await expect(db.list("water-demo", { limit: 101 })).rejects.toThrow(/每页数量/);
    await expect(db.list("water-demo", { beforeRevision: 0 })).rejects.toThrow(/修订号/);
    await expect(db.append(document(), Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow(/修订号/);
  } finally {
    db.close();
  }
});

test("读取历史版本返回深度冻结的独立副本，源工程变化不影响历史", async () => {
  const db = repository();
  try {
    const source = document();
    const original = await db.append(source, null);
    source.pages[0]!.nodes[0]!.props.title = "源文档已改变";
    const loaded = await db.get("water-demo", 1);
    expect(loaded).toEqual(original);
    expect(loaded).not.toBe(original);
    expect(loaded?.document).not.toBe(original.document);
    expect(Object.isFrozen(loaded?.document.pages[0]?.nodes[0]?.props)).toBe(true);
    expect(() => {
      (loaded!.document.pages[0]!.nodes[0]!.props as Record<string, unknown>).title = "覆盖历史";
    }).toThrow(TypeError);
  } finally {
    db.close();
  }
});

test("数据库中的历史快照被篡改时，读取和列表都拒绝内容", async () => {
  const name = newName();
  const db = repository(name);
  const snap = await db.append(document(), null);
  const raw = new Dexie(name, { indexedDB, IDBKeyRange });
  raw.version(1).stores({ heads: "projectId", versions: "[projectId+revision],projectId" });
  try {
    const tampered = JSON.parse(JSON.stringify(snap));
    tampered.document.pages[0].nodes[0].transform.x += 10;
    await raw.table("versions").put(tampered);
    await expect(db.get("water-demo", 1)).rejects.toThrow(/摘要不匹配/);
    await expect(db.list("water-demo")).rejects.toThrow(/摘要不匹配/);
    await expect(db.getHeadRevision("water-demo")).rejects.toThrow(/摘要不匹配/);
  } finally {
    raw.close();
    db.close();
  }
});

test("历史索引缺失快照时明确报错，不能把损坏数据库当作空库", async () => {
  const name = newName();
  const db = repository(name);
  await db.append(document(), null);
  const raw = new Dexie(name, { indexedDB, IDBKeyRange });
  raw.version(1).stores({ heads: "projectId", versions: "[projectId+revision],projectId" });
  try {
    await raw.table("versions").delete(["water-demo", 1]);
    await expect(db.getHeadRevision("water-demo")).rejects.toThrow(/不存在的快照/);
  } finally {
    raw.close();
    db.close();
  }
});
