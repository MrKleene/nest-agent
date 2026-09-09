# PostgreSQL 与 Drizzle

[返回项目首页](../README.md)

以下命令均在项目根目录执行。环境变量的完整说明见 [配置文档](configuration.md)。

## 连接与迁移

项目使用 `pg` 连接池和 Drizzle ORM，用户数据保存在 PostgreSQL 中。

1. 在 `.env` 中设置 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、`DATABASE_URL` 和至少 32 个字符的随机 `JWT_SECRET`，格式参考 [`.env.example`](../.env.example)。本机运行 Nest 时，数据库地址使用 `localhost:5432`。
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

[`src/database/schema.ts`](../src/database/schema.ts) 定义 `users` 和 `auth_sessions` 表。用户表包含 UUID 主键、姓名、唯一邮箱和必填密码哈希；会话表保存用户关联、Refresh Token 哈希、创建时间、固定到期时间和撤销时间，删除用户时级联删除其会话。修改表结构后，先运行 `pnpm db:generate --name=变更名称`，检查 `drizzle/` 中生成的 SQL，再运行 `pnpm db:migrate`。迁移文件及元数据需要随代码保存；应用启动不会自动修改表结构。

`DatabaseService` 从经过 Zod 校验的配置读取连接地址，创建共享连接池和 Drizzle 实例。启动时执行 `SELECT 1`，关闭时释放连接。`DatabaseModule` 导出该服务，`UserModule` 导入并注入使用。

`UserService` 的增查方法现在返回 Promise；登录和鉴权守卫会等待查询结果。公开资料只返回 `id`、`name`、`email`。并发重复注册由数据库唯一约束保证，冲突返回 409。

服务重启后账号和会话仍保留。Access Token 必须通过 JWT 校验，且对应用户、会话仍存在、会话未撤销或到期，才能访问受保护接口。接入会话功能之前签发的 JWT 没有 `sid`，需要重新登录。

## 数据库端到端测试

单元测试使用 `pnpm test`，不需要 PostgreSQL。E2E 使用真实 PostgreSQL 和独立测试库。

首次准备测试库（已存在时无需重复创建）：

```bash
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" nest_agent_test'
```

在 `.env` 中设置 `TEST_DATABASE_URL` 指向该测试库，然后执行：

```bash
pnpm test:e2e
```

测试要求数据库名以 `_test` 结尾，并与 `DATABASE_URL` 的数据库名不同。测试开始时自动应用迁移，用例之间清理测试库的用户数据及级联会话，测试文件串行运行。测试库必须专用于测试。会话 E2E 覆盖哈希存储、Cookie 属性、固定有效期、并发轮换、注销竞争、撤销/到期失效、Origin/CORS 和重启后的持久化。

前缀回归测试还覆盖默认、自定义和空前缀，使用自动 Cookie 管理验证登录、刷新、注销，以及注销后令牌失效。
