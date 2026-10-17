# @lakutata/queue

[English](README.md) | 中文

[lakutata](https://www.npmjs.com/package/lakutata) 框架的消息队列。`Queue` 组件把消息加入队列，用 `@QueueAction` 声明的控制器动作通过 `queueEntrypoint` 适配器处理这些消息，和其他传输方式一样使用输入 DTO、访问控制和中间件。动作正常返回时消息被确认，失败后重新投递；尝试次数用完后，消息进入死信队列 `<queue>.dead`。动作的返回值就是这条消息的结果（`queue.request()`、`queue.result()`），还可以接着发往另一个队列（`output`）。`lakutata` 包通过 `lakutata/com/queue` 提供这个包。

## 安装

```shell
npm install @lakutata/queue
```

内存驱动（默认）不需要其他包：它把消息保存在进程的内存中。其他驱动在组件启动时加载各自的客户端库：

| 驱动 | `driver` 选项 | 安装 | 服务端 |
|---|---|---|---|
| 内存 | `{type: 'memory'}`（默认） | — | — |
| Redis | `{type: 'redis', url}` | `npm install bullmq ioredis` | Redis 5.0 起（建议 6.2 起） |
| NATS JetStream | `{type: 'nats', servers}` | `npm install nats` | NATS 2.9.4 起，需开启 JetStream（`-js`） |
| RabbitMQ | `{type: 'rabbitmq', url}` 和 `results: {store}` | `npm install amqplib` | RabbitMQ 3.6 起 |
| Kafka | `{type: 'kafka', brokers}` 和 `results: {store}` | `npm install @platformatic/kafka`（Node.js 22.22 或 24.6 起） | Kafka 3.5 起 |

## 用法

注册组件和适配器，并把入口列入 `bootstrap`，让它在应用启动时创建（否则它要到第一次被使用时才创建，动作不会开始消费）。然后声明动作：

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {buildQueueOptions, QueueAction, queueEntrypoint} from '@lakutata/queue'

class ImageController extends Controller {
    //同时处理 4 条，最多 5 次尝试，每次最长 10 分钟，结果发往 image.index
    @QueueAction('image.extract', {concurrency: 4, attempts: 5, timeout: '10m', output: 'image.index'})
    public async extract(input: {id: number}): Promise<{id: number, pages: number}> {
        return {id: input.id, pages: 12}
    }

    @QueueAction('image.index')
    public async index(input: {id: number, pages: number}): Promise<void> {
        console.log(`image ${input.id}: ${input.pages} pages`)
    }

    //尝试次数用完的消息
    @QueueAction('image.extract.dead')
    public async failed(input: {jobId: string, error: {message: string}}): Promise<void> {
        console.error(input.jobId, input.error.message)
    }
}

Application.run(() => ({
    id: 'images.app',
    name: 'Images',
    components: {
        queue: buildQueueOptions({defaults: {attempts: 3}, results: {keep: '1d'}}),
        entrypoint: buildEntrypoints({
            controllers: [ImageController],
            queue: queueEntrypoint('queue')
        })
    },
    //在启动时创建：动作从此开始消费
    bootstrap: ['entrypoint']
}))
```

添加消息并读取结果：

```typescript
import type {Job, Queue} from '@lakutata/queue'

declare const queue: Queue
//发出即不管：10 秒后投递；编号为 image-7 的消息还保留着时，这条消息会被丢弃（dedupe）
await queue.add('image.extract', {id: 7}, {jobId: 'image-7', dedupe: true, delay: '10s'})
//添加并等待结果
const result: {pages: number} = await queue.request('image.extract', {id: 8}, {timeout: '30s'})
console.log(result.pages)
//现在添加，之后凭编号读取结果（任何实例都可以读），只要结果还保留着
const job: Job = await queue.add('image.extract', {id: 9})
console.log(await queue.result('image.extract', job.id, {timeout: '1m'}))
```

语义：

- **至少一次。** 动作正常返回时消息被确认。出错后，等待 `backoff`（默认为指数退避，从 1 秒到 1 分钟）后重新投递，最多 `attempts` 次（默认 3 次），之后进入 `<queue>.dead`（`{queue, jobId, group, input, error, attempts, failedAt}`）。重试解决不了的错误会让消息直接进入死信队列：输入不合法（`InvalidValueException`）、没有访问权限、动作不存在、返回值不合法（`@Return`）。动作抛出 `QueueDiscardException` 时，丢弃这条消息。动作应当是幂等的。
- **组。** 同一个组的各个实例分摊这个组的消息，每个组都会收到每一条消息。动作的组默认是所在应用的 `appId`：两个应用消费同一个队列时，各自都会收到全部消息，除非它们指定相同的 `group`。有多个组消费同一个队列时，`request()` 和 `result()` 必须指明组。
- **停机。** 应用停止时，消费者停止消费，正在处理的消息有一段时间可以完成（入口的 `shutdownTimeout`）。届时仍未完成的消息以后会重新投递，既不确认，也不进死信队列。组件被销毁时，`consume()` 仍在处理的消息会被中止（通过它们的 signal），之后同样会重新投递。
- **处理时限。** 处理超过 `timeout` 时以 `QueueProcessingTimeoutException` 失败并重试：它的 signal 被中止，之后的返回值被丢弃。
- **消息。** 消息是一个对象（动作的输入）。默认的编解码与 `@lakutata/nats` 相同：先用 JSON 规范化值，再编码为 MessagePack，所以 `Date` 到达时是它的 ISO 字符串（输入 DTO 可以把它转回来；返回值仍是字符串）。设置 `codec: 'json'` 后，改用 JSON 与其他语言编写的服务交换消息。
- **登记组。** 组只接收它登记之后添加的消息。应用的动作在应用启动过程中（启动完成之前）登记各自的组；`consume()` 和 `prepare()` 也会登记它们的组。使用服务端的驱动时，在任何组登记之前加入队列的消息不会被投递。组登记后一直保存在服务端，所以即使组的所有实例都没有运行，发给它的消息也会保留。

## 驱动

- **内存**驱动把消息保存在进程中：进程退出时消息丢失，应用的各个实例之间也不共享。队列还没有任何组时加入的消息，会留给第一个组，并且只留给它：如果第二个组后来才开始消费某个死信队列，它只会收到之后的死信。应用停止时放弃的投递不计为一次尝试。
- **Redis**（BullMQ）：每个队列的每个组对应一个 BullMQ 队列，位于键前缀 `prefix`（默认 `lakutata`）之下，任务处理完后即被删除。结果保存为键，在 `results.keep` 之后过期；`request()` 的回复通过 Redis 频道传递。支持延迟、优先级和去重（在同一编号的消息等待或处理期间），但不支持按键保序。应用停止时放弃的投递计为一次尝试。Redis 6.0 之前，延迟和重试最多可能晚一秒。请把服务器配置为 `maxmemory-policy noeviction`。
- **NATS JetStream**：每个队列是 `prefix`（默认 `lakutata`）下的一个 stream，消息保留 `maxAge`（默认 7 天），无论是否已处理。每个组是一个持久消费者，在组登记时创建。结果保存在一个键值桶中，`request()` 的回复发到实例的 inbox。一次投递在 `ackWait`（默认 30 秒）内没有结束时会被重新投递；消息处理期间，队列每过三分之一的 `ackWait` 就延长一次投递。消费者一直使用创建时的 `ackWait`。编号相同的重复消息在第一条之后的 2 分钟内会被丢弃，无论第一条是否已处理；不支持优先级和按键保序。在 NATS 2.12 及以上版本中，延迟使用定时消息；在较旧的服务端上，消息在到期之前会被不断退回，晚于预定时间投递的延迟消息可能比 `attempts` 多尝试一次。应用停止时放弃的投递计为一次尝试。
- **RabbitMQ**：队列的每个组是 `prefix`（默认 `lakutata`）下的一个持久队列，绑定到一个 direct 交换机。延迟消息先在延迟队列中等待，直到延迟时间结束；重试时把消息的副本发给该组，消息头中带有尝试次数；`request()` 的回复使用 RabbitMQ 的 direct reply-to。RabbitMQ 不保存结果，也无法列出一个队列有哪些组，所以要给队列一个各应用共用的存储（`results: {store: 'cache'}`，即一个 `Cacher` 组件，例如使用 Redis 存储）来保存结果和组。优先级范围为 0 到 10；不丢弃重复的消息，也不支持按键保序。应用停止时放弃的投递不计为一次尝试。驱动会自动重连并恢复消费。从 3.8.15 起，一次投递没有在 `consumer_timeout`（默认 30 分钟）内结束时，RabbitMQ 会关闭信道，信道中的消息会被重新投递。
- **Kafka**：每个队列是 `prefix`（默认 `lakutata`）下的一个 topic，创建时使用 `partitions`（默认 1）和 `replicas`。队列的每个组是一个消费者组，组登记时，它的偏移量被设到 topic 的末尾。同一个分区的消息按顺序逐条处理：`concurrency` 表示一个实例同时处理几个分区，`key` 相同的消息在同一个分区中（按键保序）。失败的消息在退避之后原地重试，期间占住它的分区。消息的尝试次数由正在处理它的实例计数，所以在重平衡或重启之后被重新投递给另一个实例的消息，会重新开始计算尝试次数。消息确认之后即提交；如果被放弃，会从它的分区重新拉取。Kafka 不保存结果，也没有回复通道：要给队列一个存储（`results: {store: 'cache'}`），`request()` 从中读取结果。不支持延迟、优先级和去重。消费者第一次加入一个组时，要等待 broker 的 `group.initial.rebalance.delay.ms`（默认 3 秒）；处理消息期间，客户端会持续发送心跳。没有成员的消费者组在偏移量过期后（`offsets.retention.minutes`，默认 7 天）会被 Kafka 删除。

## API

| 导出 | 说明 |
|---|---|
| `Queue` | 组件：`add()`、`request()`、`result()`、`consume()`、`prepare()`、`capabilities` |
| `buildQueueOptions` | 组件的选项：`driver`、`defaults`、`results`、`codec`、`requestTimeout` |
| `Job` | 已添加的消息：它的 `id` 和 `result()` |
| `QueueAction` | 处理队列的动作所用的装饰器 |
| `queueEntrypoint` | 把消息投递给动作的适配器 |
| `QueueContext`、`QUEUE_CONTEXT_TYPE` | 一次投递的上下文（`'QUEUE'`） |
| `QueueChannel` | 队列传输方式 |
| `QueueDriver`、`MemoryQueueDriver`、`RedisQueueDriver`、`NatsQueueDriver`、`RabbitMQQueueDriver`、`KafkaQueueDriver` | 各个驱动，以及自定义驱动的基类 |
| `MemoryQueueOptions`、`RedisQueueOptions`、`NatsQueueOptions`、`RabbitMQQueueOptions`、`KafkaQueueOptions`、`CustomQueueOptions` | 各个驱动的选项 |
| `messagePackQueueCodec`、`jsonQueueCodec`、`QueueCodec` | 编解码器 |

## 错误

| 异常 | 什么时候 |
|---|---|
| `QueueInvalidMessageException` | 消息不是对象、队列名为空、消息头使用了 `x-lkt-` |
| `QueueCapabilityException` | 驱动不支持的选项（`priority`、`dedupe`、`delay`、`ordered`），没有保存结果 |
| `QueueRequestTimeoutException` | `request()` 没有及时得到回复 |
| `QueueResultNotFoundException` | 消息还没处理完时调用 `result()`（或编号不存在） |
| `QueueResultExpiredException` | 结果已不再保留时调用 `result()` |
| `QueueAmbiguousGroupException` | 有多个组消费队列时，`request()` 或 `result()` 没有指定 `group` |
| `QueueJobFailedException` | `request()` 或 `result()` 的消息处理失败（带有它的 `error` 和 `attempts`） |
| `QueueProcessingTimeoutException` | 处理超过 `timeout` 而失败（会重试） |
| `QueueDiscardException` | 由动作抛出，表示丢弃这条消息 |
| `QueueDriverNotFoundException` | 驱动的客户端包没有安装 |
| `QueueDriverVersionException` | 服务端版本低于驱动支持的最低版本 |

## 另见

- `lakutata` 包中的 `doc/zh/Queue.md`：消息队列指南。
- `@lakutata/entrypoint`：控制器和各种传输方式。
- `@lakutata/cache`：一个 `Cacher`，为自身不保存结果的驱动保存结果（`results: {store: 'cache'}`）。
- `@lakutata/nats`：服务之间的消息传递（至多一次）和远程调用。

## 测试驱动

`npm run test:unit` 测试内存驱动。`npm run test:servers`（`test-env/run.sh`）在 Docker 中启动各个服务端（支持的最旧和最新版本），逐一对它们运行驱动的一致性测试，然后删除容器。`test-env/run.sh redis`、`nats`、`rabbitmq` 或 `kafka` 只启动一个驱动的服务端（Kafka 的 broker 使用 19092 和 19093 端口）。
