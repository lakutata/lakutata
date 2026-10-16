# @lakutata/queue

The message queues of the [lakutata](https://www.npmjs.com/package/lakutata) framework: the `Queue` component adds the
messages, and the controller actions declared with `@QueueAction` process them through the `queueEntrypoint` adapter,
with the same input DTOs, access control and middlewares as the other channels. A message is acknowledged when its
action returns, delivered again after a failure, then sent to the dead letter queue `<queue>.dead`; the value returned
is its result (`queue.request()`, `queue.result()`) and may go on to another queue (`output`). The umbrella package
exposes it as `lakutata/com/queue`.

## Installation

```shell
npm install @lakutata/queue
```

The memory driver (the default) needs no other package: the messages are kept in the memory of the process. The other
drivers load their clients when the component starts:

| Driver | `driver` option | Install | Server |
|---|---|---|---|
| Memory | `{type: 'memory'}` (the default) | — | — |
| Redis | `{type: 'redis', url}` | `npm install bullmq ioredis` | Redis 5.0 or later (6.2 or later recommended) |
| NATS JetStream | `{type: 'nats', servers}` | `npm install nats` | NATS 2.9.4 or later, with JetStream (`-js`) |
| RabbitMQ | `{type: 'rabbitmq', url}` and `results: {store}` | `npm install amqplib` | RabbitMQ 3.6 or later |
| Kafka | `{type: 'kafka', brokers}` and `results: {store}` | `npm install @platformatic/kafka` (Node.js 22.22 or 24.6 and later) | Kafka 3.5 or later |

## Usage

Register the component and the adapter, then declare the actions:

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

    //The messages whose attempts are spent
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
    }
}))
```

Add the messages, and read their results:

```typescript
import type {Job, Queue} from '@lakutata/queue'

declare const queue: Queue
//Fire and forget, after 10 seconds, at most once while the job image-7 is kept
await queue.add('image.extract', {id: 7}, {jobId: 'image-7', dedupe: true, delay: '10s'})
//Add and wait for the result
const result: {pages: number} = await queue.request('image.extract', {id: 8}, {timeout: '30s'})
console.log(result.pages)
//Add now, read later (by the id, in any instance) while the result is kept
const job: Job = await queue.add('image.extract', {id: 9})
console.log(await queue.result('image.extract', job.id, {timeout: '1m'}))
```

The semantics:

- **At least once.** A message is acknowledged when its action returns. An error delivers it again after the `backoff`
  (exponential from 1 second to 1 minute by default), up to `attempts` (3 by default), then it goes to `<queue>.dead`
  (`{queue, jobId, group, input, error, attempts, failedAt}`). The errors no retry can fix go there at once: an invalid
  input (`InvalidValueException`), a denied access, an action missing, an invalid result (`@Return`). An action throwing
  `QueueDiscardException` drops its message. The actions should be idempotent.
- **Groups.** The instances of a group share the messages; each group receives every message. The group of an action is
  the `appId` of its application by default: two applications consuming one queue each receive its messages, unless
  they name the same `group`. `request()` and `result()` name the group when several groups consume the queue.
- **Stopping.** When the application stops, the consumers stop and the messages being processed complete
  (`shutdownTimeout` of the entrypoint); the ones still running then are delivered again later, neither acknowledged
  nor dead. The processings of `consume()` still running when the component is destroyed are aborted (their signal)
  and delivered again later too.
- **Time limit.** A processing exceeding its `timeout` fails with `QueueProcessingTimeoutException` and is retried: its
  signal is aborted, and what it returns afterwards is dropped.
- **Messages.** A message is an object (the input of its action). The default codec is the one of `@lakutata/nats`:
  MessagePack after a JSON normalization, so a `Date` arrives as its ISO string (an input DTO converts it back; a result
  stays a string). `codec: 'json'` exchanges JSON with services written in other languages.
- **Registering the groups.** A group receives the messages added once it is registered: the actions of an application
  register their groups while it starts (before it launches), `consume()` and `prepare()` register theirs. With the
  drivers of the servers, the messages added to a queue before any group registered are not delivered; the groups stay
  registered on the server, so their messages are kept while none of their instances runs.

## Drivers

- **Memory** keeps the messages in the process: they are lost when it exits, and the instances of an application do not
  share them. A message added before the first group of its queue is kept for it (and only for the first group: a dead
  letter queue consumed later by a second group gives it only the new letters). A delivery abandoned when the
  application stops is not counted as an attempt.
- **Redis** (BullMQ): each queue and group is a BullMQ queue under the `prefix` of the keys (`lakutata` by default), its
  jobs removed once processed; the results are keys expiring with `results.keep`, the replies of `request()` go through
  Redis channels. It supports the delays, the priorities and the deduplication (while the message of the same id waits
  or is processed), not the ordering by key. A delivery abandoned when the application stops counts as an attempt.
  Before Redis 6.0, the delays and the retries may come up to a second late. Configure the server with
  `maxmemory-policy noeviction`.
- **NATS JetStream**: each queue is a stream under the `prefix` (`lakutata` by default), keeping its messages for
  `maxAge` (7 days by default, processed or not); each group is a durable consumer, created when the group registers;
  the results are a key-value bucket, the replies of `request()` go to the inbox of the instance. A delivery not ended
  within `ackWait` (30 seconds by default) is delivered again: the queue extends it every third of it while it is
  processed. A consumer keeps the `ackWait` it was created with. The duplicates are dropped for 2 minutes after the first
  message of their id, processed or not; the priorities and the ordering by key are not supported. The delays are
  scheduled messages on NATS 2.12 and later; before, the messages are given back until they are due, and a delayed
  message delivered once its time has passed may get one more attempt than `attempts`. A delivery abandoned when the
  application stops counts as an attempt.
- **RabbitMQ**: each group of a queue is a durable queue under the `prefix` (`lakutata` by default), bound to a direct
  exchange; a delayed message goes through a delay queue of its delay; a retry is a copy sent to the group, its attempt
  in its headers; the replies of `request()` are the direct replies of RabbitMQ. RabbitMQ keeps no result and cannot
  list the groups of a queue: give the queue a store (`results: {store: 'cache'}`, a `Cacher` component) shared by the
  applications (a Redis store...), which keeps the results and the groups. The priorities go from 0 to 10; the
  duplicates are not dropped, the ordering by key is not supported. A delivery abandoned when the application stops is
  not counted as an attempt. The driver reconnects by itself and consumes again. RabbitMQ 3.8.15 and later close a
  channel whose delivery is not ended within `consumer_timeout` (30 minutes by default): its messages are delivered
  again.
- **Kafka**: each queue is a topic under the `prefix` (`lakutata` by default), created with `partitions` (1 by default)
  and `replicas`; each group of a queue is a consumer group, its offsets set at the end of the topic when it registers.
  The messages of a partition are processed in their order, one at a time: `concurrency` is the number of partitions an
  instance processes at once, the messages of a `key` share a partition (the ordering by key). A failed message is
  retried in place after its backoff, holding its partition; its attempts are counted by the instance processing it (a
  message delivered again to another instance, after a rebalance or a restart, starts its attempts again). A message is
  committed once acknowledged; abandoned, it is fetched again from its partition. Kafka keeps no result and has no reply
  channel: give the queue a store (`results: {store: 'cache'}`), `request()` reads the results it keeps. The delays,
  the priorities and the deduplication are not supported. A consumer joining a group waits for the
  `group.initial.rebalance.delay.ms` of the brokers (3 seconds by default) the first time; the client sends the
  heartbeats while the messages are processed. A consumer group without members is removed by Kafka once its offsets
  expire (`offsets.retention.minutes`, 7 days by default).

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
| `QueueInvalidMessageException` | A message which is not an object, an empty queue name, a header using `x-lkt-` |
| `QueueCapabilityException` | An option the driver does not support (`priority`, `dedupe`, `delay`, `ordered`), no result kept |
| `QueueRequestTimeoutException` | `request()` without a reply in time |
| `QueueResultNotFoundException` | `result()` before the message is processed (or an unknown id) |
| `QueueResultExpiredException` | `result()` after the result stopped being kept |
| `QueueAmbiguousGroupException` | `request()` or `result()` without a `group` when several groups consume the queue |
| `QueueJobFailedException` | `request()` or `result()` of a message which failed (its `error`, its `attempts`) |
| `QueueProcessingTimeoutException` | The failure of a processing exceeding its `timeout` (retried) |
| `QueueDiscardException` | Thrown by an action to drop its message |
| `QueueDriverNotFoundException` | The client packages of the driver are not installed |
| `QueueDriverVersionException` | The server is older than the driver supports |

## See also

- `@lakutata/entrypoint`: the controllers, the channels and the other transports.
- `@lakutata/cache`: a `Cacher` keeping the results (`results: {store: 'cache'}`) of the drivers keeping none.
- `@lakutata/nats`: the messages between the services (at most once), the remote calls.

## Testing the drivers

`npm run test:unit` tests the memory driver. `npm run test:servers` (`test-env/run.sh`) starts the servers in Docker
(the oldest version supported and the newest), runs the conformance suite of the drivers on each, then removes the
containers; `test-env/run.sh redis`, `nats`, `rabbitmq` or `kafka` runs the servers of one driver (the Kafka brokers on
the ports 19092 and 19093).
