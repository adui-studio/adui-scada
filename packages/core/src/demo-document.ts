import { parseScadaDocument, SCADA_SCHEMA_VERSION } from "./document.ts";
import type { ScadaNode } from "./document.ts";
import { TagDefinitionCatalog } from "./tag-definition.ts";
import type { TagDefinition } from "./tag-definition.ts";

/** 水处理演示 Tag 元数据；质量由实时 TagValue 动态提供，不固定在定义中。 */
export const waterTreatmentDemoTagDefinitions: readonly TagDefinition[] = [
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
];

export const waterTreatmentDemoTagCatalog = new TagDefinitionCatalog(
  waterTreatmentDemoTagDefinitions,
);

export interface WaterTreatmentDemoTagOption extends TagDefinition {
  readonly label: string;
  readonly slots: readonly string[];
}

const waterTreatmentDemoTagSlots: Readonly<Record<string, readonly string[]>> = {
  "water.level": ["level", "value"],
  "water.pump.running": ["running", "value"],
  "water.flow": ["value"],
};

/**
 * Studio 绑定候选在共享 Tag 定义上增加图元槽约束。
 * 该列表只服务于本地模拟预览，不包含工业地址或连接参数。
 */
export const waterTreatmentDemoTagOptions: readonly WaterTreatmentDemoTagOption[] =
  waterTreatmentDemoTagDefinitions.map((definition) => ({
    ...definition,
    label: definition.displayName,
    slots: waterTreatmentDemoTagSlots[definition.tagId] ?? [],
  }));

/** HTTP 诊断服务与桌面离线模拟共用的水处理演示工程。 */
function node(
  id: string,
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  props: ScadaNode["props"] = {},
  bindings: ScadaNode["bindings"] = {},
): ScadaNode {
  return {
    id,
    type,
    symbolVersion: "1",
    transform: { x, y, width, height, rotation: 0 },
    props,
    bindings,
    rules: [],
  };
}

export const waterTreatmentDemoDocument = parseScadaDocument({
  schemaVersion: SCADA_SCHEMA_VERSION,
  projectId: "water-demo",
  tags: waterTreatmentDemoTagDefinitions,
  pages: [
    {
      id: "main",
      name: "水处理系统（模拟）",
      size: { width: 880, height: 460 },
      nodes: [
        node("title", "label", 44, 30, 600, 36, { text: "水处理系统 / V0.1" }),
        node("tank", "tank", 80, 125, 150, 205, {}, { level: { tagId: "water.level" } }),
        node("pipe", "pipe", 232, 220, 265, 24),
        node(
          "pump",
          "pump",
          500,
          187,
          110,
          110,
          {},
          {
            running: { tagId: "water.pump.running" },
          },
        ),
        node(
          "flow",
          "label",
          630,
          225,
          200,
          32,
          { text: "流量", unit: "m3/h" },
          { value: { tagId: "water.flow" } },
        ),
      ],
    },
  ],
});

/** 新建 Studio 工作区的默认画板；工程 Schema 本身允许导入其他合法尺寸。 */
export const STUDIO_DEFAULT_PAGE_SIZE = { width: 1920, height: 1080 } as const;

/**
 * 新建 Studio 的演示工作区使用 1920×1080 画板。
 * 仅对演示图元做等比缩放和居中，不改变原只读 Runtime 演示文档或既有工程。
 */
export const waterTreatmentStudioDocument = parseScadaDocument({
  ...waterTreatmentDemoDocument,
  pages: waterTreatmentDemoDocument.pages.map((page) => {
    const inset = 80;
    const scale = Math.min(
      (STUDIO_DEFAULT_PAGE_SIZE.width - inset * 2) / page.size.width,
      (STUDIO_DEFAULT_PAGE_SIZE.height - inset * 2) / page.size.height,
    );
    const offsetX = (STUDIO_DEFAULT_PAGE_SIZE.width - page.size.width * scale) / 2;
    const offsetY = (STUDIO_DEFAULT_PAGE_SIZE.height - page.size.height * scale) / 2;
    return {
      ...page,
      size: { ...STUDIO_DEFAULT_PAGE_SIZE },
      nodes: page.nodes.map((node) => ({
        ...node,
        transform: {
          ...node.transform,
          x: node.transform.x * scale + offsetX,
          y: node.transform.y * scale + offsetY,
          width: node.transform.width * scale,
          height: node.transform.height * scale,
        },
      })),
    };
  }),
});

/** 新建独立空白工程，不覆盖水处理示例或历史工程。 */
export function createBlankStudioDocument(projectId: string) {
  return parseScadaDocument({
    schemaVersion: SCADA_SCHEMA_VERSION,
    projectId,
    tags: [],
    pages: [
      {
        id: "main",
        name: "页面 1",
        size: { ...STUDIO_DEFAULT_PAGE_SIZE },
        nodes: [],
      },
    ],
  });
}

/** 独立水处理总览示例，仅使用现有图元与三个真实模拟 Tag。 */
export const waterTreatmentShowcaseDocument = parseScadaDocument({
  schemaVersion: SCADA_SCHEMA_VERSION,
  projectId: "water-showcase",
  tags: waterTreatmentDemoTagDefinitions,
  pages: [
    {
      id: "main",
      name: "水处理系统 · 总览",
      size: { ...STUDIO_DEFAULT_PAGE_SIZE },
      nodes: [
        node("overview-title", "label", 64, 42, 1000, 68, { text: "水处理系统 · 总览画面" }),
        node("overview-status", "label", 1310, 58, 544, 36, { text: "静态模拟预览 · 非现场控制" }),
        node("level-metric", "label", 64, 138, 570, 164, { text: "原水液位", unit: "%", presentation: "metric" }, { value: { tagId: "water.level" } }),
        node("pump-metric", "label", 674, 138, 570, 164, { text: "水泵运行", presentation: "metric" }, { value: { tagId: "water.pump.running" } }),
        node("flow-metric", "label", 1284, 138, 570, 164, { text: "处理流量", unit: "m³/h", presentation: "metric" }, { value: { tagId: "water.flow" } }),
        node("process-title", "label", 64, 354, 680, 52, { text: "工艺流程" }),
        node("inlet", "label", 64, 532, 200, 52, { text: "原水进水" }),
        node("inlet-pipe", "pipe", 64, 590, 340, 24),
        node("transfer-pipe", "pipe", 526, 590, 575, 24),
        node("outlet-pipe", "pipe", 1262, 590, 592, 24),
        node("raw-tank", "tank", 324, 420, 320, 370, {}, { level: { tagId: "water.level" } }),
        node("transfer-pump", "pump", 1012, 470, 300, 250, {}, { running: { tagId: "water.pump.running" } }),
        node("tank-name", "label", 366, 804, 250, 52, { text: "原水箱" }),
        node("pump-name", "label", 1024, 744, 284, 52, { text: "输送水泵" }),
        node("outlet", "label", 1516, 532, 338, 52, { text: "出水监测" }),
        node("overview-note", "label", 64, 906, 1790, 66, { text: "数据说明 · 本画面仅为编辑器模拟示例，未连接现场设备。实时质量须以实际数据源为准。" }),
      ],
    },
  ],
});
