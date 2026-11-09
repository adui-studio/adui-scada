# ADui SCADA · 开发与验证 Harness

Harness 用于形成真实可重复的“实现 → 测试 → 反馈”闭环。V0.1 仅有 Core 与模拟诊断页，未建立正式 Web 应用构建链路。

## 环境要求

原仓库声明 Node.js >= 22.18.0、pnpm 12.18.0、vite-plus 1.5.0。`vite.config.ts` 包含 format/lint 规则，`.vite-hooks/pre-commit` 运行 `vp staged`。本次不更换工具链、不更新 `pnpm-lock.yaml`。

## 当前命令

```powershell
pnpm install
pnpm run docs:check
pnpm run test:core
vp check
pnpm run ready
pnpm run dev
```

| 命令         | 作用                                          | 限制                        |
| ------------ | --------------------------------------------- | --------------------------- |
| `docs:check` | 现有 Markdown、需求编号与 Skill 静态检查      | 非代码构建/运行测试         |
| `test:core`  | Node 内置测试执行 Document、Tag、SVG 三组测试 | 非 Web 双框架和工业协议测试 |
| `vp check`   | 现有 Vite+ lint、格式与类型检查               | 需用户本机安装依赖后复验    |
| `ready`      | `vp check` → `test:core` → `docs:check`       | 当前无正式产品 build task   |
| `dev`        | 启动水处理模拟诊断服务器                      | 不是 Vue/React/NestJS 应用  |

Node 测试使用 `--experimental-strip-types`；无需新引入 Vitest。后续应用出现时使用 Vite+ workspace 统一运行构建、测试，并添加双框架 Playwright 验收。

## 实测与尚未验证

本轮在独立执行环境执行了核心单元测试；具体测试数量、TypeScript 检查、Node 版本和运行验证见 [V0.1 实施记录](V0.1_IMPLEMENTATION.md)。**尚未执行**真实 Windows + pnpm 的安装检查、`vp check`、Vue/React 应用构建或任何现场安全验证。

## 后续质量矩阵

| 区域          | 下一步最小验证                                  |
| ------------- | ----------------------------------------------- |
| Document/Core | Schema 版本迁移、命令撤销重做、持久化、未知图元 |
| Vue / React   | 同一工程序列化往返、两端 SVG 与质量等价         |
| Runtime       | WS 快照/增量、断线重连、订阅回收、序列重置      |
| Gateway       | 协议模拟器、超时、证书、资源释放、写入拒绝      |
| Server        | RBAC、发布原子性、报警状态、审计                |
| E2E           | 模拟设备 → 发布 → 双端监控                      |
| 安全          | 越权、注入、恶意工程、默认写入禁止              |

有关纯文档检查详见 [VALIDATION](VALIDATION.md)。
