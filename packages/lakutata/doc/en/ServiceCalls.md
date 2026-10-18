# Lakutata Service Calls

A service action (`@ServiceAction`) is called with a message rather than a URL: an object whose keys select the action,
its **pattern**, and whose other keys are the input. The same actions can be served over several transports at once:
plain HTTP, Socket.IO, JSON-RPC 2.0 (over HTTP, WebSocket or the standard input and output) and the IPC of Electron, as
this guide describes, and gRPC and NATS, which have their own guides. The controllers and their actions are described
in [Controllers](Controllers.md), the entrypoint and its adapters in [Entrypoint](Entrypoint.md).

## 1. A first service

```typescript
import {Application, DTO, Exception} from 'lakutata'
import {buildEntrypoints, Controller, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'

class NewOrderDTO extends DTO {
    @Expect(DTO.String().required())
    public product: string
}

class OrderIdDTO extends DTO {
    @Expect(DTO.Number().integer().required())
    public id: number
}

class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'

    public statusCode: number = 404
}

type Order = { id: number, product: string }

const orders: Map<number, Order> = new Map()

class OrderController extends Controller {
    //The message {resource: 'order', act: 'create', product: 'lamp'}: the input is {product: 'lamp'}
    @ServiceAction({resource: 'order', act: 'create'}, NewOrderDTO)
    public async create(input: NewOrderDTO): Promise<Order> {
        const order: Order = {id: orders.size + 1, product: input.product}
        orders.set(order.id, order)
        return order
    }

    @ServiceAction({resource: 'order', act: 'get'}, OrderIdDTO)
    public async get(input: OrderIdDTO): Promise<Order> {
        const order: Order | undefined = orders.get(input.id)
        if (!order) throw new OrderNotFoundException('Order {id} not found', {id: input.id})
        return order
    }
}

Application.run(() => ({
    id: 'orders.app',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            //POST http://localhost:3000/ with the message as its JSON body
            service: httpServiceEntrypoint({port: 3000})
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ curl localhost:3000 -H 'Content-Type: application/json' -d '{"resource": "order", "act": "create", "product": "lamp"}'
{"success":true,"error":null,"payload":{"id":1,"product":"lamp"}}
$ curl localhost:3000 -H 'Content-Type: application/json' -d '{"resource": "order", "act": "get", "id": 1}'
{"success":true,"error":null,"payload":{"id":1,"product":"lamp"}}
$ curl localhost:3000 -H 'Content-Type: application/json' -d '{"resource": "order", "act": "get", "id": 9}'
{"success":false,"error":{…,"message":"Order 9 not found","errMsg":"Order 9 not found","err":"OrderNotFoundException","errno":"E_ORDER_NOT_FOUND"},"payload":null}
```

The error carries all the properties of the exception (section 3).

## 2. Patterns

A message matches a pattern when it holds the keys of the pattern with the same values. The keys of the pattern are
then removed from the message, and the rest is the input of the action. With the actions below:

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'

class OrderController extends Controller {
    @ServiceAction({resource: 'order', act: 'get'})
    public async get(input: Record<string, unknown>): Promise<unknown> {
        return input
    }

    //The other messages of the resource "order"
    @ServiceAction({resource: 'order'})
    public async other(input: Record<string, unknown>): Promise<unknown> {
        return input
    }

    @ServiceAction({resource: 'order', act: 'audit.*'})
    public async audit(input: Record<string, unknown>): Promise<unknown> {
        return input
    }

    @ServiceAction({res: {name: 'user'}, act: 'get'})
    public async user(input: Record<string, unknown>): Promise<unknown> {
        return input
    }

    @ServiceAction({version: 2, act: 'info'})
    public async info(): Promise<string> {
        return 'v2'
    }
}
```

| Message | Action | Input |
|---|---|---|
| `{resource: 'order', act: 'get', id: 1}` | `get` | `{id: 1}` |
| `{resource: 'order', act: 'list', page: 1}` | `other` | `{act: 'list', page: 1}` |
| `{resource: 'order', act: 'audit.read', who: 'ada'}` | `audit` | `{who: 'ada'}` |
| `{res: {name: 'user', extra: 1}, act: 'get', q: 1}` | `user` | `{res: {extra: 1}, q: 1}` |
| `{version: '2', act: 'info'}` | `info` | `{}` |
| `{resource: 'invoice'}` | None: `ControllerActionNotFoundException` | |

- When several patterns match, the most specific one wins: the one with the most keys.
- A string value of a pattern may be a glob: `*` matches any characters, `?` one character.
- The values are compared as text: the pattern `{version: 2}` matches `version: '2'`.
- A pattern may nest objects, two levels at most; their keys are compared one by one.
- `@Prefix({pattern})` merges a pattern into the patterns of all the actions of a controller (see
  [Controllers](Controllers.md), section 6).
- A message that no pattern matches fails with `ControllerActionNotFoundException` (`E_CONTROLLER_ACTION_NOT_FOUND`).
- A message is JSON, so its values keep their types: unlike the query of an HTTP request, `"2"` is not converted for a
  schema that expects a number.

## 3. The response

The HTTP service, Socket.IO and Electron answer with an envelope; JSON-RPC answers with its own responses (section 4).

```text
{"success": true, "error": null, "payload": <the result>}
{"success": false, "error": <the error>, "payload": null}
```

- An action that returns nothing gives no `payload`: `{"success": true, "error": null}`.
- `error` is a copy of all the own properties of the error: `message`, `stack`, `errno`, `errMsg`, `statusCode`, `err`
  (the name of its class), `appId`, `appName`, and those of the exception's own class. The client gets the whole error
  as the action threw it.
- `Result.status(status, data)` sends its data. A file or an event stream (`Result.file()`, `Result.events()`) cannot
  be sent: the call fails.

The applications that call a service read the envelope through a proxy: `HTTPServiceProxy` for the HTTP service
(section 4), and the proxies of the NATS and gRPC transports. A proxy returns the `payload`, or throws a
`ServiceInvokeException` that carries the properties of the remote error. Other clients, such as the pages of a
browser, read the envelope themselves, for example:

```typescript
type Envelope<T> = { success: boolean, error: { message?: string, errno?: string } | null, payload: T }

export async function call<T>(message: Record<string, unknown>): Promise<T> {
    const response: Response = await fetch('http://localhost:3000/', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(message)
    })
    const envelope: Envelope<T> = await response.json() as Envelope<T>
    //The properties of the error (errno, statusCode…) copied onto an Error
    if (!envelope.success) throw Object.assign(new Error(envelope.error?.message ?? 'The call failed'), envelope.error)
    return envelope.payload
}
```

## 4. The transports

| Adapter | Imported from | To install | A request is | Events pushed |
|---|---|---|---|---|
| `httpServiceEntrypoint()` | `lakutata/com/entrypoint` | | A `POST` of the message as JSON | Server-Sent Events |
| `socketIOServiceEntrypoint()` | `lakutata/adapter/socket.io` | `socket.io` (`socket.io-client` on the clients) | An emit with an acknowledgement | Socket.IO events |
| `jsonRPCServiceEntrypoint()` | `lakutata/adapter/jsonrpc` | `ws`, for WebSocket | A JSON-RPC 2.0 request | Notifications (WebSocket, stdio) |
| `electronIPCServiceEntrypoint()` | `lakutata/adapter/electron` | (Electron) | `ipcRenderer.invoke()` | IPC messages |
| `grpcServiceEntrypoint()` | `@lakutata/grpc/service` | `@lakutata/grpc` | See [GRPC](GRPC.md) | gRPC streams |
| `natsServiceEntrypoint()` | `@lakutata/nats` | `@lakutata/nats` | See [NATS](NATS.md) | NATS messages |

Each adapter also takes `name`, to tell several adapters apart, and `middlewares`, run after those of the entrypoint
(see [Middlewares](Middlewares.md)).

### HTTP service

`httpServiceEntrypoint()` serves the actions over plain HTTP: it suits the tools (curl, Postman), the scripts, and the
pages of a web UI during its development. The Electron templates add it in development for that.

| Option | Default | Meaning |
|---|---|---|
| `port` | `3000` | The port; `0` picks a free port |
| `host` | all the interfaces | The address to listen on |
| `path` | `'/'` | The path of the requests; the events are under it, at `<path>/events` |
| `limit` | `10485760` (10 MiB) | The largest body, in bytes |
| `listening` | | `(server) => …`, called once the server listens |

- A request is a `POST` to `path`, its body the message as JSON. It is answered with 200 and the envelope, whatever the
  result of the action. A body that is not JSON is answered with 400, a body over `limit` with 413, another method or
  path with 404; these responses carry an envelope too.
- The CORS headers allow any origin, the methods `GET`, `POST` and `OPTIONS`, and any request header, such as
  `Authorization`.
- The client gives its id in the `id` header, or in the `id` query parameter (section 5).
- `GET <path>/events` streams the events pushed to the client, as Server-Sent Events. The first event, `client`, gives
  the id of the client (a random one when the request gives none); then each event has its name, and the JSON array of
  its arguments as its data. A comment keeps the stream alive every 15 seconds.

```text
event: client
data: ["client-1"]

event: progress
data: [50,"half"]
```

In a browser, `EventSource` reads them:

```typescript
const events: EventSource = new EventSource('http://localhost:3000/events?id=client-1')
events.addEventListener('progress', (event: MessageEvent): void => console.log(JSON.parse(event.data)))
```

Another application calls the service through an `HTTPServiceProxy`, a component registered with
`buildHTTPServiceProxy()`. Here it calls the orders service of section 1:

```typescript
import {Application} from 'lakutata'
import {buildHTTPServiceProxy, type HTTPServiceProxy, ServiceInvokeException} from 'lakutata/com/entrypoint'

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            orders: buildHTTPServiceProxy({url: 'http://localhost:3000/'})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: HTTPServiceProxy = await app.getObject<HTTPServiceProxy>('orders')
        //{id: 1, product: 'lamp'}
        console.log(await orders.invoke({resource: 'order', act: 'create', product: 'lamp'}))
        try {
            //5 seconds at most
            await orders.invoke({resource: 'order', act: 'get', id: 9}, 5000)
        } catch (error) {
            //The error of the action, with its properties: E_ORDER_NOT_FOUND
            if (error instanceof ServiceInvokeException) console.log(error.errno)
        }
    })
```

| Option | Default | Meaning |
|---|---|---|
| `url` | | The address of the service, with the `path` of its adapter |
| `headers` | | The headers sent with each call and with the event stream, such as `Authorization` |
| `clientId` | a random UUID | The id of this client (section 5) |
| `reconnectDelay` | `1000` | The delay, in milliseconds, before the event stream is opened again |

- `invoke(message, timeout)` posts the message and returns the `payload`. The timeout is 10 minutes by default; when it
  passes, the call is abandoned and the service aborts the signal of the action.
- An action that fails throws a `ServiceInvokeException` with the properties of its error (section 3). A service that
  gives no response throws a `ServiceUnavailableException` (`E_SERVICE_UNAVAILABLE`, status 503): it cannot be
  reached, it does not answer within the timeout, or its answer is not an envelope (the error page of a proxy in front
  of it).
- `on(event, listener)`, `once()` and `off()` listen to the events that the service pushes to this client. The first
  listener opens the event stream. When the stream drops, it is opened again after `reconnectDelay`; the events pushed
  in the meantime are lost.

### Socket.IO

`socketIOServiceEntrypoint()` serves the actions over Socket.IO: it suits the browsers and the clients that stay
connected.

| Option | Default | Meaning |
|---|---|---|
| `port` | `3000` | The port of its own server; `0` picks a free port |
| `host` | all the interfaces | The address of its own server |
| `event` | `'message'` | The event of the requests |
| `namespace` | `'/'` | The namespace of the requests |
| `options` | | The options of the Socket.IO server: `cors`, `path`, `maxHttpBufferSize`… |
| `server` | | An HTTP server to share, or a function returning it (below) |
| `io` | | An existing Socket.IO server, used as it is |
| `listening` | | `(io, server) => …`, called once the adapter is ready |

```typescript
import {io, type Socket} from 'socket.io-client'

//Identified as client-1 (section 5)
const socket: Socket = io('http://localhost:3000', {auth: {id: 'client-1'}})
socket.on('progress', (percent: number): void => console.log(`${percent}%`))
//{success: true, error: null, payload: {id: 1, product: 'lamp'}}, or an error after 5 seconds without an answer
console.log(await socket.timeout(5000).emitWithAck('message', {resource: 'order', act: 'get', id: 1}))
```

- A request is an emit of `event` with the message, and a callback that receives the envelope. An emit without a
  callback still runs the action.
- The browsers of another origin need `options: {cors: {origin: …}}`.
- `socketOfContext(this.context)`, from `lakutata/adapter/socket.io`, gives the socket of a request, to join it to a
  room for example.

Socket.IO can share the port of the HTTP adapter: give it the server that the `before` hook of `expressHTTPEntrypoint`
receives. The adapters start in the order of the options, so declare `http` before `service`:

```typescript
import type {Server} from 'node:http'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'

let httpServer: Server | undefined

export const entrypoint = buildEntrypoints({
    controllers: [],
    http: expressHTTPEntrypoint({port: 8080, before: (_app, context): void => void (httpServer = context.server)}),
    //The HTTP actions and Socket.IO on the port 8080
    service: socketIOServiceEntrypoint({server: (): Server => httpServer!})
})
```

When it stops, the adapter disconnects the sockets and leaves the shared server to its owner.

### JSON-RPC 2.0

`jsonRPCServiceEntrypoint()` serves the actions over JSON-RPC 2.0: it suits the clients written in other languages,
the tools that speak the protocol, and the parent processes over the standard input and output.

| Option | Default | Meaning |
|---|---|---|
| `transport` | `'http'` | `'http'` (a `POST` per message), `'websocket'` (needs `ws`) or `'stdio'` |
| `port`, `host`, `path` | `3000`, all the interfaces, `'/'` | The server of HTTP or WebSocket |
| `limit` | `10485760` (10 MiB) | The largest message, in bytes |
| `methodField` | `'method'` | The key of the pattern that receives the method |
| `positionalParams` | | The key of the input that receives the params given as an array; without it, they are refused |
| `toPattern` | | `(method, params) => message`: builds the message itself, replacing the two options above |
| `framing` | `'newline'` | On stdio: one message per line, or `'content-length'` (headers, as the Language Server Protocol) |
| `input`, `output` | `process.stdin`, `process.stdout` | The streams of stdio |
| `end` | `'application'` | When the input of stdio ends: `'application'` exits the application once the requests in progress are answered, `'none'` does nothing, or a function |
| `heartbeat` | `30000` | The interval of the pings of WebSocket, in milliseconds; `0` sends none |
| `listening` | | `(server) => …`, called once the server of HTTP or WebSocket listens |

The method and the params of a request make the message: `{"method": "order.get", "params": {"id": 1}}` is the message
`{method: 'order.get', id: 1}`, so the action declares the method in its pattern:

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'

class OrderRPCController extends Controller {
    //{"jsonrpc": "2.0", "id": 1, "method": "order.get", "params": {"id": 1}}
    @ServiceAction({method: 'order.get'})
    public async get(input: { id: number }): Promise<{ id: number }> {
        return {id: input.id}
    }
}
```

- The result is the `result` of the response, `null` when the action returns nothing.
- A request without `id` is a notification: the action runs, and nothing is answered (204 over HTTP). A batch, an array
  of requests, is answered with an array of responses.
- An error is an `error` with a code:

  | Code | When |
  |---|---|
  | `-32700` | The message is not JSON |
  | `-32600` | The message is not a JSON-RPC 2.0 request, or the batch is empty |
  | `-32601` | No action matches the request |
  | `-32602` | The input fails the validation of the DTO, or the params are an array without `positionalParams` |
  | `-32000` | Any other error of the action, the whole error being its `data` |
  | `-32001` | The application is stopping |

- Over HTTP, the requests are `POST`s to `path`, answered with 200; another method or path is answered with 404. The
  CORS headers allow any origin and any request header.
- Over WebSocket, each text frame is a message. The events pushed to the client are sent as notifications:
  `{"jsonrpc": "2.0", "method": "<event>", "params": [<arguments>]}`.

**Over stdio**, the application is a child process: its parent writes the requests on its standard input and reads the
responses and the events on its standard output. The standard output belongs to the protocol: write the logs of the
application to the standard error, and never call `console.log()`.

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Logger} from 'lakutata/com/logger'
import {jsonRPCServiceEntrypoint} from 'lakutata/adapter/jsonrpc'

class ToolController extends Controller {
    @ServiceAction({method: 'sum'})
    public async sum(input: { values: number[] }): Promise<number> {
        return input.values.reduce((total: number, value: number): number => total + value, 0)
    }
}

Application.run(() => ({
    id: 'tool.app',
    name: 'Tool',
    components: {
        //The standard output belongs to the protocol
        log: {class: Logger, destinations: [process.stderr]},
        entrypoint: buildEntrypoints({
            controllers: [ToolController],
            service: jsonRPCServiceEntrypoint({transport: 'stdio'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ echo '{"jsonrpc": "2.0", "id": 1, "method": "sum", "params": {"values": [1, 2, 3]}}' | node build/App.js
{"jsonrpc":"2.0","id":1,"result":6}
```

The application exits once its input ends and its requests are answered (`end`).

### Electron

`electronIPCServiceEntrypoint()` serves the actions to the windows of an Electron application, in its main process.

| Option | Default | Meaning |
|---|---|---|
| `channel` | `'lakutata:service'` | The IPC channel of the requests; the events use `<channel>:event`, the subscriptions `<channel>:subscribe` |
| `ipcMain` | the `ipcMain` of Electron | The `ipcMain` to serve, or a stand-in in the tests |

The pages call the main process through the preload script of their window:

```typescript
import {contextBridge, ipcRenderer, type IpcRendererEvent} from 'electron'

contextBridge.exposeInMainWorld('service', {
    //Resolves to the envelope, never rejects
    invoke: (message: Record<string, unknown>, clientId: string): Promise<unknown> => ipcRenderer.invoke('lakutata:service', message, clientId),
    //The events pushed to the page: their name, and the array of their arguments
    subscribe: (clientId: string, listener: (event: string, args: unknown[]) => void): void => {
        ipcRenderer.on('lakutata:service:event', (_event: IpcRendererEvent, name: string, args: unknown[]): void => listener(name, args))
        ipcRenderer.send('lakutata:service:subscribe', clientId)
    }
})
```

- Each page gives its own client id (`crypto.randomUUID()`) when it subscribes and when it invokes; a page reloaded in
  its window replaces its previous id. A page without an id receives no event.
- `ipcEventOfContext(this.context)`, from `lakutata/adapter/electron`, gives the IPC event of a request, to reach the
  window that sent it.
- The Electron templates of `lakutata create` contain a preload script of this shape, and a `window.ipc` for the pages,
  whose `invoke()` returns the payload or throws the error.

## 5. Clients and events

The transports that keep their clients connected can push events to them. A client is identified by the id it gives:

| Transport | Client id |
|---|---|
| HTTP service | The `id` header or `id` query parameter of the request; for the event stream, a random id when it gives none |
| Socket.IO | The `auth.id` of the connection, else its `id` header, else its `id` query parameter, else the id of the socket |
| JSON-RPC over HTTP | The `id` header or `id` query parameter of the request; it receives no event |
| JSON-RPC over WebSocket | The `id` header or `id` query parameter of the connection, else a random id |
| JSON-RPC over stdio | `'stdio'` |
| Electron | The id the page gives when it subscribes or invokes |

An action reads the id of its client in `this.context.clientId`. The `entrypoint` component pushes the events:

- `notify(clientId, event, ...args)` sends an event to a client, on every transport where it is connected, and returns
  whether it reached it;
- `broadcast(event, ...args)` sends an event to every connected client, and returns their number.

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
        //The client is told when its task is done, every client that a task started
        if (clientId) setTimeout((): void => void this.entrypoint.notify(clientId, 'done', {task: 1}), 1000)
        this.entrypoint.broadcast('started', {task: 1})
    }
}
```

A client receives `notify(clientId, 'progress', 50, 'half')` as:

| Transport | Received |
|---|---|
| HTTP service | `event: progress` and `data: [50,"half"]` on its event stream |
| Socket.IO | `socket.on('progress', (percent, label) => …)` |
| JSON-RPC (WebSocket, stdio) | `{"jsonrpc": "2.0", "method": "progress", "params": [50, "half"]}` |
| Electron | `('progress', [50, 'half'])`, through the `subscribe` of the preload script above |

## 6. Stopping and leaving

- When the application stops, the new requests fail with `EntrypointStoppedException` (`E_ENTRYPOINT_STOPPED`; the
  code `-32001` over JSON-RPC), and the requests in progress get the `shutdownTimeout` of the entrypoint (see
  [Entrypoint](Entrypoint.md), section 4).
- When a client leaves before its response (a socket disconnected, a window closed, an HTTP connection closed), the
  `this.signal` of its request is aborted.
- The transports set no time limit to the calls: a client sets its own, such as `socket.timeout(5000)` above.
