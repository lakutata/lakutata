# @lakutata/nats

[English](README.md) | 中文

lakutata 框架的 NATS 组件。它连接 NATS 服务器，用来发布、订阅和发送请求（数据为 MessagePack 或 JSON 格式）；通过 NATS 提供应用的服务通道（`natsServiceEntrypoint`）；提供服务代理，用来调用其他服务的动作并监听它们的事件（`ServiceProxy`）；还会通过 JetStream 的对象存储转发大数据。`lakutata` 包没有重新导出它：请从 `@lakutata/nats` 导入。

## 安装

```shell
npm install lakutata @lakutata/nats
```

它使用 NATS 客户端 `nats`（作为依赖一起安装）。服务器方面，它需要：

- NATS 服务器 2.2 或更高版本（大数据传输要用到消息头）；
- 为大数据传输启用 JetStream（`nats-server -js`，或者在服务器配置中写 `jetstream {}`）。没有 JetStream 时，组件仍然会启动，并打印一条警告；这时只有超过服务器 `max_payload` 的数据会失败。

```shell
docker run -d --name nats -p 4222:4222 nats:2.12-alpine -js
```

## 用法

### NATS 组件

用 `buildNatsClientOptions` 注册 `NATS` 组件，然后通过 `getObject()` 或 `@Inject` 获取它。组件在创建时连接服务器：所有服务器都连不上时，创建会在 `timeout`（默认 20 秒）之后失败。如果组件是在应用启动过程中创建的（列在 `bootstrap` 里，或者注入到了这样的对象中），应用的启动也会随之失败。

```typescript
import {Application} from 'lakutata'
import {buildNatsClientOptions, type NATS} from '@lakutata/nats'

Application
    .run({
        id: 'pricing.app',
        name: 'Pricing',
        components: {
            nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222', name: 'pricing'})
        }
    })
    .onLaunched(async (app: Application): Promise<void> => {
        const nats: NATS = await app.getObject('nats')
        //回调和订阅的失败
        nats.on('error', (error: Error): void => console.error('NATS', error))
        //应答者：返回值就是请求的响应；同一个队列组里的实例分担请求
        nats.subscribe('price.get', async (input: {sku: string}): Promise<number> => input.sku.length * 10, {queue: 'pricing'})
        //带通配符的订阅者：第二个参数是消息到达的主题
        nats.subscribe('price.changed.*', (price: number, subject: string): void => console.log(subject, price))
        nats.publish('price.changed.eu', 42)
        //返回响应；没有应答者时立即抛出 NatsNoRespondersAvailableException，5 秒内没有响应时抛出 NatsRequestTimeoutException
        console.log(await nats.request('price.get', {sku: 'ABC'}, 5000)) //30
    })
```

- `publish()` 把消息发给该主题的所有订阅（每个队列组只有一个成员收到）；没有人监听时，消息就丢失了。
- `subscribe()` 支持通配符 `*`（一段）和 `>`（剩下的所有段）。每条消息一到达就调用回调；设置 `{iterator: true}` 时则逐条依次处理；`{max: n}` 在收到 `n` 条消息后结束订阅。它返回 NATS 的 `Subscription`（`unsubscribe()`、`drain()`）。
- `request()` 等待第一个响应。超时以毫秒为单位，默认 10 分钟。应答者的回调抛出错误时，请求得不到响应，请求方最终超时；除非订阅设置了 `errorResponse`。
- 连接断开后会在后台重新连接（`reconnect`；`maxReconnectAttempts` 默认每个服务器 10 次，`-1` 表示一直重试）。在此期间发送的请求会在超时后失败。客户端放弃重连之后，所有调用都以 NATS 客户端错误 `CONNECTION_CLOSED` 失败。
- 应用停止时，组件会排空它的连接：在连接关闭之前，正在处理的消息处理完，待发送的消息发送出去。

连接选项有 `servers`、`codec`、`timeout`、`token`、`user`、`pass`、`debug`、`maxPingOut`、`maxReconnectAttempts`、`name`、`noEcho`、`noRandomize`、`pingInterval` 和 `reconnect`，以及大数据传输的选项 `bulk`、`bulkBucket`、`bulkTTL` 和 `bulkReplicas`（见[大数据传输](#大数据传输)）。

### 编码方式

所有数据都用组件的 `codec` 编码，同一个主题的两端必须相同：

- `messagePackCodec()`（默认）：MessagePack，紧凑而且快；
- `jsonCodec()`：JSON 文本，可以直接阅读，也方便其他语言写的客户端处理。

两者都把值放进只有一个元素的数组（`[value]`）发送，并且先把值转成 JSON，让其他语言的客户端收到的都是普通的 JSON 数据：`Date` 变成 ISO 字符串，`Buffer` 变成 `{type: 'Buffer', data: [...]}`，类的实例变成普通对象，`undefined` 变成 `null`；`bigint` 无法编码。任何带有 `encode(value): Uint8Array` 和 `decode(bytes)` 的对象都可以作为编码方式，比如用于字符串数据的 `StringCodec()`（从 `nats` 重新导出）。

```typescript
import {Application} from 'lakutata'
import {buildNatsClientOptions, jsonCodec} from '@lakutata/nats'

Application.run({
    id: 'json.app',
    name: 'JSON',
    components: {
        nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222', codec: jsonCodec()})
    }
})
```

### 通过 NATS 提供服务动作

`natsServiceEntrypoint` 通过 NATS 提供 `Entrypoint` 组件的服务通道：发给应用 id 的请求会分派给控制器的 `@ServiceAction` 方法，并以封套 `{success, error, payload}` 响应。

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {buildNatsClientOptions, natsServiceEntrypoint, type NATS} from '@lakutata/nats'

class GetOrderDTO extends DTO {
    @Expect(DTO.Number().integer().required())
    public id!: number
}

class OrderController extends Controller {
    @ServiceAction({cmd: 'order.get'}, GetOrderDTO)
    public async get(input: GetOrderDTO): Promise<{ id: number, total: number }> {
        return {id: input.id, total: 42}
    }
}

Application
    .run({
        //请求的主题，也是调用这个服务的代理所用的 serviceId
        id: 'order.service',
        name: 'OrderService',
        components: {
            nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222'}),
            entrypoint: buildEntrypoints({
                controllers: [OrderController],
                //主题为 "order.service"（应用 id），队列组为 "order.service.serviceQueue"
                service: natsServiceEntrypoint('nats')
            })
        },
        bootstrap: ['entrypoint']
    })
    .onLaunched(async (app: Application): Promise<void> => {
        //服务事件：这个服务的代理如果监听了 "orderPaid"，就会收到它
        const nats: NATS = await app.getObject('nats')
        nats.emitServiceEvent('orderPaid', 1, 42)
    })
```

- 主题是应用 id，`subject` 选项可以换成别的主题；代理把这个主题作为自己的 `serviceId`。`NATS.emitServiceEvent()` 的事件始终使用应用 id。
- 服务的所有实例加入同一个队列组（默认为 `{subject}.serviceQueue`），所以每个请求只由一个实例处理。
- 动作失败时（没有匹配的动作、输入不合法、访问被拒绝、抛出异常），响应中带有错误的各个属性。无法解码的请求也会得到错误响应，所以请求方不会一直等到超时。
- `Entrypoint.broadcast()` 在入口的主题下把事件发布给服务代理，并返回 0，因为 NATS 不会告诉发送方有多少客户端收到了事件；`NATS.emitServiceEvent()` 则在应用 id 下发布。`Entrypoint.notify()` 到达不了 NATS 客户端，因为 NATS 没有客户端 id。
- 入口停止时，它的订阅会被排空：不再接收新请求（调用方会重试，见下文），正在处理的请求会得到响应。
- 它在 2.x 中叫 `SetupNatsServiceEntrypoint`。与 3.0 中的所有函数一样，它改了名字，没有保留别名，所以为 2.x 编写的应用必须修改调用处的名字；`BuildServiceProxy`（现在是 `buildServiceProxy`）、`JSONCodec`（`jsonCodec`）和 `MessagePackCodec`（`messagePackCodec`）也是如此。

### 调用服务：服务代理

`ServiceProxy` 用来调用某个远端服务的动作，并监听它的事件。它是所有请求共用的单例提供者：每个服务用 `buildServiceProxy` 在应用的 `providers` 中声明一个，与 2.x 相同。

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
    .run({
        id: 'billing.app',
        name: 'Billing',
        components: {
            nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222'})
        },
        providers: {
            orderService: buildServiceProxy({natsComponentName: 'nats', serviceId: 'order.service'})
        }
    })
    .onLaunched(async (app: Application): Promise<void> => {
        const orderService: ServiceProxy = await app.getObject('orderService')
        orderService.on('orderPaid', (id: number, total: number): void => console.log(`Order ${id} paid: ${total}`))
        try {
            //动作的模式和输入放在同一个对象里，最多等待 30 秒
            console.log(await orderService.invoke({cmd: 'order.get', id: 1}, 30000))
        } catch (error) {
            if (error instanceof ServiceInvokeException) console.error(error.service, error.errno, error.message)
            else if (error instanceof NatsRequestTimeoutException) console.error('No response in time')
            else throw error
        }
    })
```

- `invoke(input, timeout)` 返回动作的结果。timeout 默认 10 分钟：服务没有运行时调用会立即失败，所以 timeout 只用来限制太慢的动作。
- 如果服务没有任何实例收到请求（`NatsNoRespondersAvailableException`：服务没有运行，或者正在重启），代理会重新发送，最多 `maxRetries` 次（默认 3 次），每次间隔 `retryDelay` 毫秒（默认 100）；之后抛出这个异常。超时和服务端的失败从不重试，因为动作可能已经执行过了：这样，非幂等的动作就不会执行两次。
- 动作失败时，代理抛出 `ServiceInvokeException`。它的消息就是远端错误的消息，`errno`、`statusCode` 和其他属性都从远端错误复制而来，`service` 是服务 id。
- 服务用 `NATS.emitServiceEvent()` 发出事件，`on(event, listener)`、`once(event, listener)` 和 `off(event, listener?)` 用来添加和移除这些事件的监听器。用 `on(event, listener, true)` 注册时，在所有应用中这样注册的监听器里，每个事件只发给其中一个（队列组）。事件最多送达一次：发送时没有连接的应用会错过它。代理被销毁时，通过它注册的监听器也会被移除。

### 大数据传输

一条 NATS 消息的大小不能超过服务器的 `max_payload`（默认 1 MiB）。达到 `max_payload` 90% 的请求和响应，组件会通过 JetStream 的对象存储转发，并且使用第二条连接，这样大数据的传输就不会拖慢小消息：发送方存入编码后的数据，只发送一个很小的引用；接收方读取对象后把它删除。回调、动作和 `invoke()` 拿到的始终是完整的值。

- 这个大数据通道默认开启（`bulk: true`），需要 JetStream。通道无法启动时（没有 JetStream，或者服务器拒绝了这个对象存储），组件会打印一条警告，然后不带它启动。
- 互相传输大数据的应用必须使用同一个对象存储：给它们设置相同的 `bulkBucket`。默认的对象存储取决于 `name` 选项（`lkt-bulk-{name}`，没有 name 时是 `lkt-bulk-default`），所以 name 不同的两个应用读不到对方的对象（`NatsBulkException`）。
- 一直没有被读取的对象（请求方已经离开，或者响应丢失）会在 `bulkTTL`（默认 5 分钟）后过期；`bulkReplicas` 设置对象存储在集群中的副本数。这两项在创建对象存储时生效。
- 只有请求方声明了大数据通道（它的请求带有这个声明），大的响应才会转发。只有应答者支持时，大的请求才会转发。组件从同一主题上之前的响应得知应答者是否支持；不知道时，就向这个主题发送一次探测（`_LKT.BULK.<subject>`）：有大数据通道的应答者会回答，旧版本则会忽略。后一种情况下，请求作为普通消息发送，超过 `max_payload` 就会失败。
- 没有大数据通道的应用（`bulk: false`，或者更早的版本）仍然可以和其他应用一起工作：它们直接收到数据，超过 `max_payload` 的数据会失败。
- 发布的消息和服务事件从不经过对象存储：超过 `max_payload` 时，`publish()` 和 `emitServiceEvent()` 抛出 NATS 客户端错误 `MAX_PAYLOAD_EXCEEDED`。

```typescript
import {Application} from 'lakutata'
import {buildNatsClientOptions} from '@lakutata/nats'

Application.run({
    id: 'report.service',
    name: 'ReportService',
    components: {
        nats: buildNatsClientOptions({
            servers: 'nats://127.0.0.1:4222',
            //所有互相传输大数据的应用使用同一个对象存储
            bulkBucket: 'lkt-bulk-shared',
            bulkTTL: 10 * 60 * 1000,
            bulkReplicas: 3
        })
    }
})
```

`NATS.bulkEnabled`、`bulkThreshold`、`bulkStatus()` 和 `headersSupported` 反映大数据通道的状态；`putBulk()`、`getBulk()` 和 `deleteBulk()` 直接访问它的对象存储。设计见 `docs/large-payload-design.md`。

## API

| 导出 | 说明 |
|---|---|
| `NATS` | 组件：`publish`、`request`、`subscribe`、`emitServiceEvent`、`onServiceEvent`、`onceServiceEvent`、`offServiceEvent`，大数据通道（`bulkEnabled`、`bulkThreshold`、`headersSupported`、`putBulk`、`getBulk`、`deleteBulk`、`bulkStatus`）；`error` 事件 |
| `buildNatsClientOptions` | 构建 `NATS` 组件的选项 |
| `NatsClientOptions` | 它的选项：连接、编码方式和大数据通道 |
| `SubscribeOptions` | `subscribe()` 的选项：`queue`、`max`、`iterator`、`errorResponse` |
| `messagePackCodec`、`jsonCodec` | 数据的编码方式 |
| `StringCodec`、`Codec`、`Subscription`、`RetentionPolicy` | 从 `nats` 重新导出 |
| `natsServiceEntrypoint` | 入口的 NATS 服务适配器 |
| `NatsServiceEntrypointOptions` | 它的选项：`subject`、`queue`、`name`、`middlewares` |
| `ServiceProxy` | 单例提供者，调用远端服务的动作并监听它的事件 |
| `buildServiceProxy` | 构建 `ServiceProxy` 的提供者选项 |
| `BuildServiceProxyOptions` | 它的选项：`natsComponentName`、`serviceId`、`maxRetries`、`retryDelay` |
| `ServiceInvokeException` 和各个 `Nats*Exception` 类 | 见[错误](#错误) |

类型声明中的每一项都附有说明和示例。

## 错误

| 异常 | 什么时候抛出 |
|---|---|
| `ServiceInvokeException`（`E_SERVICE_INVOKE`，或远端错误的 `errno`） | `ServiceProxy.invoke()`：远端动作失败；它带有远端错误的属性和服务 id `service`。从 `@lakutata/entrypoint` 重新导出 |
| `NatsNoRespondersAvailableException`（`E_NATS_NO_RESPONDERS_AVAILABLE`，503） | `request()`：没有人监听这个主题；`invoke()`：重试之后仍然如此 |
| `NatsRequestTimeoutException`（`E_NATS_REQUEST_TIMEOUT`，408） | `request()`、`invoke()`：超时前没有收到响应 |
| `NatsBulkException`（`E_NATS_BULK`，502） | 大数据通道失败：通道已禁用，对象存储拒绝了写入或读取，或者对象已过期、在另一个对象存储中。在服务端发生时，请求方收到 `errno` 为 `E_NATS_BULK` 的 `ServiceInvokeException` |
| `NatsBadRequestException`（400）、`NatsForbiddenException`（403）、`NatsNotFoundException`（404）、`NatsInternalServerException`（500） | `request()`：带有对应错误码的 NATS 客户端错误；核心 NATS 的请求不会产生它们 |
| `InvalidObjectOptionsException`（来自 `lakutata`） | 组件的某个选项值不合法；应用启动失败 |
| `InvalidValueException`（来自 `lakutata`） | 创建组件时没有给出 `servers` |

其他失败都是 NATS 客户端的错误（`NatsError`，带有 `code`）：数据超过 `max_payload` 又没有经过对象存储转发时为 `MAX_PAYLOAD_EXCEEDED`，连接关闭之后为 `CONNECTION_CLOSED`，启动时连不上任何服务器则为 `CONNECTION_REFUSED` 或连接超时。编码方式的错误（`bigint`、带循环引用的值）原样抛出。

## 另见

- `lakutata` 包中的 `doc/zh/NATS.md`：NATS 指南。
- `@lakutata/entrypoint`（`lakutata/com/entrypoint`、`lakutata/decorator/ctrl`）：控制器、`@ServiceAction` 和其他传输方式；模式见 `lakutata` 包中 `doc/zh/ServiceCalls.md` 的第 2 节。
- `@lakutata/grpc/service`：同样的服务通道和代理，基于 gRPC。
- `docs/large-payload-design.md`：大数据传输的设计。
