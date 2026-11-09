# ADui SCADA · 开发与验证 Harness

Harness 旨在形成真实可重复的“实现 → 验证 → 反馈”闭环。当前仓库仍是 Vite+ Starter。

## 环境事实

仓库声明 Node.js ≥ 22.18.0、pnpm 12.18.0、vite-plus 1.5.0；`vite.config.ts` 包含 format/lint 规则；`.vite-hooks/pre-commit` 为 `vp staged`；没有业务应用、后端测试、CI 工作流或数据库。

## 当前命令

```powershell
pnpm install
pnpm run docs:check
vp check
```

文档检查等价于 `node scripts/validate-docs.mjs`。以上是**存在的命令入口**，不是本机已经通过的声明。

| 已有模板命令 | 限制 |
| --- | --- |
| `pnpm run dev` | 调用 `vp run website#dev`，但无 website 应用 |
| `pnpm run ready` | 调用 `vp check && vp run -r test && vp run -r build`，尚无业务项目测试/构建任务 |
| `pnpm run prepare` | `vp config`，需有对应的开发依赖环境 |

## 随开发建立的测试（尚未实现）

| 区域 | 最小验证 |
| --- | --- |
| Document/Core | JSON Schema、版本迁移、命令撤销重做 |
| Vue + React | 同一工程往返、双版本功能对齐 |
| Runtime | 订阅、快照、质量、断网重连 |
| Gateway | 模拟 OPC UA/Modbus/MQTT、超时和资源释放 |
| Server | RBAC、发布原子性、报警状态、审计 |
| E2E | 模拟设备 → 发布 → 监控闭环 |
| 安全 | 越权、证书、非法输入、默认写入禁止 |

建议逐步引入 Vitest、Playwright 和可复现协议模拟器；在实际代码和测试存在前不创建空 CI，也不声称质量门禁通过。

## 反馈与记录

按“理解 → 影响分析 → 最小修改 → 执行检查 → 修复重验 → 同步文档 → 报告实际结果”执行。记录命令、退出码、环境与限制；不把静态文档检查当作业务测试或现场安全审计。详见 [文档校验](VALIDATION.md)。
