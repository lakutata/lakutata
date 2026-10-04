# Lakutata Controllers and Actions

The `Entrypoint` component (`lakutata/com/entrypoint`, package `@lakutata/entrypoint`) serves the methods of the
controllers, the **actions**, over several transports. An action is addressed by an HTTP route, a CLI command, a
service pattern or a schedule, and one method can carry several of these addresses at once: its input is validated by
its DTO, checked by the access control and passed through the middlewares the same way whatever the transport. The
README of `@lakutata/entrypoint` and the typings of `lakutata/com/entrypoint` and `lakutata/decorator/ctrl` give the
details.

## 1. Controllers

A controller extends `Controller` (`lakutata/com/entrypoint`), a provider whose lifetime is `@Scoped` (locked): each
request creates its own controller in the request's scope and destroys it when the request ends; the providers it
injects are scoped to the request too.

- `this.context` is the context of the request: an `HTTPContext` (its `request`, `response`, `route`, `method`), a
  `CLIContext` (its `command`), a `ServiceContext` (its `clientId`) or a `ScheduleContext`; tell them apart by their
  class or their `type`.
- `this.signal` is an `AbortSignal` aborted when the request is: its client gone, its deadline exceeded, or the
  entrypoint stopping. Long-running actions should stop then: their result is dropped.
- The method receives its input (the data of the request, validated by the DTO of the action, its defaults applied and
  its unknown keys removed) as a plain object, not a DTO instance. Without a DTO, the input is accepted as it is.
- The value returned is the response; an exception is answered with its `statusCode` (HTTP) and its `errno` and
  message, an invalid input with the status 400.

```typescript
import {Application, DTO} from 'lakutata'
import {BuildEntrypoints, Controller, ScheduleEntrypoint} from 'lakutata/com/entrypoint'
import {CLIAction, GET, POST, Schedule, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {ExpressHTTPEntrypoint} from 'lakutata/adapter/express'
import {CommanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {SocketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'

class GetOrderDTO extends DTO {
    //The route parameters and the query are strings: strict(false) converts them
    @Expect(DTO.Number().integer().strict(false).required())
    public id: number
}

class CreateOrderDTO extends DTO {
    @Expect(DTO.String().required())
    public product: string

    @Expect(DTO.Number().integer().min(1).default(1))
    public quantity: number
}

class OrderController extends Controller {
    //GET /orders/42, the command "order --id 42", the service message {cmd: 'order.get', id: 42}
    @GET('/orders/:id', GetOrderDTO)
    @CLIAction('order', GetOrderDTO)
    @ServiceAction({cmd: 'order.get'}, GetOrderDTO)
    public async get(input: GetOrderDTO): Promise<{ id: number }> {
        return {id: input.id}
    }

    //POST /orders with a JSON body
    @POST('/orders', CreateOrderDTO)
    public async create(input: CreateOrderDTO): Promise<{ product: string, quantity: number }> {
        return input
    }

    //Every 5 minutes
    @Schedule('5m')
    public async report(): Promise<void> {
    }
}

Application.run(() => ({
    id: 'orders.app',
    name: 'Orders',
    components: {
        entrypoint: BuildEntrypoints({
            controllers: [OrderController],
            http: ExpressHTTPEntrypoint({port: 8080}),
            cli: CommanderCLIEntrypoint(),
            service: SocketIOServiceEntrypoint({port: 8081}),
            schedule: ScheduleEntrypoint()
        })
    },
    bootstrap: ['entrypoint']
}))
```

## 2. The action decorators (`lakutata/decorator/ctrl`)

Each decorator takes its address, then optionally the DTO class of the input, then optionally the action options
(`acl`, `name`, `description`, `groups`, `rule`, `middlewares`).

### HTTP: `@HTTPAction`, `@GET`, `@POST`, `@PUT`, `@PATCH`, `@DELETE`, `@HEAD`, `@OPTIONS`

```text
@HTTPAction(route, method | methods, DTOClass?, options?)
@GET(route, DTOClass?, options?)
```

- The route uses the syntax of the HTTP adapter (`/users/:id`); the method is case-insensitive (`'get'`, `['get', 'post']`).
- The input is the query merged with the parsed body (JSON or URL-encoded), then the route parameters over them. The
  query values and the route parameters are strings and the schemas are strict: convert them with `.strict(false)`.
- The value returned is answered as JSON (204 for `undefined`). `Result.status(201, data, headers)`,
  `Result.file(path)` and `Result.events(producer)` (Server-Sent Events), from `lakutata/com/entrypoint`, control the
  response.

### CLI: `@CLIAction`

```text
@CLIAction(command, DTOClass?, options?)
```

- The command is its name, optionally followed by positional arguments (`'copy <source> [target]'`, `'<files...>'`);
  the words before the name are groups (`'package exe <file>'`). The other properties of the DTO are options
  (`--times 2`), the booleans flags (`--shout`); `.description()` of a schema is the help of its option, and the
  `description` action option the help of the command.
- The value returned is written to stdout (a string as it is, other values as JSON); an error is written to stderr and
  the command ends with the code 1.

### Service: `@ServiceAction`

```text
@ServiceAction(pattern, DTOClass?, options?)
```

- The pattern is an object (nested 2 levels at most) whose keys a message must hold with the same values; a string
  value may be a glob (`'user.*'`). The most specific matching pattern wins. The input is the message without the keys
  of the pattern.
- The caller receives `{success: true, error: null, payload}`, or `{success: false, error, payload: null}` where
  `error` holds the properties of the error (`errno`, `errMsg`, `statusCode`, `message`…); JSON-RPC answers with its
  own `result` and `error`. A message no pattern matches fails with `ControllerActionNotFoundException`.

### Schedules: `@Schedule`

```text
@Schedule(schedule, options?)
```

The method runs on a schedule when the entrypoint has a schedule adapter (`schedule: ScheduleEntrypoint()`). The
schedule is a duration (`'30s'`, `'1h30m'`, an interval), a cron expression (`'0 */5 * * * *'`, 5 or 6 fields, or a
macro such as `'@daily'`), or the options `{every}` or `{cron, timezone}` with:

- `overlap` (default `false`): start a run while the previous one is in progress; otherwise the run is skipped;
- `immediate` (default `false`): also run once as soon as the application launched;
- `exclusive` (default `false`): run in one instance of the application at a time, with the locks of a mutex component
  (`true` uses the component named `mutex`, `{mutex, key}` names it and the lock); see [Mutex](Mutex.md).

Each run has its own scope and goes through the middlewares and the access control; the method receives an empty
input, `this.context` is a `ScheduleContext` (its `schedule`, its planned time, its `run` number). An error thrown is
given to the `onError` option of `ScheduleEntrypoint`, or logged, and the next runs go on.

```typescript
import {Controller, ScheduleContext} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'

class JobController extends Controller {
    //Every 30 seconds, and once as soon as the application launched
    @Schedule({every: '30s', immediate: true})
    public async heartbeat(): Promise<void> {
        if (this.context instanceof ScheduleContext) console.log(`run ${this.context.run} of ${this.context.schedule}`)
    }

    //At 03:00 every day in Shanghai, in one instance at a time (a mutex component named "mutex")
    @Schedule({cron: '0 3 * * *', timezone: 'Asia/Shanghai', exclusive: true}, {name: 'Purge the expired sessions'})
    public async purge(): Promise<void> {
    }
}
```

### Prefixes: `@Prefix`

`@Prefix({route, command, pattern})` on a controller class prefixes its actions: `route` is prepended to the HTTP
routes, `command` to the CLI commands (joined by `:`, `user` and `get` give `user:get`), `pattern` is merged into the
service patterns.

```typescript
import {DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction, GET, Prefix, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'

class UserIdDTO extends DTO {
    @Expect(DTO.String().required())
    public id: string
}

@Prefix({route: '/users', command: 'user', pattern: {resource: 'user'}})
class UserController extends Controller {
    //GET /users/:id, the command "user:get <id>" and the message {resource: 'user', act: 'get', id}
    @GET('/:id', UserIdDTO)
    @CLIAction('get <id>', UserIdDTO)
    @ServiceAction({act: 'get'}, UserIdDTO)
    public async get(input: UserIdDTO): Promise<{ id: string }> {
        return {id: input.id}
    }
}
```

## 3. Middlewares and access control

A middleware runs around an action, before its input validation and its access control: a function
`(invocation, next) => Promise<unknown>` or a `Middleware` class. They are given to `BuildEntrypoints({middlewares})`
(every action), to an adapter's `middlewares` option, to `@UseMiddlewares(...)` on a controller class or a method, and to
the `middlewares` action option.

```typescript
import {type ActionInvocation, Controller, type Next} from 'lakutata/com/entrypoint'
import {GET, UseMiddlewares} from 'lakutata/decorator/ctrl'

async function Timing(invocation: ActionInvocation, next: Next): Promise<unknown> {
    const started: number = Date.now()
    try {
        return await next()
    } finally {
        console.log(`${invocation.context.type} took ${Date.now() - started} ms`)
    }
}

@UseMiddlewares(Timing)
class HealthController extends Controller {
    @GET('/health')
    public async health(): Promise<string> {
        return 'ok'
    }
}
```

An action declared with `{acl: true}` is checked by the rules given to `BuildEntrypoints({rules})`: `AccessControlRule`
subclasses, created for each request, whose `rule()` resolving `false` denies it with an `AccessDeniedException` (HTTP
403). The `rule` action option is the action's own rule.

```typescript
import {AccessControlRule, ContextType, Controller, type HTTPContext} from 'lakutata/com/entrypoint'
import {DELETE} from 'lakutata/decorator/ctrl'

class AdminRule extends AccessControlRule<HTTPContext> {
    public get supportContextTypes(): ContextType[] {
        return [ContextType.HTTP]
    }

    public async rule(): Promise<boolean> {
        if (!this.targetAction.groups.includes('admin')) return true
        return this.context.request.headers['x-role'] === 'admin'
    }
}

class UserController extends Controller {
    @DELETE('/users/:id', {acl: true, groups: ['admin']})
    public async remove(input: { id: string }): Promise<void> {
    }
}

//BuildEntrypoints({controllers: [UserController], rules: [AdminRule], httpActionGroups: {admin: 'Administration'}})
```

The groups of an action must be declared in `httpActionGroups`, `cliActionGroups` or `serviceActionGroups` of
`BuildEntrypoints`. `shutdownTimeout` (default 30000 ms) is the time given to the running requests when the entrypoint
stops.

## 4. The transports

| Option of `BuildEntrypoints` | Adapter | Subpath | Install |
|---|---|---|---|
| `http` | `ExpressHTTPEntrypoint({port})` | `lakutata/adapter/express` | `express` |
| `http` | `FastifyHTTPEntrypoint({port})` | `lakutata/adapter/fastify` | `fastify` |
| `cli` | `CommanderCLIEntrypoint()` | `lakutata/adapter/commander` | `commander` (`@inquirer/prompts` for the prompts) |
| `service` | `SocketIOServiceEntrypoint({port})` | `lakutata/adapter/socket.io` | `socket.io` |
| `service` | `JSONRPCServiceEntrypoint()` (HTTP, WebSocket, stdio) | `lakutata/adapter/jsonrpc` | `ws` for WebSocket |
| `service` | `ElectronIPCServiceEntrypoint()` | `lakutata/adapter/electron` | (Electron) |
| `service` | `HTTPServiceEntrypoint({port})` (`POST /`, events by SSE) | `lakutata/com/entrypoint` | |
| `service` | `GRPCServiceEntrypoint({port})` | `@lakutata/grpc/service` | `@lakutata/grpc` |
| `service` | `NatsServiceEntrypoint('nats')` | `@lakutata/nats` | `@lakutata/nats` |
| `schedule` | `ScheduleEntrypoint()` | `lakutata/com/entrypoint` | |

Each option takes one adapter or an array of adapters. `BuildHTTPEntrypoint`, `BuildCLIEntrypoint` and
`BuildServiceEntrypoint` (from `lakutata/com/entrypoint`) type an entrypoint function in the style of lakutata 2.x, to
plug another library; `EntrypointAdapter` (from `@lakutata/entrypoint/channel`) is the interface of the adapters.

### The clients of the service actions and their events

The service adapters with clients give the id of the client of a request to its context, `ServiceContext.clientId`:
`ElectronIPCServiceEntrypoint` (each page of a window), `SocketIOServiceEntrypoint` (each socket, its id given when it
connects by its `auth.id` or its `id` header), `HTTPServiceEntrypoint` (the `id` header of the `POST` requests, the `id`
header or query of the event stream `GET /events`), `JSONRPCServiceEntrypoint` over WebSocket and stdio, and
`GRPCServiceEntrypoint` (the `id` metadata). The entrypoint pushes events to a client with `notify(clientId, event,
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

`JSONRPCServiceEntrypoint` serves the service actions over JSON-RPC 2.0: the method and the params (by name) of a
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
    JSONRPCServiceEntrypoint({port: 4000, path: '/rpc'}),
    JSONRPCServiceEntrypoint({transport: 'websocket', port: 4001}),
    JSONRPCServiceEntrypoint({transport: 'stdio', framing: 'content-length'})
]
```

### gRPC and NATS

`GRPCServiceEntrypoint` (`@lakutata/grpc/service`) serves the service actions over gRPC: the service
`lakutata.service.v1.Service` (`SERVICE_PROTO`, for the clients of other languages) invokes an action with the JSON of
its pattern and input, and streams the events of a client. `GRPCServiceProxy`, declared with `BuildGRPCServiceProxy`,
invokes the actions of a remote application and listens to its events. The deadline of a call aborts its action
(`this.signal`). See the README of `@lakutata/grpc`.

```typescript
import {Application} from 'lakutata'
import {BuildGRPCServiceProxy, type GRPCServiceProxy} from '@lakutata/grpc/service'

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            orders: BuildGRPCServiceProxy({address: 'orders.internal:50051'})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: GRPCServiceProxy = await app.getObject<GRPCServiceProxy>('orders')
        orders.on('orderChanged', (order: { id: number }): void => console.log(order))
        console.log(await orders.invoke({cmd: 'order.get', id: 1}))
    })
```

`NatsServiceEntrypoint` (`@lakutata/nats`) serves them over NATS, on the subject of the application id, the instances
sharing a queue group; `ServiceProxy`, declared with `BuildServiceProxy`, invokes them. See the README of
`@lakutata/nats`.
