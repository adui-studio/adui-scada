/** 工程文档契约：仅支持受验证的 JSON 数据，禁止执行脚本。 */
export const SCADA_SCHEMA_VERSION = "0.2.0";
/** 仅在显式导入时支持升级的历史工程版本。 */
export const LEGACY_SCADA_SCHEMA_VERSION = "0.1.0";

export type TagId = string;
export type ScadaNodeType = "tank" | "pump" | "pipe" | "label" | (string & {});

export interface ScadaNode {
  id: string;
  /** 编辑器的平面逻辑组合标识；未组合图元省略此字段。 */
  groupId?: string;
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
    fail(path, "应为对象");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "应为普通对象");
  }
  return value as Record<string, unknown>;
}

/** 对工程结构实行字段白名单校验，阻止未知字段在导入时被静默剔除。 */
function knownFields(
  source: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "包含不支持的结构字段，拒绝静默丢弃");
  }
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    fail(path, "应为 1～128 个字符的稳定 ASCII 标识符");
  }
  return value;
}

function boundedNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `应为 ${min}～${max} 之间的有限数值`);
  }
  return value;
}

function nonemptyText(value: unknown, path: string, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    fail(path, `应为非空字符串，长度不能超过 ${max} 个字符`);
  }
  return value;
}

/** 递归验证外部属性和规则，仅允许符合深度、长度及数值限制的 JSON 数据。 */
function jsonValue(
  value: unknown,
  path: string,
  depth: number,
  visiting: WeakSet<object>,
): unknown {
  if (depth > 12) fail(path, "嵌套层级过深");
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && value.length > 8192) fail(path, "字符串过长");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "数值必须为有限数");
    return value;
  }
  if (typeof value !== "object") fail(path, "不是合法的 JSON 值");
  if (visiting.has(value)) fail(path, "存在循环引用");
  visiting.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 256) fail(path, "数组长度超出限制");
      return value.map((item, i) => jsonValue(item, `${path}[${i}]`, depth + 1, visiting));
    }
    const source = record(value, path);
    const entries = Object.entries(source);
    if (entries.length > 256) fail(path, "属性数量超出限制");
    const output: Record<string, unknown> = Object.create(null);
    for (const [key, item] of entries) {
      if (["__proto__", "prototype", "constructor"].includes(key)) fail(path, "属性名称不安全");
      if (key.length > 128) fail(path, "属性名称过长");
      output[key] = jsonValue(item, `${path}.${key}`, depth + 1, visiting);
    }
    return output;
  } finally {
    visiting.delete(value);
  }
}

/** 按指定来源版本验证所有字段，仅返回当前版本的防御性工程副本。 */
function parseVersionedDocument(input: unknown, sourceVersion: string): ScadaDocument {
  const root = record(input, "文档");
  if (root.schemaVersion !== sourceVersion) {
    fail("schemaVersion", `不支持的版本，预期为 ${sourceVersion}`);
  }
  knownFields(root, ["schemaVersion", "projectId", "pages"], "文档");
  const projectId = identifier(root.projectId, "projectId");
  if (!Array.isArray(root.pages) || root.pages.length === 0 || root.pages.length > MAX_PAGES) {
    fail("pages", `页面数量必须在 1～${MAX_PAGES} 之间`);
  }
  const ids = new Set<string>();
  const groups = new Map<string, { pageIndex: number; count: number }>();
  let nodeCount = 0;
  const pages = root.pages.map((raw, pageIndex): ScadaPage => {
    const pagePath = `pages[${pageIndex}]`;
    const page = record(raw, pagePath);
    knownFields(page, ["id", "name", "size", "nodes"], pagePath);
    const id = identifier(page.id, `${pagePath}.id`);
    if (ids.has(id)) fail(`${pagePath}.id`, "ID 重复");
    ids.add(id);
    const name = nonemptyText(page.name, `${pagePath}.name`);
    const size = record(page.size, `${pagePath}.size`);
    knownFields(size, ["width", "height"], `${pagePath}.size`);
    const width = boundedNumber(size.width, `${pagePath}.size.width`, 1, 16384);
    const height = boundedNumber(size.height, `${pagePath}.size.height`, 1, 16384);
    if (!Array.isArray(page.nodes)) fail(`${pagePath}.nodes`, "应为数组");
    nodeCount += page.nodes.length;
    if (nodeCount > MAX_NODES) fail(`${pagePath}.nodes`, `图元数量超过上限 ${MAX_NODES}`);
    const nodes = page.nodes.map((rawNode, nodeIndex): ScadaNode => {
      const nodePath = `${pagePath}.nodes[${nodeIndex}]`;
      const node = record(rawNode, nodePath);
      knownFields(
        node,
        ["id", "groupId", "type", "symbolVersion", "transform", "props", "bindings", "rules"],
        nodePath,
      );
      const nodeId = identifier(node.id, `${nodePath}.id`);
      if (ids.has(nodeId)) fail(`${nodePath}.id`, "ID 重复");
      ids.add(nodeId);
      const groupId = Object.hasOwn(node, "groupId")
        ? identifier(node.groupId, `${nodePath}.groupId`)
        : undefined;
      if (groupId !== undefined) {
        const group = groups.get(groupId);
        if (group && group.pageIndex !== pageIndex) {
          fail(`${nodePath}.groupId`, "同一组合不能跨页面");
        }
        groups.set(groupId, { pageIndex, count: (group?.count ?? 0) + 1 });
      }
      const type = nonemptyText(node.type, `${nodePath}.type`, 64);
      const symbolVersion = nonemptyText(node.symbolVersion, `${nodePath}.symbolVersion`, 32);
      const t = record(node.transform, `${nodePath}.transform`);
      knownFields(t, ["x", "y", "width", "height", "rotation"], `${nodePath}.transform`);
      const transform = {
        x: boundedNumber(t.x, `${nodePath}.transform.x`, -1_000_000, 1_000_000),
        y: boundedNumber(t.y, `${nodePath}.transform.y`, -1_000_000, 1_000_000),
        width: boundedNumber(t.width, `${nodePath}.transform.width`, 0.1, 16384),
        height: boundedNumber(t.height, `${nodePath}.transform.height`, 0.1, 16384),
        rotation: boundedNumber(t.rotation, `${nodePath}.transform.rotation`, -360, 360),
      };
      const props = jsonValue(node.props, `${nodePath}.props`, 0, new WeakSet());
      if (!props || Array.isArray(props) || typeof props !== "object") {
        fail(`${nodePath}.props`, "应为对象");
      }
      const bindingsRaw = record(node.bindings, `${nodePath}.bindings`);
      if (Object.keys(bindingsRaw).length > 64) fail(`${nodePath}.bindings`, "Tag 绑定数量过多");
      const bindings: ScadaNode["bindings"] = Object.create(null);
      for (const [key, bindingValue] of Object.entries(bindingsRaw)) {
        identifier(key, `${nodePath}.绑定字段`);
        const binding = record(bindingValue, `${nodePath}.bindings.${key}`);
        knownFields(binding, ["tagId"], `${nodePath}.bindings.${key}`);
        bindings[key] = { tagId: identifier(binding.tagId, `${nodePath}.bindings.${key}.tagId`) };
      }
      if (!Array.isArray(node.rules)) fail(`${nodePath}.rules`, "应为数组");
      const rules = jsonValue(node.rules, `${nodePath}.rules`, 0, new WeakSet()) as unknown[];
      return {
        id: nodeId,
        ...(groupId === undefined ? {} : { groupId }),
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
  for (const [groupId, group] of groups) {
    if (ids.has(groupId)) fail("groupId", "组合 ID 与图元或页面 ID 冲突");
    if (group.count < 2) fail("groupId", "组合至少需要两个图元");
  }
  return { schemaVersion: SCADA_SCHEMA_VERSION, projectId, pages };
}

/** 内部调用及 Runtime 只允许当前 Schema；旧版本必须走显式迁移入口。 */
export function parseScadaDocument(input: unknown): ScadaDocument {
  return parseVersionedDocument(input, SCADA_SCHEMA_VERSION);
}

export interface ScadaDocumentMigration {
  readonly document: ScadaDocument;
  readonly migratedFrom: typeof LEGACY_SCADA_SCHEMA_VERSION | null;
}

/**
 * 专供 Studio 工程导入：校验并升级 0.1.0，当前版本直接严格校验。
 * 不接受未来、未知版本；迁移过程中保留旧版组合 groupId。
 */
export function migrateScadaDocument(input: unknown): ScadaDocumentMigration {
  const root = record(input, "文档");
  if (root.schemaVersion === SCADA_SCHEMA_VERSION) {
    return { document: parseScadaDocument(input), migratedFrom: null };
  }
  if (root.schemaVersion === LEGACY_SCADA_SCHEMA_VERSION) {
    return {
      document: parseVersionedDocument(input, LEGACY_SCADA_SCHEMA_VERSION),
      migratedFrom: LEGACY_SCADA_SCHEMA_VERSION,
    };
  }
  fail(
    "schemaVersion",
    `不支持的工程版本，仅允许 ${LEGACY_SCADA_SCHEMA_VERSION} 或 ${SCADA_SCHEMA_VERSION}`,
  );
}
