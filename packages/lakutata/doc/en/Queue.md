# Lakutata Queues

The **Queue component** (`lakutata/com/queue`, package `@lakutata/queue`) adds messages to queues, and the controller
actions declared with `@QueueAction` process them, through the `queueEntrypoint` adapter, with the input DTOs, the access
control and the middlewares of the other transports. A message is acknowledged when its action returns, delivered again
after a failure, then sent to a dead letter queue; the value the action returns is the result of the message. The queues
are kept in memory, Redis, NATS JetStream, RabbitMQ or Kafka, and the code of the actions does not change with the
driver. The README of `@lakutata/queue` gives the details.

## 1. Configuration

Declare `Queue` in the `components` of the application with `buildQueueOptions` (named `queue` by convention), and give
the entrypoint the adapter of the queues. Without `driver`, the messages are kept in the memory of the process.

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
            //The defaults of the consumers
            defaults: {attempts: 5, backoff: {type: 'exponential', delay: '1s', max: '1m'}, concurrency: 4},
            //The results kept for result() and request()
            results: {keep: '1d'}
        }),
        entrypoint: buildEntrypoints({
            controllers: [],
            //Delivers the messages to the @QueueAction actions
            queue: queueEntrypoint('queue')
        })
    }
}))
```

| Driver | Install | Server | Notes |
|---|---|---|---|
| `{type: 'memory'}` (default) | | | the process only: the messages are lost when it exits; development, tests, desktop applications |
| `{type: 'redis', url}` | `bullmq`, `ioredis` | Redis 5.0+ (6.2+ advised) | BullMQ: priorities, delays, deduplication; use `maxmemory-policy noeviction` |
| `{type: 'nats', servers}` | `nats` | NATS 2.9.4+ with JetStream (`-js`) | streams keep the messages for `maxAge` (7 days); deduplication within 2 minutes; no priorities |
| `{type: 'rabbitmq', url}` | `amqplib` | RabbitMQ 3.6+ | priorities 0–10, delays; needs `results.store` |
| `{type: 'kafka', brokers}` | `@platformatic/kafka` (Node.js 22.22 / 24.6+) | Kafka 3.5+ | ordering by key, `partitions` (1 by default); needs `results.store` |
| `{type: 'custom', driver}` | | | a `QueueDriver` of the application |

The clients are optional peer dependencies, loaded when the component starts: a missing one fails it with
`QueueDriverNotFoundException`, a server too old with `QueueDriverVersionException`, an unreachable server with its
connection error. Once started, the drivers reconnect by themselves. The drivers of the servers also take a `prefix`
(`lakutata` by default) for the names they create on the server, to keep apart the applications sharing it.

The other options of the component:

- `defaults`: the defaults of the consumers: `attempts` (3), `backoff` (exponential from 1 s to 1 min), `concurrency`
  (1), `timeout` (none), `group` (the `appId` of the application).
- `results`: `{keep}` (1 day) and `{store}`: the name of a `Cacher` component keeping the results instead of the driver.
  RabbitMQ and Kafka keep none: give them a store, shared by the applications (a Redis store...). `false` keeps no result.
- `codec`: `'messagepack'` (default, the codec of `@lakutata/nats`), `'json'` (for the services written in other
  languages) or a `QueueCodec`.
- `requestTimeout`: how long `request()` and `result()` wait (30 s).

```typescript
import {Application} from 'lakutata'
import {buildCacherOptions} from 'lakutata/com/cacher'
import {buildQueueOptions} from 'lakutata/com/queue'

Application.run(() => ({
    id: 'billing.app',
    name: 'Billing',
    components: {
        //The results (and, for RabbitMQ, the groups of the queues) shared by the applications
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

The method processes the messages of a queue: its input is the message, validated by the DTO, and `this.context` a
`QueueContext`. The value it returns is the result of the message. A method may also carry the decorators of the other
transports (an HTTP route, a service action...). The options are those of every action (`name`, `acl`, `rule`,
`middlewares`...) and:

- `group`: the group consuming the queue (the `defaults.group` of the queue, else the `appId` of the application);
- `concurrency`: the messages an instance processes at once;
- `attempts`, `backoff`: the deliveries of a message before the dead letter queue, and the waits between them;
- `timeout`: the processing time limit (aborted, then retried);
- `ordered`: the messages of a same `key` processed in their order, one at a time (memory and Kafka);
- `output`: the queue the value returned goes to, as a new message (an object; `undefined` sends nothing).

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
    //4 messages at once, 5 attempts, 10 minutes each, the result sent on to image.index
    @QueueAction('image.extract', ExtractInput, {concurrency: 4, attempts: 5, timeout: '10m', output: 'image.index'})
    public async extract(input: ExtractInput): Promise<{id: number, pages: number}> {
        const context: QueueContext = this.context as QueueContext
        console.log(`attempt ${context.attempt} of ${context.attempts} for the message ${context.jobId}`)
        //The processing aborted at its time limit: this.signal
        this.signal?.throwIfAborted()
        return {id: input.id, pages: 12}
    }

    @QueueAction('image.index')
    public async index(input: {id: number, pages: number}): Promise<void> {
        console.log(`image ${input.id}: ${input.pages} pages`)
    }

    //The messages whose attempts are spent
    @QueueAction('image.extract.dead')
    public async failed(input: QueueDeadLetter): Promise<void> {
        console.error(input.jobId, input.attempts, input.error.message)
    }
}
```

The context holds the `queue`, the `jobId`, the `group`, the `attempt` (1 for the first delivery), the `attempts`
allowed, the `headers` of the application and `publishedAt`; its `type` is `'QUEUE'`, for the middlewares and the rules
shared by several transports.

`queueEntrypoint(componentName, {name, middlewares, onError})` checks the options of the actions and registers their
groups while the application starts, then consumes once it has launched. `onError(error, action, context)` is called for
each failure (retried or not); by default, the failures are written to the log of the application.

Without controllers, `queue.consume(name, processor, options)` processes a queue with a function `(input, context,
signal) => result` and returns a subscription to `stop()`:

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
        //Added and forgotten: after 10 s, dropped while a message of the same id waits (dedupe)
        await this.queue.add('image.extract', {id: 7}, {jobId: 'image-7', dedupe: true, delay: '10s'})

        //Added, then its result awaited: the value returned by the action, or its last error
        try {
            const result: {pages: number} = await this.queue.request('image.extract', {id: 8}, {timeout: '30s'})
            console.log(result.pages)
        } catch (error) {
            if (error instanceof QueueJobFailedException) console.error(error.error.message, error.attempts)
        }

        //Added now, its result read later by its id (in any instance) while it is kept
        const job: Job = await this.queue.add('image.extract', {id: 9}, {priority: 5, headers: {origin: 'upload'}})
        console.log(await job.result({timeout: '1m'}))
        console.log(await this.queue.result('image.extract', job.id, {wait: false}))
    }
}
```

The options of a message: `jobId` (a random UUID by default), `dedupe`, `delay`, `priority` (the greater first), `key`
(the ordering key), `attempts` and `backoff` (instead of those of the consumer), `headers` (the prefix `x-lkt-` is
reserved). An option the driver does not support fails with `QueueCapabilityException`; `queue.capabilities` tells what
it supports.

`request()` resolves with the value the action returns and rejects with `QueueJobFailedException` when the message
fails; on timeout (`QueueRequestTimeoutException`) the message stays in its queue, its result readable later.
`result()` and `job.result()` wait until the message is processed (`wait: false` reads what is kept now), and reject
with `QueueResultNotFoundException` when it is not processed in time, `QueueResultExpiredException` when its result is
no longer kept. When several groups consume a queue, `request()` and `result()` name the `group` whose result they want
(else `QueueAmbiguousGroupException`).

## 4. Deliveries

- **At least once.** A message is acknowledged when its action returns. An error delivers it again after the `backoff`,
  up to `attempts`, then it goes to `<queue>.dead` as a `QueueDeadLetter` (`{queue, jobId, group, input, error,
  attempts, failedAt}`), a queue like the others. A message may be processed twice (a crash, a stop): the actions
  should be idempotent.
- **No retry for what no retry fixes.** An invalid input (`InvalidValueException`), a denied access, an action missing,
  an invalid result (`@Return`), a message or a result the codec cannot encode: the message goes to the dead letter
  queue at once. An action throwing `QueueDiscardException` drops its message: acknowledged, neither dead nor kept.
- **Time limit.** A processing exceeding its `timeout` fails with `QueueProcessingTimeoutException` and is retried: its
  signal is aborted, what it returns afterwards is dropped. The drivers whose deliveries have a lease (NATS) extend it
  while the message is processed.
- **Stopping.** When the application stops, the consumers stop and the messages being processed get the
  `shutdownTimeout` of the entrypoint to complete; the ones still running then are delivered again later, neither
  acknowledged nor dead.
- **Groups.** The instances of a group share the messages; each group receives every message. The group of an action is
  the `appId` of its application by default: two applications consuming one queue each receive its messages, unless they
  name the same `group`. A group receives the messages added once it is registered (its actions register it while the
  application starts, `consume()` and `queue.prepare(name, {group})` too): with the drivers of the servers, the messages
  added to a queue before any group registered are not delivered. The groups stay registered on the server, so their
  messages are kept while none of their instances runs.
- **Messages.** A message is an object, the input of its action. With the default codec, a `Date` arrives as its ISO
  string (an input DTO converts it back; a result stays a string), and a `bigint` is refused.

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
| Abandon counted as an attempt | no | yes | yes | no | no |
| Survives a restart | no | yes | yes | yes | yes |

On Kafka, the messages of a partition are processed in their order, one at a time: `concurrency` is the number of
partitions an instance processes at once, and the attempts of a message are counted by the instance processing it.
RabbitMQ cannot list the groups of a queue: the component keeps them in its `results.store`, which the applications must
share for `request()` and `result()` to find the groups without naming one.

## 6. Exceptions

| Exception | When |
|---|---|
| `QueueInvalidMessageException` (400) | A message which is not an object, an empty queue name, a header using `x-lkt-`, a value the codec cannot encode |
| `QueueCapabilityException` | An option the driver does not support (`priority`, `dedupe`, `delay`, `ordered`), no result kept |
| `QueueRequestTimeoutException` (504) | `request()` without its result in time |
| `QueueResultNotFoundException` (404) | `result()` before the message is processed, or an unknown id |
| `QueueResultExpiredException` (410) | `result()` after the result stopped being kept |
| `QueueAmbiguousGroupException` (400) | `request()` or `result()` without `group` when several groups consume the queue |
| `QueueJobFailedException` | `request()` or `result()` of a message which failed (its `error`, its `attempts`) |
| `QueueProcessingTimeoutException` (504) | The failure of a processing exceeding its `timeout` (retried) |
| `QueueDiscardException` | Thrown by an action to drop its message |
| `QueueDriverNotFoundException` | The client package of the driver is not installed |
| `QueueDriverVersionException` | The server is older than the driver supports |
