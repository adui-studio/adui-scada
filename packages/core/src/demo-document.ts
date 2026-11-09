import { parseScadaDocument, SCADA_SCHEMA_VERSION } from "./document.ts";
import type { ScadaNode } from "./document.ts";

/** Shared water-treatment fixture for the HTTP diagnostic and packaged desktop simulation. */
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
      name: "Water Treatment - Simulation",
      size: { width: 880, height: 460 },
      nodes: [
        node("title", "label", 44, 30, 600, 36, { text: "Water Treatment / V0.1" }),
        node("tank", "tank", 80, 125, 150, 205, {}, { level: { tagId: "water.level" } }),
        node("pipe", "pipe", 232, 220, 265, 24),
        node("pump", "pump", 500, 187, 110, 110, {}, {
          running: { tagId: "water.pump.running" },
        }),
        node(
          "flow",
          "label",
          630,
          225,
          200,
          32,
          { text: "Flow", unit: "m3/h" },
          { value: { tagId: "water.flow" } },
        ),
      ],
    },
  ],
});
