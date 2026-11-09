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

Windows 打包如果遇到 **NSIS 工具下载 HTTP 504 / 网络不可达**，可以只生成 MSI（不会触发 NSIS 打包依赖下载）：

```powershell
pnpm run desktop:build:react:msi
pnpm run desktop:build:vue:msi
```

这里的 `--bundles msi` 只覆盖本次 CLI 打包目标，**不修改** `tauri.conf.json` 中默认的 `"targets": "all"`；原来的 `desktop:build:react` 和 `desktop:build:vue` 仍会尝试 MSI + NSIS。先复制或改名保存 React MSI，再构建 Vue，否则同一个 `ADui SCADA_0.1.0_x64_en-US.msi` 可能被覆盖。

**2026-11-09 实测说明：** React Web 与 Rust Release 编译成功，日志显示已生成 `target/release/bundle/msi/ADui SCADA_0.1.0_x64_en-US.msi`；随后 NSIS 下载 `nsis_tauri_utils.dll` 时收到 HTTP 504，导致整体 `tauri build` 返回失败。这不表示 MSI 已实际安装验证，也不表示 Vue Release 已完成打包。

- `tauri.conf.json` 默认嵌入 `apps/web-react/dist`，Vue 通过 `tauri.vue.conf.json` 叠加覆盖。
- 图标沿用初始模板占位素材，后续统一换成 ADui SCADA 正式图标。
- V0.1 不注册 `invoke` 命令，没有设备写入、文件系统或 shell 插件权限。
- **注意**：桌面打包产物不内置模拟 SSE HTTP 服务或工业网关。V0.1 MSI 改为在前端内运行共享 Core 的**离线水处理模拟**，明确标识 `SIMULATION`；它不是现场实时采集、正式离线历史或生产 Runtime。
- Rust crate 依赖由 Cargo.toml / Cargo.lock 管理，不能放入 pnpm Catalog；Node 依赖统一引用根 Catalog。

## V0.1 安装版离线模拟数据修复

此前安装 MSI 后直接请求 `/demo/project`。这个路径只有开发环境的 Vite 代理才能转发到 `127.0.0.1:4178`，安装版会得到 HTML 应用入口，导致 `Unexpected token '<'`（HTML 被当成 JSON）。已调整为**两种构建模式**：

| 运行环境 | 构建入口 | 数据源 |
| --- | --- | --- |
| Web 开发 / Tauri `dev` | `vp dev` | `/demo/project` + `/demo/events`，需 `pnpm run dev:demo` |
| Tauri MSI | `pnpm run desktop:build:react:msi` 或 `desktop:build:vue:msi` | `vp build --mode desktop`，浏览器内部复用 Core 的工程和模拟器，无网络请求 |

离线模拟每秒生成水位、泵与流量读数，并按原演示方案周期性标记 `STALE`；页面状态明确为 `SIMULATION`，提示值是本机生成。普通 Web 构建不会因此隐式切换为模拟模式。

重建并重新安装后验证（安装前可先卸载同版本旧 MSI）：

```powershell
pnpm run ready
pnpm run desktop:build:vue:msi
# 另行构建 React MSI 时，请先备份 Vue MSI；两套构建名称相同
```

**验收限制**：2026-11-09 Vue MSI 已验证可以安装及启动窗口，但旧构建因 `/demo/project` 返回 HTML 而失败；本修复尚待 Windows 上重新构建、安装及确认演示 SVG/Tag/STALE。生产网关、鉴权和正式设备数据仍未实现。
