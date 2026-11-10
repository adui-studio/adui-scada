import { studioNodeVisible } from "./document.ts";
import type { ScadaDocument, ScadaNode } from "./document.ts";
import { TAG_QUALITY_LABELS } from "./tag-store.ts";
import type { TagValue, TagQuality } from "./tag-store.ts";

const COLORS: Record<TagQuality, string> = {
  GOOD: "#30c5a0",
  UNCERTAIN: "#f0ae4d",
  BAD: "#f16c75",
  STALE: "#8391a9",
};

function xml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function number(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function tagFor(
  node: ScadaNode,
  slot: string,
  values: ReadonlyMap<string, TagValue>,
): TagValue | undefined {
  const id = node.bindings[slot]?.tagId;
  return id === undefined ? undefined : values.get(id);
}

function indicator(tag: TagValue | undefined): string {
  return COLORS[tag?.quality ?? "BAD"];
}

function quality(tag: TagValue | undefined): string {
  return TAG_QUALITY_LABELS[tag?.quality ?? "BAD"];
}

function renderTank(node: ScadaNode, tags: ReadonlyMap<string, TagValue>): string {
  const { width: w, height: h } = node.transform;
  const tag = tagFor(node, "level", tags);
  const valid = tag?.quality === "GOOD" || tag?.quality === "UNCERTAIN";
  const percent =
    valid && typeof tag.value === "number" ? Math.min(100, Math.max(0, tag.value)) : null;
  const innerHeight = percent === null ? 0 : ((h - 10) * percent) / 100;
  const label = percent === null ? "--" : `${number(percent)}%`;
  return (
    `<rect x="0" y="0" width="${number(w)}" height="${number(h)}" rx="8" fill="#17293d" stroke="${indicator(tag)}" stroke-width="3"/>` +
    `<rect x="5" y="${number(h - 5 - innerHeight)}" width="${number(w - 10)}" height="${number(innerHeight)}" rx="3" fill="${indicator(tag)}" fill-opacity=".66"/>` +
    `<text x="${number(w / 2)}" y="${number(h / 2)}" text-anchor="middle" font-size="20" fill="#ffffff">${xml(label)}</text>` +
    `<text x="${number(w / 2)}" y="${number(h + 22)}" text-anchor="middle" font-size="13" fill="${indicator(tag)}">${quality(tag)}</text>`
  );
}

function renderPump(node: ScadaNode, tags: ReadonlyMap<string, TagValue>): string {
  const { width: w, height: h } = node.transform;
  const tag = tagFor(node, "running", tags);
  const running = tag?.quality === "GOOD" && tag.value === true;
  const valueText = tag?.quality !== "GOOD" ? quality(tag) : running ? "运行中" : "已停止";
  return (
    `<circle cx="${number(w / 2)}" cy="${number(h / 2)}" r="${number(Math.max(1, Math.min(w, h) / 2 - 4))}" fill="#17293d" stroke="${indicator(tag)}" stroke-width="4"/>` +
    `<path d="M ${number(w * 0.36)} ${number(h * 0.32)} L ${number(w * 0.7)} ${number(h * 0.5)} L ${number(w * 0.36)} ${number(h * 0.68)} Z" fill="${running ? indicator(tag) : "#61758e"}"/>` +
    `<text x="${number(w / 2)}" y="${number(h + 20)}" text-anchor="middle" font-size="13" fill="${indicator(tag)}">${xml(valueText)}</text>`
  );
}

function renderPipe(node: ScadaNode): string {
  const { width: w, height: h } = node.transform;
  return `<path d="M 0 ${number(h / 2)} L ${number(w)} ${number(h / 2)}" stroke="#3e6687" stroke-width="${number(Math.max(4, Math.min(h, 24)))}" stroke-linecap="round" fill="none"/>`;
}

function renderLabel(node: ScadaNode, tags: ReadonlyMap<string, TagValue>): string {
  const text = typeof node.props.text === "string" ? node.props.text : "";
  const value = tagFor(node, "value", tags);
  const suffix = typeof node.props.unit === "string" ? node.props.unit : "";
  const dynamic =
    value === undefined
      ? ""
      : `: ${value.quality === "GOOD" ? String(value.value ?? "--") : "--"} ${suffix}`;
  return `<text x="0" y="${number(Math.min(24, node.transform.height))}" font-size="20" fill="#e6edf6">${xml(text + dynamic)}</text>`;
}

function renderNode(node: ScadaNode, tags: ReadonlyMap<string, TagValue>): string {
  const t = node.transform;
  let body: string;
  switch (node.type) {
    case "tank":
      body = renderTank(node, tags);
      break;
    case "pump":
      body = renderPump(node, tags);
      break;
    case "pipe":
      body = renderPipe(node);
      break;
    case "label":
      body = renderLabel(node, tags);
      break;
    default:
      body =
        `<rect width="${number(t.width)}" height="${number(t.height)}" fill="#43212c" stroke="#f16c75"/>` +
        `<text x="4" y="20" fill="#fff" font-size="12">不支持的图元：${xml(node.type)}</text>`;
  }
  return `<g data-node-id="${xml(node.id)}" transform="translate(${number(t.x)} ${number(t.y)}) rotate(${number(t.rotation)} ${number(t.width / 2)} ${number(t.height / 2)})">${body}</g>`;
}

/**
 * 对已校验的工程文档进行纯 SVG 序列化。
 * 只输出白名单图元与安全转义的文本，不输出原始属性、脚本或事件处理器。
 */
export function renderSvgPage(
  document: ScadaDocument,
  pageId: string,
  values: ReadonlyMap<string, TagValue>,
): string {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new RangeError(`未找到页面：${pageId}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${xml(page.name)}" ` +
    `viewBox="0 0 ${number(page.size.width)} ${number(page.size.height)}">` +
    `<rect width="100%" height="100%" fill="#0c1728"/>` +
    page.nodes.filter(studioNodeVisible).map((node) => renderNode(node, values)).join("") +
    "</svg>"
  );
}
