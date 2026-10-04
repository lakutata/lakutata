# @lakutata/grpc

gRPC for the lakutata framework, written in TypeScript over the HTTP/2 of Node.js (no native addon, no generated
code):

- `@lakutata/grpc`: its client (`GRPCConnection`: unix sockets, TCP, TLS; unary calls, server streams, bidirectional
  streams), its server (`GRPCServer`: ports, unix sockets, TLS, or the connections of HTTP/2 carried by other streams)
  and its protobuf codec driven by schemas (`Encode`, `Decode`). The containerd component and its builds with BuildKit
  use them.
- `@lakutata/grpc/service`: the service actions over gRPC. `GRPCServiceEntrypoint` serves the service channel of an
  application as the service `lakutata.service.v1.Service` (`SERVICE_PROTO`), `GRPCServiceProxy` invokes the actions of
  a remote service and listens to its events, as the proxy of NATS does.

```typescript
import {GRPCServiceEntrypoint, BuildGRPCServiceProxy, type GRPCServiceProxy} from '@lakutata/grpc/service'

//The service
entrypoint: BuildEntrypoint({controllers: [OrderController], service: GRPCServiceEntrypoint({port: 50051})})

//Its clients
components: {orders: BuildGRPCServiceProxy({address: 'orders.internal:50051'})}
const orders: GRPCServiceProxy = await app.getObject('orders')
await orders.invoke({cmd: 'order.get', id: 1})
orders.on('orderChanged', (order) => {})
```

The clients of the other languages are generated from `SERVICE_PROTO`: an action is invoked with the JSON of its
pattern and its input (`InvokeRequest.data`), its result or its error is the JSON of `InvokeResponse`; the id of a
client is its metadata `id`.

A request larger than `maxMessageSize` (4 MB by default for the servers) is refused with `RESOURCE_EXHAUSTED`, before it
is received or once decompressed; the messages may be compressed (gzip, deflate), the responses of a server only for the
clients accepting it; the deadline of a call (`grpc-timeout`) aborts it (`call.signal`, `DEADLINE_EXCEEDED`).

`npm run test:interop` checks the service with the official gRPC of Python (grpcio) and grpcurl (the gRPC of Go), in
Docker.
