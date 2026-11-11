# ADR-0035：工程结构校验结果与不可变版本快照基础

- 状态：Proposed
- 日期：2026-11-11
- 关联需求：FR-002、FR-007、FR-008、FR-013、FR-016、NFR-004、NFR-006
- 依赖：[ADR-0018](0018-schema-version-migration.md)、[ADR-0021](0021-indexeddb-dexie-storage.md)

## 背景

V0.2 已有严格的 `ScadaDocument 0.2.0` Parser、浏览器 Dexie 草稿与双框架工程 JSON 互通，但尚不存在可供后续工程发布管理复用的结构化校验结果和内容完整性快照。未经明确边界设计，直接增加“发布”容易把临时草稿、版本副本和生产发布快照混淆。

## 决策

1. **保持 Schema 不变。** `packages/core/src/project-snapshot.ts` 只通过当前 `parseScadaDocument` 严格校验，不接受未显式迁移的旧版本，不引入新工程字段，也不自动关联设备。
2. **结构化校验。** `validateProjectDocument(input)` 返回 `{ valid, issues, document? }`。成功时包含已校验的防御性工程副本；失败时将现有 Parser 的首条 `TypeError` 转为中文问题 `{code:"DOCUMENT_INVALID",severity:"error",path,message}`。首版是**首错结构校验**，既不是多错误聚合器，也不检查 Tag 是否在生产设备目录中存在。
3. **纯 Core 快照。** `createProjectSnapshot(input,{revision,createdAt})` 生成 `formatVersion:1` 的独立容器，包含 `projectId`、正安全整数 `revision`、严格 UTC ISO 毫秒 `createdAt`、`hashAlgorithm:"SHA-256"`、`contentHash`、`document`。入参必须是当前合法工程；结果深冻结，原工程变化不会污染快照。
4. **稳定内容摘要。** 对快照元数据和经过 Parser 规范化的工程执行递归对象键排序，形成稳定 JSON 后，采用运行环境原生 `crypto.subtle.digest("SHA-256")`。计算包含版本号和时间；对字段顺序不同但语义一致的对象输出相同摘要；运行环境缺少 WebCrypto 时明确报错，不降级为弱散列。
5. **不可信数据回读。** `readProjectSnapshot(unknown)` 严格检查容器字段白名单、格式版本、摘要算法、工程 ID、修订号、时间和当前 Schema，重新计算 SHA-256 并拒绝任何不一致。回读返回新的冻结副本；JSON 序列化后的原对象不会天然保持冻结，必须通过此入口重新校验。
6. **容量上限。** 首批对带元数据的规范化 JSON 限制为 **2 MiB UTF-8**，与现有本地草稿容量同量级。此上限不是最终生产工程容量，不替代服务端限流和容量评估。
7. **明确不实现的能力。** 不增加工程历史表、单调版本号分配、服务端存储、原子发布指针、回滚、签名、RBAC、审计、生产连接和设备写入。修订号由调用方提供，尚无服务端唯一性或并发保证。SHA-256 仅用于完整性检查，不证明发布者身份；拥有写权限的人仍可能替换内容并重新计算摘要。

## 测试与交付

新增 Core 单测覆盖合法工程、副本隔离、深冻结、键顺序、不同修订号/时间、JSON 往返、内容与元数据篡改、未知字段、无效参数、超限容量。两套前端不直接新增 UI，因此沿用现有 `test:browser`、`test:interop` 作为回归检查。

**状态说明：** 本 ADR 为 Proposed。新分支源码曾在独立 ES2022 / NodeNext 简化 Parser 环境通过类型与算法冒烟检查；未在维护者完整仓库中执行新单测与 `pnpm run ready`。FR-008 正式工程发布/回滚仍为规划中。
