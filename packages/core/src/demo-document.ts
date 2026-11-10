import { parseScadaDocument, SCADA_SCHEMA_VERSION } from "./document.ts";
import type { ScadaNode } from "./document.ts";

/**
 * 演示 Tag 候选与 SVG 绑定槽的映射，仅用于 V0.2 本地模拟预览。
 * 不是正式 Tag 配置中心，也不创建设备通信连接。
 */
export const waterTreatmentDemoTagOptions: readonly {
  readonly tagId: string;
  readonly label: string;
  readonly slots: readonly string[];
}[] = [
  { tagId: "water.level", label: "模拟水位", slots: ["level", "value"] },
  { tagId: "water.pump.running", label: "模拟水泵运行", slots: ["running", "value"] },
  { tagId: "water.flow", label: "模拟流量", slots: ["value"] },
];

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
