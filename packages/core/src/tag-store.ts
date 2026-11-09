/** Read-only realtime Tag contract, independent of UI and PLC drivers. */
export const TAG_QUALITIES = ["GOOD", "UNCERTAIN", "BAD", "STALE"] as const;
export type TagQuality = (typeof TAG_QUALITIES)[number];
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
  if (!ID_PATTERN.test(input.tagId)) throw new TypeError("Invalid tagId");
  if (!TAG_QUALITIES.includes(input.quality)) throw new TypeError("Invalid quality");
  if (input.value !== null && !["string", "number", "boolean"].includes(typeof input.value)) {
    throw new TypeError("Invalid tag value");
  }
  if (typeof input.value === "number" && !Number.isFinite(input.value)) {
    throw new TypeError("Invalid number");
  }
  if (typeof input.value === "string" && input.value.length > 8192) {
    throw new TypeError("Value too long");
  }
  if (input.sourceTimestamp !== null && !isTimestamp(input.sourceTimestamp)) {
    throw new TypeError("Invalid source timestamp");
  }
  if (!isTimestamp(input.serverTimestamp)) throw new TypeError("Invalid server timestamp");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new TypeError("Invalid sequence");
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

  /** A lower/equal sequence is ignored to prevent old updates overwriting newer data. */
  apply(updates: readonly TagValue[]): readonly TagValue[] {
    // Validate the entire batch before mutating, including duplicate IDs in the same batch.
    const unique = new Set<string>();
    const checked = updates.map((update) => {
      const valid = validateTagValue(update);
      if (unique.has(valid.tagId)) throw new TypeError(`Duplicate update: ${valid.tagId}`);
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

  /** Stale is a quality state, not a fabricated device reading. Caller supplies the clock. */
  markStale(nowMs: number, timeoutMs: number): readonly TagValue[] {
    if (!Number.isFinite(nowMs) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("Invalid stale clock/timeout");
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

  /** A remote snapshot starts a new session; validate before replacing atomically. */
  replaceSnapshot(updates: readonly TagValue[]): readonly TagValue[] {
    const seen = new Set<string>();
    const checked = updates.map((item) => {
      const valid = validateTagValue(item);
      if (seen.has(valid.tagId)) throw new TypeError('Duplicate snapshot Tag');
      seen.add(valid.tagId);
      return valid;
    });
    this.values.clear();
    for (const item of checked) this.values.set(item.tagId, item);
    this.emit({ kind: 'snapshot', values: this.snapshot() });
    return this.snapshot();
  }

  /** Mark disconnected readings as STALE without fabricating new sensor measurements. */
  markDisconnected(nowMs: number): readonly TagValue[] {
    if (!Number.isFinite(nowMs)) throw new TypeError('Invalid clock');
    const timestamp = new Date(nowMs).toISOString();
    const changed: TagValue[] = [];
    for (const value of this.values.values()) {
      if ((value.quality === 'GOOD' || value.quality === 'UNCERTAIN') && value.sequence < Number.MAX_SAFE_INTEGER) {
        changed.push({ ...value, quality: 'STALE', serverTimestamp: timestamp, sequence: value.sequence + 1 });
      }
    }
    return this.apply(changed);
  }

  private emit(change: TagChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
