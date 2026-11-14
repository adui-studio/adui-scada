-- 第三十三批 OIDC 数据结构增量迁移；不开放登录 API，也不连接现场设备。
-- 仅追加外部身份映射、一次性登录事务及可空 CSRF 摘要，不修改历史迁移。

ALTER TABLE "scada_auth_sessions"
  ADD COLUMN "csrf_token_hash" VARCHAR(64);

ALTER TABLE "scada_auth_sessions"
  ADD CONSTRAINT "scada_auth_sessions_csrf_token_hash_check"
  CHECK ("csrf_token_hash" IS NULL OR "csrf_token_hash" ~ '^[0-9a-f]{64}$');

CREATE TABLE "scada_external_identities" (
  "issuer" VARCHAR(512) NOT NULL,
  "subject" VARCHAR(256) NOT NULL,
  "tenant_id" VARCHAR(128) NOT NULL,
  "subject_id" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scada_external_identities_pkey" PRIMARY KEY ("issuer", "subject"),
  CONSTRAINT "scada_external_identities_issuer_check" CHECK (length("issuer") > 0),
  CONSTRAINT "scada_external_identities_subject_check" CHECK (length("subject") > 0)
);

CREATE INDEX "scada_external_identities_identity_idx"
  ON "scada_external_identities" ("tenant_id", "subject_id");

ALTER TABLE "scada_external_identities"
  ADD CONSTRAINT "scada_external_identities_identity_fkey"
  FOREIGN KEY ("tenant_id", "subject_id")
  REFERENCES "scada_identities" ("tenant_id", "subject_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "scada_oidc_transactions" (
  "state_hash" VARCHAR(64) NOT NULL,
  "issuer" VARCHAR(512) NOT NULL,
  "nonce" VARCHAR(128) NOT NULL,
  "verifier_ciphertext" TEXT NOT NULL,
  "browser_binding_hash" VARCHAR(64) NOT NULL,
  "return_path" VARCHAR(1024) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  CONSTRAINT "scada_oidc_transactions_pkey" PRIMARY KEY ("state_hash"),
  CONSTRAINT "scada_oidc_transactions_state_hash_check"
    CHECK ("state_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "scada_oidc_transactions_binding_hash_check"
    CHECK ("browser_binding_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "scada_oidc_transactions_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "scada_oidc_transactions_return_path_check"
    CHECK (left("return_path", 1) = '/' AND left("return_path", 2) <> '//')
);

CREATE INDEX "scada_oidc_transactions_expiry_idx"
  ON "scada_oidc_transactions" ("expires_at", "consumed_at");
CREATE INDEX "scada_oidc_transactions_browser_idx"
  ON "scada_oidc_transactions" ("browser_binding_hash", "expires_at");

COMMENT ON COLUMN "scada_auth_sessions"."csrf_token_hash" IS 'Cookie 会话的 CSRF 令牌 SHA-256 摘要；原有 Bearer 会话保持空值。';

COMMENT ON TABLE "scada_external_identities" IS '可信 OIDC 外部身份预绑定表：仅以 Issuer 与 subject 映射本地租户主体。';
COMMENT ON COLUMN "scada_external_identities"."issuer" IS '已配置并验证的外部 OIDC Issuer。';
COMMENT ON COLUMN "scada_external_identities"."subject" IS 'Issuer 范围内唯一的外部主体标识，不使用邮箱作为身份主键。';
COMMENT ON COLUMN "scada_external_identities"."tenant_id" IS '预绑定的本地租户标识。';
COMMENT ON COLUMN "scada_external_identities"."subject_id" IS '预绑定的租户内可信主体标识。';
COMMENT ON COLUMN "scada_external_identities"."created_at" IS '外部身份映射记录创建时间。';
COMMENT ON INDEX "scada_external_identities_identity_idx" IS '按本地租户与主体查询预绑定的外部身份。';

COMMENT ON TABLE "scada_oidc_transactions" IS '短期一次性 OIDC 登录事务表：不存储授权码、PKCE 明文或 IdP Token。';
COMMENT ON COLUMN "scada_oidc_transactions"."state_hash" IS '高熵 State 的 SHA-256 摘要和事务主键。';
COMMENT ON COLUMN "scada_oidc_transactions"."issuer" IS '登录开始时已固定的可信 OIDC Issuer。';
COMMENT ON COLUMN "scada_oidc_transactions"."nonce" IS '用于校验回调 ID Token 的一次性 Nonce。';
COMMENT ON COLUMN "scada_oidc_transactions"."verifier_ciphertext" IS 'AES-256-GCM 加密的 PKCE verifier 及解密参数；禁止保存明文。';
COMMENT ON COLUMN "scada_oidc_transactions"."browser_binding_hash" IS '发起登录浏览器短期绑定 Cookie 的 SHA-256 摘要。';
COMMENT ON COLUMN "scada_oidc_transactions"."return_path" IS '已校验的站内相对回跳路径，不允许跳转外部站点。';
COMMENT ON COLUMN "scada_oidc_transactions"."created_at" IS 'OIDC 登录事务创建时间。';
COMMENT ON COLUMN "scada_oidc_transactions"."expires_at" IS 'OIDC 登录事务绝对过期时间。';
COMMENT ON COLUMN "scada_oidc_transactions"."consumed_at" IS '事务被原子消费的时间；空值代表未消费。';
COMMENT ON INDEX "scada_oidc_transactions_expiry_idx" IS '按过期时间和消费状态清理、查询短期 OIDC 事务。';
COMMENT ON INDEX "scada_oidc_transactions_browser_idx" IS '按浏览器绑定摘要及到期时间定位登录事务。';
