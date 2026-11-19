-- 第三十五批 B 阶段补齐发布状态、发布事件与不可变版本之间的复合引用闭包。
-- 不修改已应用的 20261118000000_release_state_and_events；本迁移只新增约束与索引。
-- 任一索引、外键或数据库注释失败时，整个迁移事务回滚。

BEGIN;

-- 复合唯一键将修订号与不可变快照摘要绑定，供发布状态和发布事件共同引用。
CREATE UNIQUE INDEX "scada_project_versions_snapshot_reference_key"
  ON "scada_project_versions" ("tenant_id", "project_id", "revision", "content_hash");

-- 当前发布状态必须引用同租户、同工程、同代次且目标修订/摘要完全一致的最后成功事件。
CREATE UNIQUE INDEX "scada_project_release_event_state_reference_key"
  ON "scada_project_release_events" (
    "tenant_id",
    "project_id",
    "generation",
    "to_revision",
    "to_content_hash",
    "event_id"
  );

-- 为发布事件来源/目标版本和发布状态目标版本的复合外键提供引用侧索引。
CREATE INDEX "scada_project_release_event_from_version_idx"
  ON "scada_project_release_events" ("tenant_id", "project_id", "from_revision", "from_content_hash");
CREATE INDEX "scada_project_release_event_to_version_idx"
  ON "scada_project_release_events" ("tenant_id", "project_id", "to_revision", "to_content_hash");
CREATE INDEX "scada_project_release_state_version_idx"
  ON "scada_project_release_state" ("tenant_id", "project_id", "released_revision", "released_content_hash");

-- 发布状态的目标版本必须属于同一租户/工程，且 SHA-256 必须与不可变版本记录一致。
ALTER TABLE "scada_project_release_state"
  DROP CONSTRAINT IF EXISTS "scada_project_release_state_version_fkey";
ALTER TABLE "scada_project_release_state"
  ADD CONSTRAINT "scada_project_release_state_version_fkey"
  FOREIGN KEY ("tenant_id", "project_id", "released_revision", "released_content_hash")
  REFERENCES "scada_project_versions" ("tenant_id", "project_id", "revision", "content_hash")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 最后成功事件必须与状态行的租户、工程、代次、目标修订、摘要和事件 ID 完全一致。
ALTER TABLE "scada_project_release_state"
  DROP CONSTRAINT IF EXISTS "scada_project_release_state_last_event_fkey";
ALTER TABLE "scada_project_release_state"
  ADD CONSTRAINT "scada_project_release_state_last_event_fkey"
  FOREIGN KEY (
    "tenant_id",
    "project_id",
    "release_generation",
    "released_revision",
    "released_content_hash",
    "last_release_event_id"
  )
  REFERENCES "scada_project_release_events" (
    "tenant_id",
    "project_id",
    "generation",
    "to_revision",
    "to_content_hash",
    "event_id"
  )
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 事件来源版本与目标版本都必须绑定实际不可变版本的 SHA-256，禁止仅凭修订号关联。
ALTER TABLE "scada_project_release_events"
  DROP CONSTRAINT IF EXISTS "scada_project_release_event_from_version_fkey";
ALTER TABLE "scada_project_release_events"
  ADD CONSTRAINT "scada_project_release_event_from_version_fkey"
  FOREIGN KEY ("tenant_id", "project_id", "from_revision", "from_content_hash")
  REFERENCES "scada_project_versions" ("tenant_id", "project_id", "revision", "content_hash")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scada_project_release_events"
  DROP CONSTRAINT IF EXISTS "scada_project_release_event_to_version_fkey";
ALTER TABLE "scada_project_release_events"
  ADD CONSTRAINT "scada_project_release_event_to_version_fkey"
  FOREIGN KEY ("tenant_id", "project_id", "to_revision", "to_content_hash")
  REFERENCES "scada_project_versions" ("tenant_id", "project_id", "revision", "content_hash")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMENT ON INDEX "scada_project_versions_snapshot_reference_key" IS '将工程租户、工程标识、修订号与不可变快照摘要绑定的复合唯一索引。';
COMMENT ON INDEX "scada_project_release_event_state_reference_key" IS '正式发布状态复合外键目标索引，绑定租户、工程、代次、目标修订、摘要和事件标识。';
COMMENT ON INDEX "scada_project_release_event_from_version_idx" IS '按租户、工程、来源修订号和摘要检索发布事件来源版本。';
COMMENT ON INDEX "scada_project_release_event_to_version_idx" IS '按租户、工程、目标修订号和摘要检索发布事件目标版本。';
COMMENT ON INDEX "scada_project_release_state_version_idx" IS '按租户、工程、当前发布修订号和摘要检索发布状态目标版本。';

COMMIT;
