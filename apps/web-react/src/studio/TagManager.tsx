import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Dialog, Input, Select, Textarea } from "tdesign-react";
import { TAG_DATA_TYPE_LABELS } from "@adui/scada-core";
import type { TagDefinition } from "@adui/scada-core";
import { confirmStudioAction } from "./StudioDialog.tsx";

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

/** 侧栏负责浏览和选择，独立对话框负责编辑；工程命令仍由共享 Core 执行。 */
export function TagManager({ tags, onCreate, onUpdate, onRemove }: TagManagerProps) {
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TagDraft>(emptyDraft);
  const [formError, setFormError] = useState("");

  const search = query.trim().toLocaleLowerCase();
  const visibleTags = search
    ? tags.filter((tag) =>
        [tag.displayName, tag.tagId, tag.description, tag.unit ?? ""].some((value) =>
          value.toLocaleLowerCase().includes(search),
        ),
      )
    : tags;

  function closeEditor() {
    setEditorOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setFormError("");
  }

  function create() {
    setEditingId(null);
    setDraft(emptyDraft());
    setFormError("");
    setEditorOpen(true);
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
    setFormError("");
    setEditorOpen(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tagId = draft.tagId.trim();
    if (!draft.displayName.trim()) {
      setFormError("请填写 Tag 显示名称。");
      return;
    }
    if (editingId === null && !tagId) {
      setFormError("请填写稳定 Tag ID。");
      return;
    }
    if (editingId === null && tags.some((tag) => tag.tagId === tagId)) {
      setFormError("Tag ID 已存在，请使用其他标识。");
      return;
    }

    const changes: TagDefinitionChanges = {
      displayName: draft.displayName,
      dataType: draft.dataType,
      unit: draft.unit.trim() || null,
      description: draft.description,
    };
    const successful = editingId ? onUpdate(editingId, changes) : onCreate({ tagId, ...changes });
    if (successful) closeEditor();
    else setFormError("保存未完成，请检查工作台状态提示和字段内容。");
  }

  async function remove(definition: TagDefinition) {
    if (
      !(await confirmStudioAction(
        "确定删除项目 Tag“" + definition.displayName + "”吗？被图元绑定的 Tag 不允许删除。",
      ))
    ) {
      return;
    }
    if (onRemove(definition.tagId) && editingId === definition.tagId) closeEditor();
  }

  return (
    <div className="studio-tag-manager">
      <div className="studio-tag-toolbar">
        <span className="studio-tag-toolbar-title">Tag 目录</span>
        <Button tag="button" type="button" size="small" theme="primary" onClick={create}>
          新建 Tag
        </Button>
      </div>
      <Input
        size="small"
        className="studio-tag-search"
        aria-label="搜索项目 Tag"
        placeholder="搜索名称、ID 或描述"
        value={query}
        onChange={setQuery}
      />
      <div className="studio-tag-summary" role="status">
        {search
          ? "找到 " + visibleTags.length + " / " + tags.length + " 项"
          : "共 " + tags.length + " 项定义"}
        <span>工程内元数据</span>
      </div>
      <div className="studio-tag-list" role="list" aria-label="项目 Tag 目录">
        {visibleTags.length === 0 ? (
          <div className="studio-tag-empty">
            <strong>{tags.length === 0 ? "还没有 Tag 定义" : "没有匹配的 Tag"}</strong>
            <p>
              {tags.length === 0 ? "点击「新建 Tag」添加工程数据定义。" : "尝试修改搜索关键词。"}
            </p>
          </div>
        ) : (
          visibleTags.map((tag) => (
            <div role="listitem" className="studio-tag-item" key={tag.tagId}>
              <div className="studio-tag-item-heading">
                <strong title={tag.displayName}>{tag.displayName}</strong>
                <span className="studio-tag-type">{TAG_DATA_TYPE_LABELS[tag.dataType]}</span>
              </div>
              <span className="break-all studio-tag-id" title={tag.tagId}>
                {tag.tagId}
              </span>
              {(tag.unit || tag.description || tag.dataType === "unknown") && (
                <p className="studio-tag-item-note" title={tag.description}>
                  {tag.unit ? "单位 " + tag.unit + (tag.description ? " · " : "") : ""}
                  {tag.description}
                  {tag.dataType === "unknown" ? " · 数据类型待确认" : ""}
                </p>
              )}
              <div className="studio-tag-actions" aria-label={tag.displayName + " 操作"}>
                <Button
                  tag="button"
                  type="button"
                  size="small"
                  variant="text"
                  onClick={() => edit(tag)}
                >
                  编辑
                </Button>
                <Button
                  tag="button"
                  type="button"
                  size="small"
                  theme="danger"
                  variant="text"
                  onClick={() => void remove(tag)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <p className="studio-tag-catalog-help">
        定义随工程草稿保存，已绑定的 Tag 不能删除或改为不兼容类型。
      </p>
      <Dialog
        dialogClassName="studio-tag-dialog"
        placement="center"
        visible={editorOpen}
        header={editingId ? "编辑 Tag 定义" : "新建 Tag 定义"}
        width="min(700px, calc(100vw - 32px))"
        footer={false}
        destroyOnClose
        closeOnEscKeydown
        closeOnOverlayClick={false}
        onClose={closeEditor}
      >
        <p className="studio-tag-form-intro">配置工程内的数据定义，不涉及现场设备连接或写入。</p>
        <form className="studio-tag-form" onSubmit={submit} aria-label="项目 Tag 编辑表单">
          <div className="studio-tag-form-grid">
            <label className="studio-field">
              显示名称 <span className="studio-tag-required">*</span>
              <Input
                value={draft.displayName}
                maxlength={128}
                placeholder="例如 模拟水位"
                onChange={(value) => {
                  setDraft((current) => ({ ...current, displayName: value }));
                  setFormError("");
                }}
              />
              {formError === "请填写 Tag 显示名称。" && (
                <small className="studio-tag-field-error" role="alert">
                  {formError}
                </small>
              )}
            </label>
            <label className="studio-field">
              稳定 Tag ID <span className="studio-tag-required">*</span>
              <Input
                value={draft.tagId}
                maxlength={128}
                disabled={editingId !== null}
                placeholder="例如 water.pressure"
                onChange={(value) => {
                  setDraft((current) => ({ ...current, tagId: value }));
                  setFormError("");
                }}
              />
              <small className="studio-tag-field-help">
                {editingId ? "创建后不可修改" : "创建后不可更改，将用于工程绑定"}
              </small>
              {(formError === "请填写稳定 Tag ID。" ||
                formError === "Tag ID 已存在，请使用其他标识。") && (
                <small className="studio-tag-field-error" role="alert">
                  {formError}
                </small>
              )}
            </label>
            <label className="studio-field">
              数据类型 <span className="studio-tag-required">*</span>
              <Select
                value={draft.dataType}
                options={[
                  ...(editingId && draft.dataType === "unknown"
                    ? [{ label: "待确认（历史迁移占位）", value: "unknown" }]
                    : []),
                  { label: "数值", value: "number" },
                  { label: "布尔值", value: "boolean" },
                  { label: "文本", value: "string" },
                ]}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, dataType: value as TagDataType }));
                  setFormError("");
                }}
              />
            </label>
            <label className="studio-field">
              单位 <span className="studio-tag-optional">选填</span>
              <Input
                value={draft.unit}
                maxlength={32}
                placeholder="例如 m³/h"
                onChange={(value) => {
                  setDraft((current) => ({ ...current, unit: value }));
                  setFormError("");
                }}
              />
            </label>
            <label className="studio-field studio-tag-description-field">
              描述 <span className="studio-tag-optional">选填</span>
              <Textarea
                autosize={{ minRows: 3, maxRows: 5 }}
                maxlength={512}
                placeholder="说明数据含义、用途或绑定约束"
                value={draft.description}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, description: value }));
                  setFormError("");
                }}
              />
            </label>
          </div>
          {formError &&
            formError !== "请填写 Tag 显示名称。" &&
            formError !== "请填写稳定 Tag ID。" &&
            formError !== "Tag ID 已存在，请使用其他标识。" && (
              <p className="studio-tag-form-error" role="alert">
                {formError}
              </p>
            )}
          <div className="studio-tag-form-footer">
            <span className="studio-tag-form-footnote">变更支持工作台撤销 / 重做</span>
            <div className="studio-tag-form-actions">
              <Button tag="button" type="button" variant="outline" onClick={closeEditor}>
                取消
              </Button>
              <Button tag="button" type="submit" theme="primary">
                {editingId ? "保存修改" : "创建 Tag"}
              </Button>
            </div>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
