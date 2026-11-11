import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import { DocumentEditor } from "../src/editor.ts";
import { studioNodeLocked, studioNodeVisible } from "../src/document.ts";
import type { ScadaNode } from "../src/document.ts";
import { buildLayerTree } from "../src/layer-tree.ts";

function demoNodes(): ScadaNode[] {
  return waterTreatmentDemoDocument.pages[0]!.nodes.map((node) => ({
    ...node,
    props: { ...node.props },
  }));
}

function groupedNodes(): ScadaNode[] {
  return demoNodes().map((node) =>
    node.id === "tank" || node.id === "pump" ? { ...node, groupId: "group-1" } : node,
  );
}

test("未分组页面的图层按绘制顺序倒序排列", () => {
  const tree = buildLayerTree(demoNodes());
  expect(tree.map((entry) => (entry.kind === "node" ? entry.node.id : entry.groupId))).toEqual([
    "flow",
    "pump",
    "pipe",
    "tank",
    "title",
  ]);
  expect(tree.every((entry) => entry.kind === "node")).toBe(true);
});

test("不连续的平面组合只出现一次并按最上层成员定位", () => {
  const tree = buildLayerTree(groupedNodes());
  expect(tree.map((entry) => (entry.kind === "node" ? entry.node.id : entry.groupId))).toEqual([
    "flow",
    "group-1",
    "pipe",
    "title",
  ]);
  const group = tree[1];
  expect(group?.kind).toBe("group");
  if (group?.kind !== "group") return;
  expect(group.anchorNodeId).toBe("pump");
  expect(group.members.map((node) => node.id)).toEqual(["pump", "tank"]);
  expect(group.totalCount).toBe(2);
  expect(group.fragmented).toBe(true);
});

test("组成员连续时不再报告层序分散，成员仍按上层优先排列", () => {
  const nodes = groupedNodes();
  const pump = nodes.find((node) => node.id === "pump")!;
  const ordered = [...nodes.filter((node) => node.id !== "pump")];
  ordered.splice(2, 0, pump);
  const tree = buildLayerTree(ordered);
  const group = tree.find((entry) => entry.kind === "group");
  expect(group?.kind).toBe("group");
  if (group?.kind !== "group") return;
  expect(group.fragmented).toBe(false);
  expect(group.members.map((node) => node.id)).toEqual(["pump", "tank"]);
});

test("按组 ID 搜索可返回整个组合及全部成员", () => {
  const tree = buildLayerTree(groupedNodes(), " GROUP-1 ");
  expect(tree).toHaveLength(1);
  expect(tree[0]?.kind).toBe("group");
  if (tree[0]?.kind !== "group") return;
  expect(tree[0].members.map((node) => node.id)).toEqual(["pump", "tank"]);
});

test("按成员 ID 搜索时保留组合标题但仅展示命中成员", () => {
  const tree = buildLayerTree(groupedNodes(), " PUMP ");
  expect(tree).toHaveLength(1);
  expect(tree[0]?.kind).toBe("group");
  if (tree[0]?.kind !== "group") return;
  expect(tree[0].members.map((node) => node.id)).toEqual(["pump"]);
  expect(tree[0].totalCount).toBe(2);
});

test("搜索支持节点类型、文本属性以及大小写与首尾空格", () => {
  expect(
    buildLayerTree(demoNodes(), " LABEL ").map((entry) =>
      entry.kind === "node" ? entry.node.id : entry.groupId,
    ),
  ).toEqual(["flow", "title"]);
  expect(
    buildLayerTree(demoNodes(), "水处理系统").map((entry) =>
      entry.kind === "node" ? entry.node.id : entry.groupId,
    ),
  ).toEqual(["title"]);
  expect(buildLayerTree(demoNodes(), "不存在的图元")).toEqual([]);
});

test("锁定和隐藏统计包含全部组成员，搜索不能弱化完整组状态", () => {
  const nodes = groupedNodes().map((node) =>
    node.id === "tank"
      ? { ...node, props: { ...node.props, __scadaStudio: { locked: true, visible: false } } }
      : node,
  );
  const tree = buildLayerTree(nodes, "pump");
  expect(tree[0]?.kind).toBe("group");
  if (tree[0]?.kind !== "group") return;
  expect(tree[0].members).toHaveLength(1);
  expect(tree[0].hasLockedMember).toBe(true);
  expect(tree[0].hiddenCount).toBe(1);
  expect(studioNodeLocked(nodes[1]!)).toBe(true);
  expect(studioNodeVisible(nodes[1]!)).toBe(false);
});

test("搜索无结果、空白关键词和空页面均不改变源数组", () => {
  const source = groupedNodes();
  const original = JSON.parse(JSON.stringify(source));
  expect(buildLayerTree(source, "   ")).toHaveLength(4);
  expect(buildLayerTree(source, "找不到")).toEqual([]);
  expect(buildLayerTree([])).toEqual([]);
  expect(source).toEqual(original);
});

test("非字符串搜索关键词被明确拒绝，防止意外的运行时类型", () => {
  expect(() => buildLayerTree(demoNodes(), null as never)).toThrow(/关键词必须为字符串/);
});

test("同类型但未组合的图元不会被误合并成组", () => {
  const nodes = demoNodes().filter((node) => node.type === "label");
  const tree = buildLayerTree(nodes);
  expect(tree).toHaveLength(2);
  expect(tree.every((entry) => entry.kind === "node")).toBe(true);
});

test("组合成员的共享选中语义与图层树成员集合一致", () => {
  const editor = new DocumentEditor(waterTreatmentDemoDocument);
  editor.selectMany(["tank", "pump"]);
  const groupId = editor.groupSelected();
  editor.select("pump");
  const snapshot = editor.snapshot();
  const group = buildLayerTree(snapshot.document.pages[0]!.nodes).find(
    (entry) => entry.kind === "group" && entry.groupId === groupId,
  );
  expect(group?.kind).toBe("group");
  if (group?.kind !== "group") return;
  const ids = new Set(group.members.map((node) => node.id));
  expect(snapshot.selectedIds.every((id) => ids.has(id))).toBe(true);
  expect(snapshot.selectedIds).toHaveLength(group.totalCount);
});

test("解组后树投影立即恢复独立图元，撤销时重新出现组合", () => {
  const editor = new DocumentEditor(waterTreatmentDemoDocument);
  editor.selectMany(["tank", "pump"]);
  editor.groupSelected();
  expect(buildLayerTree(editor.snapshot().document.pages[0]!.nodes).some(
    (entry) => entry.kind === "group",
  )).toBe(true);
  editor.ungroupSelected();
  expect(buildLayerTree(editor.snapshot().document.pages[0]!.nodes).every(
    (entry) => entry.kind === "node",
  )).toBe(true);
  editor.undo();
  expect(buildLayerTree(editor.snapshot().document.pages[0]!.nodes).some(
    (entry) => entry.kind === "group",
  )).toBe(true);
});

test("只投影指定页面且搜索不会污染可撤销工程文档", () => {
  const editor = new DocumentEditor(waterTreatmentDemoDocument);
  editor.createPage("新页面");
  const id = editor.addNode("label");
  const before = editor.snapshot();
  const tree = buildLayerTree(before.document.pages[1]!.nodes, id);
  expect(tree).toHaveLength(1);
  expect(tree[0]?.kind).toBe("node");
  expect(buildLayerTree(before.document.pages[1]!.nodes, "tank")).toEqual([]);
  expect(editor.snapshot()).toEqual(before);
  expect(JSON.stringify(before.document)).not.toContain("collapsedGroupIds");
  expect(JSON.stringify(before.document)).not.toContain("layerSearch");
});
