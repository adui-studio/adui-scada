-- 首版工程存储建表迁移：须先在隔离 PostgreSQL 环境运行 prisma migrate deploy 验证。
-- 不包含用户认证/授权入口、生产发布指针及工业设备写入权限。
CREATE TABLE "scada_projects" (
    "tenant_id" VARCHAR(128) NOT NULL,
    "project_id" VARCHAR(128) NOT NULL,
    "head_revision" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "scada_projects_pkey" PRIMARY KEY ("tenant_id", "project_id"),
    CONSTRAINT "scada_projects_head_revision_check" CHECK ("head_revision" >= 0 AND "head_revision" <= 9007199254740991)
);

CREATE TABLE "scada_project_grants" (
    "tenant_id" VARCHAR(128) NOT NULL,
    "project_id" VARCHAR(128) NOT NULL,
    "subject_id" VARCHAR(128) NOT NULL,
    "permission" TEXT NOT NULL,
    CONSTRAINT "scada_project_grants_pkey" PRIMARY KEY ("tenant_id", "project_id", "subject_id", "permission"),
    CONSTRAINT "scada_project_grants_permission_check" CHECK ("permission" IN ('project:read', 'version:read', 'version:append'))
);

CREATE TABLE "scada_project_versions" (
    "tenant_id" VARCHAR(128) NOT NULL,
    "project_id" VARCHAR(128) NOT NULL,
    "revision" BIGINT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "created_by" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "scada_project_versions_pkey" PRIMARY KEY ("tenant_id", "project_id", "revision"),
    CONSTRAINT "scada_project_versions_revision_check" CHECK ("revision" > 0 AND "revision" <= 9007199254740991),
    CONSTRAINT "scada_project_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "scada_project_audit" (
    "event_id" UUID NOT NULL,
    "tenant_id" VARCHAR(128) NOT NULL,
    "project_id" VARCHAR(128) NOT NULL,
    "revision" BIGINT NOT NULL,
    "actor_id" VARCHAR(128) NOT NULL,
    "action" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scada_project_audit_pkey" PRIMARY KEY ("event_id"),
    CONSTRAINT "scada_project_audit_action_check" CHECK ("action" = 'version:append')
);

CREATE INDEX "scada_project_grants_subject_idx" ON "scada_project_grants"("tenant_id", "subject_id", "project_id");
CREATE INDEX "scada_project_versions_created_idx" ON "scada_project_versions"("tenant_id", "project_id", "created_at");
CREATE UNIQUE INDEX "scada_project_audit_version_key" ON "scada_project_audit"("tenant_id", "project_id", "revision");
CREATE INDEX "scada_project_audit_actor_idx" ON "scada_project_audit"("tenant_id", "actor_id", "created_at");

ALTER TABLE "scada_project_grants"
    ADD CONSTRAINT "scada_project_grants_tenant_id_project_id_fkey"
    FOREIGN KEY ("tenant_id", "project_id") REFERENCES "scada_projects"("tenant_id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scada_project_versions"
    ADD CONSTRAINT "scada_project_versions_tenant_id_project_id_fkey"
    FOREIGN KEY ("tenant_id", "project_id") REFERENCES "scada_projects"("tenant_id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scada_project_audit"
    ADD CONSTRAINT "scada_project_audit_tenant_id_project_id_revision_fkey"
    FOREIGN KEY ("tenant_id", "project_id", "revision") REFERENCES "scada_project_versions"("tenant_id", "project_id", "revision") ON DELETE RESTRICT ON UPDATE CASCADE;
