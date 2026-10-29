# Lakutata gRPC

The package `@lakutata/grpc` serves the service actions of an application over gRPC, and calls them from another
application. Any language with a gRPC library can call them too. It is written in TypeScript over the HTTP/2 module of
Node.js (`^22.13.0 || >=24.11.0`): no native addon and no generated code. `lakutata` does not include it, so install it
next to it:

```bash
npm install lakutata @lakutata/grpc
```

## 1. Serving the service actions

`grpcServiceEntrypoint()`, from `@lakutata/grpc/service`, is a `service` adapter of the entrypoint. The `@ServiceAction`
methods of the controllers become callable over gRPC by their patterns, as over the other service transports.

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
| `host` | All the interfaces | The address to listen on |
| `socketPath` | | A unix socket, instead of the port and the host |
| `tls` | None (plain HTTP/2) | `{cert, key}` for TLS; with `ca` too, the clients must present a certificate signed by it (mutual TLS) |
| `maxMessageSize` | 4 MiB | The largest request, before and after decompression; a larger one fails with `RESOURCE_EXHAUSTED` |
| `compression` | `'identity'` | `'gzip'` or `'deflate'` to compress the responses for the clients that accept it. Compressed requests are always accepted |
| `listening` | | `(address, listeners) => void`, called once the server listens; the start waits for it |
| `interface`, `family`, `strict`, `onError` | | Listen on a network interface instead of an address, as the HTTP adapters do (see [HTTP](HTTP.md), section 2); not with `host` or `socketPath` |
| `middlewares` | | The middlewares of the actions called over gRPC, run after the ones of the entrypoint |
| `name` | | The name of the adapter, to tell several apart |

With `interface`, the package `@lakutata/netif` has to be installed. The `address` given to `listening` is then the
first one listened on, or `null` while the interface does not exist or has no address yet, and `listeners` are the
listeners of the interface.

The server has no reflection service and no health service.

## 2. Calling them from another application

`GRPCServiceProxy` calls the actions of a remote application. It is a component: declare it under `components` with
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

`invoke(input, timeout)` returns the result of the action (`null` when the action returns nothing). The timeout, 10
minutes by default, is the deadline of the gRPC call: when it passes, the call fails and the action is aborted on the
service as well (its `this.signal` fires).

The options of `buildGRPCServiceProxy`:

| Option | Default | Meaning |
|---|---|---|
| `address` | Required | `host:port`, `tcp://host:port`, or a unix socket: `/path` or `unix:///path` |
| `tls` | None | `{ca, cert, key, servername}`, all optional. Any value, even `{}`, turns TLS on; `cert` and `key` are the client's certificate for mutual TLS |
| `clientId` | A random UUID | The id of this client, sent with each call (see section 3) |
| `compression` | `'identity'` | `'gzip'` or `'deflate'` to compress the requests |
| `maxMessageSize` | No limit | The largest response accepted |
| `reconnectDelay` | `1000` | The milliseconds to wait before opening the event stream again after it ended (see section 4) |

The proxy connects on its first call and never retries a call by itself.

## 3. Client ids, metadata and deadlines

Each call carries the metadata `id`, the id of the client: the `clientId` of the proxy, or the `id` header a client in
another language sends. The action reads it as `this.context.clientId`.

`grpcCallOfContext(context)` gives an action the whole gRPC call: the metadata the client sent, its deadline, its peer.
It returns `undefined` when the request came over another transport.

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

- `GRPCServiceProxy` sends no metadata other than `id`. A client that needs other metadata (an authorization token) uses
  `GRPCConnection` (see section 8) or a client in another language.
- The values of a metadata key are split on commas, so an id should not contain one.
- When the client cancels the call or its deadline passes, the action's `this.signal` is aborted and its result is
  dropped. A long action should watch the signal.

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

On the other side, `orders.on('orderChanged', listener)` listens to them; `once` and `off` work as on an event
emitter. The proxy opens its event stream with the first listener and closes it with the last one. When the stream
ends (the service restarted), it is opened again after `reconnectDelay`.

The events are not stored: a client that is not connected when an event is sent misses it.

## 5. Errors

A failed action does not make the gRPC call fail: the call succeeds, and its response carries the error, with its
message and all its properties (`errno`, `statusCode`, and the stack). `GRPCServiceProxy` throws it as a
`ServiceInvokeException` from `lakutata/com/entrypoint`: its message is the remote message, its `errno` and other
properties are copied, and its `service` is the address of the proxy.

A call that fails at the gRPC level is thrown as a `GRPCError` from `@lakutata/grpc`, whose `code` is a `GRPCStatus`:

| Status | When |
|---|---|
| `UNAVAILABLE` | The service cannot be reached |
| `DEADLINE_EXCEEDED` | The deadline passed |
| `CANCELLED` | The call was cancelled |
| `RESOURCE_EXHAUSTED` | A message is larger than `maxMessageSize` |
| `UNIMPLEMENTED` | An unknown method, or a compression the server does not support |

An action that no pattern matches fails with the errno `E_CONTROLLER_ACTION_NOT_FOUND`, as over the other service
transports.

## 6. Calling from other languages

`SERVICE_PROTO` holds the `.proto` file of the service. Generate the clients of other languages from it:

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

A call sends the JSON of the pattern and the input in `InvokeRequest.data`, and the id of the client in the metadata
`id`. The response holds the JSON of the result in `payload`, or the JSON of the error in `error`. With grpcurl (it
shows the `bytes` fields in base64):

```bash
DATA=$(printf '{"cmd":"order.get","id":7}' | base64)
grpcurl -plaintext -proto service.proto -H 'id: go-1' -d "{\"data\": \"$DATA\"}" localhost:50051 lakutata.service.v1.Service/Invoke
```

With Python (the `grpcio` package, the stubs generated by `grpcio-tools`):

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

When the application stops, the service refuses the new calls: the proxy throws them as a `ServiceInvokeException`
whose `errno` is `E_ENTRYPOINT_STOPPED`. The calls in progress are given the `shutdownTimeout` of the entrypoint (30
seconds by default) to complete. Then the event streams end and the server closes.

## 8. The lower layers

The package also has the layers the service is built on, usable without lakutata: `GRPCConnection`, a client for any
gRPC server (unary, server streaming and bidirectional calls, metadata, TLS); `GRPCServer`; and `encode`/`decode`, a
protobuf codec driven by schemas. The README of `@lakutata/grpc` describes them. `GRPCServer.listen()` with
`interface` listens on a network interface, as the adapter does.
