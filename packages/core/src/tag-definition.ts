import type { TagValue } from "./tag-store.ts";

/** Tag 定义的数据类型；质量是每条实时 TagValue 的动态属性，不在定义中固定。 */
export const TAG_DATA_TYPES = ["number", "boolean", "string", "unknown"] as const;
export type TagDataType = (typeof TAG_DATA_TYPES)[number];

export const TAG_DATA_TYPE_LABELS: Record<TagDataType, string> = {
  number: "数值",
  boolean: "布尔值",
  string: "文本",
  unknown: "未指定",
};

/** 项目内稳定 Tag 标识与可变展示元数据；不包含尚未设计的工业地址字段。 */
export interface TagDefinition {
  readonly tagId: string;
  readonly displayName: string;
  readonly dataType: TagDataType;
  readonly unit: string | null;
  readonly description: string;
}

/** Tag 定义编辑字段；稳定 tagId 不允许通过编辑操作修改。 */
export type TagDefinitionUpdate = Pick<
  TagDefinition,
  "displayName" | "dataType" | "unit" | "description"
>;

/** 统一约束当前内置图元绑定槽可接收的数据类型。 */
export function isTagDataTypeCompatibleWithBinding(
  nodeType: string,
  slot: string,
  dataType: TagDataType,
): boolean {
  if (dataType === "unknown") return false;
  if (nodeType === "tank" && slot === "level") return dataType === "number";
  if (nodeType === "pump" && slot === "running") return dataType === "boolean";
  if (nodeType === "label" && slot === "value") return true;
  return false;
}

const TAG_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function displayName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new TypeError("Tag 显示名称必须为 1～128 个字符");
  }
  return value.trim();
}

export function parseTagDefinition(input: unknown): TagDefinition {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Tag 定义必须为普通对象");
  }
  const source = input as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(source);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Tag 定义必须为普通对象");
  }
  const allowed = ["tagId", "displayName", "dataType", "unit", "description"];
  if (Object.keys(source).some((key) => !allowed.includes(key))) {
    throw new TypeError("Tag 定义包含不支持的字段");
  }
  if (typeof source.tagId !== "string" || !TAG_ID_PATTERN.test(source.tagId)) {
    throw new TypeError("Tag ID 必须为 1～128 个字符的稳定 ASCII 标识符");
  }
  if (!TAG_DATA_TYPES.includes(source.dataType as TagDataType)) {
    throw new TypeError("Tag 数据类型不受支持");
  }
  if (
    source.unit !== null &&
    (typeof source.unit !== "string" || source.unit.length === 0 || source.unit.length > 32)
  ) {
    throw new TypeError("Tag 单位必须为空或为 1～32 个字符");
  }
  if (typeof source.description !== "string" || source.description.length > 512) {
    throw new TypeError("Tag 描述必须为不超过 512 个字符的文本");
  }
  return Object.freeze({
    tagId: source.tagId,
    displayName: displayName(source.displayName),
    dataType: source.dataType as TagDataType,
    unit: source.unit as string | null,
    description: source.description,
  });
}

/**
 * 不可变的 Tag 元数据目录。重命名只替换展示名称，绑定始终引用稳定 tagId。
 * 当前目录只承载本机演示定义，尚未持久化到 ScadaDocument 或服务端。
 */
export class TagDefinitionCatalog {
  private readonly definitions: ReadonlyMap<string, TagDefinition>;

  constructor(definitions: readonly TagDefinition[]) {
    if (!Array.isArray(definitions)) throw new TypeError("Tag 定义列表必须为数组");
    const entries = new Map<string, TagDefinition>();
    for (const raw of definitions) {
      const definition = parseTagDefinition(raw);
      if (entries.has(definition.tagId)) {
        throw new TypeError("Tag ID 重复：" + definition.tagId);
      }
      entries.set(definition.tagId, definition);
    }
    this.definitions = entries;
  }

  get(tagId: string): TagDefinition | undefined {
    const definition = this.definitions.get(tagId);
    return definition ? { ...definition } : undefined;
  }

  snapshot(): readonly TagDefinition[] {
    return [...this.definitions.values()].map((definition) => ({ ...definition }));
  }

  /** 返回新目录；不会修改原目录或任何图元绑定。 */
  rename(tagId: string, nextDisplayName: string): TagDefinitionCatalog {
    const current = this.definitions.get(tagId);
    if (!current) throw new RangeError("未找到 Tag 定义：" + tagId);
    const nextName = displayName(nextDisplayName);
    return new TagDefinitionCatalog(
      this.snapshot().map((definition) =>
        definition.tagId === tagId ? { ...definition, displayName: nextName } : definition,
      ),
    );
  }

  /** 仅校验值类型；质量仍由 TagValue 自身表达并由 TagStore 校验。 */
  validateValueType(value: TagValue): void {
    const definition = this.definitions.get(value.tagId);
    if (!definition) throw new TypeError("实时数据引用了未定义的 Tag：" + value.tagId);
    if (
      definition.dataType !== "unknown" &&
      value.value !== null &&
      typeof value.value !== definition.dataType
    ) {
      throw new TypeError(
        "Tag 数据类型不匹配：" + value.tagId + "，预期" + TAG_DATA_TYPE_LABELS[definition.dataType],
      );
    }
  }
}
