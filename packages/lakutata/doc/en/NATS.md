# Lakutata NATS

The package `@lakutata/nats` connects an application to a [NATS](https://nats.io) server. It provides a component to
publish, subscribe and send requests; a service adapter that serves the service actions of the application over NATS;
and a service proxy that calls them from other applications. Several instances of a service share its requests, without
a load balancer. `lakutata` does not include the package, so install it next to it:

```bash
npm install lakutata @lakutata/nats
```

It needs a NATS server 2.2 or later, with JetStream enabled (`nats-server -js`) for the payloads larger than the
server's limit (section 7):

```bash
docker run -d --name nats -p 4222:4222 nats:2.12-alpine -js
```

## 1. The NATS component

Declare the component with `buildNatsClientOptions`. It connects when it is created. When the server cannot be reached,
the creation fails after `timeout` (20 seconds by default), and so does the launch of the application if the component
is created during the launch (listed in `bootstrap`, or needed by an object that is).

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

- `publish(subject, payload)` sends a message to every subscription of the subject (to one subscription per queue
  group). When nobody is listening, the message is lost.
- `subscribe(subject, callback, options?)` accepts the wildcards `*` (one token) and `>` (all the remaining tokens).
  The options are `queue` (a queue group: each message goes to one member), `max` (end after that many messages),
  `iterator` (handle the messages one after the other) and `errorResponse` (see below). It returns the NATS
  subscription (`unsubscribe()`, `drain()`).
- `request(subject, payload, timeout?)` returns the first response. Its timeout is in milliseconds, 10 minutes by
  default. When the callback of the responder throws, the request is not answered and times out, unless the
  subscription has `errorResponse: (error) => value` to answer it.
- A lost connection is opened again in the background (10 attempts per server, `maxReconnectAttempts: -1` to retry
  forever).
- When the application stops, the component drains its connections: the messages being handled are finished, and the
  outgoing ones sent.
- The component emits `'error'` for the failures it cannot throw to a caller (a callback that throws, a message that
  cannot be decoded): `nats.on('error', listener)`.

The options of `buildNatsClientOptions`:

| Option | Default | Meaning |
|---|---|---|
| `servers` | Required | A server URL or a list of them (`'nats://127.0.0.1:4222'`) |
| `user`, `pass` / `token` | | The credentials |
| `name` | | The name of the connection, shown by the server |
| `codec` | `messagePackCodec()` | How the payloads are encoded (section 6) |
| `timeout` | `20000` | The milliseconds to wait for the first connection |
| `reconnect`, `maxReconnectAttempts` | `true`, `10` | Whether, and how many times per server, to reconnect |
| `pingInterval`, `maxPingOut` | `120000`, `2` | How often to ping the server, and how many pings may stay unanswered |
| `noEcho` | `false` | Do not receive the messages this connection publishes |
| `noRandomize` | `false` | Try the servers in their order, not at random |
| `debug` | `false` | Print the protocol |
| `bulk`, `bulkBucket`, `bulkTTL`, `bulkReplicas` | | The large payloads (section 7) |

TLS and the NKey or JWT credentials are not supported by the component.

## 2. Serving the service actions

`natsServiceEntrypoint(natsComponentName, options?)` is a `service` adapter of the entrypoint: it receives the requests
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

- The first argument is the name of the NATS component.
- The requests arrive on a subject named after the application id (`order.service`); the `subject` option sets
  another one.
- The instances of the service join one queue group (`order.service.serviceQueue`, or the `queue` option), so each
  request is handled by one instance.
- A message published without waiting for a response still runs its action, but nothing is answered.
- When the application stops, the adapter stops receiving new requests, and finishes the ones in progress. Callers of a
  restarting service retry their requests (section 3).

The adapter also takes `middlewares`, run after the ones of the entrypoint, and `name`.

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

`invoke(input, timeout)` returns the result of the action. The timeout is 10 minutes by default; a service that is not
running fails at once, so the timeout only limits an action that is too slow.

- When no instance of the service received the request (it is not running, or is restarting), the proxy sends the
  request again, `maxRetries` times (3 by default) every `retryDelay` milliseconds (100 by default), then throws a
  `NatsNoRespondersAvailableException`.
- A timeout and a failed action are never retried: the action may have run, and must not run twice.
- **A timeout does not stop the action on the service**: the caller stops waiting, but the action runs to its end.
  This differs from gRPC, where the deadline aborts the action.

The options of `buildServiceProxy` are `natsComponentName`, `serviceId`, `maxRetries` and `retryDelay`.

## 4. Events

A service sends events to the proxies listening to it:

- `nats.emitServiceEvent(event, ...args)`, from the NATS component, under the application id;
- `entrypoint.broadcast(event, ...args)`, under the subject of the adapter. It returns 0: NATS does not tell how many
  receive a message. When the `subject` option of the adapter is not the application id, the proxies whose `serviceId`
  is the application id receive only the events of `emitServiceEvent`.

`entrypoint.notify(clientId, ...)` does not reach the NATS callers, which have no client id.

On the other side, `orderService.on(event, listener)`, `once` and `off` listen to the events of the service. With
`on(event, listener, true)`, each event goes to only one of the listeners registered this way, across all the
applications (a queue group). The events are delivered at most once: an application that is not connected when one is
sent misses it. The listeners of a proxy are removed when it is destroyed.

```typescript
import type {ServiceProxy} from '@lakutata/nats'

export function watchPayments(orderService: ServiceProxy): void {
    orderService.on('orderPaid', (id: number, total: number): void => console.log(`Order ${id} paid: ${total}`))
}
```

## 5. Errors

| Exception | errno | statusCode | When |
|---|---|---|---|
| `ServiceInvokeException` | The errno of the remote error | The one of the remote error | The action failed. Its message and properties are the remote error's, its `service` is the service id |
| `NatsNoRespondersAvailableException` | `E_NATS_NO_RESPONDERS_AVAILABLE` | 503 | No instance received the request, after the retries |
| `NatsRequestTimeoutException` | `E_NATS_REQUEST_TIMEOUT` | 408 | No response before the timeout |
| `NatsBulkException` | `E_NATS_BULK` | 502 | A large payload could not be stored or read (section 7) |

All of them are exported by `@lakutata/nats`. The remote error carries all its properties, its stack included.

## 6. Codecs

Every payload is encoded with the `codec` of the component, which must be the same on both sides of a subject:

- `messagePackCodec()`, the default: MessagePack, compact and fast;
- `jsonCodec()`: JSON text, easier for the clients written in other languages.

Both send the value through JSON first, so that every client receives plain JSON data: a `Date` arrives as its ISO
string, a `Buffer` as `{type: 'Buffer', data: [...]}`, a class instance as a plain object, `undefined` as `null`. A
`bigint` cannot be sent. Any object with `encode(value): Uint8Array` and `decode(bytes)` can be the codec, such as
`StringCodec()` for text payloads.

## 7. Large payloads

A NATS message cannot be larger than the `max_payload` of the server, 1 MiB by default. The requests and the responses
of 90% of that size or more are stored in a JetStream object store, and the message only carries a reference to them;
the receiver reads the object, then deletes it. The callbacks, the actions and `invoke()` always see the whole value.

- This channel is on by default (`bulk: true`) and needs JetStream. Without JetStream, the component prints a warning
  and starts without it: then only the payloads larger than `max_payload` fail.
- The applications exchanging large payloads must use the same object store: set the same `bulkBucket` on all of them.
  By default it is named after the `name` option (`lkt-bulk-<name>`, or `lkt-bulk-default`), so two applications with
  different names cannot read each other's objects.
- The objects nobody read expire after `bulkTTL` (5 minutes by default). `bulkReplicas` sets the number of copies in a
  cluster. Both apply when the store is created.
- Published messages and events are never stored: larger than `max_payload`, they fail with the NATS error
  `MAX_PAYLOAD_EXCEEDED`.
