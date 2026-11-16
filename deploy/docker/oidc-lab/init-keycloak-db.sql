-- 仅在全新 ADui SCADA PostgreSQL 数据卷初始化时创建 Keycloak 独立逻辑数据库。
-- 已有数据卷不会重新执行此脚本，禁止通过清除数据卷强行复位。
CREATE DATABASE adui_scada_keycloak;
