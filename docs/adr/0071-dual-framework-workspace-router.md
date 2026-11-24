# ADR-0071：双框架工作区 Hash 路由

- 状态：Accepted
- 日期：2026-11-24
- 关联：PR #192，维护者明确要求正式接入 Router。
- 验收：候选代码尚未完成依赖锁定、完整构建或真实浏览器验证。

## 决策

React 采用 React Router 7.18.5 的 Data Router（createHashRouter / RouterProvider / Outlet），Vue 采用 Vue Router 4.6.5（createRouter / createWebHashHistory / RouterView）。两版统一路径：根工作台、/runtime 模拟监控、/published 受控只读预览、/studio 默认示例、/studio/:projectId 本地工程。Hash 模式兼顾现有 Web 部署和 Tauri，不要求 HTTP 服务端回退配置。

项目 ID 使用现有 Core 草稿标识符校验。工程专属 URL 只从当前浏览器本地草稿或对应内置示例解析，找不到时明确提示，不能回退至其他工程。工作台导入的未保存正文只在当前应用内一次性交接，不进入 URL、history.state 或额外持久化。编辑器内部载入新工程时替换路由地址但保留当前编辑器及服务端 CAS。离开编辑器比较本地已确认保存基线，使用 Router 阻止未确认离开，刷新使用浏览器原生卸载保护；路由本身不授予服务端权限。

## 验收

双端四工作区 URL、前进后退、刷新、工程 ID、缺失工程拒绝、未保存确认及 SSE 卸载需要真实浏览器回归。Catalog 已声明固定版本；当前协作容器不能访问 npm，必须由真实 pnpm 12.18.0 生成并提交 pnpm-lock.yaml 后才能进行冻结安装和完整验收，不手工伪造锁文件。
