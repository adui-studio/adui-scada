# ADR-0039：真实浏览器双标签页草稿并发安全验收

- 状态：Proposed
- 日期：2026-11-11
- 关联需求：FR-002、FR-013、FR-016、NFR-004、NFR-006
- 依赖：[ADR-0021](0021-indexeddb-dexie-storage.md)、[ADR-0038](0038-version-recovery-safety.md)

## 背景

第六批已通过共享 Core 与 fake-indexeddb 测试验证草稿修订号 CAS、自动保存队列停写、保存与清除竞争，但模拟数据库实例不能证明真实 Chrome/Edge 中同一 Origin 的两个标签页能正确接收通知、暂停自动保存或在通知缺失时拒绝过期写入。

## 决策

1. 基于既有 `scripts/test-studio-browser.mjs` 增加独立的 `--multitab` 浏览器测试命令，不引入 Playwright、Puppeteer 或新依赖，也不改变 `pnpm run ready` 的无浏览器默认链路。
2. 所有浏览器操作都在脚本新建的临时 profile 中进行；两个真实标签页共享同一 Origin 的 IndexedDB，React 与 Vue 分别运行。以 DOM 交互驱动现有 Studio，另使用只读 IndexedDB 事务核验提交后的数据。
3. 正常 BroadcastChannel 场景需要观察第二标签页自动保存停写、当前编辑画面不变、草稿修订号与内容保持原样。只在测试标签页模拟无 BroadcastChannel，验证 IndexedDB CAS 是最终写入防护。
4. 通过真实 UI 清除与重建同一个草稿，确认修订号不回退且另一个标签页不会自动丢失当前画面。模拟原生 `IDBObjectStore.put()` 失败时，必须可见提示、停止自动保存并在故障解除后明确保存成功。
5. 所有故障注入仅作用于隔离测试页的浏览器接口；在 `finally` 恢复替换的方法并关闭所有调试标签页。失败返回非零退出码，不能沉默跳过。首轮 Windows 测试在故障注入阶段未命中目标写入，已由拦截数据库事务创建调整为拦截 `drafts.put()`；本次修复需重新实测。

## 非目标与限制

- 不修改 `ScadaDocument 0.2.0`、Dexie 数据库模式、共享 Core、TDesign UI、Runtime、服务端或工业设备写入边界。
- 此测试模拟不支持 BroadcastChannel 和拒绝写事务，不等同于真实浏览器存储配额耗尽、断电/崩溃一致性、Tauri WebView2 或跨设备协同验证。
- 在维护者 Windows 环境执行 `pnpm run ready` 与 `pnpm run test:multitab` 并提供实测日志前，只能标记源码已提交、待验收。
