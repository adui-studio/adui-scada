import { localDraftKey } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";

/** 双端使用相同的真实工作区路径；未实现模块不注册路由。 */
export const WORKSPACE_ROUTE_PATHS = {
  home: "/",
  runtime: "/runtime",
  published: "/published",
  studio: "/studio",
} as const;

export type WorkspaceView = keyof typeof WORKSPACE_ROUTE_PATHS;

export function workspaceViewFromRouteName(name: unknown): WorkspaceView {
  if (name === "runtime" || name === "published" || name === "studio") return name;
  return "home";
}

export function workspaceStudioPath(projectId: string): string {
  localDraftKey(projectId);
  return `/studio/${encodeURIComponent(projectId)}`;
}

export interface WorkspaceStudioEntry {
  readonly document: ScadaDocument;
  readonly notice: string;
  /** 已确认可重新打开的初始内容，而非仅存在于编辑会话中的导入文件。 */
  readonly clean: boolean;
}

// 完整工程仅在当前应用内短暂交接，不写入 URL、history.state 或持久化存储。
let pendingStudioEntry: WorkspaceStudioEntry | null = null;

export function stageWorkspaceStudioEntry(entry: WorkspaceStudioEntry): void {
  localDraftKey(entry.document.projectId);
  pendingStudioEntry = entry;
}

export function takeWorkspaceStudioEntry(projectId: string | undefined): WorkspaceStudioEntry | null {
  const pending = pendingStudioEntry;
  pendingStudioEntry = null;
  return pending && pending.document.projectId === projectId ? pending : null;
}
