# Lakutata Service Transports

This guide covers the service transports. The controllers, the actions, their input and their results are described in
[Controllers](Controllers.md); the entrypoint and the list of its adapters in [Entrypoint](Entrypoint.md); the
middlewares and the access control in [Middlewares](Middlewares.md); the HTTP adapters in [HTTP](HTTP.md).

## 1. Service actions: `@ServiceAction`

```text
@ServiceAction(pattern, DTOClass?, options?)
```

- The pattern is an object (nested 2 levels at most) whose keys a message must hold with the same values; a string
  value may be a glob (`'user.*'`). The most specific matching pattern wins. The input is the message without the keys
  of the pattern.
- The caller receives `{success: true, error: null, payload}`, or `{success: false, error, payload: null}` where
  `error` holds the properties of the error (`errno`, `errMsg`, `statusCode`, `message`…); JSON-RPC answers with its
  own `result` and `error`. A message no pattern matches fails with `ControllerActionNotFoundException`.

## 2. The transports

The adapters of the transports, and the packages they need, are listed in [Entrypoint](Entrypoint.md), section 2.

### The clients of the service actions and their events

The service adapters with clients give the id of the client of a request to its context, `ServiceContext.clientId`:
`electronIPCServiceEntrypoint` (each page of a window), `socketIOServiceEntrypoint` (each socket, its id given when it
connects by its `auth.id` or its `id` header), `httpServiceEntrypoint` (the `id` header of the `POST` requests, the `id`
header or query of the event stream `GET /events`), `jsonRPCServiceEntrypoint` over WebSocket and stdio, and
`grpcServiceEntrypoint` (the `id` metadata). The entrypoint pushes events to a client with `notify(clientId, event,
...args)` (it returns whether a client received it) or to every client with `broadcast(event, ...args)` (it returns the
number of clients):

```typescript
import {Controller, Entrypoint, ServiceContext} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'

class TaskController extends Controller {
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    @ServiceAction({cmd: 'start'})
    public async start(): Promise<void> {
        const clientId: string | undefined = (this.context as ServiceContext).clientId
        if (clientId) setTimeout((): void => void this.entrypoint.notify(clientId, 'done', {task: 1}), 1000)
        this.entrypoint.broadcast('started', {task: 1})
    }
}
```

The renderers of Electron listen to the events with `window.ipc.on(event, listener)` (the Electron templates), the
sockets with `socket.on(event, listener)`, the HTTP clients with the Server-Sent Events of `GET /events`
(`EventSource`, curl). A page of a window is a client until it is loaded again or its window is closed.

### JSON-RPC 2.0

`jsonRPCServiceEntrypoint` serves the service actions over JSON-RPC 2.0: the method and the params (by name) of a
request are the pattern and the input of an action, `{"method": "order.get", "params": {"id": 1}}` being dispatched as
`{method: 'order.get', id: 1}` (`methodField` names the field, `toPattern(method, params)` maps them to other patterns,
`positionalParams` accepts the params by position). The batches and the notifications follow the specification; the
errors are `-32601` (no action matches), `-32602` (the DTO refuses the input) and `-32000` (the errors of the actions,
the whole error as their `data`). The transports are HTTP (`POST`), WebSocket (the package `ws`) and stdio (framed by
lines or by `Content-Length` headers); the last two push the events of the clients as notifications. Over WebSocket, the
connections that do not answer the pings are closed (`heartbeat`, 30 s); over stdio, the application exits once its
input ends (`end: 'application'`).

```text
service: [
    jsonRPCServiceEntrypoint({port: 4000, path: '/rpc'}),
    jsonRPCServiceEntrypoint({transport: 'websocket', port: 4001}),
    jsonRPCServiceEntrypoint({transport: 'stdio', framing: 'content-length'})
]
```

### gRPC and NATS

`grpcServiceEntrypoint` (`@lakutata/grpc/service`) and `natsServiceEntrypoint` (`@lakutata/nats`) serve the service
actions over gRPC and over NATS; their proxies call them from other applications. See [GRPC](GRPC.md) and
[NATS](NATS.md).
