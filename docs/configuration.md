# 配置与本地调试

[返回项目首页](../README.md)

配置示例见 [`.env.example`](../.env.example)，运行时校验规则见 [`env.schema.ts`](../src/config/env.schema.ts)。`ConfigModule` 全局注册，应用启动时完成环境变量校验。以下命令均在项目根目录执行。

首次使用时复制配置文件，已有 `.env` 时直接编辑，避免覆盖：

```bash
cp .env.example .env
```

| 变量                           | 默认值 / 要求                            | 用途                       |
| ------------------------------ | ---------------------------------------- | -------------------------- |
| `NODE_ENV`                     | `development`；可选 `test`、`production` | 运行环境                   |
| `PORT`                         | `3000`；1–65535 的整数                   | HTTP 监听端口              |
| `API_PREFIX`                   | `api`；允许为空                          | 全局路由前缀               |
| `DATABASE_URL`                 | 必填，PostgreSQL URL                     | 应用数据库连接             |
| `JWT_SECRET`                   | 必填，至少 32 个字符                     | JWT 签名密钥，应使用随机值 |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | `900`；1–900 的整数                      | Access Token 有效期        |
| `AUTH_SESSION_TTL_SECONDS`     | `604800`；1–604800 的整数                | 会话固定有效期             |
| `CLIENT_ORIGIN`                | `http://localhost:5173`                  | 允许的前端来源             |

`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 用于 Docker Compose 中的 PostgreSQL；`TEST_DATABASE_URL` 用于独立 E2E 测试库。数据库准备与约束见 [数据库说明](database.md)。

## API 前缀、CORS 与本地调试

下面配置已有默认值，也可以在 `.env` 中显式设置：

```dotenv
API_PREFIX=api
JWT_ACCESS_TOKEN_TTL_SECONDS=900
AUTH_SESSION_TTL_SECONDS=604800
CLIENT_ORIGIN=http://localhost:5173
```

API 默认地址是 `http://localhost:3000/api`。`API_PREFIX` 是全局路由前缀，默认 `api`；设置为 `internal/v2` 后，认证地址和 Cookie Path 会一起变为 `/internal/v2/auth`；设为空字符串则不使用前缀。首尾斜杠会被移除，不接受通配符、查询参数或中间空路径段。修改配置后需重启服务。以下示例使用默认前缀。`CLIENT_ORIGIN` 填前端实际使用的协议、主机和端口，不带路径或末尾 `/`。前后端都使用 `localhost`，不要混用 `127.0.0.1`。Zod 会在启动时验证这些配置；Access 有效期最多 900 秒，会话有效期最多 604800 秒。

CORS 仅允许 `CLIENT_ORIGIN`，并允许凭据。`OriginGuard` 对 `POST /api/auth/*` 按以下规则检查：

- `NODE_ENV=development`：允许完全不带 `Origin` 的请求，方便 curl、Postman 等工具调试；如果携带了 `Origin`，仍必须与 `CLIENT_ORIGIN` 完全一致。空值、字符串 `null`、其他来源均返回 `403 ORIGIN_NOT_ALLOWED`。
- `NODE_ENV=test` 或 `production`：必须携带与 `CLIENT_ORIGIN` 完全一致的 `Origin`，缺失或不匹配均返回 `403 ORIGIN_NOT_ALLOWED`。

`NODE_ENV` 未配置时默认为 `development`。本地调试可显式设置 `NODE_ENV=development`，重启服务后，调试工具可以省略 `Origin` 请求头。浏览器前端仍需将 `CLIENT_ORIGIN` 配成实际前端地址；删除该配置只会恢复默认值，不会关闭 CORS 或来源校验。生产部署需显式设置 `NODE_ENV=production`。

这项开发环境例外只放宽来源检查，参数校验、Access Token 和会话校验仍然执行。`@Public()` 只跳过 Access 鉴权，不跳过来源检查。

Cookie 属性、生命周期和路径变化的影响见 [认证说明](authentication.md)。
