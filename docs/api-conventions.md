# 接口规范

[返回项目首页](../README.md)

## 全局参数校验

`AppModule` 通过 `APP_PIPE` 全局注册 Nest 内置的 `StandardSchemaValidationPipe`。接口在 `@Body()`、`@Param()` 或 `@Query()` 上声明 Zod Schema 即可，不需要重复配置 `pipes`：

```ts
@Body({ schema: registerSchema }) registerDto: RegisterDto
@Param('id', { schema: z.uuid().toLowerCase() }) id: string
```

管道按对应 Schema 校验参数，失败返回 400，通过后使用 Schema 的转换结果，例如去除姓名首尾空格、邮箱和 UUID 转为小写。没有 Schema 的参数不会自动校验；`@CurrentUser()` 默认不参与校验。环境变量仍由 `ConfigModule` 在启动时单独校验。

`ConfigModule` 和 Access 鉴权已经全局注册。`DatabaseModule` 保持显式导入，`OriginGuard` 仍绑定在 `AuthController`；自定义装饰器直接导入使用，无需注册为全局 provider。

## 响应格式、请求 ID 与错误码

普通 JSON 成功响应统一为 `{ data }`。请求追踪 ID 仅通过 `X-Request-Id` 响应头返回，与服务端日志中的 `requestId` 一致；成功和错误响应体均不再包含 `meta.requestId`，也不返回空的 `meta`。以下以登录和刷新响应为例，认证流程见 [认证说明](authentication.md)：

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

错误码、默认消息和对应 HTTP 状态集中在 [`src/common/http/api-errors.ts`](../src/common/http/api-errors.ts)。当前接口约定如下：

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

## 日志与可观测性

当前暂不启用 `@nestjs/observe`。HTTP 请求已经带有 `X-Request-Id`，并记录脱敏的完成日志和服务端错误日志，足够支持本地 Agent 功能开发。后续加入模型调用、队列或流式任务后，再根据实际链路选择指标、追踪和告警方案。
