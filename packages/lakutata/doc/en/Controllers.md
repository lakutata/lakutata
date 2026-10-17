# Lakutata Controllers and Actions

A controller is a class whose methods answer requests. Each of these methods is an **action**: a decorator gives it an
address (an HTTP route, a command, a service pattern, a schedule, a queue), and the `entrypoint` component calls it when
a request arrives at that address. One method can have several addresses: the same code then answers over HTTP, on the
command line and over a service transport, with the same validation, middlewares and access control.

## 1. A controller

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {CLIAction, GET, POST, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'

class OrderIdDTO extends DTO {
    //Route parameters and command line arguments are text: strict(false) converts them
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
    //GET /orders/42, the command "order 42", the service message {cmd: 'order.get', id: 42}
    @GET('/orders/:id', OrderIdDTO)
    @CLIAction('order <id>', OrderIdDTO, {description: 'Show an order'})
    @ServiceAction({cmd: 'order.get'}, OrderIdDTO)
    public async get(input: OrderIdDTO): Promise<{ id: number, status: string }> {
        return {id: input.id, status: 'paid'}
    }

    //POST /orders with a JSON body
    @POST('/orders', CreateOrderDTO)
    public async create(input: CreateOrderDTO): Promise<CreateOrderDTO> {
        return input
    }
}

Application.run(() => ({
    id: 'orders.app',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            http: expressHTTPEntrypoint({port: 8080}),
            service: httpServiceEntrypoint({port: 8081}),
            cli: commanderCLIEntrypoint({bin: 'orders', noCommand: 'ignore'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ curl localhost:8080/orders/42
{"id":42,"status":"paid"}
$ curl -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{"product":"tea","extra":1}'
{"product":"tea","quantity":1}
$ curl -X POST localhost:8081 -H 'Content-Type: application/json' -d '{"cmd":"order.get","id":42}'
{"success":true,"error":null,"payload":{"id":42,"status":"paid"}}
$ node dist/index.js order 42
{
  "id": 42,
  "status": "paid"
}
```

- A controller extends `Controller`, from `lakutata/com/entrypoint`.
- The controllers are listed in the `controllers` option of `buildEntrypoints`, next to the adapters of the transports
  (see [Entrypoint](Entrypoint.md)). The entrypoint must be listed in `bootstrap`, or nothing starts it.
- The decorator of a transport has no effect without its adapter: here, without `cli`, the `@CLIAction` would be
  ignored.

## 2. How a request is handled

1. The adapter receives the request and looks for the action at its address. When there is none, the transport answers
   that it is not found (404 over HTTP).
2. A new scope is created for the request.
3. The middlewares run (see [Middlewares](Middlewares.md)).
4. A new instance of the controller is created in the scope.
5. The DTO of the action validates the input (section 4).
6. The access control checks the request (see [Middlewares](Middlewares.md)).
7. The method is called with the input, and what it returns is the response (section 5).
8. The scope is destroyed, with the objects created in it.

So a controller lives as long as one request. The providers it injects that are `@Scoped` (the default for a provider)
are created once for the request and shared by everything that takes part in it; the components are shared by the whole
application.

Inside the method, two properties describe the request:

- `this.context` is the context of the request. Its `type` names the transport, and its class gives the details of that
  transport:

  | Class | `type` | Specific properties |
  |---|---|---|
  | `HTTPContext` | `'HTTP'` | `request`, `response`, `route` (the route as declared), `method` |
  | `CLIContext` | `'CLI'` | `command` (the command as declared) |
  | `ServiceContext` | `'SERVICE'` | `clientId`, `input` (the whole message) |
  | `ScheduleContext` | `'SCHEDULE'` | `schedule`, `scheduledAt`, `run` |
  | `QueueContext` (`lakutata/com/queue`) | `'QUEUE'` | See [Queue](Queue.md) |

  Every context also has `data`, the input as it arrived (before validation), and `locale`, the language of the
  request when the I18n middleware is used.
- `this.signal` is an `AbortSignal`. It is aborted when the request is: the client went away, the deadline of a gRPC call
  passed, or the application is stopping and its `shutdownTimeout` ran out. Once it is aborted, the result of the
  action is dropped; a long action should check it and stop early.

## 3. The action decorators

| Decorator | Address | Guide |
|---|---|---|
| `@GET(route)`, `@POST`, `@PUT`, `@PATCH`, `@DELETE`, `@HEAD`, `@OPTIONS`, `@HTTPAction(route, methods)` | An HTTP route | [HTTP](HTTP.md) |
| `@CLIAction(command)` | A command | [CLI](CLI.md) |
| `@ServiceAction(pattern)` | A service pattern | [ServiceCalls](ServiceCalls.md), [GRPC](GRPC.md), [NATS](NATS.md) |
| `@Schedule(schedule)` | An interval or a cron expression | [Schedules](Schedules.md) |
| `@QueueAction(queue)` (`lakutata/com/queue`) | A message queue | [Queue](Queue.md) |
| `@MCPTool(name)` (`@lakutata/mcp`), `@DBusMethod(...)` (`@lakutata/dbus`) | An MCP tool, a D-Bus method | The README of their package |

The decorators of the first five rows come from `lakutata/decorator/ctrl`, unless the table names another subpath.
They take the address first, then the DTO class of the input, then the action options; the DTO and the options can be
left out. `@Schedule` is the exception: it takes no DTO, as a scheduled job has no input.

The action options:

| Option | Default | Meaning |
|---|---|---|
| `name` | `'ControllerClass:method'` | The name of the action, unique for each transport |
| `description` | | A description: the help of a command, the listing of the actions |
| `middlewares` | | The middlewares of this action (see [Middlewares](Middlewares.md)) |
| `acl` | `false` | Check the request with the access rules of the entrypoint |
| `rule` | | An access rule of this action: `(context, input) => Promise<boolean>` |
| `groups` | | The groups of the action, used by the access rules and the listings (see [Entrypoint](Entrypoint.md)) |

## 4. The input

Each transport builds the input from its request:

| Transport | Input |
|---|---|
| HTTP | The query and the body, with the route parameters over them |
| Command line | The arguments and the options |
| Service | The message, without the keys of the pattern |
| Schedule | Nothing |
| Queue | The message |

The DTO of the action then validates it:

- a value is converted to the type of its schema when it can be. The query, the route parameters and the command line
  arguments are text: a schema that expects a number needs `.strict(false)` to accept `'42'`;
- the defaults are applied, and the keys the DTO does not declare are removed (`extra` above);
- an invalid input stops the request with an `InvalidValueException`, answered with the status 400 over HTTP. The
  message names the first invalid value: `"product" is required`. With the I18n middleware, it is in the language of
  the request.

The method receives the validated input as a plain object, a copy: not an instance of the DTO class, which only gives it
its type. An action without a DTO receives the input as it arrived, with all its keys.

## 5. The result

What the method returns is sent back by the transport:

| Transport | A value | `undefined` | An error thrown |
|---|---|---|---|
| HTTP | JSON | Status 204 | Its `statusCode` (500 by default) and `{errno, errMsg}` |
| Command line | On stdout: text as it is, other values as JSON | Nothing | `error: <message>` on stderr, exit code 1 |
| Service | `{success: true, error: null, payload}` | `payload` left out | `{success: false, error, payload: null}`, the error with all its properties |
| Schedule | Ignored | | Given to `onError`, or logged |

`Result`, from `lakutata/com/entrypoint`, controls the response more closely:

- `Result.status(status, data, headers)`: an HTTP status and headers with the data;
- `Result.file(path)` (or a `Buffer`, or a stream, with `{filename, contentType, etag, headers}`): a file, as a download
  when `filename` is given;
- `Result.events(producer)`: Server-Sent Events over HTTP, the data of each event on the command line. The producer
  `(send, signal) => …` runs after the scope of the request is destroyed, so it should use components rather than
  request-scoped providers.

The service transports cannot send a file or events: such a result fails the request.

## 6. Prefixes

`@Prefix` on a controller adds a prefix to the addresses of all its actions:

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

- `route` is put before the HTTP routes, `command` before the commands (joined by a colon), and `pattern` is merged
  into the service patterns. A key set to different values in the prefix and in an action is an error
  (`InvalidPrefixException`).
- The scheduled jobs have no prefix.
- A controller takes the prefix of the nearest class that declares one: its own, or else the one of its parent.

## 7. Inheritance

A controller inherits the actions of its parent classes, so common actions can be written once in a base class. A
registered subclass serves them under its own prefix:

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {GET, Prefix} from 'lakutata/decorator/ctrl'

abstract class HealthController extends Controller {
    @GET('/health')
    public async health(): Promise<string> {
        return 'ok'
    }
}

//GET /v1/health
@Prefix({route: '/v1'})
class V1Controller extends HealthController {
}

//GET /v2/health
@Prefix({route: '/v2'})
class V2Controller extends HealthController {
}
```

- Register the subclasses only (`controllers: [V1Controller, V2Controller]`). A parent and a subclass registered
  together, with the same address for an action, would conflict: the one registered last wins.
- A subclass can override an inherited method: the action keeps its address and runs the new code. A decorator on the
  overriding method adds an address; the inherited one stays.
- The base class can be abstract.
