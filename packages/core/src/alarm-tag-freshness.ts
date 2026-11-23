import { classifyNumericAlarmSample } from "./alarm-tag-quality.ts";
import type { NumericAlarmSample } from "./alarm-tag-quality.ts";
import type { TagValue } from "./tag-store.ts";

const ZONED_SERVER_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const days = DAYS_IN_MONTH[month - 1];
  if (days === undefined) return false;
  const leapYear = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day >= 1 && day <= days + (leapYear ? 1 : 0);
}

/** 有效数值仅是候选；时间窗口检查不能证明数据来源及采集时间可信。 */
export type TimelyNumericAlarmSample =
  | NumericAlarmSample
  | { readonly status: "FUTURE_TIMESTAMP" | "OUTDATED_TIMESTAMP" };

/**
 * 按调用方显式提供的时间和最大年龄检查 Tag 的服务端时间。
 * 先执行数值与质量筛选；候选服务器时间须包含显式时区和真实公历日期，
 * 且小时采用 RFC 3339 的 00–23 表示，不能隐式滚动到次日。
 * 不自动获取当前时间，不推断阈值或生成报警事件。
 * 调用方仍需校验数据来源、服务端时间可信性与订阅会话代次。
 */
export function classifyTimelyNumericAlarmSample(
  input: TagValue,
  nowMs: number,
  maxAgeMs: number,
): TimelyNumericAlarmSample {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("当前时间参数无效");
  }
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new TypeError("最大数据年龄参数无效");
  }

  const candidate = classifyNumericAlarmSample(input);
  if (candidate.status !== "READY") return candidate;
  // 通用 TagStore 接受 Date.parse 可识别的时间；报警候选不能接受依赖宿主时区解释的无偏移时间。
  const match = ZONED_SERVER_TIMESTAMP_PATTERN.exec(input.serverTimestamp);
  if (match === null) {
    throw new TypeError("报警服务器时间戳必须包含明确时区");
  }
  // Date.parse 可能将不存在的公历日期自动滚动到下个月，候选不能接受这种归一化。
  if (!isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw new TypeError("报警服务器时间戳日期无效");
  }
  // 某些宿主允许 24:00 表示次日零点，报警候选统一要求规范的 00–23 小时。
  if (Number(match[4]) > 23) {
    throw new TypeError("报警服务器时间戳小时无效");
  }

  const sampleMs = Date.parse(input.serverTimestamp);
  if (sampleMs > nowMs) return { status: "FUTURE_TIMESTAMP" };
  if (nowMs - sampleMs > maxAgeMs) return { status: "OUTDATED_TIMESTAMP" };
  return candidate;
}
