import { waterTreatmentShowcaseDocument } from "@adui/scada-core";
import { svgDataUrl } from "./runtime.ts";

export type WorkspaceHomeView = "studio" | "runtime" | "published";

export interface WorkspaceHomeEntry {
  readonly view: WorkspaceHomeView;
  readonly action: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly detail: string;
  readonly preview?: string;
}

/** 真实工作区目录；工程预览不携带实时值。 */
export const WORKSPACE_HOME_ENTRIES: readonly WorkspaceHomeEntry[] = [
  {
    view: "studio",
    action: "打开组态编辑器",
    title: "水处理演示工程",
    description: "设计工艺画面，管理图层、图元与项目 Tag。",
    status: "内置示例",
    detail: `${waterTreatmentShowcaseDocument.pages.length} 个页面 · ${waterTreatmentShowcaseDocument.tags.length} 个 Tag 定义`,
    preview: svgDataUrl(waterTreatmentShowcaseDocument, [], undefined, "light"),
  },
  {
    view: "runtime",
    action: "查看模拟运行",
    title: "水处理模拟监控",
    description: "查看模拟工艺画面、链路诊断与数据质量。",
    status: "模拟只读",
    detail: "进入工作区后连接模拟数据源",
  },
  {
    view: "published",
    action: "查看已发布工程",
    title: "已发布工程预览",
    description: "经受控接口读取正式发布的静态组态快照。",
    status: "受控只读",
    detail: "需通过发布读取权限校验",
  },
];

/** 搜索实际工作区，不虚构最近文件或搜索服务。 */
export function filterWorkspaceHomeEntries(query: string): readonly WorkspaceHomeEntry[] {
  const keyword = query.trim().toLowerCase();
  return WORKSPACE_HOME_ENTRIES.filter((entry) =>
    [entry.title, entry.action, entry.description, entry.status, entry.detail]
      .join(" ")
      .toLowerCase()
      .includes(keyword),
  );
}
