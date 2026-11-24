import { describe, expect, it } from "vite-plus/test";
import { waterTreatmentStudioDocument } from "@adui/scada-core";
import {
  WORKSPACE_ROUTE_PATHS,
  workspaceStudioPath,
  workspaceViewFromRouteName,
  stageWorkspaceStudioEntry,
  takeWorkspaceStudioEntry,
} from "../src/workspace-routes.ts";

describe("双端工作区路由", () => {
  it("仅登记四个真实功能入口", () => {
    expect(Object.values(WORKSPACE_ROUTE_PATHS)).toEqual([
      "/",
      "/runtime",
      "/published",
      "/studio",
    ]);
    expect(workspaceViewFromRouteName("studio")).toBe("studio");
    expect(workspaceViewFromRouteName("unknown")).toBe("home");
  });

  it("工程路由使用稳定 ID 并拒绝路径遍历与空 ID", () => {
    expect(workspaceStudioPath("project-123")).toBe("/studio/project-123");
    expect(() => workspaceStudioPath("../other")).toThrow("本地草稿工程 ID");
    expect(() => workspaceStudioPath("")).toThrow("本地草稿工程 ID");
  });

  it("工程正文只在当前应用内交接一次，不能跨工程复用", () => {
    const entry = { document: waterTreatmentStudioDocument, notice: "内置示例", clean: true };
    stageWorkspaceStudioEntry(entry);
    expect(takeWorkspaceStudioEntry(entry.document.projectId)).toBe(entry);
    expect(takeWorkspaceStudioEntry(entry.document.projectId)).toBeNull();
    stageWorkspaceStudioEntry(entry);
    expect(takeWorkspaceStudioEntry("other")).toBeNull();
    expect(takeWorkspaceStudioEntry(entry.document.projectId)).toBeNull();
  });
});
