import { expect, test } from "vite-plus/test";
import {
  LEGACY_SCADA_SCHEMA_VERSION,
  PREVIOUS_SCADA_SCHEMA_VERSION,
  SCADA_SCHEMA_VERSION,
  migrateScadaDocument,
  parseScadaDocument,
} from "../src/document.ts";
import {
  waterTreatmentDemoDocument,
  waterTreatmentDemoTagDefinitions,
} from "../src/demo-document.ts";

function fixture() {
  return {
    schemaVersion: SCADA_SCHEMA_VERSION,
    projectId: "water-demo",
    tags: waterTreatmentDemoTagDefinitions,
    pages: [
      {
        id: "main",
        name: "水处理系统",
        size: { width: 880, height: 460 },
        nodes: [
          {
            id: "tank",
            type: "tank",
            symbolVersion: "1",
            transform: { x: 20, y: 30, width: 100, height: 160, rotation: 0 },
            props: { title: "水箱 1" },
            bindings: { level: { tagId: "water.level" } },
            rules: [],
          },
        ],
      },
    ],
  };
}

test("验证并复制可跨框架使用的工程文档", () => {
  const source = fixture();
  const parsed = parseScadaDocument(source);
  expect(JSON.parse(JSON.stringify(parsed))).toEqual(source);
  source.pages[0].nodes[0].props.title = "已篡改";
  expect(parsed.pages[0].nodes[0].props.title).toBe("水箱 1");
});

test("拒绝不支持的 Schema 版本和非法图元尺寸", () => {
  const unsupported = fixture() as any;
  unsupported.schemaVersion = "99";
  expect(() => parseScadaDocument(unsupported)).toThrow(/不支持的版本/);
  const invalid = fixture();
  invalid.pages[0].nodes[0].transform.width = Number.POSITIVE_INFINITY;
  expect(() => parseScadaDocument(invalid)).toThrow(/有限数值/);
});

test("拒绝重复的页面或图元 ID 以及不安全的 JSON 属性名", () => {
  const duplicated = fixture();
  duplicated.pages[0].nodes[0].id = "main";
  expect(() => parseScadaDocument(duplicated)).toThrow(/ID 重复/);
  const injected = fixture() as any;
  injected.pages[0].nodes[0].props = JSON.parse('{"__proto__": {"polluted": true}}');
  expect(() => parseScadaDocument(injected)).toThrow(/属性名称不安全/);
});

test("拒绝用户规则中的函数与循环引用", () => {
  const fn = fixture() as any;
  fn.pages[0].nodes[0].rules = [() => "unsafe"];
  expect(() => parseScadaDocument(fn)).toThrow(/不是合法的 JSON 值/);
  const cycle = fixture() as any;
  const recursive: unknown[] = [];
  recursive.push(recursive);
  cycle.pages[0].nodes[0].rules = recursive;
  expect(() => parseScadaDocument(cycle)).toThrow(/循环引用/);
});

test("0.3.0 工程必须包含 Tag 目录且所有图元绑定必须引用已定义 Tag", () => {
  const missingCatalog = fixture() as Record<string, unknown>;
  delete missingCatalog.tags;
  expect(() => parseScadaDocument(missingCatalog)).toThrow(/必须包含 Tag 定义数组/);

  const dangling = fixture();
  dangling.tags = [];
  expect(() => parseScadaDocument(dangling)).toThrow(/引用了未定义的 Tag：water.level/);
});

test("平面组合标识在 JSON 往返中保留且不改变原有 Tag 绑定", () => {
  const original = parseScadaDocument(waterTreatmentDemoDocument);
  original.pages[0]!.nodes[0]!.groupId = "group-a";
  original.pages[0]!.nodes[1]!.groupId = "group-a";
  const parsed = parseScadaDocument(JSON.parse(JSON.stringify(original)));
  expect(parsed.pages[0]?.nodes[0]?.groupId).toBe("group-a");
  expect(parsed.pages[0]?.nodes[1]?.groupId).toBe("group-a");
  expect(parsed.pages[0]?.nodes.find((node) => node.id === "tank")?.bindings.level?.tagId).toBe(
    "water.level",
  );
  expect(parsed.pages[0]?.nodes[2]?.groupId).toBeUndefined();
  expect(parsed.schemaVersion).toBe(SCADA_SCHEMA_VERSION);
  expect(parseScadaDocument(parsed)).toEqual(parsed);
});

test("组合标识为空、包含不安全字符或非字符串时拒绝导入", () => {
  const document = parseScadaDocument(waterTreatmentDemoDocument);
  document.pages[0]!.nodes[0]!.groupId = "";
  expect(() => parseScadaDocument(document)).toThrow(/稳定 ASCII 标识符/);
  document.pages[0]!.nodes[0]!.groupId = "group/../bad";
  expect(() => parseScadaDocument(document)).toThrow(/稳定 ASCII 标识符/);
  document.pages[0]!.nodes[0]!.groupId = 12 as never;
  expect(() => parseScadaDocument(document)).toThrow(/稳定 ASCII 标识符/);
});

test("拒绝成员不足两个的组合与组合标识和图元 ID 冲突", () => {
  const document = parseScadaDocument(waterTreatmentDemoDocument);
  document.pages[0]!.nodes[0]!.groupId = "group-a";
  expect(() => parseScadaDocument(document)).toThrow(/至少需要两个图元/);
  document.pages[0]!.nodes[1]!.groupId = "group-a";
  expect(parseScadaDocument(document).pages[0]?.nodes[1]?.groupId).toBe("group-a");
  document.pages[0]!.nodes[1]!.groupId = "title";
  document.pages[0]!.nodes[0]!.groupId = "title";
  expect(() => parseScadaDocument(document)).toThrow(/组合 ID .*冲突/);
});

test("拒绝跨页面共用同一个组合 ID", () => {
  const document = parseScadaDocument(waterTreatmentDemoDocument);
  const first = document.pages[0]!;
  first.nodes[0]!.groupId = "group-a";
  first.nodes[1]!.groupId = "group-a";
  document.pages.push({
    id: "other",
    name: "备用画面",
    size: { ...first.size },
    nodes: [
      { ...first.nodes[0]!, id: "other-title", groupId: "group-a" },
      { ...first.nodes[1]!, id: "other-tank", groupId: "group-a" },
    ],
  });
  expect(() => parseScadaDocument(document)).toThrow(/不能跨页面/);
});

test("新版 Schema 为 0.3.0，并保留 0.2.0 与 0.1.0 两个迁移入口", () => {
  expect(SCADA_SCHEMA_VERSION).toBe("0.3.0");
  expect(PREVIOUS_SCADA_SCHEMA_VERSION).toBe("0.2.0");
  expect(LEGACY_SCADA_SCHEMA_VERSION).toBe("0.1.0");
});

test("当前工程迁移入口只校验，不改变工程内容和版本", () => {
  const current = parseScadaDocument(waterTreatmentDemoDocument);
  const result = migrateScadaDocument(current);
  expect(result.migratedFrom).toBeNull();
  expect(result.document).toEqual(current);
  expect(result.document).not.toBe(current);
});

test("无组合的历史工程显式迁移至 0.2.0 且不改 Tag 和图元", () => {
  const legacy = {
    ...fixture(),
    schemaVersion: LEGACY_SCADA_SCHEMA_VERSION,
  };
  expect(() => parseScadaDocument(legacy)).toThrow(/不支持的版本/);
  const result = migrateScadaDocument(legacy);
  expect(result.migratedFrom).toBe("0.1.0");
  expect(result.document.schemaVersion).toBe(SCADA_SCHEMA_VERSION);
  expect(result.document.pages[0]?.nodes[0]?.bindings.level?.tagId).toBe("water.level");
  expect(result.document.pages[0]?.nodes[0]?.groupId).toBeUndefined();
  expect(legacy.schemaVersion).toBe(LEGACY_SCADA_SCHEMA_VERSION);
});

test("含旧版组合元数据的历史工程迁移后保留两个成员与 Tag", () => {
  const legacy = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  legacy.schemaVersion = LEGACY_SCADA_SCHEMA_VERSION;
  legacy.pages[0].nodes[1].groupId = "group-1";
  legacy.pages[0].nodes[3].groupId = "group-1";
  const { document, migratedFrom } = migrateScadaDocument(legacy);
  expect(migratedFrom).toBe("0.1.0");
  expect(document.pages[0]?.nodes[1]?.groupId).toBe("group-1");
  expect(document.pages[0]?.nodes[3]?.groupId).toBe("group-1");
  expect(document.pages[0]?.nodes[1]?.bindings.level?.tagId).toBe("water.level");
  expect(document.pages[0]?.nodes[3]?.bindings.running?.tagId).toBe("water.pump.running");
  expect(parseScadaDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  expect(legacy.schemaVersion).toBe("0.1.0");
});

test("0.2.0 工程迁移时为已有绑定生成待确认类型，保持 Tag ID", () => {
  const previous = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  previous.schemaVersion = PREVIOUS_SCADA_SCHEMA_VERSION;
  delete previous.tags;
  const result = migrateScadaDocument(previous);
  expect(result.migratedFrom).toBe("0.2.0");
  expect(result.document.schemaVersion).toBe("0.3.0");
  expect(result.document.tags).toEqual([
    {
      tagId: "water.flow",
      displayName: "water.flow",
      dataType: "unknown",
      unit: null,
      description: "由历史工程迁移生成，数据类型与单位待维护者确认",
    },
    {
      tagId: "water.level",
      displayName: "water.level",
      dataType: "unknown",
      unit: null,
      description: "由历史工程迁移生成，数据类型与单位待维护者确认",
    },
    {
      tagId: "water.pump.running",
      displayName: "water.pump.running",
      dataType: "unknown",
      unit: null,
      description: "由历史工程迁移生成，数据类型与单位待维护者确认",
    },
  ]);
  expect(result.document.pages[0]?.nodes.find((node) => node.id === "tank")?.bindings.level?.tagId)
    .toBe("water.level");
  expect(previous.schemaVersion).toBe("0.2.0");
  expect(previous.tags).toBeUndefined();
});

test("未来版本、未知版本及缺失版本均拒绝迁移", () => {
  for (const version of ["0.4.0", "99.0.0", null, undefined]) {
    const source = { ...fixture(), schemaVersion: version };
    expect(() => migrateScadaDocument(source)).toThrow(/不支持的工程版本/);
  }
});

test("未知根与页面字段一律拒绝且不会被静默丢弃", () => {
  const root = { ...fixture(), futureField: "新字段" };
  expect(() => parseScadaDocument(root)).toThrow(/结构字段/);
  const page = JSON.parse(JSON.stringify(fixture()));
  page.pages[0].reserved = 1;
  expect(() => migrateScadaDocument(page)).toThrow(/结构字段/);
  page.schemaVersion = LEGACY_SCADA_SCHEMA_VERSION;
  expect(() => migrateScadaDocument(page)).toThrow(/结构字段/);
});

test("未知画布尺寸、图元、变换及绑定字段一律拒绝导入", () => {
  const paths = [
    (source: any) => {
      source.pages[0].size.unit = "px";
    },
    (source: any) => {
      source.pages[0].nodes[0].parentId = "unknown";
    },
    (source: any) => {
      source.pages[0].nodes[0].transform.skewX = 20;
    },
    (source: any) => {
      source.pages[0].nodes[0].bindings.level.mode = "write";
    },
  ];
  for (const mutate of paths) {
    for (const version of [SCADA_SCHEMA_VERSION, LEGACY_SCADA_SCHEMA_VERSION]) {
      const source = JSON.parse(JSON.stringify(fixture()));
      source.schemaVersion = version;
      mutate(source);
      expect(() => migrateScadaDocument(source)).toThrow(/结构字段/);
    }
  }
});

test("历史工程即使版本正确也必须拒绝非法组合和危险属性", () => {
  const oneMember = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  oneMember.schemaVersion = LEGACY_SCADA_SCHEMA_VERSION;
  oneMember.pages[0].nodes[1].groupId = "group-1";
  expect(() => migrateScadaDocument(oneMember)).toThrow(/至少需要两个图元/);

  const malicious = JSON.parse(JSON.stringify(fixture()));
  malicious.schemaVersion = LEGACY_SCADA_SCHEMA_VERSION;
  malicious.pages[0].nodes[0].props = JSON.parse('{"__proto__":{"unsafe":true}}');
  expect(() => migrateScadaDocument(malicious)).toThrow(/属性名称不安全/);
});

test("Studio 图层状态通过现有 props 扩展校验并保留布尔值", () => {
  const source = JSON.parse(JSON.stringify(fixture()));
  source.pages[0].nodes[0].props.__scadaStudio = { locked: true, visible: false };
  const parsed = parseScadaDocument(source);
  expect(parsed.pages[0]?.nodes[0]?.props.__scadaStudio).toEqual({ locked: true, visible: false });
  expect(JSON.parse(JSON.stringify(parsed))).toEqual(source);
});

test("拒绝图层状态中的非布尔值及未知字段", () => {
  const source = JSON.parse(JSON.stringify(fixture()));
  source.pages[0].nodes[0].props.__scadaStudio = { locked: "true" };
  expect(() => parseScadaDocument(source)).toThrow(/必须为布尔值/);
  source.pages[0].nodes[0].props.__scadaStudio = { visible: 1 };
  expect(() => parseScadaDocument(source)).toThrow(/必须为布尔值/);
  source.pages[0].nodes[0].props.__scadaStudio = { visible: false, script: "alert(1)" };
  expect(() => parseScadaDocument(source)).toThrow(/不支持的结构字段/);
});

test("旧工程无扩展状态仍可校验和迁移，不要求修改版本号", () => {
  const source = fixture();
  const parsed = parseScadaDocument(source);
  expect(parsed.schemaVersion).toBe(SCADA_SCHEMA_VERSION);
  expect(parsed.pages[0]?.nodes[0]?.props.__scadaStudio).toBeUndefined();
  expect(migrateScadaDocument(source).document).toEqual(parsed);
});
