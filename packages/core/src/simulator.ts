import type { TagValue } from "./tag-store.ts";

/** Deterministic simulated telemetry. Never opens a socket to industrial equipment. */
export class WaterTreatmentSimulator {
  private tick = 0;
  private readonly sequence = new Map<string, number>();

  next(at = new Date()): TagValue[] {
    this.tick++;
    const timestamp = at.toISOString();
    const level = Math.round((55 + 30 * Math.sin(this.tick / 9)) * 10) / 10;
    const running = this.tick % 48 < 40;
    const flow = running ? Math.round((15 + 4 * Math.cos(this.tick / 6)) * 10) / 10 : 0;
    const make = (tagId: string, value: number | boolean): TagValue => {
      const sequence = (this.sequence.get(tagId) ?? 0) + 1;
      this.sequence.set(tagId, sequence);
      return {
        tagId,
        value,
        quality: "GOOD",
        sourceTimestamp: timestamp,
        serverTimestamp: timestamp,
        sequence,
      };
    };
    return [
      make("water.level", level),
      make("water.pump.running", running),
      make("water.flow", flow),
    ];
  }

  /** Resume after a simulated connection interruption with a sequence newer than the store. */
  resumeAfter(storeSequences: ReadonlyMap<string, number>): void {
    for (const [tagId, sequence] of storeSequences) {
      this.sequence.set(tagId, Math.max(this.sequence.get(tagId) ?? 0, sequence));
    }
  }
}
