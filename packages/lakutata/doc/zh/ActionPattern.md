# Lakutata 服务传输

本指南介绍服务传输方式。控制器、动作及其输入和结果见 [Controllers](Controllers.md)；入口及其适配器列表见 [Entrypoint](Entrypoint.md)；中间件和访问控制见 [Middlewares](Middlewares.md)；HTTP 适配器见 [HTTP](HTTP.md)。

## 1. 服务动作：`@ServiceAction`

```text
@ServiceAction(pattern, DTOClass?, options?)
```

- 模式是一个对象（最多嵌套 2 层），消息必须包含这些键且值相同；字符串值可以是通配符（`'user.*'`）。匹配的模式中最具体的一个胜出。输入是去掉模式中各键后的消息。
- 调用方收到 `{success: true, error: null, payload}`，或 `{success: false, error, payload: null}`，其中 `error` 包含错误的各属性（`errno`、`errMsg`、`statusCode`、`message` 等）；JSON-RPC 则以它自己的 `result` 和 `error` 响应。没有模式匹配的消息会以 `ControllerActionNotFoundException` 失败。

## 2. 传输方式

各传输方式的适配器及其需要安装的包，见 [Entrypoint](Entrypoint.md) 第 2 节。

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
