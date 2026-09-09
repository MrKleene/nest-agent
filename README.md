<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## PostgreSQL 与 Drizzle

项目使用 `pg` 连接池和 Drizzle ORM，用户数据保存在 PostgreSQL 中。

1. 在 `.env` 中设置 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、`DATABASE_URL` 和至少 32 个字符的随机 `JWT_SECRET`，格式参考 `.env.example`。本机运行 Nest 时，数据库地址使用 `localhost:5432`。
2. 启动已有的 PostgreSQL 18 容器：

   ```bash
   docker compose up -d postgres
   docker compose ps
   ```

3. 执行项目中的数据库迁移，再启动应用：

   ```bash
   pnpm db:migrate
   pnpm start:dev
   ```

`src/database/schema.ts` 定义 `users` 和 `auth_sessions` 表。用户表包含 UUID 主键、姓名、唯一邮箱和必填密码哈希；会话表保存用户关联、Refresh Token 哈希、创建时间、固定到期时间和撤销时间，删除用户时级联删除其会话。修改表结构后，先运行 `pnpm db:generate --name=变更名称`，检查 `drizzle/` 中生成的 SQL，再运行 `pnpm db:migrate`。迁移文件及元数据需要随代码保存；应用启动不会自动修改表结构。

`DatabaseService` 从经过 Zod 校验的配置读取连接地址，创建共享连接池和 Drizzle 实例。启动时执行 `SELECT 1`，关闭时释放连接。`DatabaseModule` 导出该服务，`UserModule` 导入并注入使用。

`UserService` 的增查方法现在返回 Promise；登录和鉴权守卫会等待查询结果。公开资料只返回 `id`、`name`、`email`。并发重复注册由数据库唯一约束保证，冲突返回 409。

服务重启后账号和会话仍保留。Access Token 必须通过 JWT 校验，且对应用户、会话仍存在、会话未撤销或到期，才能访问受保护接口。接入会话功能之前签发的 JWT 没有 `sid`，需要重新登录。

## 全局参数校验

`AppModule` 通过 `APP_PIPE` 全局注册 Nest 内置的 `StandardSchemaValidationPipe`。接口在 `@Body()`、`@Param()` 或 `@Query()` 上声明 Zod Schema 即可，不需要重复配置 `pipes`：

```ts
@Body({ schema: registerSchema }) registerDto: RegisterDto
@Param('id', { schema: z.uuid().toLowerCase() }) id: string
```

管道按对应 Schema 校验参数，失败返回 400，通过后使用 Schema 的转换结果，例如去除姓名首尾空格、邮箱和 UUID 转为小写。没有 Schema 的参数不会自动校验；`@CurrentUser()` 默认不参与校验。环境变量仍由 `ConfigModule` 在启动时单独校验。

`ConfigModule` 和 Access 鉴权已经全局注册。`DatabaseModule` 保持显式导入，`OriginGuard` 仍绑定在 `AuthController`；自定义装饰器直接导入使用，无需注册为全局 provider。

## 认证会话：登录、刷新与注销

### 本地配置

下面三个配置已有默认值，也可以在 `.env` 中显式设置：

```dotenv
JWT_ACCESS_TOKEN_TTL_SECONDS=900
AUTH_SESSION_TTL_SECONDS=604800
CLIENT_ORIGIN=http://localhost:5173
```

API 默认是 `http://localhost:3000`。`CLIENT_ORIGIN` 填前端实际使用的协议、主机和端口，不带路径或末尾 `/`。前后端都使用 `localhost`，不要混用 `127.0.0.1`。Zod 会在启动时验证这些配置；Access 有效期最多 900 秒，会话有效期最多 604800 秒。

Refresh Cookie 名为 `nest_agent_refresh`，属性为 `HttpOnly; SameSite=Lax; Path=/auth`，不设置 `Domain`。本地 HTTP 不启用 `Secure`；`NODE_ENV=production` 时自动启用，需要通过 HTTPS 使用。Cookie 有效期跟随会话剩余时间，刷新不会重置七天期限。

CORS 仅允许 `CLIENT_ORIGIN`，并允许凭据。`OriginGuard` 对 `POST /auth/*` 按以下规则检查：

- `NODE_ENV=development`：允许完全不带 `Origin` 的请求，方便 curl、Postman 等工具调试；如果携带了 `Origin`，仍必须与 `CLIENT_ORIGIN` 完全一致。空值、字符串 `null`、其他来源均返回 `403 ORIGIN_NOT_ALLOWED`。
- `NODE_ENV=test` 或 `production`：必须携带与 `CLIENT_ORIGIN` 完全一致的 `Origin`，缺失或不匹配均返回 `403 ORIGIN_NOT_ALLOWED`。

`NODE_ENV` 未配置时默认为 `development`。本地调试可显式设置 `NODE_ENV=development`，重启服务后，调试工具可以省略 `Origin` 请求头。浏览器前端仍需将 `CLIENT_ORIGIN` 配成实际前端地址；删除该配置只会恢复默认值，不会关闭 CORS 或来源校验。生产部署需显式设置 `NODE_ENV=production`。

这项开发环境例外只放宽来源检查，参数校验、Access Token 和会话校验仍然执行。`@Public()` 只跳过 Access 鉴权，不跳过来源检查。

### 请求流程与代码职责

1. **注册**：`POST /auth/register` 校验参数，使用 Argon2id 哈希密码并保存用户；注册不会自动登录。
2. **登录**：`POST /auth/login` 验证账号密码后，由 `AuthSessionService.create()` 创建一个独立会话。Access JWT 包含 `sub`（用户 ID）和 `sid`（会话 ID）；Refresh Token 使用 `<sid>.<32 字节随机 secret>`。数据库只保存完整 Refresh Token 的 SHA-256 哈希。
3. **访问接口**：全局 `AccessTokenGuard` 读取 `Authorization: Bearer ...`，验证 JWT 的签名、算法、签发方、接收方、有效期和载荷，再查询会话及用户。通过后将用户放入请求，控制器用 `@CurrentUser()` 获取。公开接口用 `@Public()` 标记。
4. **刷新**：`POST /auth/refresh` 从 HttpOnly Cookie 获取 Refresh Token，生成下一组令牌，再执行带条件的数据库更新。更新条件包含 `sid`、当前哈希、未撤销和未到期；只有更新成功才返回 Access 和新的 Cookie。并发使用同一个 Refresh Token 时最多一个成功，其余返回 401。
5. **注销**：`POST /auth/logout` 撤销会话并返回 204，同时按相同 Cookie 属性清除 Refresh Cookie。该会话原有的 Access 和 Refresh 此后都无法通过新的请求；已经完成鉴权的进行中请求不会被主动中断。

刷新保留原来的 `expires_at`。如果会话剩余时间不足 15 分钟，新 Access 的有效期也会相应缩短。旧 Refresh Token 返回 401，不自动撤销整个会话，也不发送清除 Cookie 的响应，避免覆盖并发刷新成功后写入的新 Cookie。

注销建议同时携带当前 Access 和 Cookie：有效的同 `sid` Access 可以在 Refresh 刚发生轮换时仍完成注销；Access 已过期时，可凭当前 Refresh Cookie 注销。只有有效 Access、没有 Cookie 时也可以注销。Access 与 Cookie 属于不同会话时，使用 Cookie 自己的当前哈希验证并注销 Cookie 对应的会话。旧 Refresh 且没有有效的同 `sid` Access 时返回 401，不清 Cookie；两种凭据都没有时返回 204 并清 Cookie，不撤销其他会话。

### 接口响应与前端接入

普通 JSON 成功响应统一为 `{ data }`。请求追踪 ID 仅通过 `X-Request-Id` 响应头返回，与服务端日志中的 `requestId` 一致；成功和错误响应体均不再包含 `meta.requestId`，也不返回空的 `meta`。登录和刷新返回下面的 `data` 结构，并通过 `Set-Cookie` 写入 Refresh Token：

```json
{
  "data": {
    "access_token": "<JWT>",
    "token_type": "Bearer",
    "expires_in": 900
  }
}
```

错误响应统一为 `{ error: { code, message, details? } }`，仍使用真实 HTTP 状态码。Zod 参数校验使用 `VALIDATION_ERROR` 并在 `details` 中返回字段提示；未知错误使用 `INTERNAL_SERVER_ERROR` 和通用消息。`204` 注销和 `HEAD` 响应没有响应体；SSE、文件下载和显式 `@RawResponse()` 接口保留各自协议，这些响应同样带有 `X-Request-Id`。

前端请求封装应通过 `response.headers.get('X-Request-Id')` 读取请求 ID，在抛出客户端错误前保存它，供报错反馈和日志查询使用。CORS 已通过 `Access-Control-Expose-Headers` 暴露该响应头。原生 `EventSource` 不提供读取响应头的 API，后续若选用它并需要在页面获取连接的请求 ID，需在流式协议中另行设计。

这次响应约定移除了原来的 `meta.requestId`，已有调用方需同步改为读取响应头。以后出现分页总数、游标等业务结果附加信息时，再按接口需求定义响应体的 `meta`；当前不自动生成业务元信息。

错误码、默认消息和对应 HTTP 状态集中在 `src/common/http/api-errors.ts`。当前接口约定如下：

| 场景                 | HTTP 状态 | `error.code`               | `error.message`             |
| -------------------- | --------- | -------------------------- | --------------------------- |
| 请求 JSON 格式错误   | 400       | `BAD_REQUEST`              | `Bad Request`               |
| 参数校验失败         | 400       | `VALIDATION_ERROR`         | `Request validation failed` |
| 认证失败或会话不可用 | 401       | `UNAUTHORIZED`             | `Unauthorized`              |
| 用户越权访问         | 403       | `FORBIDDEN`                | `Forbidden`                 |
| 认证请求来源校验失败 | 403       | `ORIGIN_NOT_ALLOWED`       | `Origin not allowed`        |
| 资源或路由不存在     | 404       | `NOT_FOUND`                | `Not Found`                 |
| 通用资源冲突         | 409       | `CONFLICT`                 | `Conflict`                  |
| 邮箱已注册           | 409       | `EMAIL_ALREADY_REGISTERED` | `Email already registered`  |
| 未知服务端错误       | 500       | `INTERNAL_SERVER_ERROR`    | `Internal Server Error`     |

前端使用 HTTP 状态和 `error.code` 判断处理分支，`message` 用于说明错误，不用于字符串匹配；需要中文提示时可按 `code` 映射。`VALIDATION_ERROR` 的字段提示保留在 `details: string[]`，不保证提示文案不变。登录凭据错误、Access/Refresh Token 无效或会话不可用统一返回 `UNAUTHORIZED`。

新增业务错误时，先在 `API_ERRORS` 登记状态、错误码和固定消息，再通过 Nest 内置异常的 `errorCode` 传入，例如：

```ts
const { code, message } = API_ERRORS.EMAIL_ALREADY_REGISTERED;
throw new ConflictException(message, { errorCode: code });
```

全局过滤器只使用已登记且与 HTTP 状态匹配的业务码和消息，不透传抛出位置的自定义消息。未登记的错误码回退到 HTTP 默认错误；5xx 始终使用通用错误码和消息，不返回内部异常或 cause。其他 HTTP 错误（例如 413）仍保留实际状态并使用标准 HTTP 错误码和消息。本次 Origin 错误码由 `FORBIDDEN` 细分为 `ORIGIN_NOT_ALLOWED`，HTTP 状态和消息保持不变。

响应体不包含 Refresh Token；登录、刷新、成功注销和错误响应设置 `Cache-Control: no-store`。Access 存放在前端内存中，受保护请求添加 Bearer 请求头；前端调用登录、刷新和注销时设置 `credentials: 'include'`，由浏览器管理 HttpOnly Cookie。网页刷新后可以调用 `/auth/refresh` 恢复内存中的 Access，JavaScript 无需读取 Cookie。Access 的前端存放位置仍需前端按这一约定实现。

同一浏览器会话的刷新需要串行协调，多个标签页也应避免同时刷新。收到 401 后不要反复重试同一个旧 Refresh Token。当前方案不提供宽限窗口；如果服务器已经完成轮换但响应丢失，旧 Token 无法再次刷新，需要重新登录。当前只注销指定会话，未添加所有设备注销或历史 Token 重放检测。

例如，在本地前端执行刷新：

```ts
const response = await fetch('http://localhost:3000/auth/refresh', {
  method: 'POST',
  credentials: 'include',
});
const requestId = response.headers.get('X-Request-Id');
if (!response.ok) {
  const { error } = await response.json();
  throw Object.assign(new Error(error.message), {
    code: error.code,
    requestId,
  });
}
const { access_token } = (await response.json()).data;
// 在应用内存中保存 access_token；浏览器会自动处理新的 Refresh Cookie。
```

下面可以用 curl 验证登录、刷新和注销。先通过 `POST /auth/register` 创建账号；示例凭据仅用于本地测试。Cookie 文件相当于登录凭据，测试后应删除。

```bash
curl -i http://localhost:3000/auth/login \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -c /tmp/nest-agent-cookies.txt \
  -d '{"email":"alice@example.com","password":"local-test-password"}'

curl -i -X POST http://localhost:3000/auth/refresh \
  -H 'Origin: http://localhost:5173' \
  -b /tmp/nest-agent-cookies.txt -c /tmp/nest-agent-cookies.txt

curl -i -X POST http://localhost:3000/auth/logout \
  -H 'Origin: http://localhost:5173' \
  -b /tmp/nest-agent-cookies.txt -c /tmp/nest-agent-cookies.txt
```

## 数据库端到端测试

单元测试使用 `pnpm test`，不需要 PostgreSQL。E2E 使用真实 PostgreSQL 和独立测试库。

首次准备测试库（本机本项目已创建）：

```bash
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" nest_agent_test'
```

在 `.env` 中设置 `TEST_DATABASE_URL` 指向该测试库，然后执行：

```bash
pnpm test:e2e
```

测试要求数据库名以 `_test` 结尾，并与 `DATABASE_URL` 的数据库名不同。测试开始时自动应用迁移，用例之间清理测试库的用户数据及级联会话，测试文件串行运行。测试库必须专用于测试。会话 E2E 覆盖哈希存储、Cookie 属性、固定有效期、并发轮换、注销竞争、撤销/到期失效、Origin/CORS 和重启后的持久化。

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

当前暂不启用 `@nestjs/observe`。HTTP 请求已经带有 `X-Request-Id`，并记录脱敏的完成日志和服务端错误日志，足够支持本地 Agent 功能开发。后续加入模型调用、队列或流式任务后，再根据实际链路选择指标、追踪和告警方案。

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
