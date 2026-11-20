-- 第三十五批 D1：为正式发布快照读取增加独立工程权限，不自动授予既有主体。
-- 该权限不继承 project:read、version:read 或发布写权限；仅更新权限白名单，不修改现有授权记录。

BEGIN;

ALTER TABLE "scada_project_grants"
  DROP CONSTRAINT IF EXISTS "scada_project_grants_permission_check";

ALTER TABLE "scada_project_grants"
  ADD CONSTRAINT "scada_project_grants_permission_check"
  CHECK ("permission" IN ('project:read', 'version:read', 'version:append', 'release:publish', 'release:rollback', 'release:read'));

COMMENT ON COLUMN "scada_project_grants"."permission" IS '明确授予的工程读取、版本读取、版本追加、正式发布、正式回滚或已发布快照读取权限。';

COMMIT;
