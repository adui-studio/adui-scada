-- 历史归档基础模型；仅在授权的隔离数据库完成迁移验证后才可使用。
BEGIN;

CREATE TABLE "scada_tag_history_batches" (
  "tenant_id" VARCHAR(128) NOT NULL,
  "project_id" VARCHAR(128) NOT NULL,
  "stream_id" VARCHAR(128) NOT NULL,
  "batch_sequence" BIGINT NOT NULL,
  "format_version" INTEGER NOT NULL,
  "record_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scada_tag_history_batches_pkey" PRIMARY KEY ("tenant_id", "project_id", "stream_id", "batch_sequence"),
  CONSTRAINT "scada_tag_history_batches_project_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "scada_projects" ("tenant_id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scada_tag_history_batches_sequence_check" CHECK ("batch_sequence" BETWEEN 1 AND 9007199254740991),
  CONSTRAINT "scada_tag_history_batches_format_check" CHECK ("format_version" = 1),
  CONSTRAINT "scada_tag_history_batches_count_check" CHECK ("record_count" BETWEEN 1 AND 256)
);

CREATE TABLE "scada_tag_history_records" (
  "tenant_id" VARCHAR(128) NOT NULL,
  "project_id" VARCHAR(128) NOT NULL,
  "stream_id" VARCHAR(128) NOT NULL,
  "batch_sequence" BIGINT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "tag_id" VARCHAR(128) NOT NULL,
  "timestamp_ms" BIGINT NOT NULL,
  "payload" TEXT NOT NULL,
  CONSTRAINT "scada_tag_history_records_pkey" PRIMARY KEY ("tenant_id", "project_id", "stream_id", "batch_sequence", "ordinal"),
  CONSTRAINT "scada_tag_history_records_batch_fkey" FOREIGN KEY ("tenant_id", "project_id", "stream_id", "batch_sequence") REFERENCES "scada_tag_history_batches" ("tenant_id", "project_id", "stream_id", "batch_sequence") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scada_tag_history_records_ordinal_check" CHECK ("ordinal" BETWEEN 0 AND 255),
  CONSTRAINT "scada_tag_history_records_timestamp_check" CHECK ("timestamp_ms" BETWEEN -8640000000000000 AND 8640000000000000)
);

CREATE INDEX "scada_tag_history_records_lookup_idx" ON "scada_tag_history_records" ("tenant_id", "project_id", "tag_id", "timestamp_ms", "stream_id", "batch_sequence", "ordinal");

COMMENT ON TABLE "scada_tag_history_batches" IS '历史归档幂等批次';
COMMENT ON COLUMN "scada_tag_history_batches"."tenant_id" IS '可信租户标识';
COMMENT ON COLUMN "scada_tag_history_batches"."project_id" IS '所属工程标识';
COMMENT ON COLUMN "scada_tag_history_batches"."stream_id" IS '唯一写入流标识';
COMMENT ON COLUMN "scada_tag_history_batches"."batch_sequence" IS '写入流内批次序号';
COMMENT ON COLUMN "scada_tag_history_batches"."format_version" IS '规范记录编码版本';
COMMENT ON COLUMN "scada_tag_history_batches"."record_count" IS '完整批次记录数';
COMMENT ON COLUMN "scada_tag_history_batches"."created_at" IS '批次提交时间';
COMMENT ON TABLE "scada_tag_history_records" IS '历史归档原始记录';
COMMENT ON COLUMN "scada_tag_history_records"."tenant_id" IS '所属租户标识';
COMMENT ON COLUMN "scada_tag_history_records"."project_id" IS '所属工程标识';
COMMENT ON COLUMN "scada_tag_history_records"."stream_id" IS '所属采集流标识';
COMMENT ON COLUMN "scada_tag_history_records"."batch_sequence" IS '所属批次序号';
COMMENT ON COLUMN "scada_tag_history_records"."ordinal" IS '批次内原始顺序';
COMMENT ON COLUMN "scada_tag_history_records"."tag_id" IS '工程内稳定数据点标识';
COMMENT ON COLUMN "scada_tag_history_records"."timestamp_ms" IS '服务器时间对应 UTC 毫秒';
COMMENT ON COLUMN "scada_tag_history_records"."payload" IS '完整规范记录文本';
COMMENT ON INDEX "scada_tag_history_records_lookup_idx" IS '工程内按数据点及时间范围稳定查询';
COMMENT ON INDEX "scada_tag_history_batches_pkey" IS '归档批次复合幂等键';
COMMENT ON INDEX "scada_tag_history_records_pkey" IS '归档批次内记录唯一键';

COMMIT;
