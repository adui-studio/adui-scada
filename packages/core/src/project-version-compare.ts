import { migrateScadaDocument } from "./document.ts";
import type { ScadaDocument } from "./document.ts";

/** 工程概要不包含明细或 Tag 实时值，只统计本地组态结构。 */
export interface ProjectDocumentMetrics {
  readonly pageCount: number;
  readonly nodeCount: number;
  readonly bindingCount: number;
}

export interface ProjectDocumentComparison {
  readonly sameContent: boolean;
  readonly current: ProjectDocumentMetrics;
  readonly historical: ProjectDocumentMetrics;
}

function metrics(document: ScadaDocument): ProjectDocumentMetrics {
  let nodeCount = 0;
  let bindingCount = 0;
  for (const page of document.pages) {
    nodeCount += page.nodes.length;
    for (const node of page.nodes) bindingCount += Object.keys(node.bindings).length;
  }
  return { pageCount: document.pages.length, nodeCount, bindingCount };
}

/** JSON 对象键顺序不应造成误报；页面与图元数组顺序属于工程内容。 */
function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    );
  }
  if (typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  );
}

/** 同一工程当前编辑内容与历史版本的纯数据比较，不修改编辑历史。 */
export function compareProjectDocuments(
  current: unknown,
  historical: unknown,
): ProjectDocumentComparison {
  const a = migrateScadaDocument(current).document;
  const b = migrateScadaDocument(historical).document;
  if (a.projectId !== b.projectId) {
    throw new TypeError("版本比较只能针对同一个工程");
  }
  return {
    sameContent: sameJson(a, b),
    current: metrics(a),
    historical: metrics(b),
  };
}
