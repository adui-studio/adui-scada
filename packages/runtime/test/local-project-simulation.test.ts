import { expect, test, vi } from "vite-plus/test";
import { parseScadaDocument, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { TagChange, TagHistoryPoint } from "@adui/scada-core";
import {
  createLocalProjectSimulationSource,
  simulationHistoryCsv,
  simulationTrendPaths,
} from "../src/local-project-simulation.ts";
import { DemoRuntime, svgDataUrl } from "../src/runtime.ts";
import type { RuntimeState } from "../src/runtime.ts";

function project() {
  return parseScadaDocument({
    ...waterTreatmentDemoDocument,
    projectId: "local-simulation-test",
    projectName: "本地模拟测试工程",
    tags: [
      ...waterTreatmentDemoDocument.tags,
      { tagId: "test.text", displayName: "模拟文本", dataType: "string", unit: null, description: "" },
      { tagId: "test.unknown", displayName: "待确认", dataType: "unknown", unit: null, description: "" },
    ],
  });
}

test("导入工程使用独立模拟快照且按声明类型产生数据，关闭后不再采样", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T00:00:00.000Z"));
  const document = project();
  const source = createLocalProjectSimulationSource(document);
  const states: RuntimeState[] = [];
  const runtime = new DemoRuntime((state) => states.push(state), source);
  try {
    await runtime.start();
    expect(states.at(-1)?.document?.projectId).toBe(document.projectId);
    expect(states.at(-1)?.values).toHaveLength(document.tags.length);
    expect(states.at(-1)?.values.find((tag) => tag.tagId === "test.text")?.value).toBe("模拟运行");
    expect(states.at(-1)?.values.find((tag) => tag.tagId === "test.unknown")).toMatchObject({
      value: null,
      quality: "BAD",
      sourceTimestamp: null,
    });
    expect(svgDataUrl(document, states.at(-1)!.values)).toContain("data:image/svg+xml");
    vi.advanceTimersByTime(2000);
    expect(source.history()).toHaveLength(3);
    expect(source.history().map((point) => point.sequence)).toEqual([1, 2, 3]);
    runtime.stop();
    const count = states.length;
    vi.advanceTimersByTime(3000);
    expect(states).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    runtime.stop();
    vi.useRealTimers();
  }
});

test("趋势选择隔离历史且窗口内仅保留最近原始采样", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T00:00:00.000Z"));
  const source = createLocalProjectSimulationSource(project());
  const events: TagChange[] = [];
  const subscription = source.subscribe({
    onMessage: (event) => events.push(event as TagChange),
    onDisconnected: () => undefined,
  });
  try {
    expect(events[0]?.kind).toBe("snapshot");
    expect(() => source.subscribe({ onMessage: () => undefined, onDisconnected: () => undefined })).toThrow(
      "本地模拟源已有活动订阅",
    );
    vi.advanceTimersByTime(125_000);
    expect(source.history()).toHaveLength(121);
    expect(events.at(-1)?.kind).toBe("delta");
    source.selectHistoryTag("test.unknown");
    expect(source.history()).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(source.history()).toHaveLength(1);
    expect(source.history()[0]).toMatchObject({ tagId: "test.unknown", quality: "BAD", numericValue: null });
    expect(simulationTrendPaths(source.history())).toEqual([]);
    expect(() => source.selectHistoryTag("missing.tag")).toThrow("本地模拟历史 Tag 不存在");
  } finally {
    subscription.close();
    vi.useRealTimers();
  }
});

test("趋势不跨坏质量与采样缺口，导出保留质量和安全的原始文本", () => {
  const time = Date.parse("2026-11-24T00:00:00.000Z");
  const make = (offset: number, value: number | string, quality: TagHistoryPoint["quality"]): TagHistoryPoint => ({
    tagId: "water.level",
    timestampMs: time + offset,
    numericValue: quality === "GOOD" && typeof value === "number" ? value : null,
    value,
    quality,
    sourceTimestamp: null,
    serverTimestamp: new Date(time + offset).toISOString(),
    sequence: offset,
  });
  const points = [
    make(0, 20, "GOOD"),
    make(1000, 30, "GOOD"),
    make(2000, 40, "BAD"),
    make(3000, 50, "GOOD"),
    make(6000, 60, "GOOD"),
    make(7000, "=1+1", "GOOD"),
  ];
  expect(simulationTrendPaths(points)).toHaveLength(3);
  const csv = simulationHistoryCsv(points);
  expect(csv).toContain('"BAD"');
  expect(csv).toContain('"""=1+1"""');
  expect(csv.split("\r\n")).toHaveLength(8);
});
