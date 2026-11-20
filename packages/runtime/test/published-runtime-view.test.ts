import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import { describe, expect, it } from "vite-plus/test";
import {
  PUBLISHED_RUNTIME_STATUS_LABELS,
  publishedSnapshotSvg,
} from "../src/published-runtime-view.ts";

describe("双框架已发布运行画面只读预览", () => {
  it("所有状态都使用已审核中文文案，不将快照已验证称为实时在线", () => {
    const labels = PUBLISHED_RUNTIME_STATUS_LABELS;
    expect(Object.keys(labels).sort()).toEqual([
      "denied",
      "error",
      "idle",
      "loading",
      "offline",
      "unreleased",
      "verified",
    ]);
    expect(labels.verified).toBe("发布快照已验证");
    expect(labels.offline).toBe("发布服务离线");
  });

  it("静态 SVG 使用已验证工程正文并拒绝填充模拟 Tag 实时值", async () => {
    const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
      revision: 1,
      createdAt: "2026-11-20T00:00:00.000Z",
    });
    const source = publishedSnapshotSvg(snapshot);
    const svg = decodeURIComponent(source.split(",")[1] ?? "");
    expect(source.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(svg).toContain("<svg");
    expect(svg).toContain('role="img"');
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("onload=");
    expect(svg).not.toContain("GOOD");
    expect(svg).not.toContain("模拟数据连接正常");
  });

  it("无工程页面的已发布快照不能悄悄回退到演示画面", async () => {
    const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, {
      revision: 1,
      createdAt: "2026-11-20T00:00:00.000Z",
    });
    expect(() =>
      publishedSnapshotSvg({
        ...snapshot,
        document: { ...snapshot.document, pages: [] },
      }),
    ).toThrow(/页面数量必须/);
  });
});
