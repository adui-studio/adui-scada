# ADR-0006：Tauri 2 安装版使用显式离线模拟数据源

- 状态：Accepted
- 日期：2026-11-09

## 背景

V0.1 Web Runtime 在开发环境通过 `/demo/project` 与 `/demo/events` 消费 127.0.0.1 上的模拟 SSE HTTP Harness。Tauri 2 发布版嵌入静态 Web 资源，没有 Vite 代理，也不会自动包含 HTTP 模拟服务。Vue MSI 安装成功后得到 HTML 而非 JSON，导致 `Unexpected token '<'`、画面空白。

## 决策

1. Tauri 两套 `beforeBuildCommand` 使用 `vp build --mode desktop`。应用通过 Vite 构建时注入的 `import.meta.env.MODE` 显式选择 `OfflineDemoRuntime`；开发 Web/Tauri 模式仍保持原 SSE 链路。
2. 共享 `packages/core/src/demo-document.ts` 为 SSE 演示和离线 MSI 提供相同的经过 Schema 校验的水处理工程；共享模拟器输出 Tag。
3. 离线模拟只使用 JS 内存及计时器，不对外发起网络请求、不连接 PLC/DCS、不开放 Tauri 命令。状态显示 `SIMULATION`，消息明确说明所有读数均为模拟；周期性演练断连后 `STALE`。
4. SSE 模式校验工程响应 Content-Type，避免把 HTML fallback 直接交给 `response.json()`。
5. 复用 Vue/React 同一共享 Runtime，不复制模拟业务逻辑；测试验证模拟启动、质量和定时器生命周期。

## 非目标与风险

- 不将本地模拟读数当成现场工艺数值、真实离线缓存或生产数据；现阶段无生产 API、鉴权、网关、设备控制。
- 普通 Web 发布包不会自动回退模拟模式，防止掩盖真实后端不可用。
- MSI 需要重新构建和安装才能应用修复；本决策不会使已安装的旧版本自动更新。
- 2026-11-09 开发分支已写入修复，但**完整 TS6/Vitest/MSI 重建及安装效果尚待 Windows 实测**。
