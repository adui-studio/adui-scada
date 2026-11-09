# ADR-0004：每个框架合并 Studio 与 Runtime 应用

- 状态：Accepted
- 日期：2026-11-09

## 决策

Vue 3 与 React 分别维护 `apps/web-vue`、`apps/web-react` 两个完整 Web 应用。Studio、Runtime 作为不同功能模块共享工程 Schema、核心渲染和 Tag 模型。已实现的 Runtime 独立运行与渲染，不依赖未来 Editor。

## 代价与验证

未来编辑器组件按需加载，避免纯监控路径携带编辑命令依赖。跨框架工程互通、发布及 Runtime 功能对等仍需 E2E 验收；当前仅包含模拟监控原型。
