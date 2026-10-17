# Lakutata Queues

The **Queue component** (`lakutata/com/queue`, package `@lakutata/queue`) lets you add messages to queues and process
them with controller actions marked `@QueueAction`. The `queueEntrypoint` adapter delivers the messages, and the actions
get the same input DTOs, access control and middleware as on any other transport. A message is acknowledged when its
action returns, retried after a failure, and finally sent to a dead letter queue; whatever the action returns is the
result of the message. Queues can live in memory, Redis, NATS JetStream, RabbitMQ or Kafka, and the actions' code is the
same for every driver. The README of `@lakutata/queue` gives the details.

## 1. Configuration

Declare `Queue` in the application's `components` with `buildQueueOptions` (it is named `queue` by convention), give the
entrypoint the queue adapter, and start the entrypoint at launch with `bootstrap: ['entrypoint']` — otherwise it is only
created on first use and the actions never start consuming. Without a `driver`, messages are kept in the memory of the
process.

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
            //Default settings for the consumers
            defaults: {attempts: 5, backoff: {type: 'exponential', delay: '1s', max: '1m'}, concurrency: 4},
            //Results are kept for result() and request()
            results: {keep: '1d'}
        }),
        entrypoint: buildEntrypoints({
            controllers: [],
            //Delivers messages to the @QueueAction actions
            queue: queueEntrypoint('queue')
        })
    },
    //Created at launch, so the actions start consuming right away
    bootstrap: ['entrypoint']
}))
```

| Driver | Install | Server | Notes |
|---|---|---|---|
| `{type: 'memory'}` (default) | | | this process only; messages are lost when it exits. For development, tests and desktop applications |
| `{type: 'redis', url}` | `bullmq`, `ioredis` | Redis 5.0+ (6.2+ advised) | BullMQ: priorities, delays, deduplication; use `maxmemory-policy noeviction` |
| `{type: 'nats', servers}` | `nats` | NATS 2.9.4+ with JetStream (`-js`) | streams keep messages for `maxAge` (7 days by default); duplicates are dropped within a 2-minute window; no priorities |
| `{type: 'rabbitmq', url}` | `amqplib` | RabbitMQ 3.6+ | priorities 0–10, delays; needs `results.store` |
| `{type: 'kafka', brokers}` | `@platformatic/kafka` (Node.js 22.22 / 24.6+) | Kafka 3.5+ | ordering by key, `partitions` (1 by default); needs `results.store` |
| `{type: 'custom', driver}` | | | a `QueueDriver` of the application |

The client packages are optional peer dependencies, loaded when the component starts. A missing client fails the start
with `QueueDriverNotFoundException`, a server that is too old with `QueueDriverVersionException`, and an unreachable
server with its connection error. Once started, the drivers reconnect on their own. The server-backed drivers also take
a `prefix` (`lakutata` by default) for the names they create on the server, so that applications sharing a server stay
apart.

The other options of the component:

- `defaults`: default settings for the consumers: `attempts` (3), `backoff` (exponential, from 1 s to 1 min),
  `concurrency` (1), `timeout` (none) and `group` (the application's `appId`).
- `results`: `keep` (how long a result is kept, 1 day by default) and `store` (the name of a `Cacher` component that
  keeps the results instead of the driver). RabbitMQ and Kafka cannot keep results themselves: give them a store that
  all your applications share, such as a Redis store. `false` keeps no results at all.
- `codec`: `'messagepack'` (the default, the same codec as `@lakutata/nats`), `'json'` (for services written in other
  languages) or a custom `QueueCodec`.
- `requestTimeout`: how long `request()` and `result()` wait (30 s).

```typescript
import {Application} from 'lakutata'
import {buildCacherOptions} from 'lakutata/com/cacher'
import {buildQueueOptions} from 'lakutata/com/queue'

Application.run(() => ({
    id: 'billing.app',
    name: 'Billing',
    components: {
        //The results, and for RabbitMQ the registered groups, shared by all applications
        cache: buildCacherOptions({stores: [{type: 'redis', host: '127.0.0.1'}]}),
        queue: buildQueueOptions({
            driver: {type: 'rabbitmq', url: 'amqp://guest:guest@127.0.0.1:5672', prefix: 'billing'},
            results: {keep: '2h', store: 'cache'}
        })
    }
}))
```

## 2. Consumers: `@QueueAction`

```text
@QueueAction(queue, dto?, options?)
```

The method processes the messages of a queue. Its input is the message, validated by the DTO, and `this.context` is a
`QueueContext`; whatever it returns is the result of the message. The same method may also carry the decorators of other
transports (an HTTP route, a service action…). The options are those of any action (`name`, `acl`, `rule`,
`middlewares`…) plus:

- `group`: the consumer group (defaults to `defaults.group`, then to the application's `appId`);
- `concurrency`: how many messages one instance processes at the same time;
- `attempts`, `backoff`: how many times a message is delivered before it goes to the dead letter queue, and how long to
  wait between deliveries;
- `timeout`: the time limit for processing a message; when exceeded, the processing is aborted and the message retried;
- `ordered`: process messages that share a `key` in order, one at a time (memory and Kafka drivers);
- `output`: a queue that receives the returned value as a new message (it must be an object; `undefined` sends nothing).

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
    //4 messages at a time, 5 attempts, 10 minutes each; the result is sent on to image.index
    @QueueAction('image.extract', ExtractInput, {concurrency: 4, attempts: 5, timeout: '10m', output: 'image.index'})
    public async extract(input: ExtractInput): Promise<{id: number, pages: number}> {
        const context: QueueContext = this.context as QueueContext
        console.log(`attempt ${context.attempt} of ${context.attempts} for the message ${context.jobId}`)
        //this.signal is aborted when the time limit is reached
        this.signal?.throwIfAborted()
        return {id: input.id, pages: 12}
    }

    @QueueAction('image.index')
    public async index(input: {id: number, pages: number}): Promise<void> {
        console.log(`image ${input.id}: ${input.pages} pages`)
    }

    //Messages that ran out of attempts
    @QueueAction('image.extract.dead')
    public async failed(input: QueueDeadLetter): Promise<void> {
        console.error(input.jobId, input.attempts, input.error.message)
    }
}
```

The context holds the `queue`, the `jobId`, the `group`, the `attempt` (1 on the first delivery), the `attempts`
allowed, the application's `headers` and `publishedAt`. Its `type` is `'QUEUE'`, so middleware and access rules shared
by several transports can tell queue deliveries apart.

`queueEntrypoint(componentName, {name, middlewares, onError})` checks the actions' options and registers their groups
while the application starts, then begins consuming once it has launched. `onError(error, action, context)` is called on
every failure, retried or not; by default failures are written to the application log.

Without a controller, `queue.consume(name, processor, options)` processes a queue with a plain function
`(input, context, signal) => result` and returns a subscription with a `stop()` method:

```typescript
import type {Queue, QueueJobContext} from 'lakutata/com/queue'

declare const queue: Queue
const subscription = await queue.consume('mail.send', async (input: Record<string, any>, context: QueueJobContext, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted()
    console.log(`mail to ${input.to} (${context.jobId})`)
}, {group: 'mailer', concurrency: 2})
await subscription.stop()
```

## 3. Producers: `add`, `request`, `result`

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {type Job, type Queue, QueueJobFailedException} from 'lakutata/com/queue'

class Images extends Component {
    @Inject('queue')
    protected readonly queue: Queue

    public async work(): Promise<void> {
        //Fire and forget: delivered after 10 s; dropped if a message with the same id is still waiting (dedupe)
        await this.queue.add('image.extract', {id: 7}, {jobId: 'image-7', dedupe: true, delay: '10s'})

        //Add and wait for the result: the value the action returned, or its last error
        try {
            const result: {pages: number} = await this.queue.request('image.extract', {id: 8}, {timeout: '30s'})
            console.log(result.pages)
        } catch (error) {
            if (error instanceof QueueJobFailedException) console.error(error.error.message, error.attempts)
        }

        //Add now, read the result later by id (from any instance) while it is kept
        const job: Job = await this.queue.add('image.extract', {id: 9}, {priority: 5, headers: {origin: 'upload'}})
        console.log(await job.result({timeout: '1m'}))
        console.log(await this.queue.result('image.extract', job.id, {wait: false}))
    }
}
```

A message takes these options: `jobId` (a random UUID by default), `dedupe`, `delay`, `priority` (higher first), `key`
(the ordering key), `attempts` and `backoff` (overriding the consumer's), and `headers` (the `x-lkt-` prefix is
reserved). An option the driver does not support fails with `QueueCapabilityException`; `queue.capabilities` lists what
the driver supports.

`request()` resolves with the value the action returns and rejects with `QueueJobFailedException` when the message
fails. On timeout it rejects with `QueueRequestTimeoutException`, but the message stays in the queue and its result can
still be read later. `result()` and `job.result()` wait until the message has been processed (`wait: false` reads
whatever is kept right now); they reject with `QueueResultNotFoundException` when it is not processed in time and with
`QueueResultExpiredException` when the result is no longer kept. When several groups consume a queue, `request()` and
`result()` must name the `group` whose result they want, or they reject with `QueueAmbiguousGroupException`.

## 4. Deliveries

- **At least once.** A message is acknowledged when its action returns. If the action throws, the message is delivered
  again after the `backoff`, up to `attempts` times, and then goes to `<queue>.dead` as a `QueueDeadLetter`
  (`{queue, jobId, group, input, error, attempts, failedAt}`) — an ordinary queue you can consume. A message may be
  processed twice after a crash or a stop, so actions should be idempotent.
- **No retry when a retry cannot help.** Invalid input (`InvalidValueException`), denied access, a missing action, an
  invalid result (`@Return`), or a message or result the codec cannot encode: the message goes straight to the dead
  letter queue. An action that throws `QueueDiscardException` drops its message: it is acknowledged, and neither
  dead-lettered nor kept.
- **Time limit.** Processing that exceeds its `timeout` fails with `QueueProcessingTimeoutException` and is retried: its
  signal is aborted, and whatever it returns afterwards is dropped. Drivers whose deliveries have a lease (NATS) extend
  it while the message is being processed.
- **Stopping.** When the application stops, the consumers stop taking messages, and the ones being processed get the
  entrypoint's `shutdownTimeout` to finish. Any still running after that are neither acknowledged nor dead-lettered:
  they are delivered again later.
- **Groups.** Instances of the same group share the messages; each group receives every message. An action's group is
  its application's `appId` by default, so two applications consuming one queue each receive its messages unless they
  name the same `group`. A group only receives messages added after it was registered: its actions register it while the
  application starts, and `consume()` and `queue.prepare(name, {group})` register it too. With the server-backed
  drivers, messages added to a queue before any group registered are not delivered; the memory driver keeps them for the
  first group that registers, so an application on the memory driver consumes its dead letter queues (`<queue>.dead`),
  or their messages stay in memory. Groups stay registered on the server, so their messages are kept even while none of
  their instances is running.
- **Messages.** A message is an object: the input of its action. With the default codec, a `Date` arrives as an ISO
  string (an input DTO can convert it back; in a result it stays a string), and a `bigint` is refused.

## 5. The drivers compared

| | Memory | Redis | NATS JetStream | RabbitMQ | Kafka |
|---|---|---|---|---|---|
| Delays | ✓ | ✓ | ✓ | ✓ (delay queues) | — |
| Priorities | ✓ | ✓ | — | ✓ (0–10) | — |
| Deduplication | while kept | while kept | 2 minutes | — | — |
| Ordering by `key` | ✓ | — | — | — | ✓ (partitions) |
| Results | ✓ | ✓ | ✓ | `results.store` | `results.store` |
| `request()` | reply | reply | reply | reply | reads the results |
| Retries | delayed | delayed | delayed | copies through the delay queues | in place, holding the partition |
| An abandoned delivery counts as an attempt | no | yes | yes | no | no |
| Survives a restart | no | yes | yes | yes | yes |

On Kafka, the messages of a partition are processed in order, one at a time: `concurrency` is the number of partitions
an instance works on at the same time, and attempts are counted by the instance processing the message. RabbitMQ cannot
list the groups of a queue, so the component keeps them in `results.store`; your applications must share that store for
`request()` and `result()` to find the groups without naming one.

## 6. Exceptions

| Exception | When |
|---|---|
| `QueueInvalidMessageException` (400) | A message that is not an object, an empty queue name, a header with the `x-lkt-` prefix, or a value the codec cannot encode |
| `QueueCapabilityException` | An option the driver does not support (`priority`, `dedupe`, `delay`, `ordered`), no result kept |
| `QueueRequestTimeoutException` (504) | `request()` did not get its result in time |
| `QueueResultNotFoundException` (404) | `result()` before the message has been processed, or an unknown id |
| `QueueResultExpiredException` (410) | `result()` after the result expired |
| `QueueAmbiguousGroupException` (400) | `request()` or `result()` without `group` when several groups consume the queue |
| `QueueJobFailedException` | `request()` or `result()` of a message which failed (its `error`, its `attempts`) |
| `QueueProcessingTimeoutException` (504) | Processing exceeded its `timeout` (the message is retried) |
| `QueueDiscardException` | Thrown by an action to drop its message |
| `QueueDriverNotFoundException` | The client package of the driver is not installed |
| `QueueDriverVersionException` | The server is older than the driver supports |
