import type { TagValue } from "./tag-store.ts";

/** 可复现的模拟遥测数据，不会向工业设备建立任何网络连接。 */
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

  /** 模拟断线恢复后，从大于当前 TagStore 的序列号继续生成数据。 */
  resumeAfter(storeSequences: ReadonlyMap<string, number>): void {
    for (const [tagId, sequence] of storeSequences) {
      this.sequence.set(tagId, Math.max(this.sequence.get(tagId) ?? 0, sequence));
    }
  }
}
