# Lakutata 服务调用

服务动作（`@ServiceAction`）通过消息而不是 URL 调用。消息是一个对象，其中用于选择动作的键称为**模式**，其余的键即为输入。同一组动作可以同时通过多种传输方式提供。本指南介绍普通 HTTP、Socket.IO、JSON-RPC 2.0（基于 HTTP、WebSocket 或标准输入输出）、Electron 的 IPC、NW.js 的窗口和 React Native 手机应用的界面；gRPC、NATS 和 WebRTC 的数据通道则在各自的指南中介绍。控制器及其动作见[控制器与动作](Controllers.md)，入口及其适配器见[入口](Entrypoint.md)。

## 1. 第一个服务

```typescript
import {Application, DTO, Exception} from 'lakutata'
import {buildEntrypoints, Controller, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'

class NewOrderDTO extends DTO {
    @Expect(DTO.String().required())
    public product: string
}

class OrderIdDTO extends DTO {
    @Expect(DTO.Number().integer().required())
    public id: number
}

class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'

    public statusCode: number = 404
}

type Order = { id: number, product: string }

const orders: Map<number, Order> = new Map()

class OrderController extends Controller {
    //消息 {resource: 'order', act: 'create', product: 'lamp'}：输入是 {product: 'lamp'}
    @ServiceAction({resource: 'order', act: 'create'}, NewOrderDTO)
    public async create(input: NewOrderDTO): Promise<Order> {
        const order: Order = {id: orders.size + 1, product: input.product}
        orders.set(order.id, order)
        return order
    }

    @ServiceAction({resource: 'order', act: 'get'}, OrderIdDTO)
    public async get(input: OrderIdDTO): Promise<Order> {
        const order: Order | undefined = orders.get(input.id)
        if (!order) throw new OrderNotFoundException('Order {id} not found', {id: input.id})
        return order
    }
}

Application.run(() => ({
    id: 'orders.app',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            //POST http://localhost:3000/，请求体为 JSON 格式的消息
            service: httpServiceEntrypoint({port: 3000})
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ curl localhost:3000 -H 'Content-Type: application/json' -d '{"resource": "order", "act": "create", "product": "lamp"}'
{"success":true,"error":null,"payload":{"id":1,"product":"lamp"}}
$ curl localhost:3000 -H 'Content-Type: application/json' -d '{"resource": "order", "act": "get", "id": 1}'
{"success":true,"error":null,"payload":{"id":1,"product":"lamp"}}
$ curl localhost:3000 -H 'Content-Type: application/json' -d '{"resource": "order", "act": "get", "id": 9}'
{"success":false,"error":{…,"message":"Order 9 not found","errMsg":"Order 9 not found","err":"OrderNotFoundException","errno":"E_ORDER_NOT_FOUND"},"payload":null}
```

错误带有异常的所有属性（第 3 节）。

## 2. 模式

如果消息包含模式的所有键且值相同，消息便与该模式匹配。随后从消息中去除模式的键，剩余部分即为动作的输入。以下列动作为例：

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'

class OrderController extends Controller {
    @ServiceAction({resource: 'order', act: 'get'})
    public async get(input: Record<string, unknown>): Promise<unknown> {
        return input
    }

    //资源 "order" 的其他消息
    @ServiceAction({resource: 'order'})
    public async other(input: Record<string, unknown>): Promise<unknown> {
        return input
    }

    @ServiceAction({resource: 'order', act: 'audit.*'})
    public async audit(input: Record<string, unknown>): Promise<unknown> {
        return input
    }

    @ServiceAction({res: {name: 'user'}, act: 'get'})
    public async user(input: Record<string, unknown>): Promise<unknown> {
        return input
    }

    @ServiceAction({version: 2, act: 'info'})
    public async info(): Promise<string> {
        return 'v2'
    }
}
```

| 消息 | 动作 | 输入 |
|---|---|---|
| `{resource: 'order', act: 'get', id: 1}` | `get` | `{id: 1}` |
| `{resource: 'order', act: 'list', page: 1}` | `other` | `{act: 'list', page: 1}` |
| `{resource: 'order', act: 'audit.read', who: 'ada'}` | `audit` | `{who: 'ada'}` |
| `{res: {name: 'user', extra: 1}, act: 'get', q: 1}` | `user` | `{res: {extra: 1}, q: 1}` |
| `{version: '2', act: 'info'}` | `info` | `{}` |
| `{resource: 'invoice'}` | 无匹配的动作：`ControllerActionNotFoundException` | |

- 有多个模式匹配时，最具体的模式胜出，即键最多的模式。
- 模式中的字符串值可以是通配符：`*` 匹配任意多个字符，`?` 匹配一个字符。
- 值按文本比较，例如模式 `{version: 2}` 与 `version: '2'` 匹配。
- 模式可以嵌套对象，最多两层；嵌套对象的键逐个比较。
- `@Prefix({pattern})` 将一个模式合并到控制器所有动作的模式中（见[控制器与动作](Controllers.md)第 6 节）。
- 不与任何模式匹配的消息以 `ControllerActionNotFoundException`（`E_CONTROLLER_ACTION_NOT_FOUND`）失败。
- 消息是 JSON，值保留各自的类型。与 HTTP 请求的查询参数不同，期望数字的校验规则不会将 `"2"` 转换为数字。

## 3. 响应

HTTP 服务、Socket.IO、Electron、NW.js 和 React Native 以封套响应；JSON-RPC 则使用其自身的响应格式（第 4 节）。

```text
{"success": true, "error": null, "payload": <结果>}
{"success": false, "error": <错误>, "payload": null}
```

- 动作没有返回值时，封套不含 `payload`，即 `{"success": true, "error": null}`。
- `error` 是错误全部自身属性的副本：`message`、`stack`、`errno`、`errMsg`、`statusCode`、`err`（错误的类名）、`appId`、`appName`，以及异常类自定义的属性。客户端收到的是动作抛出的完整错误。
- `Result.status(status, data)` 发送其数据。文件和事件流（`Result.file()`、`Result.events()`）无法发送，调用将会失败。

调用服务的应用通过代理读取封套：HTTP 服务使用 `HTTPServiceProxy`（第 4 节），NATS 和 gRPC 传输方式也各有代理。代理返回 `payload`，或者抛出带有远端错误属性的 `ServiceInvokeException`。其他客户端（例如浏览器中的页面）自行读取封套，示例如下：

```typescript
type Envelope<T> = { success: boolean, error: { message?: string, errno?: string } | null, payload: T }

export async function call<T>(message: Record<string, unknown>): Promise<T> {
    const response: Response = await fetch('http://localhost:3000/', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(message)
    })
    const envelope: Envelope<T> = await response.json() as Envelope<T>
    //把错误的属性（errno、statusCode……）复制到一个 Error 上
    if (!envelope.success) throw Object.assign(new Error(envelope.error?.message ?? 'The call failed'), envelope.error)
    return envelope.payload
}
```

## 4. 传输方式

| 适配器 | 导入自 | 需要安装 | 请求的形式 | 推送的事件 |
|---|---|---|---|---|
| `httpServiceEntrypoint()` | `lakutata/com/entrypoint` | | 以 JSON 格式 `POST` 消息 | Server-Sent Events |
| `socketIOServiceEntrypoint()` | `lakutata/adapter/socket.io` | `socket.io`（客户端需要 `socket.io-client`） | 带确认回调的 emit | Socket.IO 事件 |
| `jsonRPCServiceEntrypoint()` | `lakutata/adapter/jsonrpc` | WebSocket 需要 `ws` | JSON-RPC 2.0 请求 | 通知（WebSocket、stdio） |
| `electronIPCServiceEntrypoint()` | `lakutata/adapter/electron` | （Electron） | `ipcRenderer.invoke()` | IPC 消息 |
| `nwjsServiceEntrypoint()` | `lakutata/adapter/nwjs` | （NW.js） | 窗口的宿主页面对桥接对象的一次调用 | 调用宿主页面交给桥接对象的函数 |
| `reactNativeServiceEntrypoint()` | `lakutata/adapter/react-native` | | 宿主发来的一行 JSON | 逐行写出的 JSON |
| `grpcServiceEntrypoint()` | `@lakutata/grpc/service` | `@lakutata/grpc` | 见 [gRPC](GRPC.md) | gRPC 流 |
| `natsServiceEntrypoint()` | `@lakutata/nats` | `@lakutata/nats` | 见 [NATS](NATS.md) | NATS 消息 |
| `webrtcServiceEntrypoint()` | `@lakutata/webrtc` | `@lakutata/webrtc` | 数据通道上的 JSON-RPC 2.0 请求，见 [WebRTC](WebRTC.md) | 通知 |

每个适配器还接受 `name` 和 `middlewares` 两个选项，前者用于区分多个适配器，后者在入口的中间件之后执行（见[中间件与访问控制](Middlewares.md)）。

### HTTP 服务

`httpServiceEntrypoint()` 通过普通 HTTP 提供动作，适用于工具（curl、Postman）、脚本，以及开发阶段的 Web 界面。Electron 模板在开发时即为此添加了该适配器。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `port` | `3000` | 端口；`0` 表示任选一个空闲端口 |
| `host` | 所有网络接口 | 监听的地址 |
| `path` | `'/'` | 请求的路径；事件位于其下的 `<path>/events` |
| `limit` | `10485760`（10 MiB） | 请求体的最大字节数 |
| `listening` | | `(server, listeners) => …`，服务器开始监听后调用（`listeners` 仅在按网口监听时提供，见下文） |

- 请求是发往 `path` 的 `POST`，请求体为 JSON 格式的消息。无论动作的结果如何，均以 200 和封套响应。请求体不是 JSON 时以 400 响应，超过 `limit` 时以 413 响应，其他方法或路径以 404 响应；这些响应同样带有封套。
- CORS 响应头允许任何来源，允许的方法为 `GET`、`POST` 和 `OPTIONS`，并允许任何请求头，例如 `Authorization`。
- 客户端在 `id` 请求头或 `id` 查询参数中给出自身的 ID（第 5 节）。
- `GET <path>/events` 以 Server-Sent Events 的形式推送发给该客户端的事件。第一个事件 `client` 给出客户端的 ID（请求未给出时为随机 ID）；之后的每个事件带有事件名，数据为事件参数组成的 JSON 数组。每 15 秒发送一条注释，以保持连接。

```text
event: client
data: ["client-1"]

event: progress
data: [50,"half"]
```

在浏览器中使用 `EventSource` 读取：

```typescript
const events: EventSource = new EventSource('http://localhost:3000/events?id=client-1')
events.addEventListener('progress', (event: MessageEvent): void => console.log(JSON.parse(event.data)))
```

其他应用通过 `HTTPServiceProxy` 调用该服务，该代理是一个由 `buildHTTPServiceProxy()` 注册的组件。以下示例调用第 1 节的订单服务：

```typescript
import {Application} from 'lakutata'
import {buildHTTPServiceProxy, type HTTPServiceProxy, ServiceInvokeException} from 'lakutata/com/entrypoint'

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            orders: buildHTTPServiceProxy({url: 'http://localhost:3000/'})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: HTTPServiceProxy = await app.getObject<HTTPServiceProxy>('orders')
        //{id: 1, product: 'lamp'}
        console.log(await orders.invoke({resource: 'order', act: 'create', product: 'lamp'}))
        try {
            //最多等待 5 秒
            await orders.invoke({resource: 'order', act: 'get', id: 9}, 5000)
        } catch (error) {
            //动作的错误，带有它的各个属性：E_ORDER_NOT_FOUND
            if (error instanceof ServiceInvokeException) console.log(error.errno)
        }
    })
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `url` | | 服务的地址，包括服务端适配器的 `path` |
| `headers` | | 每次调用和事件流都会携带的请求头，例如 `Authorization` |
| `clientId` | 随机的 UUID | 该客户端的 ID（第 5 节） |
| `reconnectDelay` | `1000` | 事件流断开后重新打开的间隔，单位为毫秒 |

- `invoke(message, timeout)` 发送消息并返回 `payload`。超时默认为 10 分钟；超时后放弃本次调用，服务端会中止动作的 signal。
- 动作失败时抛出 `ServiceInvokeException`，该异常带有动作错误的各个属性（第 3 节）。服务未给出响应时抛出 `ServiceUnavailableException`（`E_SERVICE_UNAVAILABLE`，状态码 503）：无法连接到服务、服务在超时之前没有响应，或者服务的响应不是封套（例如位于服务之前的代理返回的错误页面）。
- `on(event, listener)`、`once()` 和 `off()` 监听服务推送给该客户端的事件。添加第一个监听器时会打开事件流。事件流断开后，经过 `reconnectDelay` 重新打开；断开期间推送的事件将会丢失。

### Socket.IO

`socketIOServiceEntrypoint()` 通过 Socket.IO 提供动作，适用于浏览器以及保持连接的客户端。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `port` | `3000` | 适配器自身服务器的端口；`0` 表示任选一个空闲端口 |
| `host` | 所有网络接口 | 适配器自身服务器的地址 |
| `event` | `'message'` | 请求使用的事件 |
| `namespace` | `'/'` | 请求使用的命名空间 |
| `options` | | Socket.IO 服务器的选项：`cors`、`path`、`maxHttpBufferSize`…… |
| `server` | | 共用的 HTTP 服务器，或返回该服务器的函数（见下文） |
| `io` | | 一个已有的 Socket.IO 服务器，按原样使用 |
| `listening` | | `(io, server, listeners) => …`，适配器就绪后调用 |

```typescript
import {io, type Socket} from 'socket.io-client'

//客户端 id 为 client-1（第 5 节）
const socket: Socket = io('http://localhost:3000', {auth: {id: 'client-1'}})
socket.on('progress', (percent: number): void => console.log(`${percent}%`))
//{success: true, error: null, payload: {id: 1, product: 'lamp'}}，5 秒内没有应答时抛出错误
console.log(await socket.timeout(5000).emitWithAck('message', {resource: 'order', act: 'get', id: 1}))
```

- 请求的形式是以消息为数据 emit `event` 事件，并附带一个接收封套的回调。不带回调的 emit 同样会执行动作。
- 来自其他来源的浏览器需要 `options: {cors: {origin: …}}`。
- `lakutata/adapter/socket.io` 中的 `socketOfContext(this.context)` 返回发出请求的 socket，例如用于将其加入一个房间。

Socket.IO 可以与 HTTP 适配器共用端口，方法是将 `expressHTTPEntrypoint` 的 `before` 钩子收到的服务器交给 Socket.IO 适配器。适配器按选项的顺序启动，因此 `http` 必须写在 `service` 之前：

```typescript
import type {Server} from 'node:http'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'

let httpServer: Server | undefined

export const entrypoint = buildEntrypoints({
    controllers: [],
    http: expressHTTPEntrypoint({port: 8080, before: (_app, context): void => void (httpServer = context.server)}),
    //HTTP 动作和 Socket.IO 都在 8080 端口上
    service: socketIOServiceEntrypoint({server: (): Server => httpServer!})
})
```

停止时，适配器断开所有 socket，共用的服务器则交由其所有者处理。

### JSON-RPC 2.0

`jsonRPCServiceEntrypoint()` 通过 JSON-RPC 2.0 提供动作，适用于以其他语言编写的客户端、支持该协议的工具，以及通过标准输入输出调用应用的父进程。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `transport` | `'http'` | `'http'`（每条消息一个 `POST`）、`'websocket'`（需要 `ws`）或 `'stdio'` |
| `port`、`host`、`path` | `3000`、所有网络接口、`'/'` | HTTP 或 WebSocket 的服务器 |
| `limit` | `10485760`（10 MiB） | 消息的最大字节数 |
| `methodField` | `'method'` | 模式中接收方法名的键 |
| `positionalParams` | | 输入中接收数组形式参数的键；未设置时，拒绝数组形式的参数 |
| `toPattern` | | `(method, params) => message`：自行构造消息，取代上述两个选项 |
| `framing` | `'newline'` | stdio 上的分帧方式：每行一条消息，或 `'content-length'`（带消息头，与 Language Server Protocol 相同） |
| `input`、`output` | `process.stdin`、`process.stdout` | stdio 使用的流 |
| `end` | `'application'` | stdio 的输入结束时的行为：`'application'` 在正在处理的请求均得到响应后退出应用，`'none'` 不执行任何操作，也可以是一个函数 |
| `heartbeat` | `30000` | WebSocket 的 ping 间隔，单位为毫秒；`0` 表示不发送 |
| `listening` | | `(server, listeners) => …`，HTTP 或 WebSocket 的服务器开始监听后调用 |

请求的方法名和参数构成消息。例如 `{"method": "order.get", "params": {"id": 1}}` 即为消息 `{method: 'order.get', id: 1}`，因此动作需在模式中声明方法名：

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'

class OrderRPCController extends Controller {
    //{"jsonrpc": "2.0", "id": 1, "method": "order.get", "params": {"id": 1}}
    @ServiceAction({method: 'order.get'})
    public async get(input: { id: number }): Promise<{ id: number }> {
        return {id: input.id}
    }
}
```

- 结果为响应中的 `result`；动作没有返回值时为 `null`。
- 不带 `id` 的请求为通知，动作会执行，但不发送任何响应（HTTP 上为 204）。批量请求（由请求组成的数组）的答复是由各响应组成的数组。
- 错误为带有错误码的 `error`：

  | 错误码 | 触发时机 |
  |---|---|
  | `-32700` | 消息不是 JSON |
  | `-32600` | 消息不是 JSON-RPC 2.0 请求，或者批量请求为空 |
  | `-32601` | 没有动作与请求匹配 |
  | `-32602` | 输入未通过 DTO 的校验，或参数为数组但未设置 `positionalParams` |
  | `-32000` | 动作的其他错误，完整的错误放在 `data` 中 |
  | `-32001` | 应用正在停止 |

- 在 HTTP 上，请求是发往 `path` 的 `POST`，以 200 响应；其他方法或路径以 404 响应。CORS 响应头允许任何来源和任何请求头。
- 在 WebSocket 上，每个文本帧是一条消息。推送给客户端的事件以通知的形式发送：`{"jsonrpc": "2.0", "method": "<事件>", "params": [<参数>]}`。

**在 stdio 上**，应用是一个子进程。父进程将请求写入应用的标准输入，并从应用的标准输出读取响应和事件。标准输出专用于协议，因此应用的日志必须写入标准错误，也不能调用 `console.log()`。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Logger} from 'lakutata/com/logger'
import {jsonRPCServiceEntrypoint} from 'lakutata/adapter/jsonrpc'

class ToolController extends Controller {
    @ServiceAction({method: 'sum'})
    public async sum(input: { values: number[] }): Promise<number> {
        return input.values.reduce((total: number, value: number): number => total + value, 0)
    }
}

Application.run(() => ({
    id: 'tool.app',
    name: 'Tool',
    components: {
        //标准输出属于协议
        log: {class: Logger, destinations: [process.stderr]},
        entrypoint: buildEntrypoints({
            controllers: [ToolController],
            service: jsonRPCServiceEntrypoint({transport: 'stdio'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ echo '{"jsonrpc": "2.0", "id": 1, "method": "sum", "params": {"values": [1, 2, 3]}}' | node build/App.js
{"jsonrpc":"2.0","id":1,"result":6}
```

输入结束且所有请求都得到响应之后，应用随即退出（`end`）。

### 按网口监听

`httpServiceEntrypoint()`、使用自身服务器的 `socketIOServiceEntrypoint()`，以及基于 HTTP 或 WebSocket 的 `jsonRPCServiceEntrypoint()`，都可以按网口而非按地址监听，无论网口当前的地址是什么。这需要另行安装 `@lakutata/netif` 包。这些适配器接受与 HTTP 适配器相同的 `interface`、`family`、`strict`、`onError` 和 `interfaceListening` 选项（见 [HTTP](HTTP.md) 第 2 节），`listening` 回调的最后一个参数为网口的监听器：

```typescript
import {httpServiceEntrypoint} from 'lakutata/com/entrypoint'

//服务只在 eth1 上提供，不管它是什么地址
export const service = httpServiceEntrypoint({port: 3000, interface: 'eth1'})
```

在 Bun 上，交给服务器的连接无法升级为 WebSocket。因此在 Bun 上，基于 WebSocket 的 JSON-RPC 会启动失败；Socket.IO 也会启动失败，除非只使用轮询（`options: {transports: ['polling']}`，客户端也需同样设置）。

### Electron

`electronIPCServiceEntrypoint()` 在 Electron 应用的主进程中，向应用的窗口提供动作。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `channel` | `'lakutata:service'` | 请求使用的 IPC 通道；事件使用 `<channel>:event`，订阅使用 `<channel>:subscribe` |
| `ipcMain` | Electron 的 `ipcMain` | 要使用的 `ipcMain`，测试时可以传入替身 |

页面通过窗口的预加载脚本调用主进程：

```typescript
import {contextBridge, ipcRenderer, type IpcRendererEvent} from 'electron'

contextBridge.exposeInMainWorld('service', {
    //得到封套，从不抛出错误
    invoke: (message: Record<string, unknown>, clientId: string): Promise<unknown> => ipcRenderer.invoke('lakutata:service', message, clientId),
    //推送给页面的事件：事件名，以及参数组成的数组
    subscribe: (clientId: string, listener: (event: string, args: unknown[]) => void): void => {
        ipcRenderer.on('lakutata:service:event', (_event: IpcRendererEvent, name: string, args: unknown[]): void => listener(name, args))
        ipcRenderer.send('lakutata:service:subscribe', clientId)
    }
})
```

- 每个页面在订阅和调用时给出自身的客户端 ID（`crypto.randomUUID()`）；页面在窗口中重新加载后，新的 ID 取代原来的 ID。没有 ID 的页面无法收到事件。
- `lakutata/adapter/electron` 中的 `ipcEventOfContext(this.context)` 返回请求的 IPC 事件，用于找到发出请求的窗口。
- `lakutata create` 的 Electron 模板包含相同形式的预加载脚本，并为页面提供了 `window.ipc`，其 `invoke()` 返回结果或抛出错误。

### NW.js

`nwjsServiceEntrypoint()` 在 NW.js 应用的后台脚本（即应用的 Node.js 上下文）中，向应用的窗口提供动作。NW.js 会向窗口中的所有页面开放 Node.js，页面中的 iframe 也无法阻止其内容使用 Node.js（iframe 的 sandbox 会被忽略）。因此，用户界面运行在没有 Node.js 的 `<webview>` 中，由窗口中一个受信任的页面（宿主页面）承载。适配器在 NW.js 与窗口共享的全局对象上放置一个桥接对象 `global[Symbol.for(key)]`；宿主页面将界面的请求转发给桥接对象，并将向界面推送事件的函数交给桥接对象。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `key` | `'lakutata:service'`（`NWJS_SERVICE_BRIDGE`） | 桥接对象在全局对象上的键 |
| `global` | NW.js 的全局对象 | 放置桥接对象的对象，测试时可以传入替身 |

| 桥接对象的方法 | 含义 |
|---|---|
| `invoke(message, clientId)` | 调用一个动作，结果解析为封套，从不拒绝 |
| `subscribe(clientId, push)` | 将一个页面登记为客户端，推送给该页面的事件交给 `push(event, args)` |
| `unsubscribe(clientId)` | 页面重新加载或窗口关闭时移除该客户端，其正在处理的请求会被中止 |

宿主页面只转发其 `<webview>` 中加载的页面发来的消息：

```javascript
const view = document.querySelector('webview')
const origin = new URL(view.src).origin
const bridge = global[Symbol.for('lakutata:service')]
const send = (message) => view.contentWindow.postMessage(message, origin)
window.addEventListener('message', async (event) => {
    if (event.source !== view.contentWindow || event.origin !== origin) return
    const {type, id, message, clientId} = event.data
    if (type === 'invoke') send({type: 'response', id: id, response: await bridge.invoke(message, clientId)})
    if (type === 'subscribe') bridge.subscribe(clientId, (name, args) => send({type: 'event', name: name, args: args}))
})
```

- `<webview>` 只有在其分区已在 NW.js 的清单中声明时，才能加载应用的文件：`"webview": {"partitions": [{"name": "trusted", "accessible_resources": ["<all_urls>"]}]}`（由构建器写入）。
- 在 `<webview>` 中重新加载的页面是一个新的客户端，宿主页面会取消前一个客户端的订阅。
- `lakutata create` 的 NW.js 模板包含此类宿主页面（`packages/app/host`），并为界面提供了与 Electron 模板相同的 `window.ipc`。

### React Native

`reactNativeServiceEntrypoint()` 在 React Native 手机应用（Android、iOS、鸿蒙）内嵌的 Node.js 中，向应用的界面提供动作。应用的原生模块启动 Node.js，并将一个 socket 的一端交给 Node.js，该 socket 的文件描述符存放在环境变量 `LAKUTATA_NODE_FD` 中。适配器在该 socket 上读取宿主发来的消息，并将响应和事件写回，每行一个 JSON 对象。值按 JSON 的规则传递：`Date` 到达时为字符串，`Buffer` 变为 `{type, data}`，`undefined` 被丢弃；JSON 无法表示的结果（`bigint`、循环引用）会以错误作答。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `socket` | `LAKUTATA_NODE_FD` 中的文件描述符上的 socket | 与宿主的连接，测试中可以替换为替身 |
| `pause` | | 应用切换到后台时调用，调用完成后才通知宿主应用可以进入后台 |
| `resume` | | 应用从后台返回时调用 |

| 宿主写入 | 适配器的回应 |
|---|---|
| `{"type":"invoke","id":1,"clientId":"ui","data":{"cmd":"greet","name":"you"}}` | `{"type":"response","id":1,"response":{"success":true,"error":null,"payload":…}}` |
| `{"type":"subscribe","clientId":"ui"}` | `{"type":"subscribed","clientId":"ui"}`，随后是推送给该客户端的事件 |
| `{"type":"unsubscribe","clientId":"ui"}` | 没有回应；该客户端正在处理的请求会被中止 |
| `{"type":"pause"}` | `pause` 选项执行完毕后回应 `{"type":"paused"}` |
| `{"type":"resume"}` | 没有回应；执行 `resume` 选项 |

- 宿主在应用开始监听之前写入的行会保留在 socket 中，不会丢失。界面收到订阅的回应，即表明应用已经就绪。
- 在 iOS 上，宿主先向系统申请应用挂起前收尾的时间，再发送 `pause`，收到 `paused`（或时间耗尽）后才让应用挂起。
- Node.js 结束时（`process.exit()`、未捕获的异常），手机应用仍然正常运行，原生模块会报告退出码，并且可以重新启动 Node.js。
- `lakutata create` 的 `mobile-react` 模板包含此类原生模块，并为界面提供了与 Electron 模板相同的 `ipc`，两者均位于该模板的 `packages/ipc` 包中。

## 5. 客户端与事件

保持连接的传输方式可以向客户端推送事件。客户端通过其给出的 ID 识别：

| 传输方式 | 客户端 ID |
|---|---|
| HTTP 服务 | 请求的 `id` 请求头或 `id` 查询参数；事件流未给出时为随机 ID |
| Socket.IO | 连接的 `auth.id`，其次是 `id` 请求头，再次是 `id` 查询参数，否则为 socket 的 ID |
| 基于 HTTP 的 JSON-RPC | 请求的 `id` 请求头或 `id` 查询参数；无法收到事件 |
| 基于 WebSocket 的 JSON-RPC | 连接的 `id` 请求头或 `id` 查询参数，否则为随机 ID |
| 基于 stdio 的 JSON-RPC | `'stdio'` |
| Electron | 页面在订阅或调用时给出的 ID |
| NW.js | 宿主页面为其页面交给桥接对象的 ID |
| React Native | 界面在订阅或调用时给出的 ID |
| WebRTC | 调用方在房间中的成员 ID |

动作从 `this.context.clientId` 读取其客户端 ID。`entrypoint` 组件负责推送事件：

- `notify(clientId, event, ...args)` 将事件发送给一个客户端，经由该客户端所连接的每种传输方式发送，并返回是否送达；
- `broadcast(event, ...args)` 将事件发送给所有已连接的客户端，并返回客户端的数量。

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
        //任务完成时通知发起它的客户端；任务开始时通知所有客户端
        if (clientId) setTimeout((): void => void this.entrypoint.notify(clientId, 'done', {task: 1}), 1000)
        this.entrypoint.broadcast('started', {task: 1})
    }
}
```

客户端按以下形式收到 `notify(clientId, 'progress', 50, 'half')`：

| 传输方式 | 收到的内容 |
|---|---|
| HTTP 服务 | 事件流中的 `event: progress` 和 `data: [50,"half"]` |
| Socket.IO | `socket.on('progress', (percent, label) => …)` |
| JSON-RPC（WebSocket、stdio） | `{"jsonrpc": "2.0", "method": "progress", "params": [50, "half"]}` |
| Electron | 通过上文预加载脚本中的 `subscribe` 收到 `('progress', [50, 'half'])` |
| NW.js | 交给桥接对象 `subscribe` 的函数收到 `('progress', [50, 'half'])` |
| React Native | 一行 `{"type":"event","clientId":…,"event":"progress","args":[50,"half"]}`，由宿主转交给界面 |
| WebRTC | `PeerServiceProxy` 的 `proxy.on('progress', (percent, label) => …)` |

## 6. 停止与离开

- 应用停止时，新的请求以 `EntrypointStoppedException`（`E_ENTRYPOINT_STOPPED`；JSON-RPC 中错误码为 `-32001`）失败，正在处理的请求可在入口的 `shutdownTimeout` 内完成（见[入口](Entrypoint.md)第 4 节）。
- 客户端在收到响应之前离开时（socket 断开、窗口关闭、HTTP 连接关闭、数据通道关闭），其请求的 `this.signal` 会被中止。
- 传输方式不限制调用的时长，超时由客户端自行设置，例如上文的 `socket.timeout(5000)`。
