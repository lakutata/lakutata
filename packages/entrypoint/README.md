# @lakutata/entrypoint

The entrypoint of the lakutata framework: the controllers and their actions, served by transports. One controller
method can be an HTTP route, a CLI command, a service action (invoked over HTTP, Socket.IO, JSON-RPC, gRPC, NATS or
Electron IPC) and a scheduled job at the same time; its input is validated by its DTO, checked by the access control and
passed through the middlewares the same way whatever the transport.

The umbrella package `lakutata` re-exports it: `lakutata/com/entrypoint` (the component, the controllers, the
contexts, the results), `lakutata/decorator/ctrl` (the action decorators) and `lakutata/adapter/*` (the transports),
and presets the `entrypoint` component of the applications.

## Installation

```shell
npm install lakutata
```

The transports use optional peer dependencies, installed when used:

| Transport | Subpath | Install |
|---|---|---|
| HTTP with Express 4/5 | `lakutata/adapter/express` | `express` |
| HTTP with Fastify 5 | `lakutata/adapter/fastify` | `fastify` |
| CLI with Commander | `lakutata/adapter/commander` | `commander` (and `@inquirer/prompts` for the prompts) |
| Service over Socket.IO | `lakutata/adapter/socket.io` | `socket.io` |
| Service over JSON-RPC 2.0 (HTTP, WebSocket, stdio) | `lakutata/adapter/jsonrpc` | `ws` for WebSocket |
| Service over Electron IPC | `lakutata/adapter/electron` | (Electron) |
| Service over HTTP (`POST /`, events by SSE) | `lakutata/com/entrypoint` | none |
| Schedules (`@Schedule`) | `lakutata/com/entrypoint` | none |
| Service over gRPC / NATS | `@lakutata/grpc/service` / `@lakutata/nats` | their packages |

## Usage

### Controllers and transports

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller, scheduleEntrypoint} from 'lakutata/com/entrypoint'
import {CLIAction, GET, POST, Schedule, ServiceAction} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {Expect} from 'lakutata/decorator/dto'

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
    //GET /orders/42, the command "order --id 42", the service request {cmd: 'order.get', id: 42}
    @GET('/orders/:id', GetOrderDTO)
    @CLIAction('order', GetOrderDTO)
    @ServiceAction({cmd: 'order.get'}, GetOrderDTO)
    public async get(input: GetOrderDTO): Promise<{id: number}> {
        return {id: input.id}
    }

    //POST /orders with a JSON body; the value returned is the response (JSON)
    @POST('/orders', CreateOrderDTO)
    public async create(input: CreateOrderDTO): Promise<{product: string, quantity: number}> {
        return input
    }

    //Every 5 minutes (with {every: '5m', exclusive: true} and a mutex component: in one instance at a time)
    @Schedule('5m')
    public async report(): Promise<void> {
    }
}

Application.run(() => ({
    id: 'orders.app',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            http: expressHTTPEntrypoint({port: 8080}),
            cli: commanderCLIEntrypoint(),
            service: socketIOServiceEntrypoint({port: 8081}),
            schedule: scheduleEntrypoint()
        })
    },
    bootstrap: ['entrypoint']
}))
```

### The request of an action

- `this.context` is the context of the request: `HTTPContext` (its `request`, `response`, `route`, `method`),
  `CLIContext` (its `command`), `ServiceContext` (its `clientId`) or `ScheduleContext`.
- `this.signal` is aborted when the request is: its client gone, its deadline exceeded, the entrypoint stopping.
- A controller is created for each request (`@Scoped`): its injected objects of the request are shared by the request.
- The value returned is the response. `Result.status(201, data, headers)`, `Result.file(path)` and `Result.events()`
  (Server-Sent Events) control the HTTP response.
- An exception is answered with its `statusCode` (HTTP) and its `errno`, `message` (JSON); an invalid input with 400.

### Middlewares and access control

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, type ActionInvocation, type Next} from 'lakutata/com/entrypoint'
import {GET, UseMiddlewares} from 'lakutata/decorator/ctrl'

//Runs around the action: before its input validation and its access control
async function timing(invocation: ActionInvocation, next: Next): Promise<unknown> {
    const started: number = Date.now()
    try {
        return await next()
    } finally {
        console.log(`${invocation.context.type} took ${Date.now() - started} ms`)
    }
}

@UseMiddlewares(timing)
class HealthController extends Controller {
    @GET('/health')
    public async health(): Promise<string> {
        return 'ok'
    }
}

Application.run(() => ({
    id: 'health.app',
    name: 'Health',
    components: {
        entrypoint: buildEntrypoints({controllers: [HealthController], middlewares: [timing]})
    }
}))
```

The access control: an action declared with `{acl: true}` is checked by the rules given to `buildEntrypoints({rules})`
(`AccessControlRule` subclasses, created for each request); a rule resolving `false` denies it with
`AccessDeniedException` (HTTP 403).

## API

| Export | Subpath | What it is |
|---|---|---|
| `Entrypoint`, `buildEntrypoints` | `lakutata/com/entrypoint` | The component and its options: controllers, transports, middlewares, rules, groups |
| `Controller` | `lakutata/com/entrypoint` | The base class of the controllers (`context`, `signal`) |
| `HTTPContext`, `CLIContext`, `ServiceContext`, `ScheduleContext`, `BaseContext`, `ContextType` | `lakutata/com/entrypoint` | The contexts of the requests |
| `Result`, `StatusResult`, `FileResult`, `EventsResult` | `lakutata/com/entrypoint` | The results controlling the HTTP response |
| `AccessControlRule`, `AccessControl` | `lakutata/com/entrypoint` | The access control |
| `Middleware`, `ActionInvocation`, `Next` | `lakutata/com/entrypoint` | The middlewares |
| `httpServiceEntrypoint`, `scheduleEntrypoint` | `lakutata/com/entrypoint` | The service over HTTP, the schedules |
| `Cron`, `parseDuration` | `lakutata/com/entrypoint` | Cron expressions and durations |
| `HTTPAction`, `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` | `lakutata/decorator/ctrl` | HTTP routes |
| `CLIAction`, `ServiceAction`, `Schedule` | `lakutata/decorator/ctrl` | Commands, service actions, scheduled jobs |
| `Prefix`, `UseMiddlewares` | `lakutata/decorator/ctrl` | A prefix for the routes, commands and patterns of a controller; its middlewares |
| `expressHTTPEntrypoint`, `fastifyHTTPEntrypoint` | `lakutata/adapter/express`, `lakutata/adapter/fastify` | HTTP transports (with static UIs) |
| `commanderCLIEntrypoint` | `lakutata/adapter/commander` | CLI transport |
| `socketIOServiceEntrypoint`, `jsonRPCServiceEntrypoint`, `electronIPCServiceEntrypoint` | `lakutata/adapter/*` | Service transports |
| `EntrypointAdapter`, `ChannelRuntime` | `@lakutata/entrypoint/channel` | Writing a transport or a channel |

The typings document each declaration with examples.

## Errors

| Exception | Thrown when |
|---|---|
| `InvalidValueException` (from `lakutata`) | The input does not match the DTO of the action (HTTP 400) |
| `AccessDeniedException` | A rule denies the request (HTTP 403) |
| `ControllerActionNotFoundException`, `RouteNotFoundException` | No action matches the request (HTTP 404) |
| `EntrypointStoppedException` | The entrypoint is stopping (HTTP 503) |
| `DuplicateActionNameException` | Two actions of a channel have the same name |
| `InvalidPrefixException`, `InvalidMiddlewareException`, `InvalidChannelException`, `InvalidEntrypointAdapterException` | The declarations of the controllers or the options are invalid |
| `ServiceInvokeException` | A remote service action failed (its error's properties copied) |

## See also

- The guide: `doc/en/ActionPattern.md` of the package `lakutata` (Chinese in `doc/zh`).
- `@lakutata/core`: the DTOs, the dependency injection and the application.
- `@lakutata/mutex`: `@Synchronized` actions and the `exclusive` schedules.
- `@lakutata/grpc`, `@lakutata/nats`: the service transports over gRPC and NATS.
