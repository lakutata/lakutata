# Lakutata HTTP 与服务传输

本指南介绍 HTTP 适配器和服务传输方式。控制器、动作及其输入和结果见 [Controllers](Controllers.md)；入口及其适配器列表见 [Entrypoint](Entrypoint.md)；中间件和访问控制见 [Middlewares](Middlewares.md)。

## 1. HTTP 动作：`@HTTPAction`、`@GET`、`@POST`、`@PUT`、`@PATCH`、`@DELETE`、`@HEAD`、`@OPTIONS`

```text
@HTTPAction(route, method | methods, DTOClass?, options?)
@GET(route, DTOClass?, options?)
```

- 路由使用 HTTP 适配器的语法（`/users/:id`）；`@HTTPAction` 可以接受一个或多个方法（`['get', 'post']`）。
- 输入由查询参数和解析后的请求体（JSON；URL 编码的表单只有 Express 支持）合并而成，路由参数覆盖在其上。查询参数和路由参数都是字符串，而校验规则是严格的：用 `.strict(false)` 进行转换。
- 返回值以 JSON 响应（`undefined` 时为 204）。`lakutata/com/entrypoint` 中的 `Result.status(201, data, headers)`、`Result.file(path)` 和 `Result.events(producer)`（Server-Sent Events）用于控制响应。

## 2. 服务动作：`@ServiceAction`

```text
@ServiceAction(pattern, DTOClass?, options?)
```

- 模式是一个对象（最多嵌套 2 层），消息必须包含这些键且值相同；字符串值可以是通配符（`'user.*'`）。匹配的模式中最具体的一个胜出。输入是去掉模式中各键后的消息。
- 调用方收到 `{success: true, error: null, payload}`，或 `{success: false, error, payload: null}`，其中 `error` 包含错误的各属性（`errno`、`errMsg`、`statusCode`、`message` 等）；JSON-RPC 则以它自己的 `result` 和 `error` 响应。没有模式匹配的消息会以 `ControllerActionNotFoundException` 失败。

## 3. 传输方式

各传输方式的适配器及其需要安装的包，见 [Entrypoint](Entrypoint.md) 第 2 节。

### 从 2.x 的入口函数迁移到 HTTP 适配器

2.x 的 HTTP 入口函数（`buildHTTPEntrypoint`）仍然可以使用：它在入口的启动阶段被调用（此时它获取的对象，比如注入了入口的 Authenticator，都可以正常获取），并且会被等待，所以应用在它的服务开始监听之后才算启动完成。迁移到 `expressHTTPEntrypoint` 时：

- 应用自己的中间件和路由（CORS、压缩、健康检查、Authenticator、Web UI）放进 `before` 钩子，钩子里用 `module.getObject()` 获取对象；请求体解析用 `body` 选项（`{limit: '100mb'}`）；服务器的 `keepAliveTimeout`/`headersTimeout` 用 `server` 选项；
- 从请求构造动作输入（查询参数、请求体、会话中的值）用 `input` 选项；
- `{errno, errMsg, data}` 封套用 `jsonEnvelope()`。2.x 的应用通常对动作的错误返回 200，而对 Express 中间件的错误（`next(error)`，比如 Authenticator 的 401）使用错误自带的状态码：`jsonEnvelope({actionErrorStatus: 200})` 的行为与此相同。如果用 `errorStatus: 200`，401 也会变成 200，按 401 跳转登录页的前端就会失效；
- 应用封套里的其他字段（`timestamp`、`nonce`、请求 ID）用 `extra` 选项给出。它在每次响应时调用，成功和错误的响应都会带上这些字段：`jsonEnvelope({actionErrorStatus: 200, extra: () => ({timestamp: Date.now()})})`。这些字段排在 `errno`、`errMsg`、`data` 之后，不会覆盖这三个字段，因此不需要为了保留它们自己实现响应器。

```typescript
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import type {Express, NextFunction, Request, Response} from 'express'

class Unauthorized extends Error {
    public readonly errno: string = 'E_UNAUTHORIZED'

    public readonly statusCode: number = 401
}

export const entrypoint = buildEntrypoints({
    controllers: [],
    http: expressHTTPEntrypoint({
        port: 3000,
        body: {limit: '100mb'},
        before: async (app: Express): Promise<void> => {
            app.get('/health', (_request: Request, response: Response): unknown => response.json({status: 'ok'}))
            //请求的鉴权：它的错误保留自带的状态码（401）
            app.use((request: Request, _response: Response, next: NextFunction): void => request.headers.authorization ? next() : next(new Unauthorized('Not logged in')))
        },
        //动作的错误在封套中以 200 返回，与 2.x 相同，并带上时间戳
        respond: jsonEnvelope({actionErrorStatus: 200, extra: (): Record<string, unknown> => ({timestamp: Date.now()})})
    })
})
```

`fastifyHTTPEntrypoint` 的选项相同（使用 `fastifyJSONEnvelope({actionErrorStatus: 200, extra})`，Authenticator 写成 Fastify 的钩子）。自定义的响应器可以从 `error` 的第四个参数得到每个错误的来源（`'action'` 或 `'request'`）。

### 服务动作的客户端与推送事件

带客户端的服务适配器会把请求所属客户端的 id 放入上下文的 `ServiceContext.clientId`：`electronIPCServiceEntrypoint`（窗口中的每个页面）、`socketIOServiceEntrypoint`（每个 socket，连接时通过 `auth.id` 或 `id` 请求头给出 id）、`httpServiceEntrypoint`（`POST` 请求的 `id` 请求头，事件流 `GET /events` 的 `id` 请求头或查询参数）、WebSocket 和 stdio 上的 `jsonRPCServiceEntrypoint`，以及 `grpcServiceEntrypoint`（`id` 元数据）。入口组件用 `notify(clientId, event, ...args)` 向某个客户端推送事件（返回是否有客户端收到），用 `broadcast(event, ...args)` 向所有客户端推送（返回客户端数量）：

```typescript
import {Controller, Entrypoint, ServiceContext} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'

class TaskController extends Controller {
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    @ServiceAction({cmd: 'start'})
    public async start(): Promise<void> {
        const clientId: string | undefined = (this.context as ServiceContext).clientId
        if (clientId) setTimeout((): void => void this.entrypoint.notify(clientId, 'done', {task: 1}), 1000)
        this.entrypoint.broadcast('started', {task: 1})
    }
}
```

Electron 的渲染进程用 `window.ipc.on(event, listener)` 监听事件（Electron 模板中提供），socket 用 `socket.on(event, listener)`，HTTP 客户端通过 `GET /events` 的 Server-Sent Events 监听（`EventSource`、curl）。窗口中的页面在重新加载或窗口关闭之前都是同一个客户端。

### JSON-RPC 2.0

`jsonRPCServiceEntrypoint` 通过 JSON-RPC 2.0 提供服务动作：请求的 method 和（按名称给出的）params 就是动作的模式和输入，`{"method": "order.get", "params": {"id": 1}}` 会被分发为 `{method: 'order.get', id: 1}`（`methodField` 指定字段名，`toPattern(method, params)` 把它们映射为其他模式，`positionalParams` 接受按位置给出的 params）。批量请求和通知遵循规范；错误码为 `-32601`（没有匹配的动作）、`-32602`（DTO 拒绝了输入）和 `-32000`（动作抛出的错误，完整的错误对象放在 `data` 中）。传输方式有 HTTP（`POST`）、WebSocket（`ws` 包）和 stdio（按行或按 `Content-Length` 头分帧）；后两者以通知的形式推送客户端事件。在 WebSocket 上，不响应 ping 的连接会被关闭（`heartbeat`，30 秒）；在 stdio 上，输入结束后应用退出（`end: 'application'`）。

```text
service: [
    jsonRPCServiceEntrypoint({port: 4000, path: '/rpc'}),
    jsonRPCServiceEntrypoint({transport: 'websocket', port: 4001}),
    jsonRPCServiceEntrypoint({transport: 'stdio', framing: 'content-length'})
]
```

### gRPC 与 NATS

`grpcServiceEntrypoint`（`@lakutata/grpc/service`）和 `natsServiceEntrypoint`（`@lakutata/nats`）分别通过 gRPC 和 NATS 提供服务动作，它们的代理用来从其他应用调用这些动作。见 [GRPC](GRPC.md) 和 [NATS](NATS.md)。
