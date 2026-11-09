# ADui SCADA · Tauri 2 Desktop

基于用户上传的 Tauri 2 Rust 默认模板初始化，桌面应用重用现有 React / Vue Web 构建，不额外复制 UI 源码。**优先 Windows**。

从仓库根目录先启动模拟数据服务器（仅用于 V0.1）：

```powershell
pnpm run dev:demo
```

另开终端启动桌面壳：

```powershell
pnpm run desktop:dev:react
# 或切换为 Vue 前端
pnpm run desktop:dev:vue
```

Windows 桌面打包（需要 Rust、C++ Build Tools、WebView2 等 Tauri 2 系统前置）：

```powershell
pnpm run desktop:build:react
# 或
pnpm run desktop:build:vue
```

- `tauri.conf.json` 默认嵌入 `apps/web-react/dist`，Vue 通过 `tauri.vue.conf.json` 叠加覆盖。
- 图标沿用初始模板占位素材，后续统一换成 ADui SCADA 正式图标。
- V0.1 不注册 `invoke` 命令，没有设备写入、文件系统或 shell 插件权限。
- **注意**：桌面打包产物只包含前端页面，不包含模拟 SSE 服务。生产运行环境尚无正式后端，因此打包后监控页会提示连接失败，不代表离线监控已经交付。
- Rust crate 依赖由 Cargo.toml / Cargo.lock 管理，不能放入 pnpm Catalog；Node 依赖统一引用根 Catalog。
