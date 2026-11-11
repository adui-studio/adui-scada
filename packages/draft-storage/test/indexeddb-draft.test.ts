import { expect, test } from "vite-plus/test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { parseScadaDocument, waterTreatmentDemoDocument } from "@adui/scada-core";
import { localDraftKey, saveLocalDraft } from "@adui/scada-core";
import type { LocalDraftStorage } from "@adui/scada-core";
import { DexieDraftRepository, InvalidLegacyDraftError } from "../src/index.ts";

let nextDatabase = 0;
class MemoryStorage implements LocalDraftStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function repository(name?: string, legacyStorage?: LocalDraftStorage) {
  return new DexieDraftRepository({
    name: name ?? `scada-test-${++nextDatabase}`,
    indexedDB,
    IDBKeyRange,
    legacyStorage,
    broadcast: false,
  });
}

function document() {
  return parseScadaDocument(waterTreatmentDemoDocument);
}

test("空数据库读取为空，首次保存生成单调递增的版本号", async () => {
  const db = repository();
  try {
    expect(await db.get("water-demo")).toBeNull();
    const first = await db.save(document(), null);
    expect(first.revision).toBe(1);
    expect(first.document.schemaVersion).toBe("0.2.0");
    const edited = document();
    edited.pages[0]!.nodes[0]!.transform.x += 1;
    const second = await db.save(edited, 1);
    expect(second.revision).toBe(2);
    expect((await db.get("water-demo"))?.document.pages[0]?.nodes[0]?.transform.x).toBe(
      edited.pages[0]?.nodes[0]?.transform.x,
    );
  } finally {
    db.close();
  }
});

test("两个数据库实例并发创建同一草稿，只允许一个事务成功", async () => {
  const name = `scada-conflict-${++nextDatabase}`;
  const first = repository(name);
  const second = repository(name);
  try {
    const results = await Promise.allSettled([
      first.save(document(), null),
      second.save(document(), null),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await first.get("water-demo"))?.revision).toBe(1);
  } finally {
    first.close();
    second.close();
  }
});

test("已有草稿被其他页面更新后，旧版本写入被拒绝且内容不丢失", async () => {
  const name = `scada-stale-${++nextDatabase}`;
  const first = repository(name);
  const second = repository(name);
  try {
    await first.save(document(), null);
    const newer = document();
    newer.pages[0]!.nodes[0]!.transform.x += 7;
    await second.save(newer, 1);
    await expect(first.save(document(), 1)).rejects.toThrow(/其他页面修改了草稿/);
    expect((await first.get("water-demo"))?.revision).toBe(2);
    expect((await first.get("water-demo"))?.document.pages[0]?.nodes[0]?.transform.x).toBe(
      newer.pages[0]?.nodes[0]?.transform.x,
    );
  } finally {
    first.close();
    second.close();
  }
});

test("清除草稿遵循修订号条件，不能删除另一页面的新版本", async () => {
  const db = repository();
  try {
    await db.save(document(), null);
    await expect(db.remove("water-demo", null)).rejects.toThrow(/拒绝清除/);
    expect((await db.get("water-demo"))?.revision).toBe(1);
    await db.remove("water-demo", 1);
    expect(await db.get("water-demo")).toBeNull();
  } finally {
    db.close();
  }
});

test("草稿删除后重建仍递增修订号，阻止旧标签页 ABA 覆盖", async () => {
  const name = `scada-recreate-${++nextDatabase}`;
  const oldTab = repository(name);
  const newTab = repository(name);
  try {
    const original = await oldTab.save(document(), null);
    expect(original.revision).toBe(1);
    await newTab.remove("water-demo", 1);
    const replacement = document();
    replacement.pages[0]!.nodes[0]!.transform.x += 3;
    const created = await newTab.save(replacement, null);
    expect(created.revision).toBe(2);
    await expect(oldTab.save(document(), 1)).rejects.toThrow(/其他页面修改了草稿/);
    await expect(oldTab.remove("water-demo", 1)).rejects.toThrow(/拒绝清除/);
    expect((await oldTab.get("water-demo"))?.revision).toBe(2);
    expect((await oldTab.get("water-demo"))?.document.pages[0]?.nodes[0]?.transform.x).toBe(
      replacement.pages[0]?.nodes[0]?.transform.x,
    );
  } finally {
    oldTab.close();
    newTab.close();
  }
});

test("历史 localStorage 草稿校验并迁移到 IndexedDB 后才清除旧记录", async () => {
  const old = new MemoryStorage();
  const source = document();
  source.pages[0]!.nodes[1]!.groupId = "group-1";
  source.pages[0]!.nodes[3]!.groupId = "group-1";
  saveLocalDraft(old, source, new Date("2026-11-10T02:00:00.000Z"));
  const db = repository(undefined, old);
  try {
    const saved = await db.get("water-demo");
    expect(saved?.revision).toBe(1);
    expect(saved?.document.pages[0]?.nodes[1]?.groupId).toBe("group-1");
    expect(saved?.document.pages[0]?.nodes[1]?.bindings.level?.tagId).toBe("water.level");
    expect(old.getItem(localDraftKey("water-demo"))).toBeNull();
  } finally {
    db.close();
  }
});

test("历史 JSON 已损坏时迁移失败，不删除原始草稿", async () => {
  const old = new MemoryStorage();
  const key = localDraftKey("water-demo");
  old.setItem(key, "{损坏");
  const db = repository(undefined, old);
  try {
    await expect(db.get("water-demo")).rejects.toThrow(InvalidLegacyDraftError);
    await expect(db.get("water-demo")).rejects.toThrow(/JSON 已损坏/);
    expect(old.getItem(key)).toBe("{损坏");
  } finally {
    db.close();
  }
});

test("IndexedDB 草稿优先于历史备份，清除后不会重新迁移旧内容", async () => {
  const old = new MemoryStorage();
  saveLocalDraft(old, document(), new Date("2026-11-10T02:00:00.000Z"));
  const db = repository(undefined, old);
  try {
    const newer = document();
    newer.pages[0]!.nodes[0]!.transform.x += 9;
    await db.save(newer, null);
    expect((await db.get("water-demo"))?.document.pages[0]?.nodes[0]?.transform.x).toBe(
      newer.pages[0]?.nodes[0]?.transform.x,
    );
    await db.remove("water-demo", 1);
    expect(await db.get("water-demo")).toBeNull();
    expect(old.getItem(localDraftKey("water-demo"))).toBeNull();
  } finally {
    db.close();
  }
});

test("旧存储清理失败时保留迁移标记，防止已删除草稿复活", async () => {
  const old = new MemoryStorage();
  saveLocalDraft(old, document(), new Date("2026-11-10T02:00:00.000Z"));
  const storage: LocalDraftStorage = {
    getItem: (key) => old.getItem(key),
    setItem: (key, value) => old.setItem(key, value),
    removeItem: () => {
      throw new TypeError("模拟历史存储拒绝删除");
    },
  };
  const db = repository(undefined, storage);
  try {
    expect((await db.get("water-demo"))?.revision).toBe(1);
    await expect(db.remove("water-demo", 1)).rejects.toThrow(/历史|旧浏览器/);
    expect(await db.get("water-demo")).toBeNull();
    expect(old.getItem(localDraftKey("water-demo"))).not.toBeNull();
  } finally {
    db.close();
  }
});

test("不支持的工程版本无法通过 IndexedDB 保存写入", async () => {
  const db = repository();
  try {
    await expect(db.save({ ...document(), schemaVersion: "0.1.0" }, null)).rejects.toThrow(
      /不支持的版本/,
    );
    expect(await db.get("water-demo")).toBeNull();
  } finally {
    db.close();
  }
});

test("损坏的历史草稿可以由用户明确清除，且不会绕过数据库版本校验", async () => {
  const old = new MemoryStorage();
  const key = localDraftKey("water-demo");
  old.setItem(key, "{损坏");
  const db = repository(undefined, old);
  try {
    await expect(db.get("water-demo")).rejects.toThrow(InvalidLegacyDraftError);
    await expect(db.get("water-demo")).rejects.toThrow(/JSON 已损坏/);
    expect(old.getItem(key)).toBe("{损坏");
    await db.remove("water-demo", null);
    expect(old.getItem(key)).toBeNull();
    expect(await db.get("water-demo")).toBeNull();
  } finally {
    db.close();
  }
});

test("旧存储权限故障不能误判为用户可清理的损坏草稿", async () => {
  const denied: LocalDraftStorage = {
    getItem: () => {
      throw new Error("模拟读取权限被拒绝");
    },
    setItem: () => {
      throw new Error("模拟写入权限被拒绝");
    },
    removeItem: () => {
      throw new Error("模拟删除权限被拒绝");
    },
  };
  const db = repository(undefined, denied);
  try {
    const error: unknown = await db.get("water-demo").then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(InvalidLegacyDraftError);
    expect(error).toHaveProperty("message", expect.stringMatching(/读取失败/));
  } finally {
    db.close();
  }
});

test("两个标签页从相同已有修订号同时写入时，只允许一次成功提交", async () => {
  const name = `scada-existing-race-${++nextDatabase}`;
  const first = repository(name);
  const second = repository(name);
  try {
    const initial = await first.save(document(), null);
    const left = document();
    left.pages[0]!.nodes[0]!.transform.x += 2;
    const right = document();
    right.pages[0]!.nodes[0]!.transform.x += 6;
    const outcomes = await Promise.allSettled([
      first.save(left, initial.revision),
      second.save(right, initial.revision),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winner = outcomes.find((result) => result.status === "fulfilled");
    if (!winner || winner.status !== "fulfilled") {
      throw new TypeError("并发保存没有成功写入的记录");
    }
    const current = await second.get("water-demo");
    expect(current?.revision).toBe(2);
    expect(current?.document).toEqual(winner.value.document);
  } finally {
    first.close();
    second.close();
  }
});

test("保存与清除竞争时只允许一个事务成功，清除后的修订号不倒退", async () => {
  const name = `scada-remove-race-${++nextDatabase}`;
  const first = repository(name);
  const second = repository(name);
  try {
    await first.save(document(), null);
    const editedDocument = document();
    editedDocument.pages[0]!.nodes[0]!.transform.x += 13;
    const outcomes = await Promise.allSettled([
      first.save(editedDocument, 1),
      second.remove("water-demo", 1),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);

    const current = await first.get("water-demo");
    if (outcomes[0]!.status === "fulfilled") {
      expect(current?.revision).toBe(2);
      expect(current?.document).toEqual(editedDocument);
    } else {
      expect(outcomes[1]!.status).toBe("fulfilled");
      expect(current).toBeNull();
      const recreated = await second.save(document(), null);
      expect(recreated.revision).toBe(2);
    }
  } finally {
    first.close();
    second.close();
  }
});
