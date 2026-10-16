# Lakutata NATS

`@lakutata/nats` 包把应用连接到 [NATS](https://nats.io) 服务器。它提供：一个用来发布、订阅和发送请求的组件；一个通过 NATS 提供应用服务动作的服务适配器；一个从其他应用调用这些动作的服务代理。同一个服务的多个实例会分担它的请求，不需要负载均衡器。`lakutata` 不包含这个包，需要另外安装：

```bash
npm install lakutata @lakutata/nats
```

它需要 NATS 服务器 2.2 或更高版本；超过服务器大小上限的数据（第 7 节）还需要启用 JetStream（`nats-server -js`）：

```bash
docker run -d --name nats -p 4222:4222 nats:2.12-alpine -js
```

## 1. NATS 组件

用 `buildNatsClientOptions` 声明组件。组件在创建时连接服务器。连不上时，创建会在 `timeout`（默认 20 秒）之后失败；如果组件是在应用启动过程中创建的（列在 `bootstrap` 里，或者被这样的对象用到），应用的启动也会随之失败。

```typescript
import {Application} from 'lakutata'
import {buildNatsClientOptions, type NATS} from '@lakutata/nats'

Application
    .run(() => ({
        id: 'pricing.app',
        name: 'Pricing',
        components: {
            nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222', name: 'pricing'})
        },
        bootstrap: ['nats']
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const nats: NATS = await app.getObject<NATS>('nats')
        //应答者：返回值就是请求的响应；同一个队列组里的实例分担请求
        nats.subscribe('price.get', async (input: { sku: string }): Promise<number> => input.sku.length * 10, {queue: 'pricing'})
        //带通配符的订阅者：第二个参数是消息的主题
        nats.subscribe('price.changed.*', (price: number, subject: string): void => console.log(subject, price))
        nats.publish('price.changed.eu', 42)
        //5 秒内的响应
        console.log(await nats.request('price.get', {sku: 'ABC'}, 5000)) //30
    })
```

- `publish(subject, payload)` 把消息发给该主题的所有订阅（每个队列组只发给其中一个订阅）。没有人订阅时，消息就丢失了。
- `subscribe(subject, callback, options?)` 支持通配符 `*`（一段）和 `>`（剩下的所有段）。选项有 `queue`（队列组：每条消息只发给其中一个成员）、`max`（收到这么多条后结束）、`iterator`（逐条处理消息）和 `errorResponse`（见下文）。它返回 NATS 的订阅对象（`unsubscribe()`、`drain()`）。
- `request(subject, payload, timeout?)` 返回第一个响应。timeout 以毫秒为单位，默认 10 分钟。应答者的回调抛出错误时，请求得不到响应，最终超时；除非订阅设置了 `errorResponse: (error) => value` 来回复它。
- 连接断开后会在后台重新连接（每个服务器 10 次，`maxReconnectAttempts: -1` 表示一直重试）。
- 应用停止时，组件会排空它的连接：正在处理的消息处理完，待发送的消息发送出去。
- 无法抛给调用者的失败（回调抛错、消息无法解码），组件会发出 `'error'` 事件：`nats.on('error', listener)`。

`buildNatsClientOptions` 的选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `servers` | 必填 | 服务器地址，或地址列表（`'nats://127.0.0.1:4222'`） |
| `user`、`pass` / `token` | | 认证信息 |
| `name` | | 连接的名字，服务器上可以看到 |
| `codec` | `messagePackCodec()` | 数据的编码方式（第 6 节） |
| `timeout` | `20000` | 第一次连接最多等待多少毫秒 |
| `reconnect`、`maxReconnectAttempts` | `true`、`10` | 是否重连，以及每个服务器最多重连几次 |
| `pingInterval`、`maxPingOut` | `120000`、`2` | 多久 ping 一次服务器，以及最多允许几次 ping 没有回应 |
| `noEcho` | `false` | 不接收本连接自己发布的消息 |
| `noRandomize` | `false` | 按顺序而不是随机地尝试服务器 |
| `debug` | `false` | 打印协议内容 |
| `bulk`、`bulkBucket`、`bulkTTL`、`bulkReplicas` | | 大数据传输（第 7 节） |

组件不支持 TLS，也不支持 NKey 或 JWT 认证。

## 2. 提供服务动作

`natsServiceEntrypoint(natsComponentName, options?)` 是入口的一种 `service` 适配器：它接收发给本应用的请求，调用应用里的 `@ServiceAction` 方法。

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {buildNatsClientOptions, natsServiceEntrypoint} from '@lakutata/nats'

class GetOrderDTO extends DTO {
    @Expect(DTO.Number().integer().required())
    public id: number
}

class OrderController extends Controller {
    @ServiceAction({cmd: 'order.get'}, GetOrderDTO)
    public async get(input: GetOrderDTO): Promise<{ id: number, total: number }> {
        return {id: input.id, total: 42}
    }
}

Application.run(() => ({
    //请求的主题，也是代理使用的 serviceId
    id: 'order.service',
    name: 'OrderService',
    components: {
        nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222'}),
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            service: natsServiceEntrypoint('nats')
        })
    },
    bootstrap: ['entrypoint']
}))
```

- 第一个参数是 NATS 组件的名字。
- 请求发到以应用 id 命名的主题上（`order.service`）；`subject` 选项可以换成别的主题。
- 服务的各个实例加入同一个队列组（`order.service.serviceQueue`，或 `queue` 选项指定的名字），所以每个请求只由一个实例处理。
- 不等待响应、直接发布的消息也会执行对应的动作，只是不会有回复。
- 应用停止时，适配器不再接收新请求，正在处理的请求会处理完。调用正在重启的服务时，调用方会重试请求（见第 3 节）。

适配器还接受 `middlewares`（在入口的中间件之后执行）和 `name`。

## 3. 调用服务：服务代理

`ServiceProxy` 用来调用某个远端服务的动作，并监听它的事件。它是一个单例提供者：每个服务用 `buildServiceProxy` 声明一个，放在 `providers` 下。

```typescript
import {Application} from 'lakutata'
import {
    buildNatsClientOptions,
    buildServiceProxy,
    NatsRequestTimeoutException,
    ServiceInvokeException,
    type ServiceProxy
} from '@lakutata/nats'

Application
    .run(() => ({
        id: 'billing.app',
        name: 'Billing',
        components: {
            nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222'})
        },
        providers: {
            orderService: buildServiceProxy({natsComponentName: 'nats', serviceId: 'order.service'})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orderService: ServiceProxy = await app.getObject<ServiceProxy>('orderService')
        try {
            //动作的模式和输入放在同一个对象里，超时 30 秒
            console.log(await orderService.invoke({cmd: 'order.get', id: 1}, 30000))
        } catch (error) {
            if (error instanceof ServiceInvokeException) console.error(error.service, error.errno, error.message)
            else if (error instanceof NatsRequestTimeoutException) console.error('No response in time')
            else throw error
        }
    })
```

`invoke(input, timeout)` 返回动作的结果。timeout 默认 10 分钟；服务没有运行时调用会立即失败，所以 timeout 只用来限制太慢的动作。

- 如果服务没有任何实例收到请求（服务没有运行，或者正在重启），代理会重新发送，最多 `maxRetries` 次（默认 3 次），每次间隔 `retryDelay` 毫秒（默认 100），之后抛出 `NatsNoRespondersAvailableException`。
- 超时和动作失败都不会重试：动作可能已经执行过了，不能执行两次。
- **超时不会中止服务端的动作**：调用方不再等待，但动作会一直执行完。这一点与 gRPC 不同，gRPC 的截止时间会中止动作。

`buildServiceProxy` 的选项有 `natsComponentName`、`serviceId`、`maxRetries` 和 `retryDelay`。

## 4. 事件

服务可以向监听它的代理发送事件：

- NATS 组件的 `nats.emitServiceEvent(event, ...args)`，在应用 id 下发送；
- `entrypoint.broadcast(event, ...args)`，在适配器的主题下发送。它返回 0：NATS 不会告诉发送方有多少人收到了消息。如果适配器的 `subject` 选项不是应用 id，`serviceId` 为应用 id 的代理只会收到 `emitServiceEvent` 发出的事件。

`entrypoint.notify(clientId, ...)` 到达不了 NATS 的调用方，因为它们没有客户端 id。

另一端用 `orderService.on(event, listener)`、`once` 和 `off` 监听服务的事件。用 `on(event, listener, true)` 注册时，在所有应用中这样注册的监听器里，每个事件只发给其中一个（队列组）。事件最多送达一次：发送时没有连接的应用会错过它。代理被销毁时，它注册的监听器也会被移除。

```typescript
import type {ServiceProxy} from '@lakutata/nats'

export function watchPayments(orderService: ServiceProxy): void {
    orderService.on('orderPaid', (id: number, total: number): void => console.log(`Order ${id} paid: ${total}`))
}
```

## 5. 错误

| 异常 | errno | statusCode | 什么时候 |
|---|---|---|---|
| `ServiceInvokeException` | 远端错误的 errno | 远端错误的 statusCode | 动作失败。消息和属性来自远端错误，`service` 是服务 id |
| `NatsNoRespondersAvailableException` | `E_NATS_NO_RESPONDERS_AVAILABLE` | 503 | 重试之后仍然没有实例收到请求 |
| `NatsRequestTimeoutException` | `E_NATS_REQUEST_TIMEOUT` | 408 | 超时前没有收到响应 |
| `NatsBulkException` | `E_NATS_BULK` | 502 | 大数据无法存入或读取（第 7 节） |

它们都由 `@lakutata/nats` 导出。远端错误带着它的全部属性，包括调用栈。

## 6. 编码方式

所有数据都用组件的 `codec` 编码，同一个主题的两端必须相同：

- `messagePackCodec()`，默认值：MessagePack，紧凑而且快；
- `jsonCodec()`：JSON 文本，方便其他语言写的客户端使用。

两者都会先把值转成 JSON，让所有客户端收到的都是普通的 JSON 数据：`Date` 变成 ISO 字符串，`Buffer` 变成 `{type: 'Buffer', data: [...]}`，类的实例变成普通对象，`undefined` 变成 `null`。`bigint` 无法发送。任何带有 `encode(value): Uint8Array` 和 `decode(bytes)` 的对象都可以作为编码方式，比如用于文本数据的 `StringCodec()`。

## 7. 大数据传输

一条 NATS 消息的大小不能超过服务器的 `max_payload`，默认是 1 MiB。达到这个大小 90% 的请求和响应会被存进 JetStream 的对象存储，消息里只带一个引用；接收方读取对象后把它删除。回调、动作和 `invoke()` 拿到的始终是完整的值。

- 这个通道默认开启（`bulk: true`），需要 JetStream。没有 JetStream 时，组件会打印一条警告，然后不带它启动：这时只有超过 `max_payload` 的数据会失败。
- 互相传输大数据的应用必须使用同一个对象存储：给它们设置相同的 `bulkBucket`。默认的名字取决于 `name` 选项（`lkt-bulk-<name>`，没有 name 时是 `lkt-bulk-default`），所以 name 不同的两个应用读不到对方的对象。
- 没有被读取的对象会在 `bulkTTL`（默认 5 分钟）后过期。`bulkReplicas` 设置集群中的副本数。这两项在创建对象存储时生效。
- 发布的消息和事件从不经过对象存储：超过 `max_payload` 时，它们会以 NATS 的错误 `MAX_PAYLOAD_EXCEEDED` 失败。
