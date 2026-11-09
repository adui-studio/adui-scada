/** V0.1 document contract. JSON data only: no expression evaluation or embedded scripts. */
export const SCADA_SCHEMA_VERSION = "0.1.0";

export type TagId = string;
export type ScadaNodeType = "tank" | "pump" | "pipe" | "label" | (string & {});

export interface ScadaNode {
  id: string;
  type: ScadaNodeType;
  symbolVersion: string;
  transform: { x: number; y: number; width: number; height: number; rotation: number };
  props: Record<string, unknown>;
  bindings: Record<string, { tagId: TagId }>;
  rules: unknown[];
}

export interface ScadaPage {
  id: string;
  name: string;
  size: { width: number; height: number };
  nodes: ScadaNode[];
}

export interface ScadaDocument {
  schemaVersion: typeof SCADA_SCHEMA_VERSION;
  projectId: string;
  pages: ScadaPage[];
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_PAGES = 100;
const MAX_NODES = 2000;

function fail(path: string, reason: string): never {
  throw new TypeError(`${path}: ${reason}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "expected plain object");
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    fail(path, "expected stable ASCII identifier (1-128 chars)");
  }
  return value;
}

function boundedNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `expected finite number in [${min}, ${max}]`);
  }
  return value;
}

function nonemptyText(value: unknown, path: string, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    fail(path, `expected nonempty string of max ${max} chars`);
  }
  return value;
}

/** Recursively restrict external properties/rules to finite JSON values, with bounds. */
function jsonValue(
  value: unknown,
  path: string,
  depth: number,
  visiting: WeakSet<object>,
): unknown {
  if (depth > 12) fail(path, "nesting too deep");
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && value.length > 8192) fail(path, "string too long");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "non-finite number");
    return value;
  }
  if (typeof value !== "object") fail(path, "not a JSON value");
  if (visiting.has(value)) fail(path, "cyclic value");
  visiting.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 256) fail(path, "array too long");
      return value.map((item, i) => jsonValue(item, `${path}[${i}]`, depth + 1, visiting));
    }
    const source = record(value, path);
    const entries = Object.entries(source);
    if (entries.length > 256) fail(path, "too many properties");
    const output: Record<string, unknown> = Object.create(null);
    for (const [key, item] of entries) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        fail(path, "unsafe property key");
      if (key.length > 128) fail(path, "property key too long");
      output[key] = jsonValue(item, `${path}.${key}`, depth + 1, visiting);
    }
    return output;
  } finally {
    visiting.delete(value);
  }
}

/** Validate and defensively copy an untrusted in-memory object / parsed JSON document. */
export function parseScadaDocument(input: unknown): ScadaDocument {
  const root = record(input, "document");
  if (root.schemaVersion !== SCADA_SCHEMA_VERSION) {
    fail("schemaVersion", `unsupported version (expected ${SCADA_SCHEMA_VERSION})`);
  }
  const projectId = identifier(root.projectId, "projectId");
  if (!Array.isArray(root.pages) || root.pages.length === 0 || root.pages.length > MAX_PAGES) {
    fail("pages", `expected 1-${MAX_PAGES} pages`);
  }
  const ids = new Set<string>();
  let nodeCount = 0;
  const pages = root.pages.map((raw, pageIndex): ScadaPage => {
    const pagePath = `pages[${pageIndex}]`;
    const page = record(raw, pagePath);
    const id = identifier(page.id, `${pagePath}.id`);
    if (ids.has(id)) fail(`${pagePath}.id`, "duplicate ID");
    ids.add(id);
    const name = nonemptyText(page.name, `${pagePath}.name`);
    const size = record(page.size, `${pagePath}.size`);
    const width = boundedNumber(size.width, `${pagePath}.size.width`, 1, 16384);
    const height = boundedNumber(size.height, `${pagePath}.size.height`, 1, 16384);
    if (!Array.isArray(page.nodes)) fail(`${pagePath}.nodes`, "expected array");
    nodeCount += page.nodes.length;
    if (nodeCount > MAX_NODES) fail(`${pagePath}.nodes`, `too many nodes (max ${MAX_NODES})`);
    const nodes = page.nodes.map((rawNode, nodeIndex): ScadaNode => {
      const nodePath = `${pagePath}.nodes[${nodeIndex}]`;
      const node = record(rawNode, nodePath);
      const nodeId = identifier(node.id, `${nodePath}.id`);
      if (ids.has(nodeId)) fail(`${nodePath}.id`, "duplicate ID");
      ids.add(nodeId);
      const type = nonemptyText(node.type, `${nodePath}.type`, 64);
      const symbolVersion = nonemptyText(node.symbolVersion, `${nodePath}.symbolVersion`, 32);
      const t = record(node.transform, `${nodePath}.transform`);
      const transform = {
        x: boundedNumber(t.x, `${nodePath}.transform.x`, -1_000_000, 1_000_000),
        y: boundedNumber(t.y, `${nodePath}.transform.y`, -1_000_000, 1_000_000),
        width: boundedNumber(t.width, `${nodePath}.transform.width`, 0.1, 16384),
        height: boundedNumber(t.height, `${nodePath}.transform.height`, 0.1, 16384),
        rotation: boundedNumber(t.rotation, `${nodePath}.transform.rotation`, -360, 360),
      };
      const props = jsonValue(node.props, `${nodePath}.props`, 0, new WeakSet());
      if (!props || Array.isArray(props) || typeof props !== "object") {
        fail(`${nodePath}.props`, "expected object");
      }
      const bindingsRaw = record(node.bindings, `${nodePath}.bindings`);
      if (Object.keys(bindingsRaw).length > 64) fail(`${nodePath}.bindings`, "too many bindings");
      const bindings: ScadaNode["bindings"] = Object.create(null);
      for (const [key, bindingValue] of Object.entries(bindingsRaw)) {
        identifier(key, `${nodePath}.bindings key`);
        const binding = record(bindingValue, `${nodePath}.bindings.${key}`);
        bindings[key] = { tagId: identifier(binding.tagId, `${nodePath}.bindings.${key}.tagId`) };
      }
      if (!Array.isArray(node.rules)) fail(`${nodePath}.rules`, "expected array");
      const rules = jsonValue(node.rules, `${nodePath}.rules`, 0, new WeakSet()) as unknown[];
      return {
        id: nodeId,
        type,
        symbolVersion,
        transform,
        props: props as Record<string, unknown>,
        bindings,
        rules,
      };
    });
    return { id, name, size: { width, height }, nodes };
  });
  return { schemaVersion: SCADA_SCHEMA_VERSION, projectId, pages };
}
