# ADR-0003：统一 pnpm Catalog、TS6 与 Vitest

- 状态：Accepted
- 日期：2026-11-09

## 决策

所有第三方依赖采用 `pnpm-workspace.yaml` 的单一 Catalog，内部包采用 `workspace:*`。TypeScript 统一固定为 6.0.3，单元测试统一采用 Vite+ 内置 Vitest，不再使用 node:test。沿用仓库 Vite+ 1.5.0。

## 影响与验证

依赖升级要统一修改 Catalog、运行 pnpm install 更新锁文件，执行 deps:check、test:unit、typecheck:web、build:web 和 vp check。集成结果未经本地工具链验证前仍为待验收。
