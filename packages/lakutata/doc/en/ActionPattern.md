# Lakutata HTTP and Service Transports

This guide covers the HTTP adapters and the service transports. The controllers, the actions, their input and their
results are described in [Controllers](Controllers.md); the entrypoint and the list of its adapters in
[Entrypoint](Entrypoint.md); the middlewares and the access control in [Middlewares](Middlewares.md).

## 1. HTTP actions: `@HTTPAction`, `@GET`, `@POST`, `@PUT`, `@PATCH`, `@DELETE`, `@HEAD`, `@OPTIONS`

```text
@HTTPAction(route, method | methods, DTOClass?, options?)
@GET(route, DTOClass?, options?)
```

- The route uses the syntax of the HTTP adapter (`/users/:id`); `@HTTPAction` takes one method or several
  (`['get', 'post']`).
- The input is the query merged with the parsed body (JSON; URL-encoded forms with Express only), then the route
  parameters over them. The query values and the route parameters are strings and the schemas are strict: convert them
  with `.strict(false)`.
- The value returned is answered as JSON (204 for `undefined`). `Result.status(201, data, headers)`,
  `Result.file(path)` and `Result.events(producer)` (Server-Sent Events), from `lakutata/com/entrypoint`, control the
  response.

## 2. Service actions: `@ServiceAction`

```text
@ServiceAction(pattern, DTOClass?, options?)
```

- The pattern is an object (nested 2 levels at most) whose keys a message must hold with the same values; a string
  value may be a glob (`'user.*'`). The most specific matching pattern wins. The input is the message without the keys
  of the pattern.
- The caller receives `{success: true, error: null, payload}`, or `{success: false, error, payload: null}` where
  `error` holds the properties of the error (`errno`, `errMsg`, `statusCode`, `message`…); JSON-RPC answers with its
  own `result` and `error`. A message no pattern matches fails with `ControllerActionNotFoundException`.

## 3. The transports

The adapters of the transports, and the packages they need, are listed in [Entrypoint](Entrypoint.md), section 2.

### From an entrypoint function of 2.x to the HTTP adapters

An HTTP entrypoint function of 2.x (`buildHTTPEntrypoint`) keeps working: it is called in the startup of the entrypoint
(the objects it gets, such as an authenticator injecting the entrypoint, are available) and awaited, so the application
launches once its server listens. To move it to `expressHTTPEntrypoint`:

- the middlewares and the routes of the application (CORS, compression, a health check, the authenticator, a web UI) go
  into its `before` hook, which gets the objects with `module.getObject()`; the body parsers are its `body` option
  (`{limit: '100mb'}`); the `keepAliveTimeout`/`headersTimeout` of the server its `server` option;
- the input built from the request (the query, the body, a value of the session) is its `input` option;
- the `{errno, errMsg, data}` envelope is `jsonEnvelope()`. The applications of 2.x usually answered the errors of the
  actions with 200 and the errors of their express middlewares (`next(error)`: an authenticator's 401) with their
  status: `jsonEnvelope({actionErrorStatus: 200})` does the same — `errorStatus: 200` would answer the 401 with 200 too,
  which the clients redirecting to the login page on a 401 would miss;
- the other fields of the envelope of the application (`timestamp`, `nonce`, a request id) are given by its `extra`
  option, called for each response, results and errors: `jsonEnvelope({actionErrorStatus: 200, extra: () =>
  ({timestamp: Date.now()})})`. They are added after `errno`, `errMsg` and `data`, which they never replace — no
  responder of its own is needed to keep them.

```typescript
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import type {Express, NextFunction, Request, Response} from 'express'

class Unauthorized extends Error {
    public readonly errno: string = 'E_UNAUTHORIZED'

    public readonly statusCode: number = 401
}

export const entrypoint = buildEntrypoints({
    controllers: [],
    http: expressHTTPEntrypoint({
        port: 3000,
        body: {limit: '100mb'},
        before: async (app: Express): Promise<void> => {
            app.get('/health', (_request: Request, response: Response): unknown => response.json({status: 'ok'}))
            //The authenticator of the requests: its errors keep their status (401)
            app.use((request: Request, _response: Response, next: NextFunction): void => request.headers.authorization ? next() : next(new Unauthorized('Not logged in')))
        },
        //The errors of the actions answered with 200 in the envelope, as in 2.x, with its timestamp
        respond: jsonEnvelope({actionErrorStatus: 200, extra: (): Record<string, unknown> => ({timestamp: Date.now()})})
    })
})
```

`fastifyHTTPEntrypoint` takes the same options (`fastifyJSONEnvelope({actionErrorStatus: 200, extra})`, the authenticator
being a hook of fastify). A responder of its own receives the origin of each error as the fourth argument of its
`error` (`'action'` or `'request'`).

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
