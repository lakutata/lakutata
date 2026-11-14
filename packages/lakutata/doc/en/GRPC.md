# Lakutata gRPC

The `@lakutata/grpc` package serves an application's service actions over gRPC, and calls them from another application.
Any language with a gRPC library can call them too. It is written in TypeScript on top of the Node.js HTTP/2 module
(`>=18.10.0`): no native addon and no generated code. `lakutata` does not include it, so install it as well:

```bash
npm install lakutata @lakutata/grpc
```

## 1. Serving the service actions

`grpcServiceEntrypoint()`, from `@lakutata/grpc/service`, is a `service` adapter for the entrypoint. The controllers'
`@ServiceAction` methods become callable over gRPC by their patterns, as over the other service transports.

```typescript
import {Application, Exception} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {grpcServiceEntrypoint} from '@lakutata/grpc/service'

class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'
}

class OrderController extends Controller {
    //Called with {cmd: 'order.get', id: 1}
    @ServiceAction({cmd: 'order.get'})
    public async get(input: { id: number }): Promise<{ id: number, status: string }> {
        if (input.id === 0) throw new OrderNotFoundException('Order {id} not found', {id: input.id})
        return {id: input.id, status: 'paid'}
    }
}

Application.run(() => ({
    id: 'orders.service',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            service: grpcServiceEntrypoint({port: 50051})
        })
    },
    bootstrap: ['entrypoint']
}))
```

The options of `grpcServiceEntrypoint`:

| Option | Default | Meaning |
|---|---|---|
| `port` | `50051` | The port; `0` picks a free one |
| `host` | All interfaces | The address to listen on |
| `socketPath` | | A Unix socket, instead of the port and host |
| `tls` | None (plain HTTP/2) | `{cert, key}` for TLS; with `ca` too, the clients must present a certificate signed by it (mutual TLS) |
| `maxMessageSize` | 4 MiB | The largest request, before and after decompression; a larger one fails with `RESOURCE_EXHAUSTED` |
| `compression` | `'identity'` | `'gzip'` or `'deflate'` to compress responses for clients that accept it. Compressed requests are always accepted |
| `listening` | | `(address, listeners) => void`, called once the server listens; the adapter's start waits for it |
| `interface`, `family`, `strict`, `onError` | | Listen on a network interface instead of an address, as the HTTP adapters do (see [HTTP](HTTP.md), section 2); not with `host` or `socketPath` |
| `middlewares` | | Middlewares for the actions called over gRPC, run after the entrypoint's |
| `name` | | The adapter's name, to distinguish several adapters |

With `interface`, the `@lakutata/netif` package must be installed. The `address` passed to `listening` is then the first
address listened on, or `null` while the interface does not exist or has no address yet, and `listeners` are the
interface's listeners.

The server has no reflection service and no health service.

## 2. Calling them from another application

`GRPCServiceProxy` calls a remote application's actions. It is a component: declare it under `components` with
`buildGRPCServiceProxy`, one per remote application.

```typescript
import {Application} from 'lakutata'
import {ServiceInvokeException} from 'lakutata/com/entrypoint'
import {GRPCError, GRPCStatus} from '@lakutata/grpc'
import {buildGRPCServiceProxy, type GRPCServiceProxy} from '@lakutata/grpc/service'

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            orders: buildGRPCServiceProxy({address: 'orders.internal:50051'})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: GRPCServiceProxy = await app.getObject<GRPCServiceProxy>('orders')
        try {
            //The pattern and the input in one object, and a deadline of 5 seconds
            console.log(await orders.invoke({cmd: 'order.get', id: 1}, 5000))
        } catch (error) {
            if (error instanceof ServiceInvokeException) {
                //The action failed: its errno, its message and its other properties
                console.log(error.errno, error.message)
            } else if (error instanceof GRPCError && error.code === GRPCStatus.UNAVAILABLE) {
                console.log('The orders service is unreachable')
            } else {
                throw error
            }
        }
    })
```

`invoke(input, timeout)` returns the action's result (`null` when the action returns nothing). The timeout, 10 minutes
by default, is the gRPC call's deadline: when it passes, the call fails and the action is also aborted on the service
(its `this.signal` fires).

The options of `buildGRPCServiceProxy`:

| Option | Default | Meaning |
|---|---|---|
| `address` | Required | `host:port`, `tcp://host:port`, or a Unix socket: `/path` or `unix:///path` |
| `tls` | None | `{ca, cert, key, servername}`, all optional. Any value, even `{}`, turns TLS on; `cert` and `key` are the client's certificate for mutual TLS |
| `clientId` | A random UUID | This client's ID, sent with each call (see section 3) |
| `compression` | `'identity'` | `'gzip'` or `'deflate'` to compress requests |
| `maxMessageSize` | No limit | The largest response accepted |
| `reconnectDelay` | `1000` | How long to wait, in milliseconds, before reopening the event stream after it ends (see section 4) |

The proxy connects on its first call and never retries a call automatically.

## 3. Client ids, metadata and deadlines

Each call carries the `id` metadata, the client's ID: the proxy's `clientId`, or the `id` header that a client in
another language sends. The action reads it as `this.context.clientId`.

`grpcCallOfContext(context)` provides an action with the whole gRPC call: the metadata the client sent, its deadline and
its peer. It returns `undefined` when the request came over another transport.

```typescript
import {Controller, type ServiceContext} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {grpcCallOfContext} from '@lakutata/grpc/service'
import type {GRPCServerCall} from '@lakutata/grpc'

class OrderController extends Controller {
    @ServiceAction({cmd: 'order.get'})
    public async get(input: { id: number }): Promise<{ id: number, tenant: string }> {
        const call: GRPCServerCall | undefined = grpcCallOfContext(this.context as ServiceContext)
        //Metadata sent by a client: grpcurl -H 'tenant: acme' ...
        const tenant: string = call?.metadata('tenant')[0] ?? 'default'
        return {id: input.id, tenant: tenant}
    }
}
```

- `GRPCServiceProxy` sends no metadata other than `id`. A client that needs other metadata (such as an authorization
  token) uses `GRPCConnection` (see section 8) or a client in another language.
- A metadata key's values are split on commas, so an ID should not contain one.
- When the client cancels the call or its deadline passes, the action's `this.signal` is aborted and its result is
  discarded. A long-running action should watch the signal.

## 4. Events

An action pushes events to a client with `entrypoint.notify(clientId, event, ...args)`, or to every connected client
with `entrypoint.broadcast(event, ...args)`. `notify` returns whether the client received the event, `broadcast` the
number of clients.

```typescript
import {Controller, type Entrypoint, type ServiceContext} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'

class OrderController extends Controller {
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    @ServiceAction({cmd: 'order.ship'})
    public async ship(input: { id: number }): Promise<void> {
        const clientId: string | undefined = (this.context as ServiceContext).clientId
        if (clientId) this.entrypoint.notify(clientId, 'orderChanged', {id: input.id, status: 'shipped'})
    }
}
```

On the other side, `orders.on('orderChanged', listener)` listens to them; `once` and `off` work as they do on an event
emitter. The proxy opens its event stream with the first listener and closes it with the last one. When the stream ends
(the service restarted), it is reopened after `reconnectDelay`.

Events are not stored: a client that is not connected when an event is sent misses it.

## 5. Errors

A failed action does not make the gRPC call fail: the call succeeds, and its response carries the error, with its
message and all its properties (`errno`, `statusCode`, and the stack). `GRPCServiceProxy` throws it as a
`ServiceInvokeException` from `lakutata/com/entrypoint`: its message is the remote message, its `errno` and other
properties are copied, and its `service` is the proxy's address.

A call that fails at the gRPC level throws a `GRPCError` from `@lakutata/grpc`, whose `code` is a `GRPCStatus`:

| Status | When |
|---|---|
| `UNAVAILABLE` | The service cannot be reached |
| `DEADLINE_EXCEEDED` | The deadline passed |
| `CANCELLED` | The call was canceled |
| `RESOURCE_EXHAUSTED` | A message is larger than `maxMessageSize` |
| `UNIMPLEMENTED` | An unknown method, or a compression the server does not support |

A message that no pattern matches fails with the errno `E_CONTROLLER_ACTION_NOT_FOUND`, as over the other service
transports.

## 6. Calling from other languages

`SERVICE_PROTO` holds the service's `.proto` file. Generate clients for other languages from it:

```typescript
import {writeFileSync} from 'node:fs'
import {SERVICE_PROTO} from '@lakutata/grpc/service'

writeFileSync('service.proto', SERVICE_PROTO)
```

```text
service Service {                                       // package lakutata.service.v1
  rpc Invoke (InvokeRequest) returns (InvokeResponse);  // data: the JSON of the pattern and the input
  rpc Events (EventsRequest) returns (stream Event);    // the events of the client, "client" (its id) first
}
message InvokeResponse { bool success = 1; bytes payload = 2; bytes error = 3; }  // payload, error: JSON
message Event { string event = 1; bytes args = 2; }                              // args: a JSON array
```

A call sends the pattern and the input as JSON in `InvokeRequest.data`, and the client's ID in the `id` metadata. The
response holds the result as JSON in `payload`, or the error as JSON in `error`. With grpcurl (which shows the `bytes`
fields in base64):

```bash
DATA=$(printf '{"cmd":"order.get","id":7}' | base64)
grpcurl -plaintext -proto service.proto -H 'id: go-1' -d "{\"data\": \"$DATA\"}" localhost:50051 lakutata.service.v1.Service/Invoke
```

With Python (the `grpcio` package, with stubs generated by `grpcio-tools`):

```python
import json
import grpc
import service_pb2 as pb
import service_pb2_grpc as rpc

stub = rpc.ServiceStub(grpc.insecure_channel('localhost:50051'))
response = stub.Invoke(pb.InvokeRequest(data=json.dumps({'cmd': 'order.get', 'id': 5}).encode()), metadata=[('id', 'python-1')], timeout=5)
print(json.loads(response.payload) if response.success else json.loads(response.error))
```

## 7. Stopping

When the application stops, the service refuses new calls: for these, the proxy throws a `ServiceInvokeException` whose
`errno` is `E_ENTRYPOINT_STOPPED`. Calls in progress are given the entrypoint's `shutdownTimeout` (30 seconds by
default) to complete. Then the event streams end and the server closes.

## 8. The lower layers

The package also provides the layers the service is built on, usable without Lakutata: `GRPCConnection`, a client for
any gRPC server (unary, server-streaming and bidirectional calls, metadata, TLS); `GRPCServer`; and `encode`/`decode`, a
schema-driven protobuf codec. The README of `@lakutata/grpc` describes them. `GRPCServer.listenWith()` listens through
network interface listeners (`listenOnAll()` from `@lakutata/netif`), as the adapter does.
