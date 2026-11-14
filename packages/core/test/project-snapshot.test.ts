import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import {
  PROJECT_SNAPSHOT_FORMAT_VERSION,
  createProjectSnapshot,
  readProjectSnapshot,
  validateProjectDocument,
} from "../src/project-snapshot.ts";

const options = { revision: 1, createdAt: "2026-11-11T07:00:00.000Z" };
const source = () => JSON.parse(JSON.stringify(waterTreatmentDemoDocument));

test("严格结构校验返回可独立编辑的工程副本", () => {
  const original = source();
  const checked = validateProjectDocument(original);
  expect(checked.valid).toBe(true);
  expect(checked.issues).toEqual([]);
  if (!checked.valid) return;
  original.pages[0].nodes[0].props.text = "修改后的标题";
  expect(checked.document.pages[0]?.nodes[0]?.props.text).not.toBe("修改后的标题");
});

test("非法工程输出带字段路径的中文校验错误且不隐式迁移", () => {
  const invalid = source();
  invalid.pages[0].nodes[0].transform.width = 0;
  const checked = validateProjectDocument(invalid);
  expect(checked.valid).toBe(false);
  expect(checked.issues).toEqual([
    {
      code: "DOCUMENT_INVALID",
      severity: "error",
      path: "pages[0].nodes[0].transform.width",
      message: expect.stringMatching(/有限数值/),
    },
  ]);
  const old = source();
  old.schemaVersion = "0.1.0";
  expect(validateProjectDocument(old).valid).toBe(false);
});

test("创建快照后与原文档隔离并深度冻结，不改变原文档", async () => {
  const original = source();
  const snap = await createProjectSnapshot(original, options);
  expect(snap.formatVersion).toBe(PROJECT_SNAPSHOT_FORMAT_VERSION);
  expect(snap.projectId).toBe(original.projectId);
  expect(snap.revision).toBe(1);
  expect(snap.contentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(Object.isFrozen(snap)).toBe(true);
  expect(Object.isFrozen(snap.document.pages[0]?.nodes[0]?.props)).toBe(true);
  const oldText = snap.document.pages[0]?.nodes[0]?.props.text;
  original.pages[0].nodes[0].props.text = "篡改源文档";
  expect(snap.document.pages[0]?.nodes[0]?.props.text).toBe(oldText);
  expect(() => {
    (snap.document.pages[0]!.nodes[0]!.props as Record<string, unknown>).text = "篡改快照";
  }).toThrow(TypeError);
});

test("同一 JSON 结构的键插入顺序不影响 SHA-256 内容摘要", async () => {
  const first = source();
  first.pages[0].nodes[0].props = { title: "水处理", unit: "米" };
  const second = source();
  second.pages[0].nodes[0].props = { unit: "米", title: "水处理" };
  const left = await createProjectSnapshot(first, options);
  const right = await createProjectSnapshot(second, options);
  expect(left.contentHash).toBe(right.contentHash);
});

test("不同的修订号或创建时间将产生不同摘要", async () => {
  const original = await createProjectSnapshot(source(), options);
  const revision = await createProjectSnapshot(source(), { ...options, revision: 2 });
  const time = await createProjectSnapshot(source(), {
    ...options,
    createdAt: "2026-11-11T07:01:00.000Z",
  });
  expect(revision.contentHash).not.toBe(original.contentHash);
  expect(time.contentHash).not.toBe(original.contentHash);
});

test("校验 JSON 序列化后的快照时返回新的冻结工程副本", async () => {
  const original = await createProjectSnapshot(source(), options);
  const imported = await readProjectSnapshot(JSON.parse(JSON.stringify(original)));
  expect(imported).toEqual(original);
  expect(imported).not.toBe(original);
  expect(imported.document).not.toBe(original.document);
  expect(Object.isFrozen(imported.document.pages[0]?.nodes[0]?.transform)).toBe(true);
});

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const result = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(result, (item) => item.toString(16).padStart(2, "0")).join("");
}

test("读取 0.2.0 历史快照时先验证原摘要，再返回可重复校验的 0.3.0 视图", async () => {
  const legacy = source();
  legacy.schemaVersion = "0.2.0";
  delete legacy.tags;
  const payload = {
    formatVersion: PROJECT_SNAPSHOT_FORMAT_VERSION,
    projectId: legacy.projectId,
    revision: options.revision,
    createdAt: options.createdAt,
    hashAlgorithm: "SHA-256",
    document: legacy,
  };
  const sourceContentHash = await digest(payload);
  const migrated = await readProjectSnapshot({ ...payload, contentHash: sourceContentHash });
  expect(migrated.migratedFrom).toBe("0.2.0");
  expect(migrated.sourceContentHash).toBe(sourceContentHash);
  expect(migrated.document.schemaVersion).toBe("0.3.0");
  expect(migrated.document.tags.every((tag) => tag.dataType === "unknown")).toBe(true);
  expect(await readProjectSnapshot(migrated)).toEqual(migrated);

  const tampered = {
    ...payload,
    document: { ...legacy, projectId: "tampered-project" },
    contentHash: sourceContentHash,
  };
  await expect(readProjectSnapshot(tampered)).rejects.toThrow(/摘要不匹配/);
});

test("拒绝快照内容被修改及元数据被修改", async () => {
  const original = await createProjectSnapshot(source(), options);
  const documentTamper = JSON.parse(JSON.stringify(original));
  documentTamper.document.pages[0].nodes[0].props.title = "被篡改";
  await expect(readProjectSnapshot(documentTamper)).rejects.toThrow(/摘要不匹配/);
  const revisionTamper = JSON.parse(JSON.stringify(original));
  revisionTamper.revision = 2;
  await expect(readProjectSnapshot(revisionTamper)).rejects.toThrow(/摘要不匹配/);
  const dateTamper = JSON.parse(JSON.stringify(original));
  dateTamper.createdAt = "2026-11-11T07:01:00.000Z";
  await expect(readProjectSnapshot(dateTamper)).rejects.toThrow(/摘要不匹配/);
});

test("拒绝未知快照字段、错误格式版本与项目标识冲突", async () => {
  const snap = await createProjectSnapshot(source(), options);
  await expect(readProjectSnapshot({ ...snap, futureField: true })).rejects.toThrow(/未知字段/);
  await expect(readProjectSnapshot({ ...snap, formatVersion: 3 })).rejects.toThrow(/不支持/);
  await expect(readProjectSnapshot({ ...snap, projectId: "other-project" })).rejects.toThrow(
    /工程 ID 不一致/,
  );
  await expect(readProjectSnapshot(Object.create({ document: snap.document }))).rejects.toThrow(
    /普通对象/,
  );
});

test("拒绝非法修订号、日期、摘要格式与不兼容的工程文档", async () => {
  for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(createProjectSnapshot(source(), { ...options, revision })).rejects.toThrow(
      /修订号/,
    );
  }
  for (const createdAt of ["2026-02-30T00:00:00.000Z", "2026-11-11", "非法时间"]) {
    await expect(createProjectSnapshot(source(), { ...options, createdAt })).rejects.toThrow(
      /创建时间/,
    );
  }
  const invalid = source();
  invalid.schemaVersion = "9.0.0";
  await expect(createProjectSnapshot(invalid, options)).rejects.toThrow(/校验失败/);
  const snap = await createProjectSnapshot(source(), options);
  await expect(readProjectSnapshot({ ...snap, contentHash: "abc" })).rejects.toThrow(/摘要格式/);
});

test("超出 2 MiB 的合法工程内容不得创建快照", async () => {
  const large = source();
  const template = large.pages[0].nodes[0];
  large.pages[0].nodes = Array.from({ length: 300 }, (_, index) => ({
    ...template,
    id: `node-${index}`,
    props: { text: "文本".repeat(2500) },
  }));
  await expect(createProjectSnapshot(large, options)).rejects.toThrow(/超过 2 MiB/);
});
