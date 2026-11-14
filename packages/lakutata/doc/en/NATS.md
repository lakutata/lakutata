# Lakutata NATS

The `@lakutata/nats` package connects an application to a [NATS](https://nats.io) server. It provides a component to
publish, subscribe and send requests; a service adapter that serves the application's service actions over NATS; and a
service proxy that calls them from other applications. Several instances of a service share its requests, without a load
balancer. `lakutata` does not include the package, so install it as well:

```bash
npm install lakutata @lakutata/nats
```

It requires NATS server 2.2 or later, with JetStream enabled (`nats-server -js`) for payloads larger than the server's
limit (section 7):

```bash
docker run -d --name nats -p 4222:4222 nats:2.12-alpine -js
```

## 1. The NATS component

Declare the component with `buildNatsClientOptions`. It connects when it is created. When the server cannot be reached,
creation fails after `timeout` (20 seconds by default), and so does the application's launch if the component is created
during the launch (listed in `bootstrap`, or needed by an object that is).

```typescript
import {Application} from 'lakutata'
import {buildNatsClientOptions, type NATS} from '@lakutata/nats'

Application
    .run(() => ({
        id: 'pricing.app',
        name: 'Pricing',
        components: {
            nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222', name: 'pricing'})
        },
        bootstrap: ['nats']
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const nats: NATS = await app.getObject<NATS>('nats')
        //A responder: the value returned answers the request; the instances in the queue group share the requests
        nats.subscribe('price.get', async (input: { sku: string }): Promise<number> => input.sku.length * 10, {queue: 'pricing'})
        //A subscriber with a wildcard: the second argument is the subject of the message
        nats.subscribe('price.changed.*', (price: number, subject: string): void => console.log(subject, price))
        nats.publish('price.changed.eu', 42)
        //The response, within 5 seconds
        console.log(await nats.request('price.get', {sku: 'ABC'}, 5000)) //30
    })
```

- `publish(subject, payload)` sends a message to every subscription to the subject (to one subscription per queue
  group). When nobody is listening, the message is lost.
- `subscribe(subject, callback, options?)` accepts the wildcards `*` (one token) and `>` (all remaining tokens). The
  options are `queue` (a queue group: each message goes to one member), `max` (end after that many messages), `iterator`
  (handle messages one after another) and `errorResponse` (see below). It returns the NATS subscription
  (`unsubscribe()`, `drain()`).
- `request(subject, payload, timeout?)` returns the first response. Its timeout is in milliseconds, 10 minutes by
  default. When the responder's callback throws, the request receives no response and times out, unless the subscription
  has `errorResponse: (error) => value` to respond to it.
- A lost connection is reopened in the background (10 attempts per server, `maxReconnectAttempts: -1` to retry forever).
- When the application stops, the component drains its connections: the messages being handled are finished, and the
  outgoing ones are sent.
- The component emits `'error'` for failures it cannot throw to a caller (a callback that throws, a message that
  cannot be decoded): `nats.on('error', listener)`.

The options of `buildNatsClientOptions`:

| Option | Default | Meaning |
|---|---|---|
| `servers` | Required | A server URL or a list of them (`'nats://127.0.0.1:4222'`) |
| `user`, `pass` / `token` | | The credentials |
| `name` | | The connection's name, shown by the server |
| `codec` | `messagePackCodec()` | How payloads are encoded (section 6) |
| `timeout` | `20000` | How long to wait, in milliseconds, for the first connection |
| `reconnect`, `maxReconnectAttempts` | `true`, `10` | Whether, and how many times per server, to reconnect |
| `pingInterval`, `maxPingOut` | `120000`, `2` | How often to ping the server, and how many pings may be outstanding |
| `noEcho` | `false` | Do not receive the messages this connection publishes |
| `noRandomize` | `false` | Try the servers in order, not at random |
| `debug` | `false` | Print the protocol |
| `bulk`, `bulkBucket`, `bulkTTL`, `bulkReplicas` | | Large payloads (section 7) |

TLS and NKey or JWT credentials are not supported by the component.

## 2. Serving the service actions

`natsServiceEntrypoint(natsComponentName, options?)` is a `service` adapter for the entrypoint: it receives the requests
sent to the application and calls its `@ServiceAction` methods.

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {buildNatsClientOptions, natsServiceEntrypoint} from '@lakutata/nats'

class GetOrderDTO extends DTO {
    @Expect(DTO.Number().integer().required())
    public id: number
}

class OrderController extends Controller {
    @ServiceAction({cmd: 'order.get'}, GetOrderDTO)
    public async get(input: GetOrderDTO): Promise<{ id: number, total: number }> {
        return {id: input.id, total: 42}
    }
}

Application.run(() => ({
    //The subject of the requests, and the serviceId the proxies use
    id: 'order.service',
    name: 'OrderService',
    components: {
        nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222'}),
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            service: natsServiceEntrypoint('nats')
        })
    },
    bootstrap: ['entrypoint']
}))
```

- The first argument is the NATS component's name.
- Requests arrive on a subject named after the application ID (`order.service`); the `subject` option sets a different
  one.
- The service's instances join one queue group (`order.service.serviceQueue`, or the `queue` option), so each request is
  handled by one instance.
- A message published without waiting for a response still runs its action, but no response is sent.
- When the application stops, the adapter stops receiving new requests, and finishes the ones in progress. Callers of a
  restarting service retry their requests (section 3).

The adapter also takes `middlewares`, run after the entrypoint's, and `name`.

## 3. Calling a service: the service proxy

A `ServiceProxy` calls the actions of one remote service, and listens to its events. It is a singleton provider: declare
one per service with `buildServiceProxy`, under `providers`.

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
    .run(() => ({
        id: 'billing.app',
        name: 'Billing',
        components: {
            nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222'})
        },
        providers: {
            orderService: buildServiceProxy({natsComponentName: 'nats', serviceId: 'order.service'})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orderService: ServiceProxy = await app.getObject<ServiceProxy>('orderService')
        try {
            //The pattern of the action and its input in one object, and a timeout of 30 seconds
            console.log(await orderService.invoke({cmd: 'order.get', id: 1}, 30000))
        } catch (error) {
            if (error instanceof ServiceInvokeException) console.error(error.service, error.errno, error.message)
            else if (error instanceof NatsRequestTimeoutException) console.error('No response in time')
            else throw error
        }
    })
```

`invoke(input, timeout)` returns the action's result. The timeout is 10 minutes by default; a call to a service that is
not running fails immediately, so the timeout only limits an action that is too slow.

- When no service instance received the request (the service is not running, or is restarting), the proxy resends the
  request `maxRetries` times (3 by default) every `retryDelay` milliseconds (100 by default), then throws a
  `NatsNoRespondersAvailableException`.
- A timeout and a failed action are never retried: the action may have run, and must not run twice.
- **A timeout does not stop the action on the service**: the caller stops waiting, but the action runs to completion.
  This differs from gRPC, where the deadline aborts the action.

The options of `buildServiceProxy` are `natsComponentName`, `serviceId`, `maxRetries` and `retryDelay`.

## 4. Events

A service sends events to the proxies listening to it:

- `nats.emitServiceEvent(event, ...args)`, from the NATS component, under the application ID;
- `entrypoint.broadcast(event, ...args)`, under the adapter's subject. It returns 0: NATS does not report how many
  subscribers receive a message. When the adapter's `subject` option is not the application ID, proxies whose
  `serviceId` is the application ID receive only the events from `emitServiceEvent`.

`entrypoint.notify(clientId, ...)` does not reach NATS callers, which have no client ID.

On the other side, `orderService.on(event, listener)`, `once` and `off` listen to the service's events. With
`on(event, listener, true)`, each event goes to only one of the listeners registered this way, across all applications
(a queue group). Events are delivered at most once: an application that is not connected when one is sent misses it. A
proxy's listeners are removed when it is destroyed.

```typescript
import type {ServiceProxy} from '@lakutata/nats'

export function watchPayments(orderService: ServiceProxy): void {
    orderService.on('orderPaid', (id: number, total: number): void => console.log(`Order ${id} paid: ${total}`))
}
```

## 5. Errors

| Exception | errno | statusCode | When |
|---|---|---|---|
| `ServiceInvokeException` | The remote error's errno | The remote error's | The action failed. Its message and properties are the remote error's, its `service` is the service ID |
| `NatsNoRespondersAvailableException` | `E_NATS_NO_RESPONDERS_AVAILABLE` | 503 | No instance received the request, after the retries |
| `NatsRequestTimeoutException` | `E_NATS_REQUEST_TIMEOUT` | 408 | No response before the timeout |
| `NatsBulkException` | `E_NATS_BULK` | 502 | A large payload could not be stored or read (section 7) |

All of them are exported by `@lakutata/nats`. The remote error carries all its properties, including its stack.

## 6. Codecs

Every payload is encoded with the component's `codec`, which must be the same on both sides of a subject:

- `messagePackCodec()`, the default: MessagePack, compact and fast;
- `jsonCodec()`: JSON text, easier for clients written in other languages.

Both pass the value through JSON first, so that every client receives plain JSON data: a `Date` arrives as its ISO
string, a `Buffer` as `{type: 'Buffer', data: [...]}`, a class instance as a plain object, `undefined` as `null`. A
`bigint` cannot be sent. Any object with `encode(value): Uint8Array` and `decode(bytes)` can serve as the codec, such as
`StringCodec()` for text payloads.

## 7. Large payloads

A NATS message cannot be larger than the server's `max_payload`, 1 MiB by default. Requests and responses of 90% of that
size or more are stored in a JetStream object store, and the message only carries a reference to them; the receiver
reads the object, then deletes it. Callbacks, actions and `invoke()` always see the whole value.

- This channel is on by default (`bulk: true`) and requires JetStream. Without JetStream, the component prints a warning
  and continues without it; only payloads larger than `max_payload` then fail.
- Applications that exchange large payloads must use the same object store: set the same `bulkBucket` on all of them.
  By default it is named after the `name` option (`lkt-bulk-<name>`, or `lkt-bulk-default`), so two applications with
  different names cannot read each other's objects.
- Objects that nobody has read expire after `bulkTTL` (5 minutes by default). `bulkReplicas` sets the number of copies
  in a cluster. Both apply when the store is created.
- Published messages and events are never stored: when they are larger than `max_payload`, they fail with the NATS error
  `MAX_PAYLOAD_EXCEEDED`.
