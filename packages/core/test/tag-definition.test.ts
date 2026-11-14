import { expect, test } from "vite-plus/test";
import {
  TagDefinitionCatalog,
  TagStore,
  TAG_DATA_TYPE_LABELS,
  WaterTreatmentSimulator,
  waterTreatmentDemoDocument,
  waterTreatmentDemoTagCatalog,
  waterTreatmentDemoTagDefinitions,
  waterTreatmentDemoTagOptions,
} from "../src/index.ts";
import type { TagValue } from "../src/tag-store.ts";

const at = "2026-11-14T00:00:00.000Z";

function value(
  tagId: string,
  input: TagValue["value"],
  sequence = 1,
  quality: TagValue["quality"] = "GOOD",
): TagValue {
  return {
    tagId,
    value: input,
    quality,
    sourceTimestamp: at,
    serverTimestamp: at,
    sequence,
  };
}

test("水处理演示 Tag 定义提供稳定 ID、类型和单位，质量保持为实时属性", () => {
  expect(waterTreatmentDemoTagDefinitions).toEqual([
    {
      tagId: "water.level",
      displayName: "模拟水位",
      dataType: "number",
      unit: "%",
      description: "水箱液位百分比，仅为本机模拟值",
    },
    {
      tagId: "water.pump.running",
      displayName: "模拟水泵运行",
      dataType: "boolean",
      unit: null,
      description: "水泵运行状态，true 表示运行，false 表示停止",
    },
    {
      tagId: "water.flow",
      displayName: "模拟流量",
      dataType: "number",
      unit: "m3/h",
      description: "水处理模拟流量",
    },
  ]);
  expect(TAG_DATA_TYPE_LABELS).toEqual({
    number: "数值",
    boolean: "布尔值",
    string: "文本",
  });
  expect(waterTreatmentDemoTagCatalog.get("water.level")?.tagId).toBe("water.level");
  expect(waterTreatmentDemoTagOptions.find((option) => option.tagId === "water.pump.running")?.slots)
    .toEqual(["running", "value"]);

  const generated = new WaterTreatmentSimulator().next(new Date(at));
  const store = new TagStore(waterTreatmentDemoTagCatalog);
  expect(() => store.replaceSnapshot(generated)).not.toThrow();
  expect(store.snapshot()).toHaveLength(3);

  const copy = waterTreatmentDemoTagCatalog.get("water.level");
  if (copy) Object.assign(copy, { displayName: "外部篡改" });
  expect(waterTreatmentDemoTagCatalog.get("water.level")?.displayName).toBe("模拟水位");
});

test("Tag 定义目录拒绝重复 ID、未知字段和非法元数据", () => {
  const definition = waterTreatmentDemoTagDefinitions[0]!;
  expect(() => new TagDefinitionCatalog([definition, definition])).toThrow(/Tag ID 重复/);
  expect(
    () => new TagDefinitionCatalog([{ ...definition, address: "192.0.2.1" } as never]),
  ).toThrow(/不支持的字段/);
  expect(
    () => new TagDefinitionCatalog([{ ...definition, dataType: "float" } as never]),
  ).toThrow(/数据类型不受支持/);
  expect(
    () => new TagDefinitionCatalog([{ ...definition, unit: "u".repeat(33) }]),
  ).toThrow(/单位/);
});

test("重命名只改变显示名称，Tag ID 和工程图元绑定保持不变", () => {
  const before = waterTreatmentDemoTagCatalog;
  const after = before.rename("water.level", "原水池液位");
  const tank = waterTreatmentDemoDocument.pages[0]?.nodes.find((node) => node.id === "tank");
  expect(after.get("water.level")?.displayName).toBe("原水池液位");
  expect(after.get("water.level")?.tagId).toBe("water.level");
  expect(before.get("water.level")?.displayName).toBe("模拟水位");
  expect(tank?.bindings.level?.tagId).toBe("water.level");
  expect(() => before.rename("water.missing", "不存在的点位")).toThrow(/未找到 Tag 定义/);
  expect(() => before.rename("water.level", "   ")).toThrow(/显示名称/);
});

test("TagStore 按定义校验类型并在整批失败时保持原数据不变", () => {
  const store = new TagStore(waterTreatmentDemoTagCatalog);
  store.apply([value("water.level", 55), value("water.pump.running", true)]);
  expect(store.snapshot()).toHaveLength(2);
  expect(() =>
    store.apply([
      value("water.level", 66, 2),
      value("water.pump.running", 1, 2),
    ]),
  ).toThrow(/Tag 数据类型不匹配/);
  expect(store.get("water.level")?.value).toBe(55);
  expect(store.get("water.pump.running")?.value).toBe(true);
});

test("TagStore 快照同样校验类型且失败时保留原快照", () => {
  const store = new TagStore(waterTreatmentDemoTagCatalog);
  store.replaceSnapshot([value("water.level", 55)]);
  const before = store.snapshot();
  expect(() => store.replaceSnapshot([value("water.level", "55")])).toThrow(
    /Tag 数据类型不匹配/,
  );
  expect(() => store.apply([value("water.unknown", 1)])).toThrow(/未定义的 Tag/);
  expect(store.snapshot()).toEqual(before);
});

test("空值可表示尚无有效读数，质量状态仍由 TagValue 动态维护", () => {
  const store = new TagStore(waterTreatmentDemoTagCatalog);
  store.apply([value("water.level", null, 1, "STALE")]);
  expect(store.get("water.level")).toMatchObject({
    value: null,
    quality: "STALE",
    tagId: "water.level",
  });
  store.apply([value("water.level", 42, 2, "GOOD")]);
  expect(store.get("water.level")).toMatchObject({ value: 42, quality: "GOOD" });
});
