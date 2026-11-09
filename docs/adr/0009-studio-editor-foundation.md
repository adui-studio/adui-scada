# ADR-0009：V0.2 共享 SVG Studio 首批编辑内核

- 状态：Accepted
- 日期：2026-11-09
- 关联需求：FR-005、FR-002、FR-006、FR-013、NFR-004

## 背景

V0.1 已实现 Schema 校验、SVG 只读渲染、Tag Store 与 Vue/React 运行监控，但还没有 Studio 命令、选择与工程交换。两种框架分别实现编辑逻辑会导致 JSON 互通和撤销历史不一致。

## 决策

1. 第一批在现有 `packages/core` 中增加独立导出 `@adui/scada-core/editor`，共享 `DocumentEditor` 和纯函数 `withNodePosition`，避免新增 Workspace 包与锁文件扰动。Runtime 不 import 该子入口；必要时再迁移到独立 `editor-core` 包。
2. 使用 `ScadaDocument 0.1.0` 作为唯一工程数据协议，不新增框架专属字段。每次 Command 通过 `parseScadaDocument` 校验并防御性复制。
3. 编辑器保存最多 100 步不可变工程历史；选中状态不入历史，拖动松开时只提交一条命令。首批仅实现位置移动和 Label 文案修改；导入成功重置历史，导入失败保证原子性。
4. Vue/React 共享业务编辑命令及纯 SVG 渲染，但各自负责 Pointer Events、SVG 坐标转换、图层列表和 UI 生命周期。
5. 本地 JSON 导入/导出用于人工验证双向工程互通；服务端工程保存、版本发布、审计、权限与设备控制均不在首批实现范围。

## 安全与风险

预览仅使用固定静态模拟 Tag；绝不把 Studio 模拟画面冒充现场实时值。不允许 Schema 携带 JS，所有 Label 使用白名单 SVG 文本转义。用户离开 Studio 前需要导出 JSON，否则会话内改动丢失；后续应加入本地草稿提醒和正式保存服务。浏览器键盘、触摸与大规模场景性能需要逐步补充验证。

当前代码尚待维护者 Windows 环境的完整 `pnpm run ready` 和 Vue/React 双向人工 UI 验收。
