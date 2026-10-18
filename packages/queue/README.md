# @lakutata/queue

English | [中文](README.zh-CN.md)

Message queues for the [lakutata](https://www.npmjs.com/package/lakutata) framework. The `Queue` component adds
messages, and controller actions declared with `@QueueAction` process them through the `queueEntrypoint` adapter, with
the same input DTOs, access control and middlewares as the other channels. A message is acknowledged when its action
returns and delivered again after a failure; once its attempts are used up, it goes to the dead letter queue
`<queue>.dead`. The value the action returns is the message's result (`queue.request()`, `queue.result()`) and can be
passed on to another queue (`output`). The umbrella package `lakutata` exposes this package as `lakutata/com/queue`.

## Installation

```shell
npm install @lakutata/queue
```

The memory driver (the default) needs no other package: it keeps the messages in the process's memory. The other
drivers load their client libraries when the component starts:

| Driver | `driver` option | Install | Server |
|---|---|---|---|
| Memory | `{type: 'memory'}` (the default) | — | — |
| Redis | `{type: 'redis', url}` | `npm install bullmq ioredis` | Redis 5.0 or later (6.2 or later recommended) |
| NATS JetStream | `{type: 'nats', servers}` | `npm install nats` | NATS 2.9.4 or later, with JetStream (`-js`) |
| RabbitMQ | `{type: 'rabbitmq', url}` and `results: {store}` | `npm install amqplib` | RabbitMQ 3.6 or later |
| Kafka | `{type: 'kafka', brokers}` and `results: {store}` | `npm install @platformatic/kafka` (Node.js 22.22 or 24.6 and later) | Kafka 3.5 or later |

## Usage

Register the component and the adapter, and list the entrypoint in `bootstrap` so that it starts at launch (otherwise it
is created only when first used, and its actions do not consume). Then declare the actions:

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {buildQueueOptions, QueueAction, queueEntrypoint} from '@lakutata/queue'

class ImageController extends Controller {
    //Up to 4 messages at once, 5 attempts, 10 minutes each, the result sent on to image.index
    @QueueAction('image.extract', {concurrency: 4, attempts: 5, timeout: '10m', output: 'image.index'})
    public async extract(input: {id: number}): Promise<{id: number, pages: number}> {
        return {id: input.id, pages: 12}
    }

    @QueueAction('image.index')
    public async index(input: {id: number, pages: number}): Promise<void> {
        console.log(`image ${input.id}: ${input.pages} pages`)
    }

    //The messages that used up their attempts
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
    //Created at launch: the actions consume from then on
    bootstrap: ['entrypoint']
}))
```

Add messages and read their results:

```typescript
import type {Job, Queue} from '@lakutata/queue'

declare const queue: Queue
//Fire and forget: delivered after 10 seconds; dropped while a message with the id image-7 is kept (dedupe)
await queue.add('image.extract', {id: 7}, {jobId: 'image-7', dedupe: true, delay: '10s'})
//Add and wait for the result
const result: {pages: number} = await queue.request('image.extract', {id: 8}, {timeout: '30s'})
console.log(result.pages)
//Add now and read the result later (by its id, from any instance) while it is kept
const job: Job = await queue.add('image.extract', {id: 9})
console.log(await queue.result('image.extract', job.id, {timeout: '1m'}))
```

Semantics:

- **At least once.** A message is acknowledged when its action returns. After an error, it is delivered again after the
  `backoff` (exponential, from 1 second to 1 minute by default), up to `attempts` times (3 by default), and then goes
  to `<queue>.dead` (`{queue, jobId, group, input, error, attempts, failedAt}`). Errors that no retry can fix send it
  there at once: invalid input (`InvalidValueException`), denied access, a missing action, an invalid result
  (`@Return`). An action that throws `QueueDiscardException` drops its message. Actions should be idempotent.
- **Groups.** The instances of a group share its messages, and each group receives every message. By default, an
  action's group is its application's `appId`: two applications consuming the same queue each receive all of its
  messages, unless they name the same `group`. When several groups consume a queue, `request()` and `result()` must
  name the group.
- **Stopping.** When the application stops, the consumers stop and the messages being processed are given time to
  complete (the entrypoint's `shutdownTimeout`). Those still running after that are delivered again later, neither
  acknowledged nor sent to the dead letter queue. Messages that `consume()` is still processing when the component is
  destroyed are aborted (through their signal) and also delivered again later.
- **Time limit.** Processing that exceeds its `timeout` fails with `QueueProcessingTimeoutException` and is retried: its
  signal is aborted, and whatever it returns afterwards is dropped.
- **Messages.** A message is an object (the input of its action). The default codec is the same as that of
  `@lakutata/nats`: MessagePack after normalizing the value through JSON, so a `Date` arrives as its ISO string (an
  input DTO converts it back; a result stays a string). `codec: 'json'` exchanges JSON with services written in other
  languages.
- **Registering the groups.** A group receives the messages added after it is registered. An application's actions
  register their groups while it starts (before it launches); `consume()` and `prepare()` register theirs. With the
  server drivers, messages added to a queue before any group is registered are not delivered. Groups stay registered on
  the server, so their messages are kept while none of their instances is running.

## Drivers

- **Memory** keeps the messages in the process: they are lost when it exits, and the instances of an application do not
  share them. A message added before its queue has any group is kept for the first group, and only for that one: a
  dead letter queue that a second group starts consuming later gives it only new letters. Its `backlog` option caps
  how many of them are kept (1000 for each queue by default; beyond that, the oldest are dropped). A delivery abandoned
  when the application stops does not count as an attempt.
- **Redis** (BullMQ): there is one BullMQ queue for each queue and group, under the key `prefix` (`lakutata` by
  default), and its jobs are removed once processed. Results are keys that expire after `results.keep`, and the
  replies to `request()` go through Redis channels. It supports delays, priorities and deduplication (while a message
  with the same id is waiting or being processed), but not ordering by key. A delivery abandoned when the application
  stops counts as an attempt. Before Redis 6.0, delays and retries may be up to a second late. Configure the server
  with `maxmemory-policy noeviction`.
- **NATS JetStream**: each queue is a stream under the `prefix` (`lakutata` by default) that keeps its messages for
  `maxAge` (7 days by default), whether they were processed or not. Each group is a durable consumer, created when the
  group registers. Results are stored in a key-value bucket, and the replies to `request()` go to the instance's inbox.
  A delivery that does not end within `ackWait` (30 seconds by default) is delivered again; while a message is being
  processed, the queue extends its delivery every third of `ackWait`. A consumer keeps the `ackWait` it was created
  with. Duplicates are dropped for 2 minutes after the first message with their id, whether it was processed or not;
  priorities and ordering by key are not supported. On NATS 2.12 and later, delays use scheduled messages; on older
  servers, messages are handed back until they are due, and a delayed message delivered after its time may get one
  more attempt than `attempts`. A delivery abandoned when the application stops counts as an attempt.
- **RabbitMQ**: each group of a queue is a durable queue under the `prefix` (`lakutata` by default), bound to a direct
  exchange. A delayed message passes through a delay queue for its delay; a retry is a copy sent to the group, with the
  attempt number in its headers; the replies to `request()` use RabbitMQ's direct reply-to. RabbitMQ keeps no results
  and cannot list the groups of a queue, so give the queue a store that the applications share
  (`results: {store: 'cache'}`, a `Cacher` component, with a Redis store for example) to keep the results and the
  groups. Priorities range from 0 to 10; duplicates are not dropped, and ordering by key is not supported. A delivery
  abandoned when the application stops does not count as an attempt. The driver reconnects and resumes consuming on its
  own. RabbitMQ 3.8.15 and later close a channel when a delivery does not end within `consumer_timeout` (30 minutes by
  default), and its messages are delivered again.
- **Kafka**: each queue is a topic under the `prefix` (`lakutata` by default), created with `partitions` (1 by default)
  and `replicas`. Each group of a queue is a consumer group, whose offsets are set to the end of the topic when it
  registers. The messages of a partition are processed in order, one at a time: `concurrency` is the number of
  partitions an instance processes at once, and messages with the same `key` share a partition (ordering by key). A
  failed message is retried in place after its backoff, holding up its partition. Its attempts are counted by the
  instance processing it, so a message delivered again to another instance, after a rebalance or a restart, starts
  its attempts over. A message is committed once acknowledged; if it is abandoned, it is fetched again from its
  partition. Kafka keeps no results and has no reply channel: give the queue a store (`results: {store: 'cache'}`),
  from which `request()` reads the results. Delays, priorities and deduplication are not supported. The first time a
  consumer joins a group, it waits for the brokers' `group.initial.rebalance.delay.ms` (3 seconds by default); the
  client keeps sending heartbeats while messages are processed. Kafka removes a consumer group without members once its
  offsets expire (`offsets.retention.minutes`, 7 days by default).

## API

| Export | Description |
|---|---|
| `Queue` | The component: `add()`, `request()`, `result()`, `consume()`, `prepare()`, `capabilities` |
| `buildQueueOptions` | The options of the component: `driver`, `defaults`, `results`, `codec`, `requestTimeout` |
| `Job` | A message added: its `id`, its `result()` |
| `QueueAction` | The decorator of the actions processing a queue |
| `queueEntrypoint` | The adapter delivering the messages to the actions |
| `QueueContext`, `QUEUE_CONTEXT_TYPE` | The context of a delivery (`'QUEUE'`) |
| `QueueChannel` | The queue channel |
| `QueueDriver`, `MemoryQueueDriver`, `RedisQueueDriver`, `NatsQueueDriver`, `RabbitMQQueueDriver`, `KafkaQueueDriver` | The drivers, and the base of a custom one |
| `MemoryQueueOptions`, `RedisQueueOptions`, `NatsQueueOptions`, `RabbitMQQueueOptions`, `KafkaQueueOptions`, `CustomQueueOptions` | The options of the drivers |
| `messagePackQueueCodec`, `jsonQueueCodec`, `QueueCodec` | The codecs |

## Errors

| Exception | When |
|---|---|
| `QueueInvalidMessageException` | A message that is not an object, an empty queue name, a header using `x-lkt-` |
| `QueueCapabilityException` | An option the driver does not support (`priority`, `dedupe`, `delay`, `ordered`), no result kept |
| `QueueRequestTimeoutException` | `request()` without a reply in time |
| `QueueResultNotFoundException` | `result()` before the message is processed (or an unknown id) |
| `QueueResultExpiredException` | `result()` after the result stopped being kept |
| `QueueAmbiguousGroupException` | `request()` or `result()` without a `group` when several groups consume the queue |
| `QueueJobFailedException` | `request()` or `result()` of a message that failed (its `error`, its `attempts`) |
| `QueueProcessingTimeoutException` | The failure of a processing exceeding its `timeout` (retried) |
| `QueueDiscardException` | Thrown by an action to drop its message |
| `QueueDriverNotFoundException` | The client packages of the driver are not installed |
| `QueueDriverVersionException` | The server is older than the driver supports |

## See also

- The guide on the website: [Queues](https://lakutata.com/guide/Queue).
- `doc/en/Queue.md` in the `lakutata` package (Chinese in `doc/zh`): the queue guide.
- `@lakutata/entrypoint`: controllers, channels and the other transports.
- `@lakutata/cache`: a `Cacher` to keep the results (`results: {store: 'cache'}`) for the drivers that keep none.
- `@lakutata/nats`: messaging between services (at most once) and remote calls.

## Testing the drivers

`npm run test:unit` tests the memory driver. `npm run test:servers` (`test-env/run.sh`) starts the servers in Docker
(the oldest and the newest supported versions), runs the drivers' conformance suite against each, then removes the
containers. `test-env/run.sh redis`, `nats`, `rabbitmq` or `kafka` runs the servers for one driver only (the Kafka
brokers on ports 19092 and 19093).
