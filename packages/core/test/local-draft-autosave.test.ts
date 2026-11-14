import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import { parseScadaDocument } from "../src/document.ts";
import {
  LocalDraftAutoSaveSession,
  LOCAL_DRAFT_AUTO_SAVE_DELAY_MS,
  localDraftKey,
  readLocalDraft,
  saveLocalDraft,
} from "../src/local-draft.ts";
import type { LocalDraftStorage } from "../src/local-draft.ts";

class MemoryStorage implements LocalDraftStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const time = new Date("2026-11-10T07:00:00.000Z");

function document() {
  return parseScadaDocument(waterTreatmentDemoDocument);
}

function moved(x = 1) {
  const next = document();
  next.pages[0]!.nodes[0]!.transform.x += x;
  return next;
}

test("开启自动保存会话时将旧 Schema 草稿迁移并写回当前版本", () => {
  const storage = new MemoryStorage();
  const legacy = document() as unknown as Record<string, unknown>;
  legacy.schemaVersion = "0.2.0";
  delete legacy.tags;
  storage.setItem(
    localDraftKey("water-demo"),
    JSON.stringify({
      formatVersion: 1,
      savedAt: time.toISOString(),
      document: legacy,
    }),
  );
  const session = new LocalDraftAutoSaveSession(storage, document());
  const raw = JSON.parse(storage.getItem(localDraftKey("water-demo"))!);
  expect(session.hasExistingDraft).toBe(true);
  expect(raw.document.schemaVersion).toBe("0.3.0");
  expect(raw.document.tags[0].dataType).toBe("unknown");
  expect(readLocalDraft(storage, "water-demo")?.migratedFrom).toBeUndefined();
  expect(session.isDirty(document())).toBe(false);
});

test("初始工程不脏，未修改时不创建任何草稿", () => {
  expect(LOCAL_DRAFT_AUTO_SAVE_DELAY_MS).toBe(1000);
  const storage = new MemoryStorage();
  const session = new LocalDraftAutoSaveSession(storage, document());
  expect(session.hasExistingDraft).toBe(false);
  expect(session.isDirty(document())).toBe(false);
  expect(session.saveIfDirty(document(), time)).toBeNull();
  expect(storage.items.size).toBe(0);
});

test("编辑工程后保存一次，重复同内容不再写入", () => {
  const storage = new MemoryStorage();
  const session = new LocalDraftAutoSaveSession(storage, document());
  const edited = moved();
  expect(session.isDirty(edited)).toBe(true);
  expect(session.saveIfDirty(edited, time)?.savedAt).toBe(time.toISOString());
  expect(session.isDirty(edited)).toBe(false);
  const before = storage.getItem(localDraftKey("water-demo"));
  expect(readLocalDraft(storage, "water-demo")?.document.pages[0]?.nodes[0]?.transform.x).toBe(
    edited.pages[0]?.nodes[0]?.transform.x,
  );
  expect(session.saveIfDirty(edited, new Date("2026-11-10T07:00:05Z"))).toBeNull();
  expect(storage.getItem(localDraftKey("water-demo"))).toBe(before);
});

test("编辑后撤销到原工程，不触发自动保存", () => {
  const storage = new MemoryStorage();
  const session = new LocalDraftAutoSaveSession(storage, document());
  expect(session.isDirty(moved())).toBe(true);
  expect(session.isDirty(document())).toBe(false);
  expect(session.saveIfDirty(document(), time)).toBeNull();
  expect(storage.items.size).toBe(0);
});

test("连续自动保存保持 Tag、组合及工程版本", () => {
  const storage = new MemoryStorage();
  const session = new LocalDraftAutoSaveSession(storage, document());
  const first = moved();
  first.pages[0]!.nodes[1]!.groupId = "group-1";
  first.pages[0]!.nodes[3]!.groupId = "group-1";
  expect(session.saveIfDirty(first, time)).not.toBeNull();
  first.pages[0]!.nodes[0]!.transform.y += 1;
  expect(session.saveIfDirty(first, new Date("2026-11-10T07:01:00Z"))).not.toBeNull();
  const result = readLocalDraft(storage, "water-demo")!.document;
  expect(result.schemaVersion).toBe("0.3.0");
  expect(result.pages[0]?.nodes[1]?.groupId).toBe("group-1");
  expect(result.pages[0]?.nodes[3]?.groupId).toBe("group-1");
  expect(result.pages[0]?.nodes[1]?.bindings.level?.tagId).toBe("water.level");
});

test("会话开启时存在合法草稿，保留原始记录用于冲突检查", () => {
  const storage = new MemoryStorage();
  saveLocalDraft(storage, document(), time);
  const session = new LocalDraftAutoSaveSession(storage, document());
  expect(session.hasExistingDraft).toBe(true);
  session.assertStorageUnchanged();
  expect(session.saveIfDirty(moved(), new Date("2026-11-10T07:02:00Z"))).not.toBeNull();
});

test("其他标签页修改草稿后，自动保存拒绝覆盖", () => {
  const storage = new MemoryStorage();
  saveLocalDraft(storage, document(), time);
  const session = new LocalDraftAutoSaveSession(storage, document());
  const otherTab = moved(5);
  saveLocalDraft(storage, otherTab, new Date("2026-11-10T07:03:00Z"));
  const before = storage.getItem(localDraftKey("water-demo"));
  expect(() => session.assertStorageUnchanged()).toThrow(/其他页面修改或清除了草稿/);
  expect(() => session.saveIfDirty(moved(), time)).toThrow(/自动保存已暂停/);
  expect(storage.getItem(localDraftKey("water-demo"))).toBe(before);
});

test("其他标签页清除草稿后，自动保存不重新生成已清除记录", () => {
  const storage = new MemoryStorage();
  saveLocalDraft(storage, document(), time);
  const session = new LocalDraftAutoSaveSession(storage, document());
  storage.removeItem(localDraftKey("water-demo"));
  expect(() => session.saveIfDirty(moved(), time)).toThrow(/自动保存已暂停/);
  expect(storage.getItem(localDraftKey("water-demo"))).toBeNull();
});

test("原草稿内容损坏时无法开启自动保存，也不会删除记录", () => {
  const storage = new MemoryStorage();
  const key = localDraftKey("water-demo");
  storage.setItem(key, "{invalid");
  expect(() => new LocalDraftAutoSaveSession(storage, document())).toThrow(/JSON 已损坏/);
  expect(storage.getItem(key)).toBe("{invalid");
});

test("不允许向其他工程 ID 自动保存", () => {
  const storage = new MemoryStorage();
  const session = new LocalDraftAutoSaveSession(storage, document());
  const foreign = { ...document(), projectId: "other-demo" };
  expect(() => session.isDirty(foreign)).toThrow(/工程 ID 不一致/);
  expect(() => session.saveIfDirty(foreign, time)).toThrow(/工程 ID 不一致/);
  expect(storage.items.size).toBe(0);
});

test("浏览器写入失败后不更新基线，稍后仍能重新尝试", () => {
  const storage = new MemoryStorage();
  let denied = true;
  const adapter: LocalDraftStorage = {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => {
      if (denied) throw new TypeError("模拟存储权限不足");
      storage.setItem(key, value);
    },
    removeItem: (key) => storage.removeItem(key),
  };
  const session = new LocalDraftAutoSaveSession(adapter, document());
  const edited = moved();
  expect(() => session.saveIfDirty(edited, time)).toThrow(/本地草稿保存失败/);
  expect(session.isDirty(edited)).toBe(true);
  expect(storage.items.size).toBe(0);
  denied = false;
  expect(session.saveIfDirty(edited, time)).not.toBeNull();
  expect(session.isDirty(edited)).toBe(false);
});

test("人工保存后重置基线，后续修改仍有冲突保护", () => {
  const storage = new MemoryStorage();
  const session = new LocalDraftAutoSaveSession(storage, document());
  const edited = moved();
  const saved = saveLocalDraft(storage, edited, time);
  session.acceptSaved(saved);
  expect(session.isDirty(edited)).toBe(false);
  const next = moved(2);
  expect(session.saveIfDirty(next, new Date("2026-11-10T07:10:00Z"))).not.toBeNull();
  const otherTab = moved(8);
  saveLocalDraft(storage, otherTab, new Date("2026-11-10T07:11:00Z"));
  expect(() => session.saveIfDirty(moved(3), time)).toThrow(/自动保存已暂停/);
});

test("人工保存结果不能跨工程接入自动保存会话", () => {
  const storage = new MemoryStorage();
  const session = new LocalDraftAutoSaveSession(storage, document());
  const foreign = { ...document(), projectId: "other-demo" };
  const result = saveLocalDraft(storage, foreign, time);
  expect(() => session.acceptSaved(result)).toThrow(/工程 ID 不一致/);
  expect(session.isDirty(moved())).toBe(true);
});
