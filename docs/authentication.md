# 认证与会话

[返回项目首页](../README.md)

本文中的接口地址使用默认 `API_PREFIX=api`。前缀、有效期和来源校验配置见 [配置与本地调试](configuration.md)。

## Refresh Cookie

Refresh Cookie 名为 `nest_agent_refresh`，属性为 `HttpOnly; SameSite=Lax; Path=/api/auth`，不设置 `Domain`。本地 HTTP 不启用 `Secure`；`NODE_ENV=production` 时自动启用，需要通过 HTTPS 使用。Cookie Path 由 `API_PREFIX` 和认证模块路由共同推导，写入与清除使用相同配置。修改前缀后需要重新登录；已有的旧路径 Cookie 不会自动迁移，本地可清除旧 Cookie。Cookie 有效期跟随会话剩余时间，刷新不会重置七天期限。

## 请求流程与代码职责

1. **注册**：`POST /api/auth/register` 校验参数，使用 Argon2id 哈希密码并保存用户；注册不会自动登录。
2. **登录**：`POST /api/auth/login` 验证账号密码后，由 `AuthSessionService.create()` 创建一个独立会话。Access JWT 包含 `sub`（用户 ID）和 `sid`（会话 ID）；Refresh Token 使用 `<sid>.<32 字节随机 secret>`。数据库只保存完整 Refresh Token 的 SHA-256 哈希。
3. **访问接口**：全局 `AccessTokenGuard` 读取 `Authorization: Bearer ...`，验证 JWT 的签名、算法、签发方、接收方、有效期和载荷，再查询会话及用户。通过后将用户放入请求，控制器用 `@CurrentUser()` 获取。公开接口用 `@Public()` 标记。
4. **刷新**：`POST /api/auth/refresh` 从 HttpOnly Cookie 获取 Refresh Token，生成下一组令牌，再执行带条件的数据库更新。更新条件包含 `sid`、当前哈希、未撤销和未到期；只有更新成功才返回 Access 和新的 Cookie。并发使用同一个 Refresh Token 时最多一个成功，其余返回 401。
5. **注销**：`POST /api/auth/logout` 撤销会话并返回 204，同时按相同 Cookie 属性清除 Refresh Cookie。该会话原有的 Access 和 Refresh 此后都无法通过新的请求；已经完成鉴权的进行中请求不会被主动中断。

刷新保留原来的 `expires_at`。如果会话剩余时间不足 15 分钟，新 Access 的有效期也会相应缩短。旧 Refresh Token 返回 401，不自动撤销整个会话，也不发送清除 Cookie 的响应，避免覆盖并发刷新成功后写入的新 Cookie。

注销建议同时携带当前 Access 和 Cookie：有效的同 `sid` Access 可以在 Refresh 刚发生轮换时仍完成注销；Access 已过期时，可凭当前 Refresh Cookie 注销。只有有效 Access、没有 Cookie 时也可以注销。Access 与 Cookie 属于不同会话时，使用 Cookie 自己的当前哈希验证并注销 Cookie 对应的会话。旧 Refresh 且没有有效的同 `sid` Access 时返回 401，不清 Cookie；两种凭据都没有时返回 204 并清 Cookie，不撤销其他会话。

## 前端接入与调试

登录、刷新返回以下结构，并通过 `Set-Cookie` 写入 Refresh Token。通用响应、错误码及请求 ID 约定见 [接口规范](api-conventions.md)。

```json
{
  "data": {
    "access_token": "<JWT>",
    "token_type": "Bearer",
    "expires_in": 900
  }
}
```

响应体不包含 Refresh Token；登录、刷新、成功注销和错误响应设置 `Cache-Control: no-store`。Access 存放在前端内存中，受保护请求添加 Bearer 请求头；前端调用登录、刷新和注销时设置 `credentials: 'include'`，由浏览器管理 HttpOnly Cookie。网页刷新后可以调用 `/api/auth/refresh` 恢复内存中的 Access，JavaScript 无需读取 Cookie。Access 的前端存放位置仍需前端按这一约定实现。

同一浏览器会话的刷新需要串行协调，多个标签页也应避免同时刷新。收到 401 后不要反复重试同一个旧 Refresh Token。当前方案不提供宽限窗口；如果服务器已经完成轮换但响应丢失，旧 Token 无法再次刷新，需要重新登录。当前只注销指定会话，未添加所有设备注销或历史 Token 重放检测。

例如，在本地前端执行刷新：

```ts
const response = await fetch('http://localhost:3000/api/auth/refresh', {
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

下面可以用 curl 验证登录、刷新和注销。先通过 `POST /api/auth/register` 创建账号；示例凭据仅用于本地测试。Cookie 文件相当于登录凭据，测试后应删除。

```bash
curl -i http://localhost:3000/api/auth/login \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -c /tmp/nest-agent-cookies.txt \
  -d '{"email":"alice@example.com","password":"local-test-password"}'

curl -i -X POST http://localhost:3000/api/auth/refresh \
  -H 'Origin: http://localhost:5173' \
  -b /tmp/nest-agent-cookies.txt -c /tmp/nest-agent-cookies.txt

curl -i -X POST http://localhost:3000/api/auth/logout \
  -H 'Origin: http://localhost:5173' \
  -b /tmp/nest-agent-cookies.txt -c /tmp/nest-agent-cookies.txt
```
