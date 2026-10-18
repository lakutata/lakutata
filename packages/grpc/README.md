# @lakutata/grpc

English | [中文](README.zh-CN.md)

gRPC for the lakutata framework, written in TypeScript on top of the HTTP/2 module of Node.js, with no native addon and
no generated code. It provides a client (`GRPCConnection`: unix sockets, TCP, TLS and mutual TLS; unary,
server-streaming and bidirectional calls), a server (`GRPCServer`) and a schema-driven protobuf codec (`encode`,
`decode`). The `@lakutata/grpc/service` subpath serves an application's service actions over gRPC
(`grpcServiceEntrypoint`, through the `lakutata.service.v1.Service` service of `SERVICE_PROTO`, which any language can
call) and lets another application invoke them (`GRPCServiceProxy`). The containerd component (`@lakutata/containerd`)
and its BuildKit builds use this package. The umbrella package `lakutata` does not re-export it: import it from
`@lakutata/grpc` and `@lakutata/grpc/service`.

## Installation

```shell
npm install @lakutata/grpc
```

The client, the server and the codec need nothing else (Node.js `^22.13.0 || >=24.11.0`). The service entrypoint and the
service proxy run in a lakutata application, so they need `lakutata`, which provides the package's peer dependencies
`@lakutata/core` and `@lakutata/entrypoint` (optional for the other uses).

```shell
npm install lakutata @lakutata/grpc
```

## Usage

### The service actions over gRPC

`grpcServiceEntrypoint` is the entrypoint's `service` adapter: the application's `@ServiceAction`s are invoked over
gRPC by their patterns, as over the other service transports.

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, Entrypoint, ServiceContext} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {grpcServiceEntrypoint} from '@lakutata/grpc/service'

class OrderController extends Controller {
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    //Invoked with {cmd: 'order.get', id: 1}
    @ServiceAction({cmd: 'order.get'})
    public async get(input: {id: number}): Promise<{id: number, status: string}> {
        return {id: input.id, status: 'paid'}
    }

    //Pushes an event to the calling client's event stream
    @ServiceAction({cmd: 'order.ship'})
    public async ship(input: {id: number}): Promise<void> {
        const clientId: string | undefined = (this.context as ServiceContext).clientId
        if (clientId) this.entrypoint.notify(clientId, 'orderChanged', {id: input.id, status: 'shipped'})
    }
}

Application.run(() => ({
    id: 'orders.service',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            //Port 50051 on all interfaces by default; socketPath for a unix socket, tls for TLS
            service: grpcServiceEntrypoint({port: 50051, compression: 'gzip'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

Another application invokes them with `GRPCServiceProxy`, a component registered with `buildGRPCServiceProxy`:

```typescript
import {Application} from 'lakutata'
import {ServiceInvokeException} from 'lakutata/com/entrypoint'
import {buildGRPCServiceProxy, type GRPCServiceProxy} from '@lakutata/grpc/service'

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            //host:port, tcp://host:port, /path or unix:///path
            orders: buildGRPCServiceProxy({address: 'orders.internal:50051'})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: GRPCServiceProxy = await app.getObject<GRPCServiceProxy>('orders')
        //The event stream opens with the first listener, and opens again after reconnectDelay when it ends
        orders.on('orderChanged', (order: {id: number, status: string}): void => console.log(order))
        //A 5-second deadline (10 minutes by default)
        console.log(await orders.invoke({cmd: 'order.get', id: 1}, 5000))
        try {
            await orders.invoke({cmd: 'order.cancel', id: 1})
        } catch (error) {
            //The remote action's error, with its errno and properties
            if (error instanceof ServiceInvokeException) console.log(error.errno, error.message)
            else throw error
        }
    })
```

- A client's id is the `id` metadata of its calls (`ServiceContext.clientId` in the actions); the proxy sends its
  `clientId` (a random UUID by default). `grpcCallOfContext(context)` gives an action the whole gRPC call, with its
  metadata and its deadline.
- An action's signal is aborted when the client cancels the call or its deadline passes; the call then ends with
  `CANCELLED` or `DEADLINE_EXCEEDED`.
- A failed action is answered with its error (message, `errno` and other properties), which the proxy throws as a
  `ServiceInvokeException`; transport failures are thrown as a `GRPCError` (`UNAVAILABLE`, `DEADLINE_EXCEEDED`…).
- Once the entrypoint stops, new invocations fail (the proxy throws a `ServiceInvokeException` whose `errno` is
  `E_ENTRYPOINT_STOPPED`) while those in progress complete; when it closes, the event streams end and the server
  closes.

### Calling the service from other languages

`SERVICE_PROTO` is the `.proto` file of the service: generate clients for other languages from it.

```text
service Service {
  rpc Invoke (InvokeRequest) returns (InvokeResponse);  // data: the JSON of the pattern and input
  rpc Events (EventsRequest) returns (stream Event);    // the events pushed to the client, "client" (its id) first
}
message InvokeResponse { bool success = 1; bytes payload = 2; bytes error = 3; }  // payload, error: JSON
message Event { string event = 1; bytes args = 2; }  // args: a JSON array
```

```typescript
import {writeFileSync} from 'node:fs'
import {SERVICE_PROTO} from '@lakutata/grpc/service'

writeFileSync('service.proto', SERVICE_PROTO)
```

A call sends the JSON of the action's pattern and input in `InvokeRequest.data`; the result or the error comes back as
JSON in `InvokeResponse.payload` or `InvokeResponse.error`; a client's id is its `id` metadata. With grpcurl (in its
JSON, `bytes` fields are base64):

```shell
DATA=$(printf '{"cmd":"order.get","id":7}' | base64)
grpcurl -plaintext -proto service.proto -H 'id: go-1' -d "{\"data\": \"$DATA\"}" localhost:50051 lakutata.service.v1.Service/Invoke
```

With the official gRPC library for Python (grpcio, with stubs generated by grpcio-tools):

```python
import json
import grpc
import service_pb2 as pb
import service_pb2_grpc as rpc

stub = rpc.ServiceStub(grpc.insecure_channel('localhost:50051'))
response = stub.Invoke(pb.InvokeRequest(data=json.dumps({'cmd': 'order.get', 'id': 5}).encode()), metadata=[('id', 'python-1')], timeout=5)
print(json.loads(response.payload) if response.success else json.loads(response.error))
```

`npm run test:interop` tests the service with grpcio and grpcurl (built on gRPC for Go) in Docker: invocations,
errors, gzip compression, deadlines, the size limit and events.

### The client

`GRPCConnection` calls any gRPC server; messages are described by schemas (see [the codec](#the-protobuf-codec)).

```typescript
import {readFileSync} from 'node:fs'
import {GRPCConnection, GRPCError, GRPCStatus, type BidiStream, type Message, type Schema} from '@lakutata/grpc'

const HelloRequest: Schema = {name: {no: 1, type: 'string'}}
const HelloReply: Schema = {message: {no: 1, type: 'string'}}

//A unix socket: '/run/greeter.sock' or 'unix:///run/greeter.sock'; TCP: 'tcp://host:port'
const local: GRPCConnection = new GRPCConnection('/run/greeter.sock')
//TLS: the server's certificate authority; mutual TLS: the client's certificate and key too
const remote: GRPCConnection = new GRPCConnection('tcp://greeter.internal:50051', {
    ca: readFileSync('ca.pem'),
    cert: readFileSync('client.pem'),
    key: readFileSync('client-key.pem')
}, {compression: 'gzip', maxMessageSize: 16 * 1024 * 1024})

try {
    //Unary, with metadata and a deadline in milliseconds
    const reply: Message = await remote.unary('/helloworld.Greeter/SayHello', HelloRequest, {name: 'Ada'}, HelloReply, {
        metadata: {authorization: 'Bearer token'},
        timeout: 5000
    })
    console.log(reply.message)

    //Server streaming, cancelled by a signal; leaving the loop cancels the call too
    const controller: AbortController = new AbortController()
    for await (const message of local.serverStream('/helloworld.Greeter/SayHelloAgain', HelloRequest, {name: 'Ada'}, HelloReply, {signal: controller.signal})) {
        console.log(message.message)
        if (message.message === 'stop') controller.abort()
    }

    //Bidirectional streaming (and client streaming): send, end, read the responses
    const chat: BidiStream = local.bidi('/helloworld.Greeter/Chat', HelloRequest, HelloReply)
    await chat.send({name: 'Ada'})
    await chat.send({name: 'Grace'})
    chat.end()
    for await (const message of chat.responses) console.log(message.message)
} catch (error) {
    if (error instanceof GRPCError && error.code === GRPCStatus.CANCELLED) console.log('Cancelled')
    else throw error
} finally {
    local.close()
    remote.close()
}
```

- The HTTP/2 session opens with the first call, and again with the next call after it closes; it keeps the process alive
  only while calls are in progress. Failed calls are not retried.
- Calls fail with a `GRPCError`: the server's status, or `UNAVAILABLE` (connection failed or lost), `CANCELLED` (signal
  aborted), `DEADLINE_EXCEEDED` (timeout passed), `RESOURCE_EXHAUSTED` (a response over `maxMessageSize`, unlimited by
  default) or `INTERNAL` (a response that cannot be decompressed or decoded).
- Metadata values are sent as they are (no percent or base64 encoding).

### The server

```typescript
import {readFileSync} from 'node:fs'
import type {AddressInfo} from 'node:net'
import {GRPCError, GRPCServer, GRPCStatus, type GRPCServerCall, type Schema} from '@lakutata/grpc'

const HelloRequest: Schema = {name: {no: 1, type: 'string'}}
const HelloReply: Schema = {message: {no: 1, type: 'string'}}

const server: GRPCServer = new GRPCServer({
    //TLS; with ca, the clients must present a certificate it signs (mutual TLS). Plain HTTP/2 without tls
    tls: {cert: readFileSync('server.pem'), key: readFileSync('server-key.pem'), ca: readFileSync('ca.pem')},
    //The largest request, in bytes (4 MiB by default)
    maxMessageSize: 1024 * 1024,
    //Responses are compressed for the clients that accept gzip
    compression: 'gzip'
})

server
    .method('/helloworld.Greeter/SayHello', async (call: GRPCServerCall): Promise<void> => {
        const [token] = call.metadata('authorization')
        if (!token) throw new GRPCError(GRPCStatus.UNAUTHENTICATED, 'A token is required', call.path)
        const request = await call.request(HelloRequest)
        await call.send(HelloReply, {message: `Hello ${request.name ?? 'world'}`})
    })
    //Bidirectional: a response per request, until the client ends its requests
    .method('/helloworld.Greeter/Chat', async (call: GRPCServerCall): Promise<void> => {
        for await (const request of call.requests(HelloRequest)) {
            //Aborted when the client cancels or the deadline passes
            call.signal.throwIfAborted()
            await call.send(HelloReply, {message: `Hello ${request.name ?? 'world'}`})
        }
    })

//Port 50051 by default (0 for a free one), or {socketPath: '/run/greeter.sock'}
const address = await server.listen({port: 50051}) as AddressInfo
console.log(`Listening on ${address.port}`)
//The calls in progress get 10 seconds to complete
process.once('SIGTERM', (): void => void server.close(10000))
```

- A handler ends its call when it settles: `OK` when it resolves, the code and message of the `GRPCError` it throws, or
  `UNKNOWN` for any other error. A call to an unknown method ends with `UNIMPLEMENTED`.
- A request larger than `maxMessageSize` is refused with `RESOURCE_EXHAUSTED`, either from its length before it is
  received or once it is decompressed. Requests may be compressed with gzip or deflate; responses are compressed only
  for clients that accept it.
- A call's deadline (`grpc-timeout`) aborts it: `call.signal` is aborted and the call ends with `DEADLINE_EXCEEDED`;
  the handler keeps running unless it watches the signal.
- `server.serve(socket)` serves an HTTP/2 connection carried by another byte stream (a BuildKit session, for example).

### The protobuf codec

A `Schema` replaces the `.proto` file and its generated code: it lists the fields of a message by property name, with
their numbers and types.

```typescript
import {decode, encode, type Message, type Schema} from '@lakutata/grpc'

//message Point { int32 x = 1; int32 y = 2; }
const Point: Schema = {x: {no: 1, type: 'int32'}, y: {no: 2, type: 'int32'}}
//message Route { string name = 1; repeated Point points = 2; map<string, string> labels = 3; uint64 started = 4; bytes data = 5; }
const Route: Schema = {
    name: {no: 1, type: 'string'},
    points: {no: 2, type: Point, repeated: true},
    labels: {no: 3, type: 'string', map: true},
    started: {no: 4, type: 'uint64'},
    data: {no: 5, type: 'bytes'}
}

const bytes: Uint8Array = encode(Route, {
    name: 'home',
    points: [{x: 1, y: 2}],
    labels: {zone: 'eu'},
    //A bigint keeps the 64 bits (nanoseconds); a number is exact up to 2^53
    started: 1700000000000000000n,
    data: Buffer.from('raw')
})
const route: Message = decode(Route, bytes)
console.log(route.name, route.points, route.labels, route.started, route.data)
```

| Type | Encoded from | Decoded as |
|---|---|---|
| `string` | a string (`String(value)`) | a string |
| `bytes` | a `Uint8Array`, or a string as UTF-8 | a `Buffer` |
| `bool` | a boolean | a boolean |
| `int32`, `uint32`, `int64`, `uint64`, `enum` | a `number` (truncated) or a `bigint` (64 bits) | a `number`; an `int64`/`uint64` beyond 2^53 as a `bigint` (keeping all 64 bits) |
| a `Schema` | an object | an object |

- Proto3 rules apply: default values (`0`, `''`, `false`, empty bytes) are not written, and a decoded message lacks
  them (read `message.count ?? 0`); repeated fields decode as arrays (`[]` when empty), and maps as objects.
- Repeated varints are written packed, and read packed or unpacked; map keys can only be strings.
- Fields that the schema does not declare are skipped. `sint32`/`sint64`, the fixed-size types, `float` and `double`
  are not supported.
- `decode` throws an `Error` on truncated bytes or on a wire type that its schema does not expect.

## API

| Export | Subpath | What it is |
|---|---|---|
| `GRPCConnection` | `@lakutata/grpc` | The client: `unary`, `serverStream`, `bidi`, `close` |
| `GRPCServer` | `@lakutata/grpc` | The server: `method`, `listen`, `serve`, `close`, `methods` |
| `GRPCServerCall` | `@lakutata/grpc` | A call received by a server: `request`, `requests`, `send`, `finish`, `metadata`, `deadline`, `signal` |
| `BidiStream` | `@lakutata/grpc` | A bidirectional call: `send`, `end`, `cancel`, `responses` |
| `CallOptions` | `@lakutata/grpc` | The metadata, signal and timeout of a call |
| `GRPCTLSOptions`, `GRPCServerTLSOptions` | `@lakutata/grpc` | The TLS options of a connection and of a server |
| `GRPCMessageOptions`, `GRPCCompression` | `@lakutata/grpc` | The message size limit and compression |
| `GRPCError`, `GRPCStatus` | `@lakutata/grpc` | A failed call, and the status codes |
| `parseGRPCTimeout`, `formatGRPCTimeout` | `@lakutata/grpc` | Convert the `grpc-timeout` header from and to milliseconds |
| `encode`, `decode` | `@lakutata/grpc` | The protobuf codec |
| `Schema`, `Field`, `ScalarType`, `Message` | `@lakutata/grpc` | Message definitions and messages |
| `grpcServiceEntrypoint`, `GRPCServiceEntrypointOptions` | `@lakutata/grpc/service` | The service adapter that serves the service actions over gRPC |
| `grpcCallOfContext` | `@lakutata/grpc/service` | The gRPC call behind a service context |
| `GRPCServiceProxy`, `buildGRPCServiceProxy`, `BuildGRPCServiceProxyOptions` | `@lakutata/grpc/service` | The client component for a service: `invoke`, `on`, `once`, `off`, `id` |
| `SERVICE_PROTO`, `SERVICE_METHODS` | `@lakutata/grpc/service` | The `.proto` file of the service and its method paths |

The typings document each declaration, with examples.

## Errors

| Error | Thrown when |
|---|---|
| `GRPCError` (`code`: a `GRPCStatus`, `path`) | A call fails: the server's status, or `UNAVAILABLE` (connection failed or lost, no status), `CANCELLED` (signal aborted, stream cancelled, call closed), `DEADLINE_EXCEEDED` (timeout passed), `RESOURCE_EXHAUSTED` (a message over `maxMessageSize`), `INTERNAL` (a message that cannot be decompressed or decoded) or `UNKNOWN` (an HTTP status other than 200). A server handler throws it to end its call with that status. |
| `ServiceInvokeException` (`E_SERVICE_INVOKE`, from `lakutata/com/entrypoint`) | `GRPCServiceProxy.invoke()`: the remote action failed; the exception carries the remote error's message and properties (`errno`…) |
| `EntrypointStoppedException` (`E_ENTRYPOINT_STOPPED`) | An invocation arrives while the service's entrypoint is stopping (the proxy receives it as a `ServiceInvokeException` with this errno) |
| `Error` | `new GRPCConnection()` with an address that is not a unix socket path, a `tcp://` URL or `host:port`, or with TLS over a unix socket; `decode()` with truncated or unexpected bytes; `GRPCServer.listen()` with the listen error (`EADDRINUSE`) |

A server ends a call to an unknown method, or one with an unsupported compression, with `UNIMPLEMENTED`; a request
over its `maxMessageSize` with `RESOURCE_EXHAUSTED`; and a call past its deadline with `DEADLINE_EXCEEDED`.

## See also

- The guide on the website: [gRPC](https://lakutata.com/guide/GRPC).
- `@lakutata/entrypoint` (`lakutata/com/entrypoint`): the entrypoint, controllers and service actions
  (`doc/en/ServiceCalls.md` in the `lakutata` package, Chinese version in `doc/zh`).
- `@lakutata/nats`: service actions over NATS, with the same patterns.
- `@lakutata/containerd` (`doc/en/ContainerdIntegration.md` in the `lakutata` package): containerd and BuildKit, over
  this client.
