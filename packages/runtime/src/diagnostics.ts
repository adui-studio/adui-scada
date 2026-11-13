import type { TagQuality, TagValue } from "@adui/scada-core";
import type { RuntimeStatus } from "./runtime.ts";

/** 单次 Runtime 会话最多保留的本地状态变更条数。 */
export const MAX_RUNTIME_STATUS_EVENTS = 20;

export interface RuntimeStatusEvent {
  /** 会话内单调递增的序号，避免同毫秒状态变化造成渲染键冲突。 */
  readonly sequence: number;
  readonly status: RuntimeStatus;
  readonly occurredAt: number;
}

/** 仅在状态发生变化时记录，不存储动态消息、Tag 值或外部设备信息。 */
export class RuntimeStatusHistory {
  private readonly entries: RuntimeStatusEvent[] = [];
  private nextSequence = 0;

  record(status: RuntimeStatus, occurredAt = Date.now()): void {
    if (this.entries[0]?.status === status) return;
    this.entries.unshift({ sequence: ++this.nextSequence, status, occurredAt });
    if (this.entries.length > MAX_RUNTIME_STATUS_EVENTS) {
      this.entries.length = MAX_RUNTIME_STATUS_EVENTS;
    }
  }

  snapshot(): readonly RuntimeStatusEvent[] {
    return this.entries.map((event) => ({ ...event }));
  }

  clear(): void {
    this.entries.length = 0;
    this.nextSequence = 0;
  }
}

/** 仅限本机运行时观测，不包含设备地址、鉴权、网络往返时延或持久化数据。 */
export interface RuntimeDiagnostics {
  /** 一次连续断连只记一次；不等于实际 EventSource TCP 重连次数。 */
  readonly reconnectCount: number;
  /** 最近一次通过 Core 校验且被序列规则接受的 Tag 到达本机的时间。 */
  readonly lastTagReceivedAt: number | null;
  /** 生成本次状态快照时距上一次有效 Tag 到达的时长，不是链路传输延迟。 */
  readonly dataAgeMs: number | null;
  readonly tagCount: number;
  readonly qualityCounts: Readonly<Record<TagQuality, number>>;
  /** 最近状态变化，最新在前；不是服务器日志或工业报警历史。 */
  readonly statusEvents: readonly RuntimeStatusEvent[];
}

export function createRuntimeDiagnostics(
  values: readonly TagValue[],
  lastTagReceivedAt: number | null,
  reconnectCount: number,
  now = Date.now(),
  statusEvents: readonly RuntimeStatusEvent[] = [],
): RuntimeDiagnostics {
  const qualityCounts: Record<TagQuality, number> = {
    GOOD: 0,
    UNCERTAIN: 0,
    BAD: 0,
    STALE: 0,
  };
  for (const tag of values) qualityCounts[tag.quality]++;
  return {
    reconnectCount,
    lastTagReceivedAt,
    dataAgeMs: lastTagReceivedAt === null ? null : Math.max(0, now - lastTagReceivedAt),
    tagCount: values.length,
    qualityCounts,
    statusEvents: statusEvents.map((event) => ({ ...event })),
  };
}

export const initialRuntimeDiagnostics: RuntimeDiagnostics = createRuntimeDiagnostics(
  [],
  null,
  0,
  0,
);

/** 仅用于界面显示；秒数为状态快照时刻值，不会自行刷新。 */
export function formatRuntimeDataAge(ageMs: number | null): string {
  if (ageMs === null) return "尚无有效数据";
  if (ageMs < 60_000) return Math.floor(ageMs / 1000) + " 秒";
  return Math.floor(ageMs / 60_000) + " 分 " + Math.floor((ageMs % 60_000) / 1000) + " 秒";
}

export function formatRuntimeUpdateTime(timestamp: number | null): string {
  if (timestamp === null) return "尚无有效数据";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}
