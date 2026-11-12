-- PostgreSQL 17 工程业务表中文说明迁移，遵循项目 PostgreSQL 表设计 Skill。
-- 初始建表迁移已应用，不得修改历史；本迁移仅设置元数据注释，不更改数据与约束。
-- _prisma_migrations 是 Prisma 管理的系统表，不属于本项目的业务模型。

-- ScadaProject 的表说明及所有持久化字段说明。
COMMENT ON TABLE "scada_projects" IS 'SCADA 工程主表：以租户和工程联合主键隔离项目，维护当前历史版本水位。';
COMMENT ON COLUMN "scada_projects"."tenant_id" IS '所属租户标识，与工程标识共同构成联合主键。';
COMMENT ON COLUMN "scada_projects"."project_id" IS '工程标识，在同一租户内唯一。';
COMMENT ON COLUMN "scada_projects"."head_revision" IS '最新历史版本修订号；0 表示尚无已保存版本。';
COMMENT ON COLUMN "scada_projects"."created_at" IS '工程创建时间，采用带时区时间戳。';
COMMENT ON COLUMN "scada_projects"."updated_at" IS '工程最近修改时间，版本更新时由 Prisma 维护。';

-- ScadaProjectGrant 的表说明及所有持久化字段说明。
COMMENT ON TABLE "scada_project_grants" IS '工程权限授权表：记录主体对指定租户工程的精确操作许可。';
COMMENT ON COLUMN "scada_project_grants"."tenant_id" IS '授权记录所属租户标识。';
COMMENT ON COLUMN "scada_project_grants"."project_id" IS '授权记录所属工程标识。';
COMMENT ON COLUMN "scada_project_grants"."subject_id" IS '被授权的可信身份主体标识。';
COMMENT ON COLUMN "scada_project_grants"."permission" IS '明确授予的工程读取、版本读取或版本追加权限。';

-- ScadaProjectVersion 的表说明及所有持久化字段说明。
COMMENT ON TABLE "scada_project_versions" IS '工程历史版本表：只追加保存完整 JSONB 快照和 SHA-256 摘要。';
COMMENT ON COLUMN "scada_project_versions"."tenant_id" IS '历史版本所属租户标识。';
COMMENT ON COLUMN "scada_project_versions"."project_id" IS '历史版本所属工程标识。';
COMMENT ON COLUMN "scada_project_versions"."revision" IS '服务端分配的递增修订号，范围为正安全整数。';
COMMENT ON COLUMN "scada_project_versions"."snapshot" IS '完整工程快照，包含格式、文档、修订号和内容摘要。';
COMMENT ON COLUMN "scada_project_versions"."content_hash" IS '快照 SHA-256 小写十六进制摘要，用于校验完整性。';
COMMENT ON COLUMN "scada_project_versions"."created_by" IS '本次版本保存的可信操作主体标识。';
COMMENT ON COLUMN "scada_project_versions"."created_at" IS '工程版本创建时间，采用带时区时间戳。';

-- ScadaProjectAudit 的表说明及所有持久化字段说明。
COMMENT ON TABLE "scada_project_audit" IS '版本成功保存审计表：记录实际提交的工程修订号、主体及操作时间。';
COMMENT ON COLUMN "scada_project_audit"."event_id" IS '审计事件全局唯一 UUID 标识。';
COMMENT ON COLUMN "scada_project_audit"."tenant_id" IS '成功保存事件所属租户标识。';
COMMENT ON COLUMN "scada_project_audit"."project_id" IS '成功保存事件所属工程标识。';
COMMENT ON COLUMN "scada_project_audit"."revision" IS '本次成功保存的工程修订号。';
COMMENT ON COLUMN "scada_project_audit"."actor_id" IS '执行版本追加操作的可信主体标识。';
COMMENT ON COLUMN "scada_project_audit"."action" IS '审计操作类型，当前仅允许版本追加。';
COMMENT ON COLUMN "scada_project_audit"."created_at" IS '成功提交审计事件创建时间。';

-- 常用业务索引的中文用途说明。
COMMENT ON INDEX "scada_project_grants_subject_idx" IS '按租户、主体和工程快速查询显式权限。';
COMMENT ON INDEX "scada_project_versions_created_idx" IS '按工程和创建时间检索版本历史。';
COMMENT ON INDEX "scada_project_audit_version_key" IS '确保每个工程版本最多对应一条成功保存审计。';
COMMENT ON INDEX "scada_project_audit_actor_idx" IS '按租户、操作主体和时间检索保存审计。';
