# ADui SCADA · NestJS API

基于用户上传的 NestJS 12 ESM 默认模板初始化。仅用于 V0.1 工程验证，非生产 API。

```powershell
pnpm --filter @adui/scada-server run start:dev
pnpm --filter @adui/scada-server run test
pnpm --filter @adui/scada-server run test:e2e
pnpm --filter @adui/scada-server run typecheck
pnpm --filter @adui/scada-server run build
```

启动后访问 `http://127.0.0.1:3001/health`。这是进程存活检查，**不代表数据库、Gateway 或真实设备在线**。

默认仅绑定 loopback、禁用跨域、没有认证/数据库/设备接口；接入业务 API 前必须完成身份验证与授权设计。TS6、NestJS 与测试依赖统一从根目录 `pnpm-workspace.yaml` Catalog 解析。
