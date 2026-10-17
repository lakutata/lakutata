# @lakutata/nats

The NATS component of the lakutata framework: a connection to a NATS server to publish, subscribe and send requests
(MessagePack or JSON payloads), the service channel of an application served over NATS (`natsServiceEntrypoint`), the
proxies invoking the actions of the other services and listening to their events (`ServiceProxy`), and the large
payloads relayed through a JetStream object store. The umbrella package `lakutata` does not re-export it: import it
from `@lakutata/nats`.

## Installation

```shell
npm install lakutata @lakutata/nats
```

It uses the NATS client `nats` (a dependency) and needs, on the server side:

- a NATS server 2.2 or later (the message headers, which the large payloads need);
- JetStream enabled (`nats-server -js`, or `jetstream {}` in its configuration) for the large payloads. Without it the
  component starts anyway, prints a warning, and only the payloads over the server's `max_payload` fail.

```shell
docker run -d --name nats -p 4222:4222 nats:2.12-alpine -js
```

## Usage

### The NATS component

Register the `NATS` component with `buildNatsClientOptions`, then get it with `getObject()` or `@Inject`. It connects
when it is created: an unreachable server fails the application's start (after `timeout`, 20 seconds by default).

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
        //The failures of the callbacks and the subscriptions
        nats.on('error', (error: Error): void => console.error('NATS', error))
        //A responder: the value returned answers the request; the instances of the queue group share the requests
        nats.subscribe('price.get', async (input: {sku: string}): Promise<number> => input.sku.length * 10, {queue: 'pricing'})
        //A subscriber with a wildcard: the second argument is the subject the message arrived on
        nats.subscribe('price.changed.*', (price: number, subject: string): void => console.log(subject, price))
        nats.publish('price.changed.eu', 42)
        //The response, or NatsNoRespondersAvailableException at once, NatsRequestTimeoutException after 5 seconds
        console.log(await nats.request('price.get', {sku: 'ABC'}, 5000)) //30
    })
```

- `publish()` sends a message to every subscription of the subject (one per queue group); it is lost when nobody
  listens.
- `subscribe()` accepts the wildcards `*` (one token) and `>` (the remaining tokens). Its callback is called for each
  message as it arrives, or one message after the other with `{iterator: true}`; `{max: n}` ends the subscription
  after `n` messages. It returns the NATS `Subscription` (`unsubscribe()`, `drain()`).
- `request()` waits for the first response; its timeout is in milliseconds, 10 minutes when omitted. A callback which
  throws leaves the request unanswered (the requester times out) unless the subscription has an `errorResponse`.
- A lost connection is reestablished in the background (`reconnect`, `maxReconnectAttempts`: 10 attempts per server
  by default, `-1` for ever); the requests sent meanwhile fail when their timeout passes. Once the client gives up,
  every call fails with the NATS client error `CONNECTION_CLOSED`.
- When the application stops, the component drains its connections: the messages in progress are handled and the
  outgoing ones flushed before they close.

The connection options: `servers`, `codec`, `timeout`, `token`, `user`, `pass`, `debug`, `maxPingOut`,
`maxReconnectAttempts`, `name`, `noEcho`, `noRandomize`, `pingInterval`, `reconnect`, and the large payloads'
`bulk`, `bulkBucket`, `bulkTTL`, `bulkReplicas` (see [Large payloads](#large-payloads)).

### The codecs

Every payload is encoded with the component's `codec`, the same on both sides of a subject:

- `messagePackCodec()` (the default): MessagePack, compact and fast;
- `jsonCodec()`: JSON text, readable and easy for the clients of other languages.

Both send a value as a one-element array (`[value]`) and normalize it through JSON first, so that the clients of
other languages receive plain JSON data: a `Date` arrives as its ISO string, a `Buffer` as
`{type: 'Buffer', data: [...]}`, a class instance as a plain object, `undefined` as `null`; a `bigint` fails the
encoding. Any object with `encode(value): Uint8Array` and `decode(bytes)` can be given, such as `StringCodec()`
(re-exported from `nats`) for string payloads.

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

### Serving the service actions over NATS

`natsServiceEntrypoint` serves the service channel of the `Entrypoint` component: the requests sent to the
application's id are dispatched to the `@ServiceAction` methods of the controllers, and answered with a service
response `{success, error, payload}`.

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
        //The subject of the requests, and the serviceId of the proxies invoking this service
        id: 'order.service',
        name: 'OrderService',
        components: {
            nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222'}),
            entrypoint: buildEntrypoints({
                controllers: [OrderController],
                //Subject "order.service" (the application id), queue group "order.service.serviceQueue"
                service: natsServiceEntrypoint('nats')
            })
        },
        bootstrap: ['entrypoint']
    })
    .onLaunched(async (app: Application): Promise<void> => {
        //The service events: received by the proxies of this service listening to "orderPaid"
        const nats: NATS = await app.getObject('nats')
        nats.emitServiceEvent('orderPaid', 1, 42)
    })
```

- The subject is the application id unless the `subject` option sets another; the proxies use it as their
  `serviceId`. The service events stay under the application id.
- The instances of the service join one queue group (`{subject}.serviceQueue` by default): each request is handled by
  one instance.
- A failed action (no matching action, invalid input, access denied, an exception) is answered with its error's
  properties; a request which cannot be decoded is answered with an error too, so the requester never waits for its
  timeout.
- `Entrypoint.broadcast()` publishes its events under the entrypoint's subject, to the service proxies (counted 0:
  NATS does not tell how many receive them); `NATS.emitServiceEvent()` publishes under the application id.
  `Entrypoint.notify()` does not reach the NATS clients (NATS has no client ids).
- When the entrypoint stops, its subscription is drained: no new request is received (the callers retry, see below)
  and the requests in progress are answered.
- It is `SetupNatsServiceEntrypoint` of 2.x, renamed as the functions of 3.0 (no alias): the applications of 2.x rename
  their calls, as the ones of `BuildServiceProxy` (`buildServiceProxy`), `JSONCodec` (`jsonCodec`) and `MessagePackCodec`
  (`messagePackCodec`).

### Invoking a service: the service proxy

A `ServiceProxy` invokes the actions of one remote service and listens to its events. It is a singleton provider, shared
by the requests: declare one per service with `buildServiceProxy` in the `providers` of the application, as in 2.x.

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
            //The pattern of the action and its input in one object; 30 seconds at most
            console.log(await orderService.invoke({cmd: 'order.get', id: 1}, 30000))
        } catch (error) {
            if (error instanceof ServiceInvokeException) console.error(error.service, error.errno, error.message)
            else if (error instanceof NatsRequestTimeoutException) console.error('No response in time')
            else throw error
        }
    })
```

- `invoke(input, timeout)` returns the action's result. Its timeout defaults to 10 minutes: a service which is not
  running fails at once, so the timeout only bounds an action which is too slow.
- A request nobody received (`NatsNoRespondersAvailableException`: the service is not running, or restarting) is sent
  again, `maxRetries` times (3 by default) every `retryDelay` milliseconds (100 by default), then thrown. A timeout and
  a failure of the service are never retried: the action may have run, and a non-idempotent action never runs twice.
- A failed action is thrown as a `ServiceInvokeException`: its message is the remote error's, its `errno`,
  `statusCode` and other properties are copied from it, and its `service` is the service id.
- `on(event, listener)`, `once(event, listener)` and `off(event, listener?)` listen to the events the service emits
  with `NATS.emitServiceEvent()`. With `on(event, listener, true)`, each event goes to one listener among those
  registered so, across the applications (a queue group). The events are delivered at most once: an application not
  connected when one is emitted misses it. The listeners registered through a proxy are removed when it is
  destroyed.

### Large payloads

A NATS message cannot exceed the server's `max_payload` (1 MiB by default). The component relays the requests and the
responses of 90% of `max_payload` or more through a JetStream object store, over a second connection, so the large
transfers never delay the small messages: the sender stores the encoded payload and sends a small reference, the
receiver reads the object and deletes it. The callbacks, the actions and `invoke()` see the whole value.

- It is on by default (`bulk: true`) and needs JetStream. When it cannot start (no JetStream, the bucket refused), the
  component prints a warning and starts without it.
- The applications exchanging large payloads must share their bucket: set the same `bulkBucket` on all of them. The
  default bucket depends on the `name` option (`lkt-bulk-{name}`, `lkt-bulk-default` without it), so two applications
  with different names cannot read each other's objects (`NatsBulkException`).
- The objects not read (a requester gone, a response lost) expire after `bulkTTL` (5 minutes by default);
  `bulkReplicas` sets the bucket's replicas in a cluster. Both apply when the bucket is created.
- A large response is relayed when the requester declared the bulk channel (its requests carry it). A large request
  is relayed when the responders support it: learned from a previous response on the same subject, else asked once by
  a probe of the subject (`_LKT.BULK.<subject>`), which the responders with the bulk channel answer and the older
  versions ignore (the request is then sent as a message, and fails over `max_payload`).
- The applications without the bulk channel (`bulk: false`, or the versions before it) keep working with the others:
  they receive the payloads themselves, and a payload over `max_payload` fails.
- The published messages and the service events are never relayed: over `max_payload`, `publish()` and
  `emitServiceEvent()` throw the NATS client error `MAX_PAYLOAD_EXCEEDED`.

```typescript
import {Application} from 'lakutata'
import {buildNatsClientOptions} from '@lakutata/nats'

Application.run({
    id: 'report.service',
    name: 'ReportService',
    components: {
        nats: buildNatsClientOptions({
            servers: 'nats://127.0.0.1:4222',
            //The same bucket in every application exchanging large payloads
            bulkBucket: 'lkt-bulk-shared',
            bulkTTL: 10 * 60 * 1000,
            bulkReplicas: 3
        })
    }
})
```

`NATS.bulkEnabled`, `bulkThreshold`, `bulkStatus()` and `headersSupported` tell the state of the bulk channel;
`putBulk()`, `getBulk()` and `deleteBulk()` use its object store directly. The design is described in
`docs/large-payload-design.md` (Chinese).

## API

| Export | What it is |
|---|---|
| `NATS` | The component: `publish`, `request`, `subscribe`, `emitServiceEvent`, `onServiceEvent`, `onceServiceEvent`, `offServiceEvent`, the bulk channel (`bulkEnabled`, `bulkThreshold`, `headersSupported`, `putBulk`, `getBulk`, `deleteBulk`, `bulkStatus`), the event `error` |
| `buildNatsClientOptions` | Builds the component options of a `NATS` component |
| `NatsClientOptions` | Its options: the connection, the codec and the bulk channel |
| `SubscribeOptions` | The options of `subscribe()`: `queue`, `max`, `iterator`, `errorResponse` |
| `messagePackCodec`, `jsonCodec` | The codecs of the payloads |
| `StringCodec`, `Codec`, `Subscription`, `RetentionPolicy` | Re-exported from `nats` |
| `natsServiceEntrypoint` | The service adapter of an entrypoint served over NATS |
| `NatsServiceEntrypointOptions` | Its options: `subject`, `queue`, `name`, `middlewares` |
| `ServiceProxy` | The singleton provider invoking the actions of a remote service and listening to its events |
| `buildServiceProxy` | Builds the provider options of a `ServiceProxy` |
| `BuildServiceProxyOptions` | Its options: `natsComponentName`, `serviceId`, `maxRetries`, `retryDelay` |
| `ServiceInvokeException` and the `Nats*Exception` classes | See [Errors](#errors) |

The typings document each declaration with examples.

## Errors

| Exception | Thrown when |
|---|---|
| `ServiceInvokeException` (`E_SERVICE_INVOKE`, or the remote error's `errno`) | `ServiceProxy.invoke()`: the remote action failed; it carries the remote error's properties and the `service` id. Re-exported from `@lakutata/entrypoint` |
| `NatsNoRespondersAvailableException` (`E_NATS_NO_RESPONDERS_AVAILABLE`, 503) | `request()`: nobody listens on the subject; `invoke()` after its retries |
| `NatsRequestTimeoutException` (`E_NATS_REQUEST_TIMEOUT`, 408) | `request()`, `invoke()`: no response in time |
| `NatsBulkException` (`E_NATS_BULK`, 502) | The bulk channel failed: disabled, the object store refused a write or a read, an object expired or in another bucket. On the service side, the requester receives it as a `ServiceInvokeException` whose `errno` is `E_NATS_BULK` |
| `NatsBadRequestException` (400), `NatsForbiddenException` (403), `NatsNotFoundException` (404), `NatsInternalServerException` (500) | `request()`: an error of the NATS client with that code; the core requests do not produce them |
| `InvalidValueException` (from `lakutata`) | The component options are invalid, when the component is created |

The other failures are the NATS client's errors (`NatsError`, with a `code`): `MAX_PAYLOAD_EXCEEDED` for a payload
over `max_payload` which is not relayed, `CONNECTION_CLOSED` once the connection is closed, `CONNECTION_REFUSED` or a
connection timeout when no server can be reached at the start. The codec's errors (a `bigint`, a circular value) are thrown as they are.

## See also

- `@lakutata/entrypoint` (`lakutata/com/entrypoint`, `lakutata/decorator/ctrl`): the controllers, `@ServiceAction` and
  the other transports; section 2 of `doc/en/ServiceCalls.md` in the package `lakutata` (Chinese in `doc/zh`) for the
  patterns.
- `@lakutata/grpc/service`: the same service channel and proxy over gRPC.
- `docs/large-payload-design.md`: the design of the large payloads.
