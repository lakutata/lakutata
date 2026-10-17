# @lakutata/nats

The NATS component of the lakutata framework. It provides a connection to a NATS server to publish, subscribe and send
requests (with MessagePack or JSON payloads), serves an application's service channel over NATS
(`natsServiceEntrypoint`), offers proxies that invoke the actions of other services and listen to their events
(`ServiceProxy`), and relays large payloads through a JetStream object store. The umbrella package `lakutata` does not
re-export it: import it from `@lakutata/nats`.

## Installation

```shell
npm install lakutata @lakutata/nats
```

It uses the NATS client `nats` (installed as a dependency). On the server side, it needs:

- a NATS server 2.2 or later (for message headers, which large payloads need);
- JetStream enabled (`nats-server -js`, or `jetstream {}` in the server configuration) for large payloads. Without it,
  the component still starts and prints a warning; only payloads over the server's `max_payload` then fail.

```shell
docker run -d --name nats -p 4222:4222 nats:2.12-alpine -js
```

## Usage

### The NATS component

Register the `NATS` component with `buildNatsClientOptions`, then get it with `getObject()` or `@Inject`. It connects
when it is created: when no server can be reached, its creation fails after `timeout` (20 seconds by default). The
application then fails to start if the component is created during the start (listed in `bootstrap`, or injected into
an object that is).

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

- `publish()` sends a message to every subscription of the subject (only one member of each queue group receives
  it); the message is lost when nobody is listening.
- `subscribe()` accepts the wildcards `*` (one token) and `>` (all remaining tokens). Its callback is called for each
  message as it arrives, or for one message after another with `{iterator: true}`; `{max: n}` ends the subscription
  after `n` messages. It returns the NATS `Subscription` (`unsubscribe()`, `drain()`).
- `request()` waits for the first response. Its timeout is in milliseconds and defaults to 10 minutes. When a
  responder's callback throws, the request goes unanswered and the requester times out, unless the subscription has
  an `errorResponse`.
- A lost connection is reestablished in the background (`reconnect`; `maxReconnectAttempts` is 10 attempts per server
  by default, `-1` to retry forever). Requests sent in the meantime fail when their timeout expires. Once the client
  gives up, every call fails with the NATS client error `CONNECTION_CLOSED`.
- When the application stops, the component drains its connections: messages in progress are handled and outgoing
  messages are flushed before the connections close.

The connection options are `servers`, `codec`, `timeout`, `token`, `user`, `pass`, `debug`, `maxPingOut`,
`maxReconnectAttempts`, `name`, `noEcho`, `noRandomize`, `pingInterval` and `reconnect`, plus the large-payload options
`bulk`, `bulkBucket`, `bulkTTL` and `bulkReplicas` (see [Large payloads](#large-payloads)).

### The codecs

Every payload is encoded with the component's `codec`, which must be the same on both sides of a subject:

- `messagePackCodec()` (the default): MessagePack, compact and fast;
- `jsonCodec()`: JSON text, readable and easy to handle for clients written in other languages.

Both send a value as a one-element array (`[value]`) and first normalize it through JSON, so that clients in other
languages receive plain JSON data: a `Date` arrives as its ISO string, a `Buffer` as `{type: 'Buffer', data: [...]}`,
a class instance as a plain object, and `undefined` as `null`; a `bigint` cannot be encoded. Any object with
`encode(value): Uint8Array` and `decode(bytes)` can serve as the codec, such as `StringCodec()` (re-exported from
`nats`) for string payloads.

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

`natsServiceEntrypoint` serves the `Entrypoint` component's service channel over NATS: requests sent to the
application's id are dispatched to the controllers' `@ServiceAction` methods and answered with a service response
`{success, error, payload}`.

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

- The subject is the application id, unless the `subject` option sets another one; proxies use the subject as their
  `serviceId`. The events of `NATS.emitServiceEvent()` always use the application id.
- All instances of the service join one queue group (`{subject}.serviceQueue` by default), so each request is handled
  by a single instance.
- A failed action (no matching action, invalid input, access denied, an exception) is answered with the properties of
  its error. A request that cannot be decoded is also answered with an error, so the requester never waits for its
  timeout.
- `Entrypoint.broadcast()` publishes its events to the service proxies under the entrypoint's subject, and returns 0,
  because NATS does not tell how many clients receive them; `NATS.emitServiceEvent()` publishes under the application
  id. `Entrypoint.notify()` does not reach NATS clients, since NATS has no client ids.
- When the entrypoint stops, its subscription is drained: it receives no new requests (callers retry them, see below),
  and the requests in progress are answered.
- In 2.x it was `SetupNatsServiceEntrypoint`. Like all functions in 3.0, it was renamed without an alias, so
  applications written for 2.x must rename their calls, as they must for `BuildServiceProxy` (now `buildServiceProxy`),
  `JSONCodec` (`jsonCodec`) and `MessagePackCodec` (`messagePackCodec`).

### Invoking a service: the service proxy

A `ServiceProxy` invokes the actions of one remote service and listens to its events. It is a singleton provider shared
by all requests: declare one per service with `buildServiceProxy` in the application's `providers`, as in 2.x.

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

- `invoke(input, timeout)` returns the action's result. Its timeout defaults to 10 minutes: a call to a service that is
  not running fails at once, so the timeout only limits actions that are too slow.
- A request that no instance received (`NatsNoRespondersAvailableException`: the service is not running, or is
  restarting) is sent again up to `maxRetries` times (3 by default), every `retryDelay` milliseconds (100 by default);
  after that, the exception is thrown. Timeouts and failures of the service are never retried, because the action may
  already have run: this way, a non-idempotent action never runs twice.
- A failed action is thrown as a `ServiceInvokeException`. Its message is that of the remote error, its `errno`,
  `statusCode` and other properties are copied from the remote error, and its `service` is the service id.
- `on(event, listener)`, `once(event, listener)` and `off(event, listener?)` manage listeners for the events that the
  service emits with `NATS.emitServiceEvent()`. With `on(event, listener, true)`, each event goes to only one of the
  listeners registered this way, across all applications (a queue group). Events are delivered at most once: an
  application that is not connected when an event is emitted misses it. The listeners registered through a proxy are
  removed when the proxy is destroyed.

### Large payloads

A NATS message cannot exceed the server's `max_payload` (1 MiB by default). The component relays requests and
responses of 90% of `max_payload` or more through a JetStream object store, over a second connection, so that large
transfers never delay small messages: the sender stores the encoded payload and sends a small reference, and the
receiver reads the object, then deletes it. Callbacks, actions and `invoke()` always see the whole value.

- This bulk channel is on by default (`bulk: true`) and needs JetStream. When it cannot start (no JetStream, or the
  bucket is refused), the component prints a warning and starts without it.
- Applications that exchange large payloads must share a bucket: set the same `bulkBucket` on all of them. The default
  bucket depends on the `name` option (`lkt-bulk-{name}`, or `lkt-bulk-default` without a name), so two applications
  with different names cannot read each other's objects (`NatsBulkException`).
- Objects that are never read (the requester has gone, a response was lost) expire after `bulkTTL` (5 minutes by
  default); `bulkReplicas` sets the number of replicas of the bucket in a cluster. Both apply when the bucket is
  created.
- A large response is relayed when the requester has declared the bulk channel (its requests carry this
  declaration). A large request is relayed when the responders support it. The component learns this from an earlier
  response on the same subject, or else asks once with a probe of the subject (`_LKT.BULK.<subject>`): responders with
  the bulk channel answer it and older versions ignore it, in which case the request is sent as a plain message and
  fails if it exceeds `max_payload`.
- Applications without the bulk channel (`bulk: false`, or versions that predate it) keep working with the others:
  they receive the payloads directly, and a payload over `max_payload` fails.
- Published messages and service events are never relayed: over `max_payload`, `publish()` and `emitServiceEvent()`
  throw the NATS client error `MAX_PAYLOAD_EXCEEDED`.

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

`NATS.bulkEnabled`, `bulkThreshold`, `bulkStatus()` and `headersSupported` report the state of the bulk channel;
`putBulk()`, `getBulk()` and `deleteBulk()` access its object store directly. The design is described in
`docs/large-payload-design.md` (in Chinese).

## API

| Export | What it is |
|---|---|
| `NATS` | The component: `publish`, `request`, `subscribe`, `emitServiceEvent`, `onServiceEvent`, `onceServiceEvent`, `offServiceEvent`, the bulk channel (`bulkEnabled`, `bulkThreshold`, `headersSupported`, `putBulk`, `getBulk`, `deleteBulk`, `bulkStatus`); the `error` event |
| `buildNatsClientOptions` | Builds the component options for a `NATS` component |
| `NatsClientOptions` | Its options: the connection, the codec and the bulk channel |
| `SubscribeOptions` | The options of `subscribe()`: `queue`, `max`, `iterator`, `errorResponse` |
| `messagePackCodec`, `jsonCodec` | The payload codecs |
| `StringCodec`, `Codec`, `Subscription`, `RetentionPolicy` | Re-exported from `nats` |
| `natsServiceEntrypoint` | The entrypoint's service adapter over NATS |
| `NatsServiceEntrypointOptions` | Its options: `subject`, `queue`, `name`, `middlewares` |
| `ServiceProxy` | The singleton provider that invokes the actions of a remote service and listens to its events |
| `buildServiceProxy` | Builds the provider options for a `ServiceProxy` |
| `BuildServiceProxyOptions` | Its options: `natsComponentName`, `serviceId`, `maxRetries`, `retryDelay` |
| `ServiceInvokeException` and the `Nats*Exception` classes | See [Errors](#errors) |

The typings document every declaration, with examples.

## Errors

| Exception | Thrown when |
|---|---|
| `ServiceInvokeException` (`E_SERVICE_INVOKE`, or the remote error's `errno`) | `ServiceProxy.invoke()`: the remote action failed; it carries the remote error's properties and the `service` id. Re-exported from `@lakutata/entrypoint` |
| `NatsNoRespondersAvailableException` (`E_NATS_NO_RESPONDERS_AVAILABLE`, 503) | `request()`: nobody is listening on the subject; `invoke()`, after its retries |
| `NatsRequestTimeoutException` (`E_NATS_REQUEST_TIMEOUT`, 408) | `request()`, `invoke()`: no response in time |
| `NatsBulkException` (`E_NATS_BULK`, 502) | The bulk channel failed: it is disabled, the object store refused a write or a read, or an object expired or is in another bucket. When this happens on the service side, the requester receives a `ServiceInvokeException` whose `errno` is `E_NATS_BULK` |
| `NatsBadRequestException` (400), `NatsForbiddenException` (403), `NatsNotFoundException` (404), `NatsInternalServerException` (500) | `request()`: a NATS client error with that code; core NATS requests do not produce them |
| `InvalidObjectOptionsException` (from `lakutata`) | An option of the component has an invalid value; the application fails to start |
| `InvalidValueException` (from `lakutata`) | The component is created without `servers` |

Other failures are errors of the NATS client (`NatsError`, with a `code`): `MAX_PAYLOAD_EXCEEDED` for a payload over
`max_payload` that is not relayed, `CONNECTION_CLOSED` once the connection is closed, and `CONNECTION_REFUSED` or a
connection timeout when no server can be reached at the start. Codec errors (a `bigint`, a circular value) are thrown
as they are.

## See also

- `doc/en/NATS.md` in the `lakutata` package (Chinese version in `doc/zh`): the guide to NATS.
- `@lakutata/entrypoint` (`lakutata/com/entrypoint`, `lakutata/decorator/ctrl`): controllers, `@ServiceAction` and the
  other transports; for patterns, see section 2 of `doc/en/ServiceCalls.md` in the `lakutata` package (Chinese version
  in `doc/zh`).
- `@lakutata/grpc/service`: the same service channel and proxy over gRPC.
- `docs/large-payload-design.md`: the design of the large payloads.
