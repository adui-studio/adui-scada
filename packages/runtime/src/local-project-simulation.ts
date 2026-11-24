import {
  parseScadaDocument,
  TagHistoryBuffer,
} from "@adui/scada-core";
import type { TagChange, TagHistoryPoint, TagValue } from "@adui/scada-core";
import type { ReadonlyTagSource } from "./tag-source.ts";

const HISTORY_WINDOW_MS = 120_000;
const HISTORY_CAPACITY = 240;

/** 只在当前本地模拟会话保留单个选中 Tag 的原始合成采样，不读取现场或服务器。 */
export interface LocalProjectSimulationSource extends ReadonlyTagSource {
  selectHistoryTag(tagId: string): void;
  history(): readonly TagHistoryPoint[];
}

/** 将用户已校验的工程作为独立本地只读模拟快照；不读取或改写草稿及发布指针。 */
export function createLocalProjectSimulationSource(input: unknown): LocalProjectSimulationSource {
  const project = parseScadaDocument(input);
  let selectedTag = project.tags.find((tag) => tag.dataType === "number")?.tagId ??
    project.tags[0]?.tagId;
  let buffer = new TagHistoryBuffer(HISTORY_CAPACITY);
  let lastSampleMs: number | undefined;

  function resetHistory(): void {
    buffer = new TagHistoryBuffer(HISTORY_CAPACITY);
    lastSampleMs = undefined;
  }

  return {
    async loadProject(signal: AbortSignal): Promise<unknown> {
      signal.throwIfAborted();
      return parseScadaDocument(project);
    },
    subscribe(handlers) {
      let closed = false;
      let sequence = 0;
      resetHistory();

      const publish = (kind: TagChange["kind"]): void => {
        if (closed) return;
        const now = Date.now();
        if (lastSampleMs !== undefined && now <= lastSampleMs) return;
        sequence += 1;
        const timestamp = new Date(now).toISOString();
        const values: TagValue[] = project.tags.map((tag, index) => {
          let value: TagValue["value"] = null;
          switch (tag.dataType) {
            case "number":
              value = Math.round((50 + 40 * Math.sin((sequence + index) / 10)) * 10) / 10;
              break;
            case "boolean":
              value = (sequence + index) % 12 < 9;
              break;
            case "string":
              value = (sequence + index) % 12 < 9 ? "模拟运行" : "模拟停止";
              break;
          }
          return {
            tagId: tag.tagId,
            value,
            quality: tag.dataType === "unknown" ? "BAD" : "GOOD",
            sourceTimestamp: null,
            serverTimestamp: timestamp,
            sequence,
          };
        });
        const sample = values.find((tag) => tag.tagId === selectedTag);
        if (sample) {
          buffer.pruneBefore(now - HISTORY_WINDOW_MS);
          buffer.append({ kind: "sample", values: [sample] });
        }
        lastSampleMs = now;
        handlers.onMessage({ kind, values });
      };

      // 先同步发出快照，后续只产生增量；同步异常不能留下定时器。
      publish("snapshot");
      const timer = setInterval(() => publish("delta"), 1000);
      return {
        close(): void {
          if (closed) return;
          closed = true;
          clearInterval(timer);
        },
      };
    },
    selectHistoryTag(tagId): void {
      if (!project.tags.some((tag) => tag.tagId === tagId)) {
        throw new TypeError("本地模拟历史 Tag 不存在");
      }
      if (selectedTag !== tagId) {
        selectedTag = tagId;
        resetHistory();
      }
    },
    history(): readonly TagHistoryPoint[] {
      if (!selectedTag || lastSampleMs === undefined) return [];
      return buffer.query({
        tagId: selectedTag,
        startMs: lastSampleMs - HISTORY_WINDOW_MS,
        endMs: lastSampleMs + 1,
        maxPoints: HISTORY_CAPACITY,
      });
    },
  };
}

/** 本地模拟趋势只连接连续的正常数值点，不跨未知质量或长时间缺口。 */
export function simulationTrendPaths(points: readonly TagHistoryPoint[]): readonly string[] {
  if (points.length === 0) return [];
  const start = points[0]!.timestampMs;
  const duration = Math.max(1, points.at(-1)!.timestampMs - start);
  const paths: string[] = [];
  let path = "";
  let previousMs: number | undefined;
  for (const point of points) {
    if (point.numericValue === null) {
      if (path) paths.push(path);
      path = "";
      previousMs = undefined;
      continue;
    }
    if (previousMs !== undefined && point.timestampMs - previousMs > 2000) {
      if (path) paths.push(path);
      path = "";
    }
    const x = 8 + ((point.timestampMs - start) / duration) * 304;
    const y = 112 - Math.min(100, Math.max(0, point.numericValue)) * 1.04;
    // 单个点也以短线呈现，数值范围仅适用于当前 0～100 的本地合成数据。
    path += path ? ` L ${x} ${y}` : `M ${x} ${y} l 0.01 0`;
    previousMs = point.timestampMs;
  }
  if (path) paths.push(path);
  return paths;
}

/** 标量以 JSON 表示，文本不会成为 CSV 公式；只导出当前模拟会话真实采样。 */
export function simulationHistoryCsv(points: readonly TagHistoryPoint[]): string {
  const quote = (value: string): string => '"' + value.replaceAll('"', '""') + '"';
  const rows = points.map((point) =>
    [
      point.tagId,
      point.serverTimestamp,
      point.quality,
      Object.is(point.value, -0) ? "-0" : JSON.stringify(point.value),
      String(point.sequence),
    ].map(quote).join(","),
  );
  return ["Tag ID,服务器时间（UTC）,质量,原始值（JSON）,序列号", ...rows].join("\r\n") + "\r\n";
}
