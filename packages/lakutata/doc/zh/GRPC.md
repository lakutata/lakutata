# Lakutata gRPC

`@lakutata/grpc` 包让应用通过 gRPC 提供服务动作，也能从另一个应用调用这些动作；任何有 gRPC 库的语言都可以调用它们。它用 TypeScript 基于 Node.js（`^22.13.0 || >=24.11.0`）的 HTTP/2 模块实现，不需要原生插件，也不需要生成代码。`lakutata` 不包含这个包，需要另外安装：

```bash
npm install lakutata @lakutata/grpc
```

## 1. 提供服务动作

`@lakutata/grpc/service` 中的 `grpcServiceEntrypoint()` 是入口的一种 `service` 适配器。控制器里的 `@ServiceAction` 方法可以通过 gRPC 按模式调用，和其他服务传输方式一样。

```typescript
import {Application, Exception} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {grpcServiceEntrypoint} from '@lakutata/grpc/service'

class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'
}

class OrderController extends Controller {
    //用 {cmd: 'order.get', id: 1} 调用
    @ServiceAction({cmd: 'order.get'})
    public async get(input: { id: number }): Promise<{ id: number, status: string }> {
        if (input.id === 0) throw new OrderNotFoundException('Order {id} not found', {id: input.id})
        return {id: input.id, status: 'paid'}
    }
}

Application.run(() => ({
    id: 'orders.service',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            service: grpcServiceEntrypoint({port: 50051})
        })
    },
    bootstrap: ['entrypoint']
}))
```

`grpcServiceEntrypoint` 的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `port` | `50051` | 端口；`0` 表示随机选一个空闲端口 |
| `host` | 所有网络接口 | 监听的地址 |
| `socketPath` | | 改用 unix socket，代替端口和地址 |
| `tls` | 无（明文 HTTP/2） | `{cert, key}` 启用 TLS；再加上 `ca` 时，客户端必须出示由它签发的证书（双向 TLS） |
| `maxMessageSize` | 4 MiB | 请求的最大大小（解压前后都算）；超过时以 `RESOURCE_EXHAUSTED` 失败 |
| `compression` | `'identity'` | 设为 `'gzip'` 或 `'deflate'` 时，对支持的客户端压缩响应。压缩过的请求总是可以接收 |
| `listening` | | `(address, listeners) => void`，服务开始监听后调用；启动过程会等它完成 |
| `interface`、`family`、`strict`、`onError` | | 按网口监听，而不是按地址监听，用法和 HTTP 适配器一样（见 [HTTP](HTTP.md) 第 2 节）；不能和 `host` 或 `socketPath` 一起设置 |
| `middlewares` | | 通过 gRPC 调用的动作专用的中间件，在入口的中间件之后执行 |
| `name` | | 适配器的名字，用来区分多个适配器 |

设置 `interface` 时需要安装 `@lakutata/netif` 包。这时传给 `listening` 的 `address` 是第一个监听的地址；网口还不存在或还没有地址时是 `null`；`listeners` 是网口的监听器。

服务端不提供反射服务，也不提供健康检查服务。

## 2. 从另一个应用调用

`GRPCServiceProxy` 用来调用远端应用的动作。它是一个组件：用 `buildGRPCServiceProxy` 声明在 `components` 下，每个远端应用一个。

```typescript
import {Application} from 'lakutata'
import {ServiceInvokeException} from 'lakutata/com/entrypoint'
import {GRPCError, GRPCStatus} from '@lakutata/grpc'
import {buildGRPCServiceProxy, type GRPCServiceProxy} from '@lakutata/grpc/service'

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            orders: buildGRPCServiceProxy({address: 'orders.internal:50051'})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: GRPCServiceProxy = await app.getObject<GRPCServiceProxy>('orders')
        try {
            //模式和输入放在同一个对象里，截止时间 5 秒
            console.log(await orders.invoke({cmd: 'order.get', id: 1}, 5000))
        } catch (error) {
            if (error instanceof ServiceInvokeException) {
                //动作失败：它的 errno、消息和其他属性
                console.log(error.errno, error.message)
            } else if (error instanceof GRPCError && error.code === GRPCStatus.UNAVAILABLE) {
                console.log('The orders service is unreachable')
            } else {
                throw error
            }
        }
    })
```

`invoke(input, timeout)` 返回动作的结果（动作没有返回值时为 `null`）。timeout 默认 10 分钟，就是这次 gRPC 调用的截止时间：时间一到，调用失败，服务端的动作也会被中止（触发它的 `this.signal`）。

`buildGRPCServiceProxy` 的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `address` | 必填 | `host:port`、`tcp://host:port`，或 unix socket：`/path`、`unix:///path` |
| `tls` | 无 | `{ca, cert, key, servername}`，都可省略。只要设置了（哪怕是 `{}`）就启用 TLS；`cert` 和 `key` 是双向 TLS 中客户端的证书 |
| `clientId` | 随机 UUID | 这个客户端的 id，随每次调用发送（见第 3 节） |
| `compression` | `'identity'` | 设为 `'gzip'` 或 `'deflate'` 时压缩请求 |
| `maxMessageSize` | 不限 | 接收的响应的最大大小 |
| `reconnectDelay` | `1000` | 事件流结束后，等待多少毫秒再重新打开（见第 4 节） |

代理在第一次调用时才建立连接，调用失败时不会自己重试。

## 3. 客户端 id、元数据与截止时间

每次调用都带着元数据 `id`，即客户端的 id：代理的 `clientId`，或者其他语言的客户端发送的 `id` 头。动作通过 `this.context.clientId` 读取它。

`grpcCallOfContext(context)` 让动作拿到整个 gRPC 调用：客户端发送的元数据、截止时间和对端地址。请求来自其他传输方式时，它返回 `undefined`。

```typescript
import {Controller, type ServiceContext} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {grpcCallOfContext} from '@lakutata/grpc/service'
import type {GRPCServerCall} from '@lakutata/grpc'

class OrderController extends Controller {
    @ServiceAction({cmd: 'order.get'})
    public async get(input: { id: number }): Promise<{ id: number, tenant: string }> {
        const call: GRPCServerCall | undefined = grpcCallOfContext(this.context as ServiceContext)
        //客户端发送的元数据：grpcurl -H 'tenant: acme' ...
        const tenant: string = call?.metadata('tenant')[0] ?? 'default'
        return {id: input.id, tenant: tenant}
    }
}
```

- `GRPCServiceProxy` 只发送 `id` 这一项元数据。需要其他元数据（比如授权令牌）的客户端，可以用 `GRPCConnection`（见第 8 节）或其他语言的客户端。
- 同一个元数据键的值会按逗号拆分，所以 id 里不要有逗号。
- 客户端取消调用或截止时间已过时，动作的 `this.signal` 会被触发，结果会被丢弃。耗时长的动作应该检查这个信号。

## 4. 事件

动作可以用 `entrypoint.notify(clientId, event, ...args)` 向某个客户端推送事件，或者用 `entrypoint.broadcast(event, ...args)` 推送给所有已连接的客户端。`notify` 返回客户端是否收到了事件，`broadcast` 返回客户端的数量。

```typescript
import {Controller, type Entrypoint, type ServiceContext} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'

class OrderController extends Controller {
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    @ServiceAction({cmd: 'order.ship'})
    public async ship(input: { id: number }): Promise<void> {
        const clientId: string | undefined = (this.context as ServiceContext).clientId
        if (clientId) this.entrypoint.notify(clientId, 'orderChanged', {id: input.id, status: 'shipped'})
    }
}
```

另一端用 `orders.on('orderChanged', listener)` 监听；`once` 和 `off` 的用法与事件发射器相同。代理在注册第一个监听器时打开事件流，最后一个监听器移除时关闭。事件流意外结束时（比如服务重启了），会在 `reconnectDelay` 之后重新打开。

事件不会被保存：发送时没有连接的客户端会错过它。

## 5. 错误

动作失败不会让 gRPC 调用失败：调用本身是成功的，响应里带着这个错误，包括它的消息和全部属性（`errno`、`statusCode`，以及调用栈）。`GRPCServiceProxy` 把它作为 `lakutata/com/entrypoint` 中的 `ServiceInvokeException` 抛出：消息是远端的消息，`errno` 等属性从远端错误复制而来，`service` 是代理的地址。

gRPC 层面失败的调用会抛出 `@lakutata/grpc` 中的 `GRPCError`，它的 `code` 是一个 `GRPCStatus`：

| 状态 | 什么时候 |
|---|---|
| `UNAVAILABLE` | 连不上服务 |
| `DEADLINE_EXCEEDED` | 超过截止时间 |
| `CANCELLED` | 调用被取消 |
| `RESOURCE_EXHAUSTED` | 消息超过 `maxMessageSize` |
| `UNIMPLEMENTED` | 方法不存在，或使用了服务端不支持的压缩方式 |

没有模式匹配的调用会以 errno `E_CONTROLLER_ACTION_NOT_FOUND` 失败，和其他服务传输方式一样。

## 6. 从其他语言调用

`SERVICE_PROTO` 是这个服务的 `.proto` 文件，用它生成其他语言的客户端：

```typescript
import {writeFileSync} from 'node:fs'
import {SERVICE_PROTO} from '@lakutata/grpc/service'

writeFileSync('service.proto', SERVICE_PROTO)
```

```text
service Service {                                       // package lakutata.service.v1
  rpc Invoke (InvokeRequest) returns (InvokeResponse);  // data：模式和输入的 JSON
  rpc Events (EventsRequest) returns (stream Event);    // 推送给该客户端的事件，第一个是 "client"（它的 id）
}
message InvokeResponse { bool success = 1; bytes payload = 2; bytes error = 3; }  // payload、error：JSON
message Event { string event = 1; bytes args = 2; }                              // args：JSON 数组
```

调用时，在 `InvokeRequest.data` 里放模式和输入的 JSON，在元数据 `id` 里放客户端的 id。响应的 `payload` 是结果的 JSON，或者 `error` 是错误的 JSON。用 grpcurl 调用（它把 `bytes` 字段显示为 base64）：

```bash
DATA=$(printf '{"cmd":"order.get","id":7}' | base64)
grpcurl -plaintext -proto service.proto -H 'id: go-1' -d "{\"data\": \"$DATA\"}" localhost:50051 lakutata.service.v1.Service/Invoke
```

用 Python（`grpcio` 包，存根由 `grpcio-tools` 生成）：

```python
import json
import grpc
import service_pb2 as pb
import service_pb2_grpc as rpc

stub = rpc.ServiceStub(grpc.insecure_channel('localhost:50051'))
response = stub.Invoke(pb.InvokeRequest(data=json.dumps({'cmd': 'order.get', 'id': 5}).encode()), metadata=[('id', 'python-1')], timeout=5)
print(json.loads(response.payload) if response.success else json.loads(response.error))
```

## 7. 停止

应用停止时，服务会拒绝新的调用：代理把它作为 `ServiceInvokeException` 抛出，其 `errno` 为 `E_ENTRYPOINT_STOPPED`。正在进行的调用有入口的 `shutdownTimeout`（默认 30 秒）可以完成。之后事件流结束，服务端关闭。

## 8. 底层组件

这个包也提供服务所依赖的底层组件，脱离 lakutata 也能使用：`GRPCConnection` 是可以调用任何 gRPC 服务端的客户端（一元调用、服务端流、双向流、元数据、TLS）；`GRPCServer` 是服务端；`encode`/`decode` 是基于 schema 的 protobuf 编解码器。详见 `@lakutata/grpc` 的 README。`GRPCServer.listenWith()` 也能像适配器一样，通过网口的监听器（`@lakutata/netif` 的 `listenOnAll()`）按网口监听。
