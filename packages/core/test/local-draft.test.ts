import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import { parseScadaDocument } from "../src/document.ts";
import {
  LOCAL_DRAFT_FORMAT_VERSION,
  LOCAL_DRAFT_MAX_BYTES,
  clearLocalDraft,
  hasLocalDraft,
  localDraftKey,
  readLocalDraft,
  saveLocalDraft,
} from "../src/local-draft.ts";
import type { LocalDraftStorage } from "../src/local-draft.ts";

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

const savedAt = new Date("2026-11-10T03:00:00.000Z");

test("草稿保存和恢复保持节点、组合、Tag 及防御性副本", () => {
  const storage = new MemoryStorage();
  const document = parseScadaDocument(waterTreatmentDemoDocument);
  document.pages[0]!.nodes[1]!.groupId = "group-1";
  document.pages[0]!.nodes[3]!.groupId = "group-1";

  const written = saveLocalDraft(storage, document, savedAt);
  expect(written.savedAt).toBe(savedAt.toISOString());
  expect(hasLocalDraft(storage, document.projectId)).toBe(true);
  document.pages[0]!.nodes[1]!.transform.x = 90;

  const restored = readLocalDraft(storage, "water-demo");
  expect(restored?.document.pages[0]?.nodes[1]?.transform.x).toBe(80);
  expect(restored?.document.pages[0]?.nodes[1]?.groupId).toBe("group-1");
  expect(restored?.document.pages[0]?.nodes[3]?.groupId).toBe("group-1");
  expect(restored?.document.pages[0]?.nodes[1]?.bindings.level?.tagId).toBe("water.level");
  expect(restored?.document.schemaVersion).toBe("0.3.0");

  restored!.document.pages[0]!.nodes[1]!.transform.x = 100;
  expect(readLocalDraft(storage, "water-demo")?.document.pages[0]?.nodes[1]?.transform.x).toBe(80);
});

test("工程草稿按项目 ID 隔离，清除不会影响其他工程", () => {
  const storage = new MemoryStorage();
  expect(readLocalDraft(storage, "water-demo")).toBeNull();
  const a = parseScadaDocument(waterTreatmentDemoDocument);
  const b = { ...a, projectId: "other-demo" };
  saveLocalDraft(storage, a, savedAt);
  saveLocalDraft(storage, b, savedAt);
  clearLocalDraft(storage, "water-demo");
  expect(hasLocalDraft(storage, "water-demo")).toBe(false);
  expect(readLocalDraft(storage, "water-demo")).toBeNull();
  expect(readLocalDraft(storage, "other-demo")?.document.projectId).toBe("other-demo");
});

test("存储键拒绝非法工程 ID", () => {
  expect(localDraftKey("water-demo")).toContain("water-demo");
  expect(() => localDraftKey("../water")).toThrow(/工程 ID/);
  expect(() => localDraftKey("")).toThrow(/工程 ID/);
});

test("损坏的 JSON 被拒绝但不自动删除原始内容", () => {
  const storage = new MemoryStorage();
  const key = localDraftKey("water-demo");
  storage.setItem(key, "{bad");
  expect(() => readLocalDraft(storage, "water-demo")).toThrow(/JSON 已损坏/);
  expect(storage.getItem(key)).toBe("{bad");
  expect(hasLocalDraft(storage, "water-demo")).toBe(true);
});

test("未知草稿格式和新增结构字段均拒绝恢复", () => {
  const storage = new MemoryStorage();
  const key = localDraftKey("water-demo");
  saveLocalDraft(storage, waterTreatmentDemoDocument, savedAt);
  const base = JSON.parse(storage.getItem(key)!);
  for (const { record, message } of [
    {
      record: { ...base, formatVersion: LOCAL_DRAFT_FORMAT_VERSION + 1 },
      message: /草稿格式版本或结构不受支持/,
    },
    {
      record: { ...base, additional: "unknown" },
      message: /草稿格式版本或结构不受支持/,
    },
    {
      record: { ...base, savedAt: "not-a-time" },
      message: /草稿保存时间无效/,
    },
    {
      record: { ...base, document: { ...base.document, schemaVersion: "0.4.0" } },
      message: /不支持的工程版本/,
    },
  ]) {
    const raw = JSON.stringify(record);
    storage.setItem(key, raw);
    expect(() => readLocalDraft(storage, "water-demo")).toThrow(message);
    expect(storage.getItem(key)).toBe(raw);
  }
});

test("草稿项目与当前工程不同或内部工程不合法时拒绝恢复", () => {
  const storage = new MemoryStorage();
  const key = localDraftKey("water-demo");
  saveLocalDraft(storage, waterTreatmentDemoDocument, savedAt);
  const record = JSON.parse(storage.getItem(key)!);
  record.document.projectId = "other-demo";
  storage.setItem(key, JSON.stringify(record));
  expect(() => readLocalDraft(storage, "water-demo")).toThrow(/工程 ID 不一致/);
  record.document.projectId = "water-demo";
  record.document.pages[0].nodes[0].props = JSON.parse('{"__proto__":{"unsafe":true}}');
  storage.setItem(key, JSON.stringify(record));
  expect(() => readLocalDraft(storage, "water-demo")).toThrow(/属性名称不安全/);
});

test("读取 0.1.0 和 0.2.0 历史草稿时迁移 Tag 占位定义并保留绑定", () => {
  for (const version of ["0.1.0", "0.2.0"]) {
    const storage = new MemoryStorage();
    const key = localDraftKey("water-demo");
    const legacy = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
    legacy.schemaVersion = version;
    delete legacy.tags;
    storage.setItem(
      key,
      JSON.stringify({
        formatVersion: LOCAL_DRAFT_FORMAT_VERSION,
        savedAt: savedAt.toISOString(),
        document: legacy,
      }),
    );
    const restored = readLocalDraft(storage, "water-demo");
    expect(restored?.migratedFrom).toBe(version);
    expect(restored?.document.schemaVersion).toBe("0.3.0");
    expect(restored?.document.tags.every((tag) => tag.dataType === "unknown")).toBe(true);
    expect(
      restored?.document.pages[0]?.nodes.find((node) => node.id === "tank")?.bindings.level?.tagId,
    ).toBe("water.level");
    expect(storage.getItem(key)).not.toBeNull();
  }
});

test("草稿保存前严格校验文档，拒绝旧版工程和非法时间", () => {
  const storage = new MemoryStorage();
  const legacy = { ...waterTreatmentDemoDocument, schemaVersion: "0.1.0" };
  expect(() => saveLocalDraft(storage, legacy, savedAt)).toThrow(/不支持的版本/);
  expect(() => saveLocalDraft(storage, waterTreatmentDemoDocument, new Date(NaN))).toThrow(
    /保存时间无效/,
  );
  expect(storage.values.size).toBe(0);
});

test("超过 2 MiB 的本地记录无法恢复且原内容不被清空", () => {
  const storage = new MemoryStorage();
  const key = localDraftKey("water-demo");
  const large = "x".repeat(LOCAL_DRAFT_MAX_BYTES + 1);
  storage.setItem(key, large);
  expect(() => readLocalDraft(storage, "water-demo")).toThrow(/超过 2 MiB/);
  expect(storage.getItem(key)).toBe(large);

  const document = parseScadaDocument(waterTreatmentDemoDocument);
  const template = document.pages[0]!.nodes[0]!;
  document.pages[0]!.nodes = Array.from({ length: 280 }, (_, index) => ({
    ...template,
    id: `node-${index}`,
    props: { text: "x".repeat(8192) },
  }));
  expect(() => saveLocalDraft(storage, document, savedAt)).toThrow(/超过 2 MiB/);
  expect(storage.getItem(key)).toBe(large);

  const unicode = parseScadaDocument(waterTreatmentDemoDocument);
  unicode.pages[0]!.nodes = Array.from({ length: 150 }, (_, index) => ({
    ...unicode.pages[0]!.nodes[0]!,
    id: `unicode-${index}`,
    props: { text: "汉".repeat(5000) },
  }));
  expect(() => saveLocalDraft(storage, unicode, savedAt)).toThrow(/超过 2 MiB/);
  expect(storage.getItem(key)).toBe(large);

  const unicodeRaw = "汉".repeat(700_000);
  storage.setItem(key, unicodeRaw);
  expect(() => readLocalDraft(storage, "water-demo")).toThrow(/超过 2 MiB/);
  expect(storage.getItem(key)).toBe(unicodeRaw);
});

test("浏览器存储拒绝写入时保留原草稿，不误报保存成功", () => {
  const storage = new MemoryStorage();
  saveLocalDraft(storage, waterTreatmentDemoDocument, savedAt);
  const previous = storage.getItem(localDraftKey("water-demo"));
  const unavailable: LocalDraftStorage = {
    getItem: (key) => storage.getItem(key),
    setItem: () => {
      throw new Error("模拟存储空间不足");
    },
    removeItem: (key) => storage.removeItem(key),
  };
  expect(() => saveLocalDraft(unavailable, waterTreatmentDemoDocument, savedAt)).toThrow(
    /本地草稿保存失败/,
  );
  expect(storage.getItem(localDraftKey("water-demo"))).toBe(previous);
});

test("浏览器存储拒绝读取或清除时提供中文错误", () => {
  const unavailable: LocalDraftStorage = {
    getItem: () => {
      throw new Error("模拟拒绝读取");
    },
    setItem: () => {
      throw new Error("模拟拒绝写入");
    },
    removeItem: () => {
      throw new Error("模拟拒绝删除");
    },
  };
  expect(() => hasLocalDraft(unavailable, "water-demo")).toThrow(/读取失败/);
  expect(() => readLocalDraft(unavailable, "water-demo")).toThrow(/读取失败/);
  expect(() => clearLocalDraft(unavailable, "water-demo")).toThrow(/清除失败/);
});
