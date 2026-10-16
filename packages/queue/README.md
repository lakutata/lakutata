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

The memory driver (the default) needs no other package: the messages are kept in the memory of the process.

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
- **The memory driver** keeps the messages in the process: they are lost when it exits, and the instances of an
  application do not share them. A message added before the first consumer of its queue is kept for it (and only for
  the first group: a dead letter queue consumed later by a second group gives it only the new letters). A delivery
  abandoned when the application stops is not counted as an attempt.

## API

| Export | Description |
|---|---|
| `Queue` | The component: `add()`, `request()`, `result()`, `consume()`, `capabilities` |
| `buildQueueOptions` | The options of the component: `driver`, `defaults`, `results`, `codec`, `requestTimeout` |
| `Job` | A message added: its `id`, its `result()` |
| `QueueAction` | The decorator of the actions processing a queue |
| `queueEntrypoint` | The adapter delivering the messages to the actions |
| `QueueContext`, `QUEUE_CONTEXT_TYPE` | The context of a delivery (`'QUEUE'`) |
| `QueueChannel` | The queue channel |
| `QueueDriver`, `MemoryQueueDriver` | The drivers: the memory one, the base of a custom one |
| `MemoryQueueOptions`, `CustomQueueOptions` | The options of the drivers |
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

## See also

- `@lakutata/entrypoint`: the controllers, the channels and the other transports.
- `@lakutata/cache`: a `Cacher` keeping the results (`results: {store: 'cache'}`) of the drivers keeping none.
- `@lakutata/nats`: the messages between the services (at most once), the remote calls.
