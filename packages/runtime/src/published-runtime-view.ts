import { parseScadaDocument } from "@adui/scada-core";
import type { ProjectSnapshot } from "@adui/scada-core";
import { svgDataUrl } from "./runtime.ts";
import type { PublishedRuntimeStatus } from "./published-runtime.ts";

/** 双框架共享状态文案，静态发布快照验证不代表现场采集正常。 */
export const PUBLISHED_RUNTIME_STATUS_LABELS: Readonly<Record<PublishedRuntimeStatus, string>> =
  Object.freeze({
    idle: "未启动",
    loading: "正在核对发布指针",
    unreleased: "尚未发布",
    verified: "发布快照已验证",
    offline: "发布服务离线",
    denied: "无读取权限",
    error: "发布数据不可用",
  });

/**
 * 只预览已验证快照中的静态 SVG 配置，故意传入空 Tag 值。
 * 绝不从模拟 SSE、Studio 编辑 head 或 IndexedDB 草稿补充运行时数值。
 * 图元中缺失 Tag 时的 BAD 占位不是现场设备故障诊断。
 */
export function publishedSnapshotSvg(snapshot: ProjectSnapshot): string {
  return svgDataUrl(parseScadaDocument(snapshot.document), []);
}
