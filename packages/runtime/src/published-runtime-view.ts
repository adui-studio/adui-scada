import { parseScadaDocument, validateProjectReleasePreflight } from "@adui/scada-core";
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

/** 只读发布运行七种状态共用的空画面说明，不允许暗示模拟或实时 Tag 已接入。 */
export const PUBLISHED_RUNTIME_EMPTY_HINTS: Readonly<Record<PublishedRuntimeStatus, string>> =
  Object.freeze({
    idle: "请输入已授权工程 ID，读取正式发布后显示静态组态预览",
    loading: "正在验证正式发布指针及快照，核验完成前不展示画面",
    unreleased: "当前工程尚无可展示的正式发布版本",
    verified: "当前已验证快照没有可展示的组态画面",
    offline: "发布服务不可用，画面已清空；恢复后必须重新核验",
    denied: "当前登录会话无权读取此工程的正式发布内容",
    error: "正式发布快照校验未通过，已停止展示画面",
  });

/**
 * 只预览已验证快照中的静态 SVG 配置，故意传入空 Tag 值。
 * 绝不从模拟 SSE、Studio 编辑 head 或 IndexedDB 草稿补充运行时数值。
 * 图元中缺失 Tag 时的 BAD 占位不是现场设备故障诊断。
 */
export function publishedSnapshotSvg(snapshot: ProjectSnapshot, pageId?: string): string {
  const document = parseScadaDocument(snapshot.document);
  if (!validateProjectReleasePreflight(document).passed) {
    throw new TypeError("已发布快照与当前 SVG 运行时不兼容");
  }
  // 只允许读取当前已验证快照的页面；不访问编辑中的工程或任何实时 Tag 源。
  return svgDataUrl(document, [], pageId);
}
