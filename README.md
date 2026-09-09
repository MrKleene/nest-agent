# nest-agent

基于 NestJS 的 Agent 后端项目。目前已实现用户、认证会话、数据库接入和通用 HTTP 基础设施，Agent 业务功能将逐步加入。

技术栈：NestJS 12、TypeScript（ESM）、pnpm、PostgreSQL、Drizzle ORM、Zod、Vitest。

## 快速启动

以下命令在项目根目录执行。使用项目的 Docker Compose 启动数据库时，需要先启动 Docker。

```bash
pnpm install
# 首次使用时复制；已有 .env 时直接编辑，避免覆盖
cp .env.example .env
```

启动前编辑 `.env`，填写随机 `JWT_SECRET`（至少 32 个字符），并确认 PostgreSQL 凭据与 `DATABASE_URL` 一致。完整配置见 [配置与本地调试](docs/configuration.md)。

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm start:dev
```

若使用已有 PostgreSQL 实例，可以跳过 Docker 启动步骤，并将 `DATABASE_URL` 指向该实例中已创建的数据库。

默认 API 地址：`http://localhost:3000/api`。前端来源默认为 `http://localhost:5173`，按实际端口调整 `CLIENT_ORIGIN`。

## 常用命令

| 命令                               | 用途                           |
| ---------------------------------- | ------------------------------ |
| `pnpm start`                       | 编译并启动应用                 |
| `pnpm start:dev`                   | 开发模式，监听文件变化         |
| `pnpm start:debug`                 | 调试模式，监听文件变化         |
| `pnpm build`                       | 构建生产产物                   |
| `pnpm start:prod`                  | 启动已构建产物，需先执行 build |
| `pnpm lint`                        | 代码检查                       |
| `pnpm format`                      | 格式化源码和测试               |
| `pnpm test`                        | 单元测试，无需数据库           |
| `pnpm test:cov`                    | 单元测试覆盖率                 |
| `pnpm test:e2e`                    | 端到端测试，需先准备独立测试库 |
| `pnpm db:generate --name=变更名称` | 根据 Schema 生成迁移           |
| `pnpm db:migrate`                  | 执行数据库迁移                 |

E2E 会迁移并清理测试数据，请先按 [数据库说明](docs/database.md) 配置专用测试库。

## 项目文档

| 文档                                    | 内容                                                  |
| --------------------------------------- | ----------------------------------------------------- |
| [配置与本地调试](docs/configuration.md) | 环境变量、API 前缀、CORS 和 Origin 校验               |
| [认证与会话](docs/authentication.md)    | 登录、刷新、注销、Guard、Cookie、Token 轮换及前端接入 |
| [接口规范](docs/api-conventions.md)     | 全局参数校验、响应格式、错误码、请求 ID 和日志        |
| [数据库](docs/database.md)              | PostgreSQL、Drizzle、表结构、迁移和测试库             |

新增或调整功能时，同步更新对应文档；README 保留快速启动和导航，避免重复维护详细说明。

## 参考资料

- [NestJS 官方文档](https://docs.nestjs.com)
- [NestJS 部署指南](https://docs.nestjs.com/deployment)

项目暂未启用 `@nestjs/observe`，当前日志与可观测性约定见 [接口规范](docs/api-conventions.md)。
