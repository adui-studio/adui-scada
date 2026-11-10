/** 只读实时 Tag 契约，不依赖 UI 框架或 PLC 驱动。 */
export const TAG_QUALITIES = ["GOOD", "UNCERTAIN", "BAD", "STALE"] as const;
export type TagQuality = (typeof TAG_QUALITIES)[number];

/** Tag 质量状态的中文显示名称，协议值保持不变。 */
export const TAG_QUALITY_LABELS: Record<TagQuality, string> = {
  GOOD: "正常",
  UNCERTAIN: "不确定",
  BAD: "异常",
  STALE: "已过期",
};
export type TagScalar = string | number | boolean | null;

export interface TagValue {
  tagId: string;
  value: TagScalar;
  quality: TagQuality;
  sourceTimestamp: string | null;
  serverTimestamp: string;
  sequence: number;
}

export type TagChange = { kind: "snapshot" | "delta"; values: readonly TagValue[] };
export type TagListener = (change: TagChange) => void;

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateTagValue(input: TagValue): TagValue {
  if (!ID_PATTERN.test(input.tagId)) throw new TypeError("Tag ID 无效");
  if (!TAG_QUALITIES.includes(input.quality)) throw new TypeError("Tag 质量状态无效");
  if (input.value !== null && !["string", "number", "boolean"].includes(typeof input.value)) {
    throw new TypeError("Tag 数值类型无效");
  }
  if (typeof input.value === "number" && !Number.isFinite(input.value)) {
    throw new TypeError("Tag 数值必须为有限数");
  }
  if (typeof input.value === "string" && input.value.length > 8192) {
    throw new TypeError("Tag 文本值过长");
  }
  if (input.sourceTimestamp !== null && !isTimestamp(input.sourceTimestamp)) {
    throw new TypeError("数据源时间戳无效");
  }
  if (!isTimestamp(input.serverTimestamp)) throw new TypeError("服务器时间戳无效");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new TypeError("Tag 序列号无效");
  }
  return { ...input };
}

export class TagStore {
  private readonly values = new Map<string, TagValue>();
  private readonly listeners = new Set<TagListener>();

  snapshot(): readonly TagValue[] {
    return [...this.values.values()].map((value) => ({ ...value }));
  }

  get(tagId: string): TagValue | undefined {
    const found = this.values.get(tagId);
    return found ? { ...found } : undefined;
  }

  subscribe(listener: TagListener): () => void {
    this.listeners.add(listener);
    try {
      listener({ kind: "snapshot", values: this.snapshot() });
    } catch (error) {
      this.listeners.delete(listener);
      throw error;
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 忽略较小或相同的序列号，防止旧数据覆盖新数据。 */
  apply(updates: readonly TagValue[]): readonly TagValue[] {
    // 写入前先验证整批数据，包括同一批次中的重复 Tag ID。
    const unique = new Set<string>();
    const checked = updates.map((update) => {
      const valid = validateTagValue(update);
      if (unique.has(valid.tagId)) throw new TypeError(`同一批次存在重复的 Tag 更新：${valid.tagId}`);
      unique.add(valid.tagId);
      return valid;
    });
    const accepted = checked.filter(
      (value) => value.sequence > (this.values.get(value.tagId)?.sequence ?? -1),
    );
    for (const value of accepted) this.values.set(value.tagId, value);
    if (accepted.length) this.emit({ kind: "delta", values: accepted });
    return accepted.map((value) => ({ ...value }));
  }

  /** STALE 表示数据质量已过期，不是伪造的设备读数；时间由调用方提供。 */
  markStale(nowMs: number, timeoutMs: number): readonly TagValue[] {
    if (!Number.isFinite(nowMs) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("数据过期时间或超时时长无效");
    }
    const changes: TagValue[] = [];
    for (const old of this.values.values()) {
      if (
        (old.quality === "GOOD" || old.quality === "UNCERTAIN") &&
        nowMs - Date.parse(old.serverTimestamp) > timeoutMs
      ) {
        if (old.sequence === Number.MAX_SAFE_INTEGER) continue;
        changes.push({
          ...old,
          quality: "STALE",
          serverTimestamp: new Date(nowMs).toISOString(),
          sequence: old.sequence + 1,
        });
      }
    }
    return this.apply(changes);
  }

  /** 远端快照代表新的订阅会话；先完整验证，再原子替换。 */
  replaceSnapshot(updates: readonly TagValue[]): readonly TagValue[] {
    const seen = new Set<string>();
    const checked = updates.map((item) => {
      const valid = validateTagValue(item);
      if (seen.has(valid.tagId)) throw new TypeError("快照中存在重复的 Tag ID");
      seen.add(valid.tagId);
      return valid;
    });
    this.values.clear();
    for (const item of checked) this.values.set(item.tagId, item);
    this.emit({ kind: "snapshot", values: this.snapshot() });
    return this.snapshot();
  }

  /** 断连时将现有读数标记为 STALE，不生成虚假的传感器测量值。 */
  markDisconnected(nowMs: number): readonly TagValue[] {
    if (!Number.isFinite(nowMs)) throw new TypeError("时间参数无效");
    const timestamp = new Date(nowMs).toISOString();
    const changed: TagValue[] = [];
    for (const value of this.values.values()) {
      if (
        (value.quality === "GOOD" || value.quality === "UNCERTAIN") &&
        value.sequence < Number.MAX_SAFE_INTEGER
      ) {
        changed.push({
          ...value,
          quality: "STALE",
          serverTimestamp: timestamp,
          sequence: value.sequence + 1,
        });
      }
    }
    return this.apply(changed);
  }

  private emit(change: TagChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
