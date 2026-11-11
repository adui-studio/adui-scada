import { studioNodeLocked, studioNodeVisible } from "./document.ts";
import type { ScadaNode } from "./document.ts";

/** 图层面板只读投影：不修改工程节点顺序，也不产生持久化的组树。 */
export interface LayerTreeNode {
  readonly kind: "node";
  readonly node: ScadaNode;
}

export interface LayerTreeGroup {
  readonly kind: "group";
  readonly groupId: string;
  /** 组合最上层的节点 ID，可作为现有图层移动命令的锚点。 */
  readonly anchorNodeId: string;
  /** 按视觉层序从上到下排列，搜索时仅保留命中的成员。 */
  readonly members: readonly ScadaNode[];
  readonly totalCount: number;
  readonly hasLockedMember: boolean;
  readonly hiddenCount: number;
  /** 历史工程可能存在组成员在 nodes[] 中不连续的情况。 */
  readonly fragmented: boolean;
}

export type LayerTreeEntry = LayerTreeNode | LayerTreeGroup;

function matchesNode(node: ScadaNode, keyword: string): boolean {
  const text = node.props.text;
  const name = node.props.name;
  const values = [
    node.id,
    node.type,
    typeof text === "string" ? text : "",
    typeof name === "string" ? name : "",
  ];
  return values.some((value) => value.toLocaleLowerCase().includes(keyword));
}

/**
 * 将平面 SVG 图层投影为一层组合树。最上层在顶部，组合按最上层成员定位。
 * 搜索不会更改工程或撤销历史，命中组 ID 时显示整组，命中成员时只显示匹配成员。
 */
export function buildLayerTree(nodes: readonly ScadaNode[], query = ""): LayerTreeEntry[] {
  if (typeof query !== "string") throw new TypeError("图层搜索关键词必须为字符串");
  const keyword = query.trim().toLocaleLowerCase();
  const groups = new Map<string, { members: ScadaNode[]; positions: number[] }>();
  nodes.forEach((node, index) => {
    if (!node.groupId) return;
    const group = groups.get(node.groupId) ?? { members: [], positions: [] };
    group.members.push(node);
    group.positions.push(index);
    groups.set(node.groupId, group);
  });

  const emitted = new Set<string>();
  const result: LayerTreeEntry[] = [];
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!;
    if (!node.groupId) {
      if (!keyword || matchesNode(node, keyword)) result.push({ kind: "node", node });
      continue;
    }
    const id = node.groupId;
    if (emitted.has(id)) continue;
    emitted.add(id);
    const group = groups.get(id)!;
    const allMembers = [...group.members].reverse();
    const visibleMembers =
      keyword && !id.toLocaleLowerCase().includes(keyword)
        ? allMembers.filter((member) => matchesNode(member, keyword))
        : allMembers;
    if (visibleMembers.length === 0) continue;
    const positions = group.positions;
    result.push({
      kind: "group",
      groupId: id,
      anchorNodeId: node.id,
      members: visibleMembers,
      totalCount: group.members.length,
      hasLockedMember: group.members.some(studioNodeLocked),
      hiddenCount: group.members.filter((member) => !studioNodeVisible(member)).length,
      fragmented: positions[positions.length - 1]! - positions[0]! + 1 !== positions.length,
    });
  }
  return result;
}
