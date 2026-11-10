# ADui SCADA · 自有文案与诊断信息统一中文

- 生效范围：项目**自行维护**的 Vue、React、SCADA Core、Runtime、NestJS、Tauri、自有模拟器、校验脚本、Docker 配置与文档。
- 文案规范：**面向用户或开发者的提示、异常、日志、测试标题、注释及 JSDoc 均使用简体中文**。
- 目标：让 SCADA 编辑器、模拟监控与开发调试信息保持一致，同时不破坏工业通信和工程 JSON 契约。

## 一、必须使用中文

1. 运行时及编辑器页面的标题、状态、提示、异常、表单说明和无数据状态。
2. `throw new Error/TypeError/RangeError` 等项目自行创建的异常说明；可保留原有标准异常类型。
3. `console.log/error/warn` 等项目日志的固定描述；动态数据与真实系统错误原文可保留。
4. `test/it/describe` 的测试名称，以及项目编写的断言失败说明；异常文案调整时同步更新 `toThrow` 匹配文本。
5. 自研 TypeScript、JavaScript、Vue、Rust、CSS、Dockerfile、Nginx 和环境模板中的注释、JSDoc、开发说明。
6. 诊断脚本通过/失败的输出；必须保留准确退出码、必要的文件名、行号和技术标识。

## 二、禁止翻译的技术契约

以下均属于**程序接口或标准标识符**，不能翻译成中文：

- 工程 Schema 的 `schemaVersion`、`projectId`、`pages`、`nodes`、`bindings` 等字段名；
- 现有 `water.level`、`water.pump.running`、`water.flow` 等 Tag ID；
- `GOOD`、`UNCERTAIN`、`BAD`、`STALE` 质量枚举及 Runtime 状态标识；
- 图元类型 `tank`、`pump`、`pipe`、`label`，固定事件类型、接口路径和 HTTP 字段；
- 第三方包名、工具命令、配置关键字、环境变量、测试 API、CSS 类名及代码标识符。

**显示与协议分离：** `TAG_QUALITY_LABELS` 将质量状态映射为「正常 / 不确定 / 异常 / 已过期」；`RUNTIME_STATUS_LABELS` 将 Runtime 内部状态映射为「未启动 / 加载中 / 连接中 / 模拟数据正常 / 离线模拟 / 重新连接中 / 运行异常」。映射只用于显示，数据传输和 JSON 序列化仍使用原值。

## 三、范围边界

Node、Vite+、Vitest、pnpm、Docker、Rust 编译器等第三方工具**自行生成**的英文错误及第三方 Skill/依赖源码，不属于本项目能够直接控制的提示。不得改写协议字段、工具源码或错误类型以强制实现中文。项目自有日志包裹的固定说明必须使用中文，但真实异常对象本身可原样记录，便于定位。

默认水处理演示工程的可见标题和说明已使用中文，**既有用户导出的旧 JSON 仍合法**；不迁移或覆盖用户自定义文案。

## 四、验证

```powershell
pnpm run messages:check
pnpm run ready
```

`messages:check` 扫描自有源码及部署配置中的异常文本、测试名称、注释和日志，发现疑似纯英文文案时返回非零退出码。它是启发式静态门禁，不能自动证明所有页面和运行时文本均已中文化；发布前仍需检查 React/Vue、桌面端、SVG 画面和模拟服务器。

中文异常文案修改后，单元测试与 E2E 中的 `toThrow` 应一同更新。新增英文技术标识必须明确说明其兼容性原因，不能将普通提示写成英文。
