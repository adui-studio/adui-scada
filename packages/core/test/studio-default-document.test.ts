import { expect, test } from "vite-plus/test";
import {
  STUDIO_DEFAULT_PAGE_SIZE,
  createBlankStudioDocument,
  waterTreatmentDemoDocument,
  waterTreatmentStudioDocument,
  waterTreatmentShowcaseDocument,
} from "../src/demo-document.ts";
import { parseScadaDocument } from "../src/document.ts";
import { DocumentEditor } from "../src/editor.ts";

test("全新 Studio 演示画板默认 1920×1080，且展示图元按相同比例缩放", () => {
  expect(STUDIO_DEFAULT_PAGE_SIZE).toEqual({ width: 1920, height: 1080 });
  expect(waterTreatmentStudioDocument.pages[0]?.size).toEqual(STUDIO_DEFAULT_PAGE_SIZE);
  expect(STUDIO_DEFAULT_PAGE_SIZE.width / STUDIO_DEFAULT_PAGE_SIZE.height).toBeCloseTo(16 / 9);
  const source = waterTreatmentDemoDocument.pages[0];
  const studio = waterTreatmentStudioDocument.pages[0];
  expect(source).toBeDefined();
  expect(studio).toBeDefined();
  const sourceTank = source!.nodes.find((node) => node.id === "tank");
  const studioTank = studio!.nodes.find((node) => node.id === "tank");
  expect(studioTank?.transform).toMatchObject({
    x: 240,
    y: 330,
    width: 300,
    height: 410,
    rotation: 0,
  });
  const sourcePipe = source!.nodes.find((node) => node.id === "pipe");
  const studioPipe = studio!.nodes.find((node) => node.id === "pipe");
  expect(studioPipe?.transform.width).toBe(sourcePipe!.transform.width * 2);
  expect(studioPipe?.transform.height).toBe(sourcePipe!.transform.height * 2);
  expect(studioTank?.bindings).toEqual(sourceTank?.bindings);
  for (const node of studio!.nodes) {
    expect(node.transform.x).toBeGreaterThanOrEqual(0);
    expect(node.transform.y).toBeGreaterThanOrEqual(0);
    expect(node.transform.x + node.transform.width).toBeLessThanOrEqual(
      STUDIO_DEFAULT_PAGE_SIZE.width,
    );
    expect(node.transform.y + node.transform.height).toBeLessThanOrEqual(
      STUDIO_DEFAULT_PAGE_SIZE.height,
    );
  }
  expect(parseScadaDocument(waterTreatmentStudioDocument)).toEqual(waterTreatmentStudioDocument);
});

test("新页面继承 1920×1080，页面复制和撤销不改变画板大小", () => {
  const editor = new DocumentEditor(waterTreatmentStudioDocument);
  const createdId = editor.createPage("新的控制画面");
  const created = editor.snapshot().document.pages.find((page) => page.id === createdId);
  expect(created?.size).toEqual(STUDIO_DEFAULT_PAGE_SIZE);
  expect(created?.nodes).toEqual([]);
  const duplicatedId = editor.duplicatePage(createdId);
  const duplicated = editor.snapshot().document.pages.find((page) => page.id === duplicatedId);
  expect(duplicated?.size).toEqual(STUDIO_DEFAULT_PAGE_SIZE);
  expect(editor.undo()).toBe(true);
  expect(editor.snapshot().document.pages.some((page) => page.id === duplicatedId)).toBe(false);
});

test("既有工程仍保留 880×460 原始尺寸，导入不会被默认值覆盖", () => {
  const legacy = parseScadaDocument(waterTreatmentDemoDocument);
  expect(legacy.pages[0]?.size).toEqual({ width: 880, height: 460 });
  const editor = new DocumentEditor(legacy);
  const nextId = editor.createPage("沿用旧画板");
  expect(editor.snapshot().document.pages.find((page) => page.id === nextId)?.size).toEqual({
    width: 880,
    height: 460,
  });
  expect(waterTreatmentDemoDocument.pages[0]?.nodes[0]?.transform).toMatchObject({
    x: 44,
    y: 30,
    width: 600,
    height: 36,
  });
});

test("新建独立工程采用共享默认画板且不携带演示 Tag 或图元", () => {
  const first = createBlankStudioDocument("project-first");
  const second = createBlankStudioDocument("project-second");
  expect(first.projectId).toBe("project-first");
  expect(second.projectId).toBe("project-second");
  expect(first.pages[0]?.size).toEqual(STUDIO_DEFAULT_PAGE_SIZE);
  expect(first.pages[0]?.nodes).toEqual([]);
  expect(first.tags).toEqual([]);
  expect(parseScadaDocument(first)).toEqual(first);
  expect(() => createBlankStudioDocument("../invalid")).toThrow(/稳定 ASCII 标识符/);
  expect(waterTreatmentStudioDocument.projectId).toBe("water-demo");
});

test("独立总览示例保留真实模拟 Tag 定义且不覆盖历史水处理工程", () => {
  const showcase = waterTreatmentShowcaseDocument;
  expect(showcase.projectId).toBe("water-showcase");
  expect(showcase.tags).toEqual(waterTreatmentDemoDocument.tags);
  expect(showcase.pages[0]?.size).toEqual(STUDIO_DEFAULT_PAGE_SIZE);
  expect(showcase.pages[0]?.nodes.filter((node) => node.props.presentation === "metric")).toHaveLength(3);
  expect(parseScadaDocument(showcase)).toEqual(showcase);
  for (const node of showcase.pages[0]!.nodes) {
    expect(node.transform.x + node.transform.width).toBeLessThanOrEqual(1920);
    expect(node.transform.y + node.transform.height).toBeLessThanOrEqual(1080);
  }
  expect(waterTreatmentStudioDocument.projectId).toBe("water-demo");
});
