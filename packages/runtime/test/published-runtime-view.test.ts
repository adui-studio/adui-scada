import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
import { describe, expect, it } from "vite-plus/test";
import {
  PUBLISHED_RUNTIME_EMPTY_HINTS,
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

  it("同一已验证快照可按页面 ID 切换静态 SVG，且拒绝不存在的页面", async () => {
    const document = JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) as ScadaDocument;
    const originalPage = document.pages[0]!;
    const auxiliary = JSON.parse(JSON.stringify(originalPage)) as ScadaDocument["pages"][number];
    auxiliary.id = "auxiliary";
    auxiliary.name = "辅助工段";
    auxiliary.nodes = [
      {
        ...auxiliary.nodes[0]!,
        id: "auxiliary-title",
        props: { text: "辅助工段静态画面" },
      },
    ];
    document.pages.push(auxiliary);
    const snapshot = await createProjectSnapshot(document, {
      revision: 1,
      createdAt: "2026-11-20T00:00:00.000Z",
    });
    const first = decodeURIComponent(publishedSnapshotSvg(snapshot).split(",")[1] ?? "");
    const nextSource = publishedSnapshotSvg(snapshot, "auxiliary");
    const next = decodeURIComponent(nextSource.split(",")[1] ?? "");

    expect(first).toContain("水处理系统 / V0.1");
    expect(next).toContain("辅助工段静态画面");
    expect(next).not.toContain("水处理系统 / V0.1");
    expect(next).not.toContain("GOOD");
    expect(() => publishedSnapshotSvg(snapshot, "missing-page")).toThrow(/未找到页面/);
  });

  it("有效 SHA-256 快照包含不支持的规则或图元时拒绝生成静态发布画面", async () => {
    for (const change of [
      (document: ScadaDocument) => {
        document.pages[0]!.nodes[0]!.symbolVersion = "2";
      },
      (document: ScadaDocument) => {
        document.pages[0]!.nodes[0]!.rules = [{ action: "write" }];
      },
    ]) {
      const document = JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) as ScadaDocument;
      change(document);
      const snapshot = await createProjectSnapshot(document, {
        revision: 1,
        createdAt: "2026-11-20T00:00:00.000Z",
      });
      expect(() => publishedSnapshotSvg(snapshot)).toThrow("已发布快照与当前 SVG 运行时不兼容");
    }
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
