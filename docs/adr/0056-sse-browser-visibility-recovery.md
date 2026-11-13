# ADR-0056：SSE 浏览器回归与后台页恢复时效复查

- 状态：Proposed
- 日期：2026-11-13
- 关联：FR-007、FR-009、NFR-001、NFR-002、NFR-003、NFR-006
- 前置：[ADR-0055](0055-sse-heartbeat-and-tag-silence.md)

## 背景

上一批在共享 Runtime 中实现 5 秒具名心跳、15 秒 SSE 传输静默重建和 12 秒 Tag 数据超时降级，但回归主要使用 Vitest 假定时器及虚拟 EventSource。真实 Chrome/Edge 中两个正式 Web 框架的订阅生命周期尚没有专项浏览器自动化入口。后台标签页计时器节流或暂停后，单凭定时器实际执行时间也无法确保恢复前台瞬间检查数据新鲜度。

## 决策

1. 浏览器与桌面模式的工程 Schema、TagChange 契约和原有同源预设 URL 不变。仅修改共享 `packages/runtime` 的 SSE 看门狗和数据时效检查，不分别改写 Vue/React 页面。
2. SSE 适配器记录最后一次收到 **真实 Tag 或 heartbeat 事件** 的墙上时间。定时器触发时重新计算持续静默时长，尚未达到 15 秒则只调度剩余时间；页面恢复为 `visible` 时立即复查。如果真正超时，则沿用先通知断连、确认未关闭、关闭旧流、重建固定同源 EventSource 的流程。
3. DemoRuntime 抽取既有 12 秒数据静默检查函数，在浏览器文档恢复为 `visible` 时立即执行。只有接受的新 Tag 才更新时间；具名心跳不能恢复旧值的 GOOD 质量。**修正 ADR-0055 的本地数据超时处理**：超时仅在 Runtime 展示层按 Tag ID 覆盖 `STALE` 质量，不调用会递增本地序列号的 `TagStore.markDisconnected()`，使上游下一条合法递增数据得以恢复对应 Tag；未收到有效新值的其他 Tag 继续显示过期。真正网络断连仍沿用 `markDisconnected()` 与新会话必须先 snapshot 的约束。非法消息、停止和重启必须注销新的 `visibilitychange` 监听，避免泄漏。
4. 新增 `pnpm run test:sse:browser`，复用现有 Chrome/Edge DevTools Protocol 的无依赖启动方式，以真实前端页面和原生 SSE 通道运行 React、Vue 两端。测试脚本只允许目标 URL 为本机回环地址；读取根目录 `.env` 的开发端口，按页面和 `/demo/project` 分别做显式预检查，失败时显示 URL、底层网络异常及启动命令。
5. 浏览器故障注入通过包装原生 EventSource **屏蔽应用层回调**，分别模拟“仅 Tag 停更、心跳仍在”和“Tag 与心跳完全静默”；测试检查 `stale`、重连后 `live`、同源路径不变、旧流关闭以及离开 Runtime 资源清理。此方法不会停止底层 HTTP 网络字节，不能宣称覆盖真实路由器断网或代理半开连接。
6. 不增加第三方依赖、不修改 Vue/React 业务页、NestJS/Prisma、Docker 代理或工业 Gateway；维持模拟接口非生产、同源、只读及回环访问边界。

## 本机运行与验收

首先打开三个独立终端，分别执行 `pnpm run dev:demo`、`pnpm run dev:react` 和 `pnpm run dev:vue`；第四个终端在项目根目录运行 `pnpm run test:sse:browser`。如浏览器不在默认安装路径，设置 `SCADA_BROWSER_PATH` 为 Chrome/Edge 可执行文件路径。脚本会自动创建和清理隔离浏览器用户目录，不需要向工程或模拟服务添加测试专用 API。

另外运行 `pnpm run test:runtime`、`vp check`、`pnpm run docs:check` 和 `pnpm run ready`。需人工将两个浏览器标签页先放后台超过 15 秒再切回，验证旧读数不会被伪装为 GOOD。真实代理半开、后台节流差异、长时多连接背压、现场设备与生产鉴权仍需单独验收。

## 当前验证状态

- 最初仅完成协作容器脚本静态语法检查；**随后维护者 Windows Chrome/Edge 浏览器与 pnpm 工作区已完成自动化实测**。
- 首轮维护者 Windows 运行：Runtime 专项 **30/31**，因本地 STALE 标记占用序列号导致恢复断言失败；浏览器脚本预检查返回 `fetch failed`。修正过期展示层、端口读取与诊断信息，并新增双 Tag 独立恢复回归后，第二轮实测 **Runtime 32/32、React/Vue 浏览器 SSE 回归均通过，两个命令退出码 0**。完整单测 **412/412**、NestJS E2E **17/17**，`vp check` 与完整 `ready` 均通过；原始日志来自维护者 Windows 环境。
- 本次改动通过 Draft PR 交付，维护者验收并明确授权前不合并、部署或发布。

- 本轮 `vp check` 为 253 个格式文件正确、124 个受检文件零警告/零错误，文档检查 72 份 Markdown 成功。E2E 预期 HTTP 503 为故意模拟关闭；Docker 本批增量回归、真实代理断流、高并发、生产认证和工业现场均未执行。验收记录更新后未重新执行全部质量链。
