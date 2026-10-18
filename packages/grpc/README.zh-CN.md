# @lakutata/grpc

[English](README.md) | 中文

lakutata 框架的 gRPC 实现，用 TypeScript 基于 Node.js 的 HTTP/2 模块编写，不需要原生插件，也不需要生成代码。它提供客户端（`GRPCConnection`：支持 unix socket、TCP、TLS 和双向 TLS，支持一元调用、服务端流和双向流）、服务端（`GRPCServer`）和基于 schema 的 protobuf 编解码器（`encode`、`decode`）。子路径 `@lakutata/grpc/service` 让应用通过 gRPC 提供服务动作（`grpcServiceEntrypoint`，经由 `SERVICE_PROTO` 中的 `lakutata.service.v1.Service` 服务，任何语言都可以调用），也让另一个应用调用这些动作（`GRPCServiceProxy`）。containerd 组件（`@lakutata/containerd`）和它的 BuildKit 构建都使用这个包。`lakutata` 包没有重新导出它：请从 `@lakutata/grpc` 和 `@lakutata/grpc/service` 导入。

## 安装

```shell
npm install @lakutata/grpc
```

客户端、服务端和编解码器不需要其他包（Node.js `^22.13.0 || >=24.11.0`）。服务入口和服务代理运行在 lakutata 应用中，所以需要 `lakutata` 包，它提供了这个包的 peer 依赖 `@lakutata/core` 和 `@lakutata/entrypoint`（其他用法不需要这两个包）。

```shell
npm install lakutata @lakutata/grpc
```

## 用法

### 通过 gRPC 提供服务动作

`grpcServiceEntrypoint` 是入口的 `service` 适配器：应用的 `@ServiceAction` 动作可以通过 gRPC 按模式调用，和其他服务传输方式一样。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, Entrypoint, ServiceContext} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {grpcServiceEntrypoint} from '@lakutata/grpc/service'

class OrderController extends Controller {
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    //用 {cmd: 'order.get', id: 1} 调用
    @ServiceAction({cmd: 'order.get'})
    public async get(input: {id: number}): Promise<{id: number, status: string}> {
        return {id: input.id, status: 'paid'}
    }

    //向发起调用的客户端的事件流推送一个事件
    @ServiceAction({cmd: 'order.ship'})
    public async ship(input: {id: number}): Promise<void> {
        const clientId: string | undefined = (this.context as ServiceContext).clientId
        if (clientId) this.entrypoint.notify(clientId, 'orderChanged', {id: input.id, status: 'shipped'})
    }
}

Application.run(() => ({
    id: 'orders.service',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            //默认监听所有网络接口的 50051 端口；socketPath 改用 unix socket，tls 启用 TLS
            service: grpcServiceEntrypoint({port: 50051, compression: 'gzip'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

另一个应用用 `GRPCServiceProxy` 调用这些动作，它是一个用 `buildGRPCServiceProxy` 注册的组件：

```typescript
import {Application} from 'lakutata'
import {ServiceInvokeException} from 'lakutata/com/entrypoint'
import {buildGRPCServiceProxy, type GRPCServiceProxy} from '@lakutata/grpc/service'

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            //host:port、tcp://host:port、/path 或 unix:///path
            orders: buildGRPCServiceProxy({address: 'orders.internal:50051'})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: GRPCServiceProxy = await app.getObject<GRPCServiceProxy>('orders')
        //注册第一个监听器时打开事件流；事件流结束后，等待 reconnectDelay 再重新打开
        orders.on('orderChanged', (order: {id: number, status: string}): void => console.log(order))
        //截止时间 5 秒（默认 10 分钟）
        console.log(await orders.invoke({cmd: 'order.get', id: 1}, 5000))
        try {
            await orders.invoke({cmd: 'order.cancel', id: 1})
        } catch (error) {
            //远端动作的错误，带有它的 errno 和其他属性
            if (error instanceof ServiceInvokeException) console.log(error.errno, error.message)
            else throw error
        }
    })
```

- 客户端的 id 就是它的调用所带的元数据 `id`（动作中通过 `ServiceContext.clientId` 读取）；代理发送的是它的 `clientId`（默认是随机 UUID）。`grpcCallOfContext(context)` 让动作拿到整个 gRPC 调用，包括元数据和截止时间。
- 客户端取消调用或截止时间已过时，动作的 signal 会被触发，调用随之以 `CANCELLED` 或 `DEADLINE_EXCEEDED` 结束。
- 动作失败时，响应里带着它的错误（消息、`errno` 和其他属性），代理把它作为 `ServiceInvokeException` 抛出；传输层面的失败作为 `GRPCError` 抛出（`UNAVAILABLE`、`DEADLINE_EXCEEDED`……）。
- 入口停止后，新的调用会失败（代理抛出 `errno` 为 `E_ENTRYPOINT_STOPPED` 的 `ServiceInvokeException`），正在进行的调用可以完成；入口关闭时，事件流结束，服务端关闭。

### 从其他语言调用服务

`SERVICE_PROTO` 是这个服务的 `.proto` 文件，用它生成其他语言的客户端。

```text
service Service {
  rpc Invoke (InvokeRequest) returns (InvokeResponse);  // data：模式和输入的 JSON
  rpc Events (EventsRequest) returns (stream Event);    // 推送给该客户端的事件，第一个是 "client"（它的 id）
}
message InvokeResponse { bool success = 1; bytes payload = 2; bytes error = 3; }  // payload、error：JSON
message Event { string event = 1; bytes args = 2; }  // args：JSON 数组
```

```typescript
import {writeFileSync} from 'node:fs'
import {SERVICE_PROTO} from '@lakutata/grpc/service'

writeFileSync('service.proto', SERVICE_PROTO)
```

调用时，把动作的模式和输入的 JSON 放在 `InvokeRequest.data` 里；结果或错误以 JSON 的形式放在 `InvokeResponse.payload` 或 `InvokeResponse.error` 里返回；客户端的 id 是它的元数据 `id`。用 grpcurl 调用（grpcurl 的 JSON 中，`bytes` 字段用 base64 表示）：

```shell
DATA=$(printf '{"cmd":"order.get","id":7}' | base64)
grpcurl -plaintext -proto service.proto -H 'id: go-1' -d "{\"data\": \"$DATA\"}" localhost:50051 lakutata.service.v1.Service/Invoke
```

用 Python 的官方 gRPC 库（grpcio，存根由 grpcio-tools 生成）：

```python
import json
import grpc
import service_pb2 as pb
import service_pb2_grpc as rpc

stub = rpc.ServiceStub(grpc.insecure_channel('localhost:50051'))
response = stub.Invoke(pb.InvokeRequest(data=json.dumps({'cmd': 'order.get', 'id': 5}).encode()), metadata=[('id', 'python-1')], timeout=5)
print(json.loads(response.payload) if response.success else json.loads(response.error))
```

`npm run test:interop` 在 Docker 中用 grpcio 和 grpcurl（基于 Go 的 gRPC 实现）测试这个服务：调用、错误、gzip 压缩、截止时间、大小限制和事件。

### 客户端

`GRPCConnection` 可以调用任何 gRPC 服务端；消息由 schema 描述（见[编解码器](#protobuf-编解码器)）。

```typescript
import {readFileSync} from 'node:fs'
import {GRPCConnection, GRPCError, GRPCStatus, type BidiStream, type Message, type Schema} from '@lakutata/grpc'

const HelloRequest: Schema = {name: {no: 1, type: 'string'}}
const HelloReply: Schema = {message: {no: 1, type: 'string'}}

//unix socket：'/run/greeter.sock' 或 'unix:///run/greeter.sock'；TCP：'tcp://host:port'
const local: GRPCConnection = new GRPCConnection('/run/greeter.sock')
//TLS：给出签发服务端证书的 CA；双向 TLS：再给出客户端的证书和私钥
const remote: GRPCConnection = new GRPCConnection('tcp://greeter.internal:50051', {
    ca: readFileSync('ca.pem'),
    cert: readFileSync('client.pem'),
    key: readFileSync('client-key.pem')
}, {compression: 'gzip', maxMessageSize: 16 * 1024 * 1024})

try {
    //一元调用，带元数据和截止时间（毫秒）
    const reply: Message = await remote.unary('/helloworld.Greeter/SayHello', HelloRequest, {name: 'Ada'}, HelloReply, {
        metadata: {authorization: 'Bearer token'},
        timeout: 5000
    })
    console.log(reply.message)

    //服务端流，用 signal 取消；跳出循环也会取消调用
    const controller: AbortController = new AbortController()
    for await (const message of local.serverStream('/helloworld.Greeter/SayHelloAgain', HelloRequest, {name: 'Ada'}, HelloReply, {signal: controller.signal})) {
        console.log(message.message)
        if (message.message === 'stop') controller.abort()
    }

    //双向流（以及客户端流）：发送，结束，然后读取响应
    const chat: BidiStream = local.bidi('/helloworld.Greeter/Chat', HelloRequest, HelloReply)
    await chat.send({name: 'Ada'})
    await chat.send({name: 'Grace'})
    chat.end()
    for await (const message of chat.responses) console.log(message.message)
} catch (error) {
    if (error instanceof GRPCError && error.code === GRPCStatus.CANCELLED) console.log('Cancelled')
    else throw error
} finally {
    local.close()
    remote.close()
}
```

- HTTP/2 会话在第一次调用时打开，关闭后在下一次调用时重新打开；只有调用正在进行时，它才会让进程保持运行。失败的调用不会重试。
- 调用失败时抛出 `GRPCError`，状态是服务端返回的状态，或者是 `UNAVAILABLE`（连接失败或断开）、`CANCELLED`（signal 被触发）、`DEADLINE_EXCEEDED`（超时）、`RESOURCE_EXHAUSTED`（响应超过 `maxMessageSize`，默认不限）或 `INTERNAL`（响应无法解压或解码）。
- 元数据的值按原样发送（不做百分号编码，也不做 base64 编码）。

### 服务端

```typescript
import {readFileSync} from 'node:fs'
import type {AddressInfo} from 'node:net'
import {GRPCError, GRPCServer, GRPCStatus, type GRPCServerCall, type Schema} from '@lakutata/grpc'

const HelloRequest: Schema = {name: {no: 1, type: 'string'}}
const HelloReply: Schema = {message: {no: 1, type: 'string'}}

const server: GRPCServer = new GRPCServer({
    //TLS；给出 ca 时，客户端必须出示由它签发的证书（双向 TLS）。不设置 tls 时使用明文 HTTP/2
    tls: {cert: readFileSync('server.pem'), key: readFileSync('server-key.pem'), ca: readFileSync('ca.pem')},
    //请求的最大字节数（默认 4 MiB）
    maxMessageSize: 1024 * 1024,
    //对接受 gzip 的客户端压缩响应
    compression: 'gzip'
})

server
    .method('/helloworld.Greeter/SayHello', async (call: GRPCServerCall): Promise<void> => {
        const [token] = call.metadata('authorization')
        if (!token) throw new GRPCError(GRPCStatus.UNAUTHENTICATED, 'A token is required', call.path)
        const request = await call.request(HelloRequest)
        await call.send(HelloReply, {message: `Hello ${request.name ?? 'world'}`})
    })
    //双向流：每个请求一个响应，直到客户端结束发送请求
    .method('/helloworld.Greeter/Chat', async (call: GRPCServerCall): Promise<void> => {
        for await (const request of call.requests(HelloRequest)) {
            //客户端取消调用或截止时间已过时，signal 会被触发
            call.signal.throwIfAborted()
            await call.send(HelloReply, {message: `Hello ${request.name ?? 'world'}`})
        }
    })

//默认端口 50051（0 表示任选一个空闲端口），也可以用 {socketPath: '/run/greeter.sock'}
const address = await server.listen({port: 50051}) as AddressInfo
console.log(`Listening on ${address.port}`)
//正在进行的调用有 10 秒时间完成
process.once('SIGTERM', (): void => void server.close(10000))
```

- 处理函数完成时，它的调用随之结束：正常返回时为 `OK`；抛出 `GRPCError` 时使用它的状态码和消息；抛出其他错误时为 `UNKNOWN`。调用的方法不存在时，以 `UNIMPLEMENTED` 结束。
- 超过 `maxMessageSize` 的请求以 `RESOURCE_EXHAUSTED` 拒绝，可能在接收之前根据它的长度判断，也可能在解压之后判断。请求可以用 gzip 或 deflate 压缩；响应只对接受压缩的客户端压缩。
- 调用的截止时间（`grpc-timeout`）一到，调用就会被中止：`call.signal` 被触发，调用以 `DEADLINE_EXCEEDED` 结束；处理函数如果不检查这个信号，会继续运行。
- `server.serve(socket)` 为承载在另一个字节流（比如 BuildKit 会话）上的 HTTP/2 连接提供服务。

### protobuf 编解码器

`Schema` 取代 `.proto` 文件和由它生成的代码：它按属性名列出消息的字段，以及字段的编号和类型。

```typescript
import {decode, encode, type Message, type Schema} from '@lakutata/grpc'

//message Point { int32 x = 1; int32 y = 2; }
const Point: Schema = {x: {no: 1, type: 'int32'}, y: {no: 2, type: 'int32'}}
//message Route { string name = 1; repeated Point points = 2; map<string, string> labels = 3; uint64 started = 4; bytes data = 5; }
const Route: Schema = {
    name: {no: 1, type: 'string'},
    points: {no: 2, type: Point, repeated: true},
    labels: {no: 3, type: 'string', map: true},
    started: {no: 4, type: 'uint64'},
    data: {no: 5, type: 'bytes'}
}

const bytes: Uint8Array = encode(Route, {
    name: 'home',
    points: [{x: 1, y: 2}],
    labels: {zone: 'eu'},
    //bigint 保留全部 64 位（纳秒）；number 在 2^53 以内是精确的
    started: 1700000000000000000n,
    data: Buffer.from('raw')
})
const route: Message = decode(Route, bytes)
console.log(route.name, route.points, route.labels, route.started, route.data)
```

| 类型 | 编码时接受 | 解码结果 |
|---|---|---|
| `string` | 字符串（`String(value)`） | 字符串 |
| `bytes` | `Uint8Array`，或者按 UTF-8 编码的字符串 | `Buffer` |
| `bool` | 布尔值 | 布尔值 |
| `int32`、`uint32`、`int64`、`uint64`、`enum` | `number`（截断为整数）或 `bigint`（64 位） | `number`；超过 2^53 的 `int64`/`uint64` 解码为 `bigint`（保留全部 64 位） |
| 一个 `Schema` | 对象 | 对象 |

- 遵循 proto3 的规则：默认值（`0`、`''`、`false`、空字节）不会写入，解码出的消息里也没有这些字段（读取时写 `message.count ?? 0`）；repeated 字段解码为数组（为空时是 `[]`），map 解码为对象。
- repeated 的 varint 字段以 packed 方式写入，读取时 packed 和非 packed 都支持；map 的键只能是字符串。
- schema 没有声明的字段会被跳过。不支持 `sint32`/`sint64`、定长类型、`float` 和 `double`。
- 字节不完整，或者遇到与 schema 不符的 wire type 时，`decode` 抛出 `Error`。

## API

| 导出 | 子路径 | 说明 |
|---|---|---|
| `GRPCConnection` | `@lakutata/grpc` | 客户端：`unary`、`serverStream`、`bidi`、`close` |
| `GRPCServer` | `@lakutata/grpc` | 服务端：`method`、`listen`、`serve`、`close`、`methods` |
| `GRPCServerCall` | `@lakutata/grpc` | 服务端收到的一次调用：`request`、`requests`、`send`、`finish`、`metadata`、`deadline`、`signal` |
| `BidiStream` | `@lakutata/grpc` | 一次双向流调用：`send`、`end`、`cancel`、`responses` |
| `CallOptions` | `@lakutata/grpc` | 一次调用的元数据、signal 和超时 |
| `GRPCTLSOptions`、`GRPCServerTLSOptions` | `@lakutata/grpc` | 连接和服务端的 TLS 选项 |
| `GRPCMessageOptions`、`GRPCCompression` | `@lakutata/grpc` | 消息大小限制和压缩方式 |
| `GRPCError`、`GRPCStatus` | `@lakutata/grpc` | 失败的调用，以及状态码 |
| `parseGRPCTimeout`、`formatGRPCTimeout` | `@lakutata/grpc` | 在 `grpc-timeout` 头和毫秒数之间互相转换 |
| `encode`、`decode` | `@lakutata/grpc` | protobuf 编解码器 |
| `Schema`、`Field`、`ScalarType`、`Message` | `@lakutata/grpc` | 消息的定义，以及消息本身 |
| `grpcServiceEntrypoint`、`GRPCServiceEntrypointOptions` | `@lakutata/grpc/service` | 通过 gRPC 提供服务动作的服务适配器 |
| `grpcCallOfContext` | `@lakutata/grpc/service` | 服务上下文背后的 gRPC 调用 |
| `GRPCServiceProxy`、`buildGRPCServiceProxy`、`BuildGRPCServiceProxyOptions` | `@lakutata/grpc/service` | 调用服务的客户端组件：`invoke`、`on`、`once`、`off`、`id` |
| `SERVICE_PROTO`、`SERVICE_METHODS` | `@lakutata/grpc/service` | 服务的 `.proto` 文件及其方法路径 |

类型声明中的每一项都附有说明和示例。

## 错误

| 错误 | 什么时候抛出 |
|---|---|
| `GRPCError`（`code`：一个 `GRPCStatus`；`path`） | 调用失败：状态是服务端返回的状态，或者是 `UNAVAILABLE`（连接失败或断开，没有收到状态）、`CANCELLED`（signal 被触发、流被取消、调用被关闭）、`DEADLINE_EXCEEDED`（超时）、`RESOURCE_EXHAUSTED`（消息超过 `maxMessageSize`）、`INTERNAL`（消息无法解压或解码）或 `UNKNOWN`（HTTP 状态码不是 200）。服务端的处理函数抛出它，让调用以这个状态结束。 |
| `ServiceInvokeException`（`E_SERVICE_INVOKE`，来自 `lakutata/com/entrypoint`） | `GRPCServiceProxy.invoke()`：远端动作失败；异常带有远端错误的消息和属性（`errno`……） |
| `EntrypointStoppedException`（`E_ENTRYPOINT_STOPPED`） | 服务的入口正在停止时收到调用（代理收到的是带有这个 errno 的 `ServiceInvokeException`） |
| `Error` | `new GRPCConnection()` 的地址不是 unix socket 路径、`tcp://` URL 或 `host:port`，或者在 unix socket 上使用 TLS；`decode()` 遇到不完整或不符合预期的字节；`GRPCServer.listen()` 监听出错（`EADDRINUSE`） |

调用的方法不存在，或者使用了不支持的压缩方式时，服务端以 `UNIMPLEMENTED` 结束调用；请求超过 `maxMessageSize` 时，以 `RESOURCE_EXHAUSTED` 结束；调用超过截止时间时，以 `DEADLINE_EXCEEDED` 结束。

## 另见

- 网站上的指南：[gRPC](https://lakutata.com/zh/guide/GRPC)。
- `@lakutata/entrypoint`（`lakutata/com/entrypoint`）：入口、控制器和服务动作（`lakutata` 包中的 `doc/zh/ServiceCalls.md`）。
- `@lakutata/nats`：基于 NATS 的服务动作，使用相同的模式。
- `@lakutata/containerd`（`lakutata` 包中的 `doc/zh/ContainerdIntegration.md`）：containerd 和 BuildKit，基于这个客户端实现。
