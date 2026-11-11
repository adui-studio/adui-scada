# ADui SCADA · 文档校验机制

## 执行

```powershell
pnpm run docs:check
# 或
node scripts/validate-docs.mjs
```

脚本仅使用 Node.js 内置模块，无额外依赖。

## 自动检查范围

1. 核心文档、ADR 和脚本是否存在。
2. Markdown 相对链接路径是否存在。
3. 需求表中 FR-NNN / NFR-NNN 编号是否重复。
4. ADR 文件编号、状态是否有效。
5. `skills-lock.json` 的技能是否有对应 `.agents/skills/<name>/SKILL.md`。

错误显示文件及原因，退出码非零。外部 URL、Markdown 锚点语义、实际图片/图表渲染不在此脚本范围。

## 必须进行的人工或运行验证

需求与 SDD 是否语义一致、Mermaid 是否正常渲染、代码与命令能否执行、Skills 的许可及安全性、工业协议兼容、控制写入边界、性能与现场认证，均不能由文件存在性检查证明。

文档、需求编号、Skills 或 ADR 结构变化时同步更新脚本与本说明；CI 只有在实际测试和维护条件具备后再配置。

## 编辑器浏览器几何和交互检查

`pnpm run test:browser` 是独立的本地浏览器冒烟检查，不属于 `pnpm run ready` 默认链路。需要启动 React/Vue 开发服务器并安装 Chrome/Edge；测试使用隔离浏览器数据，不访问生产设备。详见 [Harness](HARNESS.md) 的 V0.2 浏览器交互回归小节。
