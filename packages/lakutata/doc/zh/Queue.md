# Lakutata 消息队列

**Queue 组件**（`lakutata/com/queue`，`@lakutata/queue` 包）把消息加入队列，用 `@QueueAction` 声明的控制器动作通过 `queueEntrypoint` 适配器处理这些消息，和其他传输方式一样使用输入 DTO、访问控制和中间件。动作正常返回时消息被确认；失败后重新投递，次数用完后进入死信队列；动作的返回值就是这条消息的结果。队列可以放在内存、Redis、NATS JetStream、RabbitMQ 或 Kafka 中，换驱动不需要改动作的代码。更多细节见 `@lakutata/queue` 的 README。

## 1. 配置

用 `buildQueueOptions` 在应用的 `components` 中声明 `Queue`（按惯例命名为 `queue`），把队列的适配器交给 entrypoint，并让 entrypoint 在启动时创建（`bootstrap: ['entrypoint']`；否则它要到第一次被使用时才创建，动作不会开始消费）。不指定 `driver` 时，消息保存在进程的内存中。

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {buildQueueOptions, queueEntrypoint} from 'lakutata/com/queue'

Application.run(() => ({
    id: 'image.app',
    name: 'Images',
    components: {
        queue: buildQueueOptions({
            driver: {type: 'redis', url: 'redis://127.0.0.1:6379'},
            //消费者的默认设置
            defaults: {attempts: 5, backoff: {type: 'exponential', delay: '1s', max: '1m'}, concurrency: 4},
            //为 result() 和 request() 保存的结果
            results: {keep: '1d'}
        }),
        entrypoint: buildEntrypoints({
            controllers: [],
            //把消息投递给 @QueueAction 动作
            queue: queueEntrypoint('queue')
        })
    },
    //在启动时创建：动作从此开始消费
    bootstrap: ['entrypoint']
}))
```

| 驱动 | 需要安装 | 服务端 | 说明 |
|---|---|---|---|
| `{type: 'memory'}`（默认） | | | 只在当前进程内有效：进程退出后消息丢失；用于开发、测试、桌面应用 |
| `{type: 'redis', url}` | `bullmq`、`ioredis` | Redis 5.0 起（建议 6.2 起） | 基于 BullMQ：支持优先级、延迟、去重；请使用 `maxmemory-policy noeviction` |
| `{type: 'nats', servers}` | `nats` | NATS 2.9.4 起，需开启 JetStream（`-js`） | stream 保留消息 `maxAge`（7 天）；2 分钟内去重；不支持优先级 |
| `{type: 'rabbitmq', url}` | `amqplib` | RabbitMQ 3.6 起 | 优先级 0–10，支持延迟；需要 `results.store` |
| `{type: 'kafka', brokers}` | `@platformatic/kafka`（Node.js 22.22 / 24.6 起） | Kafka 3.5 起 | 按键保序，`partitions`（默认 1）；需要 `results.store` |
| `{type: 'custom', driver}` | | | 应用自己实现的 `QueueDriver` |

客户端都是可选的 peer 依赖，在组件启动时才加载：缺少客户端包时启动失败并抛出 `QueueDriverNotFoundException`，服务端版本太旧时抛出 `QueueDriverVersionException`，连不上服务端时抛出连接错误。启动之后，驱动会自动重连。使用服务端的驱动还接受 `prefix`（默认 `lakutata`），作为它们在服务端创建的名称的前缀，用来隔开共用同一个服务端的应用。

组件的其他选项：

- `defaults`：消费者的默认设置：`attempts`（3）、`backoff`（指数退避，从 1 秒到 1 分钟）、`concurrency`（1）、`timeout`（不限）、`group`（应用的 `appId`）。
- `results`：`keep` 是结果保留多久（默认 1 天），`store` 是代替驱动保存结果的 `Cacher` 组件的名称。RabbitMQ 和 Kafka 自身不保存结果，需要指定一个各应用共用的存储（例如 Redis）。`false` 表示不保存结果。
- `codec`：`'messagepack'`（默认，和 `@lakutata/nats` 相同）、`'json'`（方便其他语言的服务对接）或自定义的 `QueueCodec`。
- `requestTimeout`：`request()` 和 `result()` 的等待时间（30 秒）。

```typescript
import {Application} from 'lakutata'
import {buildCacherOptions} from 'lakutata/com/cacher'
import {buildQueueOptions} from 'lakutata/com/queue'

Application.run(() => ({
    id: 'billing.app',
    name: 'Billing',
    components: {
        //各应用共用的结果（对 RabbitMQ 来说还有各队列的组）
        cache: buildCacherOptions({stores: [{type: 'redis', host: '127.0.0.1'}]}),
        queue: buildQueueOptions({
            driver: {type: 'rabbitmq', url: 'amqp://guest:guest@127.0.0.1:5672', prefix: 'billing'},
            results: {keep: '2h', store: 'cache'}
        })
    }
}))
```

## 2. 消费者：`@QueueAction`

```text
@QueueAction(queue, dto?, options?)
```

被装饰的方法处理一个队列的消息：输入就是消息，经过 DTO 校验；`this.context` 是 `QueueContext`。方法的返回值就是这条消息的结果。同一个方法还可以同时带有其他传输方式的装饰器（HTTP 路由、服务动作等）。选项包括所有动作通用的选项（`name`、`acl`、`rule`、`middlewares` 等），以及：

- `group`：消费这个队列的组（默认是队列的 `defaults.group`，否则是应用的 `appId`）；
- `concurrency`：一个实例同时处理的消息数；
- `attempts`、`backoff`：消息进入死信队列之前的投递次数，以及两次投递之间的等待；
- `timeout`：处理的时间上限（到时中止，然后重试）；
- `ordered`：同一个 `key` 的消息按顺序逐条处理（内存和 Kafka 驱动）；
- `output`：把返回值作为一条新消息发到这个队列（返回值须为对象；返回 `undefined` 时不发送）。

```typescript
import {DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {Expect} from 'lakutata/decorator/dto'
import {QueueAction, type QueueContext, type QueueDeadLetter} from 'lakutata/com/queue'

class ExtractInput extends DTO {
    @Expect(DTO.Number().integer().required())
    public id: number
}

class ImageController extends Controller {
    //同时处理 4 条，最多 5 次尝试，每次最长 10 分钟，结果发往 image.index
    @QueueAction('image.extract', ExtractInput, {concurrency: 4, attempts: 5, timeout: '10m', output: 'image.index'})
    public async extract(input: ExtractInput): Promise<{id: number, pages: number}> {
        const context: QueueContext = this.context as QueueContext
        console.log(`消息 ${context.jobId} 的第 ${context.attempt} 次尝试，共 ${context.attempts} 次`)
        //到达处理时限时被中止：this.signal
        this.signal?.throwIfAborted()
        return {id: input.id, pages: 12}
    }

    @QueueAction('image.index')
    public async index(input: {id: number, pages: number}): Promise<void> {
        console.log(`图片 ${input.id}：${input.pages} 页`)
    }

    //尝试次数用完的消息
    @QueueAction('image.extract.dead')
    public async failed(input: QueueDeadLetter): Promise<void> {
        console.error(input.jobId, input.attempts, input.error.message)
    }
}
```

上下文中包含 `queue`、`jobId`、`group`、`attempt`（首次投递为 1）、允许的 `attempts`、应用的 `headers` 和 `publishedAt`；它的 `type` 是 `'QUEUE'`，供多种传输方式共用的中间件和访问规则区分。

`queueEntrypoint(componentName, {name, middlewares, onError})` 在应用启动时检查各动作的选项并登记它们的组，应用启动完成后开始消费。每次处理失败（无论是否重试）都会调用 `onError(error, action, context)`；默认把失败写入应用的日志。

不使用控制器时，可以用 `queue.consume(name, processor, options)` 以函数 `(input, context, signal) => result` 处理队列，它返回一个可以 `stop()` 的订阅：

```typescript
import type {Queue, QueueJobContext} from 'lakutata/com/queue'

declare const queue: Queue
const subscription = await queue.consume('mail.send', async (input: Record<string, any>, context: QueueJobContext, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted()
    console.log(`发邮件给 ${input.to}（${context.jobId}）`)
}, {group: 'mailer', concurrency: 2})
await subscription.stop()
```

## 3. 生产者：`add`、`request`、`result`

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Job, type Queue, QueueJobFailedException} from 'lakutata/com/queue'

class Images extends Component {
    @Inject('queue')
    protected readonly queue: Queue

    public async work(): Promise<void> {
        //发出即不管：10 秒后投递；同一编号的消息还在等待时丢弃（dedupe）
        await this.queue.add('image.extract', {id: 7}, {jobId: 'image-7', dedupe: true, delay: '10s'})

        //发出并等待结果：动作的返回值，或最后一次的错误
        try {
            const result: {pages: number} = await this.queue.request('image.extract', {id: 8}, {timeout: '30s'})
            console.log(result.pages)
        } catch (error) {
            if (error instanceof QueueJobFailedException) console.error(error.error.message, error.attempts)
        }

        //现在发出，之后凭编号读取结果（任何实例都可以读），只要结果还保留着
        const job: Job = await this.queue.add('image.extract', {id: 9}, {priority: 5, headers: {origin: 'upload'}})
        console.log(await job.result({timeout: '1m'}))
        console.log(await this.queue.result('image.extract', job.id, {wait: false}))
    }
}
```

消息的选项：`jobId`（默认随机 UUID）、`dedupe`、`delay`、`priority`（越大越先）、`key`（保序的键）、`attempts` 和 `backoff`（代替消费者的设置）、`headers`（前缀 `x-lkt-` 保留给框架）。驱动不支持的选项会抛出 `QueueCapabilityException`；`queue.capabilities` 给出驱动支持的能力。

`request()` 以动作的返回值完成；消息失败时以 `QueueJobFailedException` 拒绝；超时（`QueueRequestTimeoutException`）时消息仍留在队列中，之后还能读取它的结果。`result()` 和 `job.result()` 会等到消息处理完（`wait: false` 只读取当前已保存的结果）；没有在时间内处理完时抛出 `QueueResultNotFoundException`，结果已不再保留时抛出 `QueueResultExpiredException`。有多个组消费同一个队列时，`request()` 和 `result()` 要用 `group` 指明要哪个组的结果（否则抛出 `QueueAmbiguousGroupException`）。

## 4. 投递

- **至少一次。** 动作正常返回时消息被确认。抛出错误时，等待 `backoff` 后重新投递，最多 `attempts` 次，之后作为 `QueueDeadLetter`（`{queue, jobId, group, input, error, attempts, failedAt}`）进入 `<队列名>.dead`，它和普通队列一样。一条消息可能被处理两次（进程崩溃、停机），动作应当是幂等的。
- **重试解决不了的不重试。** 输入不合法（`InvalidValueException`）、没有访问权限、动作不存在、返回值校验失败（`@Return`）、消息或结果无法编码：消息直接进入死信队列。动作抛出 `QueueDiscardException` 时丢弃这条消息：确认它，不进死信，也不保存结果。
- **处理时限。** 处理超过 `timeout` 时以 `QueueProcessingTimeoutException` 失败并重试：它的 signal 被中止，之后的返回值被丢弃。投递有租约的驱动（NATS）会在处理期间自动续租。
- **停机。** 应用停止时，消费者停止取新消息，正在处理的消息有 entrypoint 的 `shutdownTimeout` 时间完成；届时仍未完成的消息以后重新投递，既不确认也不进死信。
- **组。** 同一个组的多个实例分摊消息；不同的组各收一份。动作的组默认是所在应用的 `appId`：两个应用消费同一个队列时会各收一份，除非它们指定相同的 `group`。组在登记之后才开始接收消息（应用启动时登记其动作的组，`consume()` 和 `queue.prepare(name, {group})` 也会登记）：使用服务端的驱动时，队列在任何组登记之前收到的消息不会被投递；内存驱动则把这些消息留给第一个登记的组，所以使用内存驱动的应用要消费它的死信队列（`<queue>.dead`），否则死信会一直留在内存中。组登记后一直保存在服务端，所以即使组的所有实例都没有运行，发给它的消息也会保留。
- **消息内容。** 消息是一个对象，也就是动作的输入。使用默认编解码时，`Date` 会变成 ISO 字符串（输入 DTO 可以把它转回 `Date`；返回值仍是字符串），`bigint` 会被拒绝。

## 5. 各驱动的比较

| | 内存 | Redis | NATS JetStream | RabbitMQ | Kafka |
|---|---|---|---|---|---|
| 延迟 | ✓ | ✓ | ✓ | ✓（延迟队列） | — |
| 优先级 | ✓ | ✓ | — | ✓（0–10） | — |
| 去重 | 消息保留期间 | 消息保留期间 | 2 分钟内 | — | — |
| 按 `key` 保序 | ✓ | — | — | — | ✓（分区） |
| 结果 | ✓ | ✓ | ✓ | `results.store` | `results.store` |
| `request()` | 回复通道 | 回复通道 | 回复通道 | 回复通道 | 读取结果 |
| 重试 | 延迟重投 | 延迟重投 | 延迟重投 | 经延迟队列发送副本 | 原地等待，占住分区 |
| 停机时放弃计为一次尝试 | 否 | 是 | 是 | 否 | 否 |
| 重启后消息仍在 | 否 | 是 | 是 | 是 | 是 |

在 Kafka 上，同一个分区的消息按顺序逐条处理：`concurrency` 表示一个实例同时处理几个分区；一条消息的尝试次数由正在处理它的实例计数。RabbitMQ 无法列出一个队列有哪些组：组件把它们记在 `results.store` 中，各应用必须共用这个存储，`request()` 和 `result()` 才能在不指定组时找到组。

## 6. 异常

| 异常 | 什么时候 |
|---|---|
| `QueueInvalidMessageException`（400） | 消息不是对象、队列名为空、消息头使用了 `x-lkt-`、值无法编码 |
| `QueueCapabilityException` | 驱动不支持的选项（`priority`、`dedupe`、`delay`、`ordered`），没有保存结果 |
| `QueueRequestTimeoutException`（504） | `request()` 没有在时间内得到结果 |
| `QueueResultNotFoundException`（404） | `result()` 时消息还没处理完，或编号不存在 |
| `QueueResultExpiredException`（410） | `result()` 时结果已不再保留 |
| `QueueAmbiguousGroupException`（400） | 有多个组消费队列时，`request()` 或 `result()` 没有指定 `group` |
| `QueueJobFailedException` | `request()` 或 `result()` 的消息处理失败（带有它的 `error` 和 `attempts`） |
| `QueueProcessingTimeoutException`（504） | 处理超过 `timeout` 而失败（会重试） |
| `QueueDiscardException` | 由动作抛出，表示丢弃这条消息 |
| `QueueDriverNotFoundException` | 驱动的客户端包没有安装 |
| `QueueDriverVersionException` | 服务端版本低于驱动支持的最低版本 |
