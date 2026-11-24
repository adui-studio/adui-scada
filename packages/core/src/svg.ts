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

/** 浅色编辑画板的状态文字使用深色，保留原始工业质量语义。 */
const LIGHT_COLORS: Record<TagQuality, string> = {
  GOOD: "#087c61",
  UNCERTAIN: "#996009",
  BAD: "#bd3043",
  STALE: "#61758a",
};

const LIGHT_DEFINITIONS =
  '<defs><linearGradient id="scada-metal" x1="0%" x2="100%" y1="0%" y2="0%">' +
  '<stop offset="0" stop-color="#9aaabb"/><stop offset=".35" stop-color="#f5f8fc"/>' +
  '<stop offset=".7" stop-color="#d2dce8"/><stop offset="1" stop-color="#879bb1"/>' +
  '</linearGradient><linearGradient id="scada-water" x1="0%" x2="0%" y1="0%" y2="100%">' +
  '<stop offset="0" stop-color="#c9e9fa"/><stop offset="1" stop-color="#579dcf"/>' +
  "</linearGradient></defs>";

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

function renderTank(
  node: ScadaNode,
  tags: ReadonlyMap<string, TagValue>,
  appearance: "dark" | "light",
): string {
  const { width: w, height: h } = node.transform;
  const tag = tagFor(node, "level", tags);
  const valid = tag?.quality === "GOOD" || tag?.quality === "UNCERTAIN";
  const percent =
    valid && typeof tag.value === "number" ? Math.min(100, Math.max(0, tag.value)) : null;
  const innerHeight = percent === null ? 0 : ((h - 10) * percent) / 100;
  const label = percent === null ? "--" : `${number(percent)}%`;
  if (appearance === "light") {
    const levelHeight = percent === null ? 0 : (78 * percent) / 100;
    const color = LIGHT_COLORS[tag?.quality ?? "BAD"];
    return (
      `<svg width="${number(w)}" height="${number(h)}" viewBox="0 0 100 150" preserveAspectRatio="none">` +
      '<rect x="22" y="8" width="56" height="12" rx="4" fill="url(#scada-metal)" stroke="#8699ad"/>' +
      '<rect x="14" y="16" width="72" height="112" rx="12" fill="url(#scada-metal)" stroke="#8699ad"/>' +
      '<rect x="23" y="32" width="54" height="78" rx="2" fill="#e6eff6" stroke="#9baec2"/>' +
      `<rect x="23" y="${number(110 - levelHeight)}" width="54" height="${number(levelHeight)}" fill="url(#scada-water)"/>` +
      '<path d="M14 26H86M14 117H86M25 128V138M75 128V138" stroke="#8699ad" stroke-width="3"/>' +
      '<rect x="28" y="58" width="44" height="27" rx="4" fill="#ffffff" fill-opacity=".9"/>' +
      `<text x="50" y="75" text-anchor="middle" font-size="12" font-weight="600" fill="#142338">${xml(label)}</text>` +
      `<text x="50" y="146" text-anchor="middle" font-size="9" fill="${color}">${quality(tag)}</text>` +
      "</svg>"
    );
  }
  return (
    `<rect x="0" y="0" width="${number(w)}" height="${number(h)}" rx="8" fill="#17293d" stroke="${indicator(tag)}" stroke-width="3"/>` +
    `<rect x="5" y="${number(h - 5 - innerHeight)}" width="${number(w - 10)}" height="${number(innerHeight)}" rx="3" fill="${indicator(tag)}" fill-opacity=".66"/>` +
    `<text x="${number(w / 2)}" y="${number(h / 2)}" text-anchor="middle" font-size="20" fill="#ffffff">${xml(label)}</text>` +
    `<text x="${number(w / 2)}" y="${number(h + 22)}" text-anchor="middle" font-size="13" fill="${indicator(tag)}">${quality(tag)}</text>`
  );
}

function renderPump(
  node: ScadaNode,
  tags: ReadonlyMap<string, TagValue>,
  appearance: "dark" | "light",
): string {
  const { width: w, height: h } = node.transform;
  const tag = tagFor(node, "running", tags);
  const running = tag?.quality === "GOOD" && tag.value === true;
  const valueText = tag?.quality !== "GOOD" ? quality(tag) : running ? "运行中" : "已停止";
  if (appearance === "light") {
    const color = LIGHT_COLORS[tag?.quality ?? "BAD"];
    const motor = running ? "#b7e9d2" : "#d5dde7";
    return (
      `<svg width="${number(w)}" height="${number(h)}" viewBox="0 0 120 100" preserveAspectRatio="xMidYMid meet">` +
      '<rect x="14" y="73" width="94" height="8" rx="2" fill="#9cacc0"/>' +
      '<rect x="10" y="36" width="9" height="30" rx="2" fill="url(#scada-metal)"/>' +
      `<rect x="19" y="27" width="51" height="47" rx="8" fill="${motor}" stroke="#8699ad"/>` +
      '<path d="M29 32V68M36 32V68M43 32V68M50 32V68M57 32V68" stroke="#8699ad" stroke-width="2"/>' +
      '<rect x="26" y="20" width="20" height="9" rx="2" fill="url(#scada-metal)"/>' +
      '<rect x="70" y="40" width="11" height="24" fill="url(#scada-metal)"/>' +
      '<circle cx="91" cy="51" r="23" fill="url(#scada-metal)" stroke="#8699ad" stroke-width="2"/>' +
      '<rect x="91" y="22" width="17" height="16" rx="2" fill="url(#scada-metal)" stroke="#8699ad"/>' +
      `<path d="M84 42L99 51L84 60Z" fill="${running ? color : "#61758a"}"/>` +
      `<text x="60" y="94" text-anchor="middle" font-size="11" fill="${color}">${xml(valueText)}</text>` +
      "</svg>"
    );
  }
  return (
    `<circle cx="${number(w / 2)}" cy="${number(h / 2)}" r="${number(Math.max(1, Math.min(w, h) / 2 - 4))}" fill="#17293d" stroke="${indicator(tag)}" stroke-width="4"/>` +
    `<path d="M ${number(w * 0.36)} ${number(h * 0.32)} L ${number(w * 0.7)} ${number(h * 0.5)} L ${number(w * 0.36)} ${number(h * 0.68)} Z" fill="${running ? indicator(tag) : "#61758e"}"/>` +
    `<text x="${number(w / 2)}" y="${number(h + 20)}" text-anchor="middle" font-size="13" fill="${indicator(tag)}">${xml(valueText)}</text>`
  );
}

function renderPipe(node: ScadaNode, appearance: "dark" | "light"): string {
  const { width: w, height: h } = node.transform;
  if (appearance === "light") {
    const line = `M 0 ${number(h / 2)} L ${number(w)} ${number(h / 2)}`;
    const thickness = Math.max(0.1, Math.min(h, 24));
    return (
      `<path d="${line}" stroke="#8699ad" stroke-width="${number(thickness)}" stroke-linecap="butt" fill="none"/>` +
      `<path d="${line}" stroke="#c8d8e5" stroke-width="${number(thickness * 0.55)}" stroke-linecap="butt" fill="none"/>`
    );
  }
  return `<path d="M 0 ${number(h / 2)} L ${number(w)} ${number(h / 2)}" stroke="#3e6687" stroke-width="${number(Math.max(4, Math.min(h, 24)))}" stroke-linecap="round" fill="none"/>`;
}

function renderLabel(
  node: ScadaNode,
  tags: ReadonlyMap<string, TagValue>,
  appearance: "dark" | "light",
): string {
  const text = typeof node.props.text === "string" ? node.props.text : "";
  const value = tagFor(node, "value", tags);
  const suffix = typeof node.props.unit === "string" ? node.props.unit : "";
  const dynamic =
    value === undefined
      ? ""
      : `: ${value.quality === "GOOD" ? String(value.value ?? "--") : "--"} ${suffix}`;
  if (appearance === "light" && node.props.presentation === "metric") {
    const raw = value?.quality === "GOOD" ? value.value : null;
    const reading =
      raw === null ? "--" : typeof raw === "boolean" ? (raw ? "是" : "否") : String(raw);
    const color = LIGHT_COLORS[value?.quality ?? "BAD"];
    const content = reading + (suffix ? " " + suffix : "");
    return (
      `<svg width="${number(node.transform.width)}" height="${number(node.transform.height)}" viewBox="0 0 320 92" preserveAspectRatio="none">` +
      '<rect x="1" y="1" width="318" height="90" rx="9" fill="#f5f7fa" stroke="#d5dfe9"/>' +
      `<text x="16" y="25" font-size="${number(Math.min(13, 280 / Math.max(1, text.length)))}" fill="#4d6176">${xml(text)}</text>` +
      `<text x="16" y="58" font-size="${number(Math.min(25, 280 / Math.max(1, content.length)))}" font-weight="700" fill="#142338">${xml(content)}</text>` +
      `<text x="16" y="78" font-size="10" fill="${color}">${quality(value)}</text>` +
      "</svg>"
    );
  }
  if (appearance === "light") {
    const content =
      value === undefined && node.bindings.value ? `${text}: -- ${suffix}` : text + dynamic;
    const fontSize = Math.min(
      48,
      node.transform.height * 0.72,
      node.transform.width / Math.max(1, content.length),
    );
    return `<text x="0" y="${number(fontSize)}" font-size="${number(fontSize)}" fill="#142338">${xml(content)}</text>`;
  }
  return `<text x="0" y="${number(Math.min(24, node.transform.height))}" font-size="20" fill="#e6edf6">${xml(text + dynamic)}</text>`;
}

function renderNode(
  node: ScadaNode,
  tags: ReadonlyMap<string, TagValue>,
  appearance: "dark" | "light",
): string {
  const t = node.transform;
  let body: string;
  switch (node.type) {
    case "tank":
      body = renderTank(node, tags, appearance);
      break;
    case "pump":
      body = renderPump(node, tags, appearance);
      break;
    case "pipe":
      body = renderPipe(node, appearance);
      break;
    case "label":
      body = renderLabel(node, tags, appearance);
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
  appearance: "dark" | "light" = "dark",
): string {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new RangeError(`未找到页面：${pageId}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${xml(page.name)}" ` +
    `viewBox="0 0 ${number(page.size.width)} ${number(page.size.height)}">` +
    `<rect width="100%" height="100%" fill="${appearance === "light" ? "#ffffff" : "#0c1728"}"/>` +
    (appearance === "light" ? LIGHT_DEFINITIONS : "") +
    page.nodes
      .filter(studioNodeVisible)
      .map((node) => renderNode(node, values, appearance))
      .join("") +
    "</svg>"
  );
}
