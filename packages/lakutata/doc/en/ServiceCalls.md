# Lakutata Service Calls

A service action (`@ServiceAction`) is called with a message rather than a URL: an object whose keys select the action,
its **pattern**, and whose other keys are the input. The same actions can be served over several transports at the same
time: plain HTTP, Socket.IO, JSON-RPC 2.0 (over HTTP, WebSocket or standard input and output), Electron IPC, NW.js
windows and the user interface of a React Native mobile application, as this guide describes, and gRPC, NATS and WebRTC
data channels, which have their own guides. Controllers and their actions are described in [Controllers and
Actions](Controllers.md), the entrypoint and its adapters in [Entrypoint](Entrypoint.md).

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

The error carries all the exception's properties (section 3).

## 2. Patterns

A message matches a pattern when it contains the pattern's keys with the same values. The pattern's keys are then
removed from the message, and the rest is the action's input. With the actions below:

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
- A string value in a pattern may be a glob: `*` matches any characters, `?` one character.
- Values are compared as text: the pattern `{version: 2}` matches `version: '2'`.
- A pattern may nest objects, two levels at most; their keys are compared one by one.
- `@Prefix({pattern})` merges a pattern into the patterns of every action in a controller (see [Controllers and
  Actions](Controllers.md), section 6).
- A message that no pattern matches fails with `ControllerActionNotFoundException` (`E_CONTROLLER_ACTION_NOT_FOUND`).
- A message is JSON, so its values keep their types: unlike an HTTP request's query, `"2"` is not converted for a schema
  that expects a number.

## 3. The response

The HTTP service, Socket.IO, Electron, NW.js and React Native respond with an envelope; JSON-RPC uses its own response
format (section 4).

```text
{"success": true, "error": null, "payload": <the result>}
{"success": false, "error": <the error>, "payload": null}
```

- An action that returns nothing produces no `payload`: `{"success": true, "error": null}`.
- `error` is a copy of all the error's own properties: `message`, `stack`, `errno`, `errMsg`, `statusCode`, `err` (its
  class name), `appId`, `appName`, and those of the exception's own class. The client receives the whole error as the
  action threw it.
- `Result.status(status, data)` sends its data. A file or an event stream (`Result.file()`, `Result.events()`) cannot
  be sent: the call fails.

Applications that call a service read the envelope through a proxy: `HTTPServiceProxy` for the HTTP service (section 4),
and the NATS and gRPC proxies. A proxy returns the `payload`, or throws a `ServiceInvokeException` that carries the
remote error's properties. Other clients, such as browser pages, read the envelope themselves, for example:

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
| `socketIOServiceEntrypoint()` | `lakutata/adapter/socket.io` | `socket.io` (`socket.io-client` on clients) | An emit with an acknowledgement | Socket.IO events |
| `jsonRPCServiceEntrypoint()` | `lakutata/adapter/jsonrpc` | `ws`, for WebSocket | A JSON-RPC 2.0 request | Notifications (WebSocket, stdio) |
| `electronIPCServiceEntrypoint()` | `lakutata/adapter/electron` | (Electron) | `ipcRenderer.invoke()` | IPC messages |
| `nwjsServiceEntrypoint()` | `lakutata/adapter/nwjs` | (NW.js) | A call to its bridge from a window's host page | Calls to the function the host page provides |
| `reactNativeServiceEntrypoint()` | `lakutata/adapter/react-native` | | A line of JSON from the host | Lines of JSON |
| `grpcServiceEntrypoint()` | `@lakutata/grpc/service` | `@lakutata/grpc` | See [gRPC](GRPC.md) | gRPC streams |
| `natsServiceEntrypoint()` | `@lakutata/nats` | `@lakutata/nats` | See [NATS](NATS.md) | NATS messages |
| `webrtcServiceEntrypoint()` | `@lakutata/webrtc` | `@lakutata/webrtc` | A JSON-RPC 2.0 request on a data channel, see [WebRTC](WebRTC.md) | Notifications |

Each adapter also takes `name`, to distinguish several adapters, and `middlewares`, run after the entrypoint's (see
[Middlewares and Access Control](Middlewares.md)).

### HTTP service

`httpServiceEntrypoint()` serves the actions over plain HTTP: it suits tools (curl, Postman), scripts, and a web UI's
pages during development. The Electron templates add it in development for this purpose.

| Option | Default | Meaning |
|---|---|---|
| `port` | `3000` | The port; `0` picks a free port |
| `host` | all interfaces | The address to listen on |
| `path` | `'/'` | The request path; events are under it, at `<path>/events` |
| `limit` | `10485760` (10 MiB) | The largest body, in bytes |
| `listening` | | `(server, listeners) => …`, called once the server listens (`listeners`, with `interface`: see below) |

- A request is a `POST` to `path`, whose body is the message as JSON. The response is a 200 with the envelope, whatever
  the action's result. A body that is not JSON receives a 400 response, a body over `limit` a 413, and another method or
  path a 404; these responses carry an envelope too.
- The CORS headers allow any origin, the methods `GET`, `POST` and `OPTIONS`, and any request header, such as
  `Authorization`.
- The client provides its ID in the `id` header, or in the `id` query parameter (section 5).
- `GET <path>/events` streams the events pushed to the client, as Server-Sent Events. The first event, `client`, carries
  the client's ID (a random one when the request provides none); then each event has its name, and the JSON array of its
  arguments as its data. A comment keeps the stream alive every 15 seconds.

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
`buildHTTPServiceProxy()`. Here it calls the orders service from section 1:

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
| `url` | | The service's address, with its adapter's `path` |
| `headers` | | The headers sent with each call and with the event stream, such as `Authorization` |
| `clientId` | a random UUID | This client's ID (section 5) |
| `reconnectDelay` | `1000` | The delay, in milliseconds, before the event stream is reopened |

- `invoke(message, timeout)` posts the message and returns the `payload`. The timeout is 10 minutes by default; when it
  expires, the call is abandoned and the service aborts the action's signal.
- When an action fails, the call throws a `ServiceInvokeException` with the error's properties (section 3). When the
  service sends no response, the call throws a `ServiceUnavailableException` (`E_SERVICE_UNAVAILABLE`, status 503): the
  service cannot be reached, does not respond within the timeout, or its response is not an envelope (such as the error
  page of a proxy in front of it).
- `on(event, listener)`, `once()` and `off()` listen to the events that the service pushes to this client. The first
  listener opens the event stream. When the stream drops, it is reopened after `reconnectDelay`; events pushed in the
  meantime are lost.

### Socket.IO

`socketIOServiceEntrypoint()` serves the actions over Socket.IO: it suits browsers and clients that stay connected.

| Option | Default | Meaning |
|---|---|---|
| `port` | `3000` | The port for its own server; `0` picks a free port |
| `host` | all interfaces | The address for its own server |
| `event` | `'message'` | The request event |
| `namespace` | `'/'` | The request namespace |
| `options` | | Socket.IO server options: `cors`, `path`, `maxHttpBufferSize`… |
| `server` | | An HTTP server to share, or a function returning it (below) |
| `io` | | An existing Socket.IO server, used unchanged |
| `listening` | | `(io, server, listeners) => …`, called once the adapter is ready |

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
- Browsers on another origin need `options: {cors: {origin: …}}`.
- `socketOfContext(this.context)`, from `lakutata/adapter/socket.io`, returns a request's socket, for example to join it
  to a room.

Socket.IO can share the HTTP adapter's port: pass it the server that the `before` hook of `expressHTTPEntrypoint`
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

`jsonRPCServiceEntrypoint()` serves the actions over JSON-RPC 2.0: it suits clients written in other languages, tools
that speak the protocol, and parent processes over standard input and output.

| Option | Default | Meaning |
|---|---|---|
| `transport` | `'http'` | `'http'` (a `POST` per message), `'websocket'` (needs `ws`) or `'stdio'` |
| `port`, `host`, `path` | `3000`, all interfaces, `'/'` | The HTTP or WebSocket server |
| `limit` | `10485760` (10 MiB) | The largest message, in bytes |
| `methodField` | `'method'` | The pattern key that receives the method |
| `positionalParams` | | The input key that receives params passed as an array; without it, they are refused |
| `toPattern` | | `(method, params) => message`: builds the message itself, replacing the two options above |
| `framing` | `'newline'` | On stdio: one message per line, or `'content-length'` (headers, as in the Language Server Protocol) |
| `input`, `output` | `process.stdin`, `process.stdout` | The stdio streams |
| `end` | `'application'` | When the stdio input ends: `'application'` exits the application once the responses to the requests in progress are sent, `'none'` does nothing, or a function |
| `heartbeat` | `30000` | The WebSocket ping interval, in milliseconds; `0` sends none |
| `listening` | | `(server, listeners) => …`, called once the HTTP or WebSocket server listens |

A request's method and params form the message. `{"method": "order.get", "params": {"id": 1}}` is the message
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

- The result is the response's `result`, `null` when the action returns nothing.
- A request without `id` is a notification: the action runs, and no response is sent (204 over HTTP). A batch, an array
  of requests, receives an array of responses.
- An error is an `error` with a code:

  | Code | When |
  |---|---|
  | `-32700` | The message is not JSON |
  | `-32600` | The message is not a JSON-RPC 2.0 request, or the batch is empty |
  | `-32601` | No action matches the request |
  | `-32602` | The input fails DTO validation, or the params are an array without `positionalParams` |
  | `-32000` | Any other action error, with the whole error as its `data` |
  | `-32001` | The application is stopping |

- Over HTTP, requests are `POST`s to `path`, and the response status is 200; another method or path receives a 404
  response. The CORS headers allow any origin and any request header.
- Over WebSocket, each text frame is a message. Events pushed to the client are sent as notifications:
  `{"jsonrpc": "2.0", "method": "<event>", "params": [<arguments>]}`.

**Over stdio**, the application is a child process: its parent writes requests to its standard input and reads responses
and events from its standard output. The standard output belongs to the protocol: write the application's logs to
standard error, and never call `console.log()`.

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

The application exits once its input ends and the responses to its requests are sent (`end`).

### On a network interface

`httpServiceEntrypoint()`, `socketIOServiceEntrypoint()` with its own server, and `jsonRPCServiceEntrypoint()` over HTTP
or WebSocket can listen on a network interface instead of an address, whatever its addresses, with the `@lakutata/netif`
package installed separately. They take the same `interface`, `family`, `strict`, `onError` and `interfaceListening`
options as the HTTP adapters (see [HTTP](HTTP.md), section 2), and their `listening` callback receives the interface's
listeners as its last argument:

```typescript
import {httpServiceEntrypoint} from 'lakutata/com/entrypoint'

//The service on eth1 only, whatever its address
export const service = httpServiceEntrypoint({port: 3000, interface: 'eth1'})
```

In Bun, a connection passed to a server cannot be upgraded to a WebSocket. JSON-RPC over WebSocket
therefore fails to start in Bun, and so does Socket.IO unless it uses polling only
(`options: {transports: ['polling']}`, and the same on the clients).

### Electron

`electronIPCServiceEntrypoint()` serves the actions to an Electron application's windows, in its main process.

| Option | Default | Meaning |
|---|---|---|
| `channel` | `'lakutata:service'` | The IPC channel for requests; events use `<channel>:event`, subscriptions `<channel>:subscribe` |
| `ipcMain` | Electron's `ipcMain` | The `ipcMain` to serve, or a stand-in in tests |

Pages call the main process through their window's preload script:

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

- Each page provides its own client ID (`crypto.randomUUID()`) when it subscribes and when it invokes; a page reloaded
  in its window replaces its previous ID. A page without an ID receives no events.
- `ipcEventOfContext(this.context)`, from `lakutata/adapter/electron`, returns a request's IPC event, to reach the
  window that sent it.
- The Electron templates from `lakutata create` contain a preload script like this one, and a `window.ipc` for the
  pages, whose `invoke()` returns the payload or throws the error.

### NW.js

`nwjsServiceEntrypoint()` serves the actions to an NW.js application's windows, in its background script (its Node.js
context). NW.js exposes Node.js to the pages in its windows, and an iframe in such a page does not keep Node.js
away from its content (its sandbox is ignored): the user interface runs in a `<webview>`, without Node.js, held by a
trusted page in the window (its host page). The adapter places a bridge on the global object that NW.js shares with its
windows, `global[Symbol.for(key)]`; the host page forwards the interface's requests to it, and provides it with the
function that pushes events to the interface.

| Option | Default | Meaning |
|---|---|---|
| `key` | `'lakutata:service'` (`NWJS_SERVICE_BRIDGE`) | The bridge's key on the global object |
| `global` | the NW.js global object | The object the bridge is placed on, or a stand-in in tests |

| Bridge method | Meaning |
|---|---|
| `invoke(message, clientId)` | Invokes an action: resolves to the envelope, never rejects |
| `subscribe(clientId, push)` | Registers a page as a client: events pushed to it are passed to `push(event, args)` |
| `unsubscribe(clientId)` | Removes a client, when its page is reloaded or its window closed: its requests in progress are aborted |

The host page forwards the interface's messages, only from the page loaded in its `<webview>`:

```javascript
const view = document.querySelector('webview')
const origin = new URL(view.src).origin
const bridge = global[Symbol.for('lakutata:service')]
const send = (message) => view.contentWindow.postMessage(message, origin)
window.addEventListener('message', async (event) => {
    if (event.source !== view.contentWindow || event.origin !== origin) return
    const {type, id, message, clientId} = event.data
    if (type === 'invoke') send({type: 'response', id: id, response: await bridge.invoke(message, clientId)})
    if (type === 'subscribe') bridge.subscribe(clientId, (name, args) => send({type: 'event', name: name, args: args}))
})
```

- The `<webview>` loads the application's files when its partition is declared in the NW.js manifest:
  `"webview": {"partitions": [{"name": "trusted", "accessible_resources": ["<all_urls>"]}]}` (the builder writes it).
- A page reloaded in the `<webview>` is a new client: the host page unsubscribes the previous one.
- The NW.js templates from `lakutata create` contain such a host page (`packages/app/host`), and a `window.ipc` for the
  interface like the one in the Electron templates.

### React Native

`reactNativeServiceEntrypoint()` serves the actions to the user interface of a React Native mobile application (Android,
iOS, HarmonyOS), in the Node.js runtime that the application embeds. The application's native module starts Node.js and
passes it one end of a socket, whose file descriptor is in the `LAKUTATA_NODE_FD` environment variable. The adapter
reads the host's messages on that socket and writes its responses and events there, one JSON object per line. Values
arrive as JSON carries them: a `Date` arrives as its string, a `Buffer` as `{type, data}`, `undefined` is omitted, and a
result that JSON cannot represent (a `bigint`, a cycle) produces an error response.

| Option | Default | Meaning |
|---|---|---|
| `socket` | a socket on the file descriptor in `LAKUTATA_NODE_FD` | The connection to the host, or a stand-in in tests |
| `pause` | | Called when the application goes to the background, before the host is told that the application is ready for it |
| `resume` | | Called when the application comes back from the background |

| The host writes | The adapter responds |
|---|---|
| `{"type":"invoke","id":1,"clientId":"ui","data":{"cmd":"greet","name":"you"}}` | `{"type":"response","id":1,"response":{"success":true,"error":null,"payload":…}}` |
| `{"type":"subscribe","clientId":"ui"}` | `{"type":"subscribed","clientId":"ui"}`, then the events pushed to the client |
| `{"type":"unsubscribe","clientId":"ui"}` | Nothing; the client's requests in progress are aborted |
| `{"type":"pause"}` | `{"type":"paused"}`, once the `pause` option has run |
| `{"type":"resume"}` | Nothing; the `resume` option runs |

- Lines that the host writes before the application listens wait in the socket: none is lost. The response to the
  subscription tells the interface that the application is ready.
- On iOS, the host asks the system for time to finish before the application is suspended, sends `pause`, and lets the
  application be suspended once `paused` arrives (or when the time runs out).
- When Node.js exits (`process.exit()`, a failed application launch), the mobile application keeps running: the native
  module reports the exit code and can start Node.js again.
- The `mobile-react` template from `lakutata create` contains such a native module, and an `ipc` for the interface like
  the one in the Electron templates, both in its `packages/ipc` package.

## 5. Clients and events

Transports that keep their clients connected can push events to them. A client is identified by the ID it provides:

| Transport | Client ID |
|---|---|
| HTTP service | The request's `id` header or `id` query parameter; for the event stream, a random ID when it provides none |
| Socket.IO | The connection's `auth.id`, else its `id` header, else its `id` query parameter, else the socket's ID |
| JSON-RPC over HTTP | The request's `id` header or `id` query parameter; it receives no events |
| JSON-RPC over WebSocket | The connection's `id` header or `id` query parameter, else a random ID |
| JSON-RPC over stdio | `'stdio'` |
| Electron | The ID the page provides when it subscribes or invokes |
| NW.js | The ID the host page provides to the bridge for its page |
| React Native | The ID the user interface provides when it subscribes or invokes |
| WebRTC | The caller's member ID in its room |

An action reads its client's ID from `this.context.clientId`. The `entrypoint` component pushes events:

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
| Electron | `('progress', [50, 'half'])`, through the preload script's `subscribe` above |
| NW.js | `('progress', [50, 'half'])`, passed to the function registered with the bridge's `subscribe` |
| React Native | The line `{"type":"event","clientId":…,"event":"progress","args":[50,"half"]}`, which the host passes to the interface |
| WebRTC | `proxy.on('progress', (percent, label) => …)` of a `PeerServiceProxy` |

## 6. Stopping and leaving

- When the application stops, new requests fail with `EntrypointStoppedException` (`E_ENTRYPOINT_STOPPED`; code `-32001`
  over JSON-RPC), and the requests in progress are given the entrypoint's `shutdownTimeout` (see
  [Entrypoint](Entrypoint.md), section 4).
- When a client leaves before receiving its response (a socket disconnected, a window closed, an HTTP connection closed,
  a data channel closed), the `this.signal` of its request is aborted.
- The transports set no time limit on calls: a client sets its own, such as `socket.timeout(5000)` above.
