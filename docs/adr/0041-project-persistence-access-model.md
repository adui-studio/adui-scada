# ADR-0041：PostgreSQL 工程持久化、工程级权限与版本事务设计

- 状态：Proposed
- 日期：2026-11-12
- 关联需求：FR-001、FR-002、FR-008、FR-013、FR-014、NFR-004、NFR-006
- 依赖：[ADR-0035](0035-project-validation-snapshot.md)、[ADR-0036](0036-local-version-history.md)、[ADR-0040](0040-server-project-contract.md)

## 背景与边界

已存在 `ScadaDocument 0.2.0` 的严格 Parser、内容完整性 SHA-256 快照、浏览器 IndexedDB 版本 CAS 和服务端保存请求白名单。然而 NestJS 只有 `GET /health`，还没有可信认证主体、工程授权、数据库连接或可用的项目发布流程。不能将本地历史视为正式服务端版本库，也不能先开放匿名工程写入接口。

本 ADR 是**待评审的数据模型与事务方案**。下面 SQL 是示意 DDL，未创建迁移文件、未连接 PostgreSQL、未部署数据库；ORM/SQL 客户端、数据库版本、迁移管理、真实身份系统和运行时部署方式仍未决定。

## PostgreSQL 候选四表

```sql
-- 候选 DDL，仅供评审，不作为已经执行的数据库迁移
CREATE TABLE scada_projects (
  tenant_id varchar(128) NOT NULL,
  project_id varchar(128) NOT NULL,
  head_revision bigint NOT NULL DEFAULT 0 CHECK (head_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id)
);

CREATE TABLE scada_project_grants (
  tenant_id varchar(128) NOT NULL,
  project_id varchar(128) NOT NULL,
  subject_id varchar(128) NOT NULL,
  permission text NOT NULL CHECK (
    permission IN ('project:read', 'version:read', 'version:append')
  ),
  PRIMARY KEY (tenant_id, project_id, subject_id, permission),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES scada_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE scada_project_versions (
  tenant_id varchar(128) NOT NULL,
  project_id varchar(128) NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_by varchar(128) NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, revision),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES scada_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE scada_project_audit (
  event_id uuid PRIMARY KEY,
  tenant_id varchar(128) NOT NULL,
  project_id varchar(128) NOT NULL,
  revision bigint NOT NULL,
  actor_id varchar(128) NOT NULL,
  action text NOT NULL CHECK (action = 'version:append'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, revision)
    REFERENCES scada_project_versions (tenant_id, project_id, revision)
    ON DELETE RESTRICT
);
```

- `(tenant_id, project_id)` 是服务端隔离边界；数据库复合外键阻止把 A 租户的版本挂到 B 租户项目上。项目 ID 只在租户范围内唯一，不得脱离租户单独查找工程。
- `head_revision=0` 表示该**已创建项目**尚无任何版本，不等于允许未经授权自动创建项目。`expectedRevision:null` 仅在 head 为 0 时合法。正常 head 是正整数；服务端必须控制修订号不超出 JavaScript 安全整数范围。
- `snapshot` 存放由共享 Core 严格生成与验证的整个 `ProjectSnapshot` 容器（含 Schema、格式、摘要），不可把 `content_hash` 字符列单独当作可信签名；每次读取仍校验完整快照。完整快照超过 2 MiB 时拒绝。
- `grants` 每一行只有一项精确权限，所有主体 ID 与授权数据必须来自受控身份/管理服务；当前不定义可继承的管理员特权。未来授权管理动作必须经过独立审计与权限控制。
- `versions` 和成功提交 `audit` 只追加；应用数据库账号应禁止对历史快照执行 UPDATE/DELETE，正式迁移时还需落实角色权限及访问路径约束。完整版本快照、head 和审计必须一起提交，失败整体回滚。

## 候选服务端授权流程

1. NestJS 可信认证层解析主体 ID 与有效租户上下文，拒绝未认证请求；不得从请求体、Header 中任意角色字段、客户端 Tag 或浏览器 Origin 直接推导身份。
2. 校验主体在项目上的 `project:read`、`version:read` 或 `version:append` 明确授权；无身份、无项目、无授权、跨租户、跨工程都默认拒绝。对未知或不可见项目使用统一的不可枚举错误语义，不向客户端暴露“项目存在但无权限”的区别。
3. 只有经过授权才能调用第八批 `parseServerProjectSaveRequest` 严格校验请求体；服务端分配时间、修订号和快照摘要，客户端提交的身份/审计信息一律无效。
4. NestJS 专项 Guard、可信 principal 的生成/生命周期、审计失败策略、服务账户权限与租户成员关系由后续批次实现；**本批新增的 `hasProjectPermission` 只是一项纯策略，尚未与 Controller 或 Guard 绑定**。

## 版本保存与撤销授权的事务顺序

候选流程：请求预检与 `expectedRevision` 计算在事务外完成；后续受控服务端同一事务中：

1. `BEGIN`；按 `tenant_id + project_id` 查询项目行并执行 `FOR UPDATE`，未知工程按不可枚举策略拒绝。
2. 在工程行锁内**重新读取并确认**当前项目授权仍有效；撤销授权和变更项目状态的事务也必须先锁同一工程行，保证锁顺序一致，避免“检查后撤权仍提交”。
3. 比较数据库 `head_revision` 与客户端预期：`expectedRevision:null` 对应数据库 0；其他情况必须严格相等，否则返回冲突并回滚。服务端计算 `nextRevision=head+1`，检查上界和快照大小。为避免长事务，SHA-256 可以按候选修订号在事务外预先计算，但锁内仍必须复查期望 head。
4. 以 `(tenant_id,project_id,nextRevision)` 插入不可变快照，更新项目 head；将包含可信操作人、工程、版本和操作结果的成功审计事件插入 `scada_project_audit`。这三项写入在**同一个事务内**完成或全部回滚。
5. `COMMIT` 后才向客户端确认保存成功。未提交、失败与冲突不得产生成功审计；失败尝试的安全审计需要**独立于会回滚的业务事务**的持久通道，且必须设计失败封闭策略，不能声称本批已交付。

真实实现必须测试首次创建、并发双写只成功一个、跨租户数据隔离、撤权竞争、审计插入失败整体回滚、持久化重启、篡改快照拒绝读取、数据库不可用时不影响已发布 Runtime。发布指针、审批和设备写入属于独立流程，**不得因为有版本历史就自动产生生产发布权限**。

## 安全与未决项

- PostgreSQL 版本、数据库驱动/ORM、迁移管理、权限体系与身份提供方未确认；当前 SQL 不是可直接部署的生产迁移。
- 真实数据库连接池、超时、重试、死锁、RLS 多租户补充防御、字段加密、备份/恢复、审计保留策略与性能容量须独立验证。
- 生产设备写入、匿名工程保存、未授权版本查看、自动发布和用户脚本执行仍保持禁止。

## 本批验收

在 `apps/server/src/projects/project-access-policy.spec.ts` 验证默认拒绝、精确授权、跨租户/工程/主体、未知权限和非法标识；维持原 NestJS 工程读/写版本路由 404 负面测试。执行完整 `pnpm run ready` 及文档检查。**未运行 PostgreSQL 迁移、事务与身份认证实测时，不能宣称数据库持久化或访问控制已经上线。**
