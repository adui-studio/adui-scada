-- 第十三批服务端可信身份与短期会话基础；不创建登录 API、不开放工程/设备写入。
-- 仅新增业务表、约束、索引与中文元数据，不回改已有 PostgreSQL 迁移。

CREATE TABLE "scada_identities" (
    "tenant_id" VARCHAR(128) NOT NULL,
    "subject_id" VARCHAR(128) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "scada_identities_pkey" PRIMARY KEY ("tenant_id", "subject_id"),
    CONSTRAINT "scada_identities_status_check" CHECK ("status" IN ('active', 'disabled'))
);

CREATE TABLE "scada_auth_sessions" (
    "session_id" UUID NOT NULL,
    "tenant_id" VARCHAR(128) NOT NULL,
    "subject_id" VARCHAR(128) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "scada_auth_sessions_pkey" PRIMARY KEY ("session_id"),
    CONSTRAINT "scada_auth_sessions_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "scada_auth_sessions_expiry_check" CHECK ("expires_at" > "issued_at")
);

CREATE UNIQUE INDEX "scada_auth_sessions_token_hash_key"
    ON "scada_auth_sessions"("token_hash");
CREATE INDEX "scada_auth_sessions_subject_expiry_idx"
    ON "scada_auth_sessions"("tenant_id", "subject_id", "expires_at");

ALTER TABLE "scada_auth_sessions"
    ADD CONSTRAINT "scada_auth_sessions_identity_fkey"
    FOREIGN KEY ("tenant_id", "subject_id")
    REFERENCES "scada_identities"("tenant_id", "subject_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

COMMENT ON TABLE "scada_identities" IS '租户内受信身份主体表：保存身份状态，不直接保存密码或客户端提交的角色。';
COMMENT ON COLUMN "scada_identities"."tenant_id" IS '受信身份所属租户标识。';
COMMENT ON COLUMN "scada_identities"."subject_id" IS '在租户内唯一的主体标识。';
COMMENT ON COLUMN "scada_identities"."status" IS '主体状态：active 有效，disabled 禁用。';
COMMENT ON COLUMN "scada_identities"."created_at" IS '主体创建时间。';
COMMENT ON COLUMN "scada_identities"."updated_at" IS '主体最后修改时间。';

COMMENT ON TABLE "scada_auth_sessions" IS '短期不透明会话表：只存储令牌摘要、到期与撤销状态。';
COMMENT ON COLUMN "scada_auth_sessions"."session_id" IS '会话 UUID 主键，不是令牌明文。';
COMMENT ON COLUMN "scada_auth_sessions"."tenant_id" IS '会话归属租户标识。';
COMMENT ON COLUMN "scada_auth_sessions"."subject_id" IS '会话归属主体标识。';
COMMENT ON COLUMN "scada_auth_sessions"."token_hash" IS '高熵 Bearer 令牌的 SHA-256 十六进制摘要。';
COMMENT ON COLUMN "scada_auth_sessions"."issued_at" IS '令牌签发时间。';
COMMENT ON COLUMN "scada_auth_sessions"."expires_at" IS '令牌严格过期时间。';
COMMENT ON COLUMN "scada_auth_sessions"."revoked_at" IS '令牌撤销时间，空值表示未撤销。';
COMMENT ON INDEX "scada_auth_sessions_token_hash_key" IS '令牌摘要唯一索引，用于服务端单次会话校验。';
COMMENT ON INDEX "scada_auth_sessions_subject_expiry_idx" IS '按租户主体和过期时间查询、清理会话。';
