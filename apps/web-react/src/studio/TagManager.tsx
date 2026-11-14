import { useState } from "react";
import { Button, Input } from "tdesign-react";
import type { FormEvent } from "react";
import { TAG_DATA_TYPE_LABELS } from "@adui/scada-core";
import type { TagDefinition } from "@adui/scada-core";

type TagDataType = TagDefinition["dataType"];
type TagDefinitionChanges = Pick<
  TagDefinition,
  "displayName" | "dataType" | "unit" | "description"
>;

interface TagManagerProps {
  readonly tags: readonly TagDefinition[];
  readonly onCreate: (definition: TagDefinition) => boolean;
  readonly onUpdate: (tagId: string, changes: TagDefinitionChanges) => boolean;
  readonly onRemove: (tagId: string) => boolean;
}

interface TagDraft {
  tagId: string;
  displayName: string;
  dataType: TagDataType;
  unit: string;
  description: string;
}

function emptyDraft(): TagDraft {
  return { tagId: "", displayName: "", dataType: "number", unit: "", description: "" };
}

/** 只编辑项目静态元数据；实际校验、撤销和持久化由共享 DocumentEditor 处理。 */
export function TagManager({ tags, onCreate, onUpdate, onRemove }: TagManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TagDraft>(emptyDraft);

  function reset() {
    setEditingId(null);
    setDraft(emptyDraft());
  }

  function edit(definition: TagDefinition) {
    setEditingId(definition.tagId);
    setDraft({
      tagId: definition.tagId,
      displayName: definition.displayName,
      dataType: definition.dataType,
      unit: definition.unit ?? "",
      description: definition.description,
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes: TagDefinitionChanges = {
      displayName: draft.displayName,
      dataType: draft.dataType,
      unit: draft.unit.trim() || null,
      description: draft.description,
    };
    const successful = editingId
      ? onUpdate(editingId, changes)
      : onCreate({ tagId: draft.tagId.trim(), ...changes });
    if (successful) reset();
  }

  function remove(definition: TagDefinition) {
    if (!window.confirm("确定删除项目 Tag“" + definition.displayName + "”吗？被图元绑定的 Tag 不允许删除。")) {
      return;
    }
    if (onRemove(definition.tagId) && editingId === definition.tagId) reset();
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-2" role="list" aria-label="项目 Tag 目录">
        {tags.length === 0 && <p className="studio-tip">当前工程尚未定义 Tag</p>}
        {tags.map((tag) => (
          <div role="listitem" className="studio-binding min-w-0" key={tag.tagId}>
            <strong>{tag.displayName}</strong> · <span className="break-all">{tag.tagId}</span>
            <p className="studio-tip">
              {TAG_DATA_TYPE_LABELS[tag.dataType]}
              {tag.unit ? " · " + tag.unit : ""}
              {tag.dataType === "unknown" ? " · 需要确认数据类型" : ""}
            </p>
            {tag.description && <p className="studio-tip">{tag.description}</p>}
            <div className="studio-toolbox">
              <Button type="button" size="small" onClick={() => edit(tag)}>
                编辑
              </Button>
              <Button type="button" size="small" onClick={() => remove(tag)}>
                删除
              </Button>
            </div>
          </div>
        ))}
      </div>
      <form className="flex min-w-0 flex-col gap-2" onSubmit={submit} aria-label="项目 Tag 编辑表单">
        <strong>{editingId ? "编辑项目 Tag" : "新增项目 Tag"}</strong>
        <label className="studio-field">
          稳定 Tag ID
          <Input
            value={draft.tagId}
            maxlength={128}
            disabled={editingId !== null}
            placeholder="例如 water.pressure"
            onChange={(value) => setDraft((current) => ({ ...current, tagId: value }))}
          />
        </label>
        <label className="studio-field">
          显示名称
          <Input
            value={draft.displayName}
            maxlength={128}
            onChange={(value) => setDraft((current) => ({ ...current, displayName: value }))}
          />
        </label>
        <label className="studio-field">
          数据类型
          <select
            aria-label="项目 Tag 数据类型"
            value={draft.dataType}
            onChange={(event) =>
              setDraft((current) => ({ ...current, dataType: event.target.value as TagDataType }))
            }
          >
            {editingId && draft.dataType === "unknown" && (
              <option value="unknown">待确认（历史迁移占位）</option>
            )}
            <option value="number">数值</option>
            <option value="boolean">布尔值</option>
            <option value="string">文本</option>
          </select>
        </label>
        <label className="studio-field">
          单位（可选）
          <Input
            value={draft.unit}
            maxlength={32}
            placeholder="留空表示无单位"
            onChange={(value) => setDraft((current) => ({ ...current, unit: value }))}
          />
        </label>
        <label className="studio-field">
          描述（可选）
          <textarea
            rows={3}
            maxLength={512}
            value={draft.description}
            onChange={(event) =>
              setDraft((current) => ({ ...current, description: event.target.value }))
            }
          />
        </label>
        <div className="studio-toolbox">
          <Button type="submit">{editingId ? "保存修改" : "新增 Tag"}</Button>
          <Button type="button" onClick={reset}>
            {editingId ? "取消编辑" : "清空"}
          </Button>
        </div>
      </form>
      <p className="studio-tip">
        Tag ID 创建后不可更改。定义随工程 JSON、草稿和本地历史版本保存，支持撤销和重做；
        已绑定 Tag 不允许删除或改成不兼容类型。这里只管理元数据，不涉及设备连接或写入。
      </p>
    </div>
  );
}
