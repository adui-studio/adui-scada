import type { ScadaNode } from "./document.ts";

/** 展开所选节点所属的全部平面组合，供拖动预览与提交统一使用。 */
export function expandGroupedSelection(
  nodes: readonly ScadaNode[],
  nodeIds: readonly string[],
): Set<string> {
  const selected = new Set(nodeIds);
  if (selected.size !== nodeIds.length) throw new TypeError("选择中包含重复图元");
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  if ([...selected].some((id) => !lookup.has(id))) throw new RangeError("所选图元不存在");
  const groups = new Set(
    [...selected]
      .map((id) => lookup.get(id)?.groupId)
      .filter((groupId): groupId is string => groupId !== undefined),
  );
  for (const node of nodes) {
    if (node.groupId && groups.has(node.groupId)) selected.add(node.id);
  }
  return selected;
}
