# @lakutata/entrypoint

English | [中文](README.zh-CN.md)

The entrypoint of the lakutata framework: controllers and their actions, served by transports. One controller method
can be an HTTP route, a CLI command, a service action (called over HTTP, Socket.IO, JSON-RPC, gRPC, NATS or Electron
IPC) and a scheduled job at the same time. Whatever the transport, a request goes through the same middlewares, its
input is validated by the same DTO, and the same access control applies.

The umbrella package `lakutata` re-exports it as `lakutata/com/entrypoint` (the component, controllers, contexts and
results), `lakutata/decorator/ctrl` (the action decorators) and `lakutata/adapter/*` (the transports), and presets the
`entrypoint` component in every application.

## Installation

```shell
npm install lakutata
```

The transports rely on optional peer dependencies, which you install only when you use them:

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

    //Every 5 minutes (with {every: '5m', exclusive: true} and a mutex component, in one instance at a time)
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

### Inside an action

- `this.context` is the request's context: `HTTPContext` (with `request`, `response`, `route`, `method`),
  `CLIContext` (with `command`), `ServiceContext` (with `clientId`) or `ScheduleContext`.
- `this.signal` is aborted when the request is aborted: the client goes away, the deadline passes or the entrypoint
  stops.
- A controller is created for each request (`@Scoped`), and the request-scoped objects it injects are shared within
  that request.
- The returned value is the response. `Result.status(201, data, headers)`, `Result.file(path)` and `Result.events()`
  (Server-Sent Events) control the HTTP response.
- Over HTTP (Express, Fastify), an exception is answered with its `statusCode` and the JSON `{errno, errMsg}`, and
  invalid input with 400.

### Middlewares and access control

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, type ActionInvocation, type Next} from 'lakutata/com/entrypoint'
import {GET, UseMiddlewares} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

//Runs around the action, before input validation and access control
async function timing(invocation: ActionInvocation, next: Next): Promise<unknown> {
    const started: number = Date.now()
    try {
        return await next()
    } finally {
        console.log(`${invocation.context.type} took ${Date.now() - started} ms`)
    }
}

//For the actions of this controller (buildEntrypoints({middlewares: [timing]}) would run it for every action)
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
        entrypoint: buildEntrypoints({controllers: [HealthController], http: expressHTTPEntrypoint({port: 3000})})
    },
    bootstrap: ['entrypoint']
}))
```

Access control: an action declared with `{acl: true}` is checked by the rules given to `buildEntrypoints({rules})`
(`AccessControlRule` subclasses, created for each request). A rule that resolves to `false` denies the request with
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
| `HTTPServiceProxy`, `buildHTTPServiceProxy` | `lakutata/com/entrypoint` | The client of a service over HTTP: its actions and its events |
| `Cron`, `parseDuration` | `lakutata/com/entrypoint` | Cron expressions and durations |
| `HTTPAction`, `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` | `lakutata/decorator/ctrl` | HTTP routes |
| `CLIAction`, `ServiceAction`, `Schedule` | `lakutata/decorator/ctrl` | Commands, service actions, scheduled jobs |
| `Prefix`, `UseMiddlewares` | `lakutata/decorator/ctrl` | A prefix for the routes, commands and patterns of a controller; its middlewares |
| `expressHTTPEntrypoint`, `fastifyHTTPEntrypoint` | `lakutata/adapter/express`, `lakutata/adapter/fastify` | HTTP transports (`staticUI` with Express) |
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
| `ServiceUnavailableException` | A service called by an `HTTPServiceProxy` gave no response (HTTP 503) |

## See also

- The guides in the `lakutata` package (`doc/en`, Chinese in `doc/zh`): `Controllers.md`, `Entrypoint.md`,
  `Middlewares.md`, `HTTP.md` (the HTTP adapters), `ServiceCalls.md` (the service transports), `CLI.md`, `Schedules.md`.
- `@lakutata/core`: DTOs, dependency injection and the application.
- `@lakutata/mutex`: `@Synchronized` actions and `exclusive` schedules.
- `@lakutata/grpc`, `@lakutata/nats`: the service transports over gRPC and NATS.
