-- 第三十五批 B 阶段正式发布数据结构；仅建立发布状态、发布事件与独立发布权限边界。
-- 本迁移不开放发布/回滚 API，不切换 Runtime，不连接现场设备，不修改已应用历史迁移。

ALTER TABLE "scada_project_grants"
  ADD CONSTRAINT "scada_project_grants_permission_check"
  CHECK ("permission" IN ('project:read', 'version:read', 'version:append', 'release:publish', 'release:rollback'));

CREATE TABLE "scada_project_release_events" (
  "event_id" UUID NOT NULL,
  "tenant_id" VARCHAR(128) NOT NULL,
  "project_id" VARCHAR(128) NOT NULL,
  "generation" BIGINT NOT NULL,
  "action" VARCHAR(16) NOT NULL,
  "from_revision" BIGINT,
  "from_content_hash" VARCHAR(64),
  "to_revision" BIGINT NOT NULL,
  "to_content_hash" VARCHAR(64) NOT NULL,
  "actor_id" VARCHAR(128) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_semantic_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scada_project_release_events_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "scada_project_release_event_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "scada_project_release_event_action_check" CHECK ("action" IN ('PUBLISH', 'ROLLBACK')),
  CONSTRAINT "scada_project_release_event_from_revision_check" CHECK ("from_revision" IS NULL OR "from_revision" > 0),
  CONSTRAINT "scada_project_release_event_hash_pair_check" CHECK (("from_revision" IS NULL AND "from_content_hash" IS NULL) OR ("from_revision" IS NOT NULL AND "from_content_hash" IS NOT NULL)),
  CONSTRAINT "scada_project_release_event_from_hash_check" CHECK ("from_content_hash" IS NULL OR "from_content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "scada_project_release_event_to_revision_check" CHECK ("to_revision" > 0),
  CONSTRAINT "scada_project_release_event_to_hash_check" CHECK ("to_content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "scada_project_release_event_idempotency_key_check" CHECK (length("idempotency_key") BETWEEN 1 AND 128),
  CONSTRAINT "scada_project_release_event_semantic_hash_check" CHECK ("request_semantic_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "scada_project_release_event_project_fkey"
    FOREIGN KEY ("tenant_id", "project_id")
    REFERENCES "scada_projects" ("tenant_id", "project_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scada_project_release_event_from_version_fkey"
    FOREIGN KEY ("tenant_id", "project_id", "from_revision")
    REFERENCES "scada_project_versions" ("tenant_id", "project_id", "revision")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scada_project_release_event_to_version_fkey"
    FOREIGN KEY ("tenant_id", "project_id", "to_revision")
    REFERENCES "scada_project_versions" ("tenant_id", "project_id", "revision")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "scada_project_release_event_generation_key"
  ON "scada_project_release_events" ("tenant_id", "project_id", "generation");
CREATE UNIQUE INDEX "scada_project_release_event_idempotency_key"
  ON "scada_project_release_events" ("tenant_id", "project_id", "actor_id", "action", "idempotency_key");
CREATE INDEX "scada_project_release_event_project_created_idx"
  ON "scada_project_release_events" ("tenant_id", "project_id", "created_at");
CREATE INDEX "scada_project_release_event_actor_created_idx"
  ON "scada_project_release_events" ("tenant_id", "actor_id", "created_at");

CREATE TABLE "scada_project_release_state" (
  "tenant_id" VARCHAR(128) NOT NULL,
  "project_id" VARCHAR(128) NOT NULL,
  "released_revision" BIGINT,
  "released_content_hash" VARCHAR(64),
  "release_generation" BIGINT NOT NULL DEFAULT 0,
  "last_release_event_id" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "scada_project_release_state_pkey" PRIMARY KEY ("tenant_id", "project_id"),
  CONSTRAINT "scada_project_release_state_generation_check" CHECK ("release_generation" >= 0),
  CONSTRAINT "scada_project_release_state_revision_check" CHECK ("released_revision" IS NULL OR "released_revision" > 0),
  CONSTRAINT "scada_project_release_state_hash_pair_check" CHECK (("released_revision" IS NULL AND "released_content_hash" IS NULL) OR ("released_revision" IS NOT NULL AND "released_content_hash" IS NOT NULL)),
  CONSTRAINT "scada_project_release_state_hash_check" CHECK ("released_content_hash" IS NULL OR "released_content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "scada_project_release_state_project_fkey"
    FOREIGN KEY ("tenant_id", "project_id")
    REFERENCES "scada_projects" ("tenant_id", "project_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scada_project_release_state_version_fkey"
    FOREIGN KEY ("tenant_id", "project_id", "released_revision")
    REFERENCES "scada_project_versions" ("tenant_id", "project_id", "revision")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scada_project_release_state_last_event_fkey"
    FOREIGN KEY ("last_release_event_id")
    REFERENCES "scada_project_release_events" ("event_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "scada_project_release_state_last_event_key"
  ON "scada_project_release_state" ("last_release_event_id");

INSERT INTO "scada_project_release_state" (
  "tenant_id",
  "project_id",
  "release_generation",
  "updated_at"
)
SELECT "tenant_id", "project_id", 0, "updated_at"
FROM "scada_projects";

COMMENT ON TABLE "scada_project_release_state" IS 'SCADA 工程正式发布状态表：每工程唯一发布指针、代次与最后成功发布事件。';
COMMENT ON COLUMN "scada_project_release_state"."tenant_id" IS '正式发布状态所属租户标识。';
COMMENT ON COLUMN "scada_project_release_state"."project_id" IS '正式发布状态所属工程标识。';
COMMENT ON COLUMN "scada_project_release_state"."released_revision" IS '当前正式发布的不可变历史修订号；空值表示尚未发布。';
COMMENT ON COLUMN "scada_project_release_state"."released_content_hash" IS '当前正式发布快照的 SHA-256 摘要；与发布修订号成对存在。';
COMMENT ON COLUMN "scada_project_release_state"."release_generation" IS '正式发布代次；初始为 0，每次成功发布或回滚严格递增。';
COMMENT ON COLUMN "scada_project_release_state"."last_release_event_id" IS '当前发布指针对应的最后成功发布事件 UUID；未发布时为空。';
COMMENT ON COLUMN "scada_project_release_state"."updated_at" IS '发布状态最近更新时间；仅用于诊断展示，不参与版本 CAS。';
COMMENT ON INDEX "scada_project_release_state_last_event_key" IS '保证一个正式发布事件最多成为一个工程的当前发布状态指针。';

COMMENT ON TABLE "scada_project_release_events" IS 'SCADA 工程正式发布事件表：只追加记录成功发布与回滚的不可变事务事实。';
COMMENT ON COLUMN "scada_project_release_events"."event_id" IS '正式发布事件全局唯一 UUID 标识。';
COMMENT ON COLUMN "scada_project_release_events"."tenant_id" IS '正式发布事件所属租户标识。';
COMMENT ON COLUMN "scada_project_release_events"."project_id" IS '正式发布事件所属工程标识。';
COMMENT ON COLUMN "scada_project_release_events"."generation" IS '本次成功发布或回滚后的发布代次，从 1 开始严格递增。';
COMMENT ON COLUMN "scada_project_release_events"."action" IS '发布事件动作：PUBLISH 正式发布，ROLLBACK 回滚。';
COMMENT ON COLUMN "scada_project_release_events"."from_revision" IS '事务提交前的正式发布修订号；首次发布时为空。';
COMMENT ON COLUMN "scada_project_release_events"."from_content_hash" IS '事务提交前正式发布快照的 SHA-256 摘要；与原发布修订号成对存在。';
COMMENT ON COLUMN "scada_project_release_events"."to_revision" IS '事务提交后的正式发布修订号。';
COMMENT ON COLUMN "scada_project_release_events"."to_content_hash" IS '事务提交后正式发布快照的 SHA-256 摘要。';
COMMENT ON COLUMN "scada_project_release_events"."actor_id" IS '执行正式发布或回滚操作的可信主体标识。';
COMMENT ON COLUMN "scada_project_release_events"."idempotency_key" IS '受控客户端幂等标识；禁止写入令牌、Cookie、工程正文或设备地址。';
COMMENT ON COLUMN "scada_project_release_events"."request_semantic_hash" IS '服务端计算的请求语义 SHA-256 摘要，用于识别同幂等标识的不同语义。';
COMMENT ON COLUMN "scada_project_release_events"."created_at" IS '正式发布事件成功提交时间。';
COMMENT ON INDEX "scada_project_release_event_generation_key" IS '保证同一租户工程的发布代次唯一，防止 ABA 与重复代次。';
COMMENT ON INDEX "scada_project_release_event_idempotency_key" IS '按租户、工程、主体、动作和幂等标识保证成功请求只提交一次。';
COMMENT ON INDEX "scada_project_release_event_project_created_idx" IS '按租户工程和提交时间检索发布事件历史。';
COMMENT ON INDEX "scada_project_release_event_actor_created_idx" IS '按租户、可信主体和提交时间检索发布事件。';

-- 已有工程在迁移后统一拥有 generation=0 的未发布状态；不产生任何发布事件。
