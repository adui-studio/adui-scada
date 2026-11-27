# ADui SCADA · Docker 本机全新安装与启动

唯一 Compose 文件为 `deploy/docker/compose.yaml`，项目名 **adui-scada**。七个服务为 web-react、web-vue、server、demo、postgres、redis、keycloak。业务库和 Keycloak 库使用同一个 PostgreSQL 19 实例中的独立逻辑数据库；正式业务结构由 Prisma 8 原生契约管理。仅用于 Windows 本机 Docker Desktop 的 Linux 引擎，不是生产部署。

## 已初始化的本机环境

保留现有根目录 .env、.local/docker/、证书、随机凭据和 Docker 数据卷，不重新复制或覆盖。已有 PostgreSQL 19 原生业务库直接执行：

```powershell
pnpm run docker:up
if ($LASTEXITCODE -ne 0) { throw "Docker 一键启动验收失败，保留现场" }
pnpm run docker:ps
```

恢复唯一 adui-scada Compose 七服务一键启动，新增 docker:infra 保留三服务基础设施入口。docker:up 先准备本机随机凭据与证书、验证 Compose 和固定本机 Linux Docker Desktop 命名管道，等待基础设施，再执行已有 Prisma 8 --status 官方严格结构/标记及真实中文注释只读验证；只在成功后构建并启动 server、demo、web-react、web-vue，等待应用服务运行。容器内显式探针经 server 的 lab 网络访问固定 postgres:5432/adui_scada，必须严格只读且与宿主验证的 PostgreSQL 集群 systemIdentifier 一致；复用正式原生根模块全部只读核验与关闭流程。凭据从现有 Git 忽略的随机秘密文件读取，仅经 docker exec -T 标准输入传给一次性探针，不进入服务环境、命令行或报告。两端 Web 探针验证容器网络内静态入口、/api/health、/demo/project、/demo/events 的响应状态及 SSE 内容类型、受保护工程路由保持 404。宿主默认连接白名单和正式数据库生产禁令保持不变。Docker HTTP Server 仍显式关闭 OIDC，不开放身份、工程或设备写入接口；Keycloak 本轮仅验证容器启动，不验证真实登录、JWKS、HTTPS 回调、Cookie 或双端浏览器渲染。不存在数据库自动初始化、迁移、清卷、失败回退、旧库接管或自动授权。

## 首次安装（只用于确认全新的空库）

Docker Desktop、Node/pnpm 依赖、mkcert 及本机可信根证书须已准备，三个基础设施镜像须已在本机存在。仅在不存在 .env 时复制模板，不覆盖既有配置。先启动基础设施并运行官方只读预览：

```powershell
pnpm run docker:infra
pnpm run db:prisma8:fresh:preview
```

如果确实为全新空库，预览通过后须获得维护者独立明确授权，才执行 ADR-0073 所记录的显式首次初始化命令；不得将初始化嵌入 docker:up。随后执行 docker:db:status 与 docker:up。若库已初始化，只运行状态检查和正常启动；任何结构、标记或中文注释不一致都停止本次应用启动，不重试写入。

## 访问与验收

| 服务                     | 默认本机入口            |
| ------------------------ | ----------------------- |
| React Docker HTTP        | http://127.0.0.1:18080  |
| Vue Docker HTTP          | http://127.0.0.1:18081  |
| PostgreSQL（两个逻辑库） | 127.0.0.1:15432         |
| Redis                    | 127.0.0.1:16379         |
| Keycloak HTTPS           | https://127.0.0.1:18443 |

HTTP Web 入口不能替代 OIDC HTTPS 受保护工程 API。真实 Keycloak 登录、双端回调、Secure Cookie、CSRF、ACL 和真实写事务后续独立验收，不自动创建用户或授予工程权限。HTTP 就绪探针只代表 HTTP 子系统；数据库就绪由独立原生探针验证。

```powershell
pnpm run docker:db:status
pnpm run docker:ps
pnpm run docker:logs
pnpm run docker:down
```

docker:down 不删除卷，禁止为排错执行 down -v、删除持久化卷或重置数据库。docker:up 使用已有基础设施镜像，不主动升级基础设施版本；失败时保留现场。不读取或输出真实凭据，不自动修改根 .env。

## 当前验证状态

维护者 Windows 已完成 PR #250 最终复验：中文注释 2/2、OIDC 身份 14/14、全新安装 28/28、CLI 4/4、82 个文件 966/966 单测、6 个文件 65/65 HTTP E2E；498 格式文件、339 受检零警告/Lint/类型错误，中文 365 个自有文件、文档 97 份，React/Vue/NestJS 构建通过。React 单个 chunk 591.62 kB 的构建体积警告暂保留。锁文件刷新与冻结安装已通过，移除 Prisma 7 三项直接依赖及 98 个包。真实 PostgreSQL 19 只读 FRESH_PROVIDER_SMOKE_READY，存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表/85 字段/36 CHECK/20 索引/13 外键/119 注释一致，所有原生根模块及只读标志为 true，最终退出码 0、工作区干净。远端验收提交 dbab7c2a7ca3737e23fd451811aef92981378801，维护者明确授权，PR #250 已 Squash 合并至 feat/mvp-first-integration 的 94106b29b328833d944f35361004411b5a3ddab2。E-160 已关闭。

协作环境 Node.js 22.16.0 对从当前远端原生 URL 解析函数提取的类型擦除片段及同等参数断言运行 node --test，2/2 通过（宿主两模式不变；容器允许路径及九种非法配置拒绝）。从远端启动编排和测试文件提取新增/调整的四个模拟编排用例，在 V8 隔离环境以基础等价断言执行，4/4 通过（启动顺序及秘密仅标准输入、数据库失败不启动本次应用、烟测失败不报告成功、基础设施入口独立）。这不是完整仓库 Node/Vitest 测试或真实 Docker 验收。Docker、pnpm、Vite+ 及固定依赖在协作容器不可用，Git 网络 DNS 不可达；Windows 增量测试、完整构建和实际七容器启动待验收。
