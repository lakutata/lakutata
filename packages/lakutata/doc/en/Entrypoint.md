# Lakutata Entrypoint

The `entrypoint` component connects the controllers to the transports. It holds the controllers and the adapters of
the transports (HTTP, command line, service calls, schedules, queues…): each adapter receives the requests of its
transport, and the entrypoint runs the matching action, with its middlewares, its validation and its access control.

## 1. Declaring the entrypoint

The `lakutata` package already declares a component named `entrypoint`. An application gives it its options with
`buildEntrypoints`, under the same name, and lists it in `bootstrap`:

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class HealthController extends Controller {
    @GET('/health')
    public async health(): Promise<string> {
        return 'ok'
    }
}

Application.run(() => ({
    id: 'api.app',
    name: 'API',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [HealthController],
            http: expressHTTPEntrypoint({port: 8080})
        })
    },
    bootstrap: ['entrypoint']
}))
```

A component is created the first time something needs it. No other object needs the entrypoint, so without
`bootstrap: ['entrypoint']` it is never created: no server listens, no command runs, no job starts.

## 2. Options

| Option | Default | Meaning |
|---|---|---|
| `controllers` | `[]` | The controller classes |
| `http`, `cli`, `service`, `schedule`, `queue`, `mcp`, `dbus` | | The adapters of the transports (below): one adapter, or an array of them |
| `middlewares` | `[]` | The middlewares of every action (see [Middlewares](Middlewares.md)) |
| `rules` | `[]` | The access rules of the actions declared with `acl: true` (see [Middlewares](Middlewares.md)) |
| `shutdownTimeout` | `30000` | The milliseconds given to the requests in progress when the application stops (section 4) |
| `httpActionGroups`, `cliActionGroups`, `serviceActionGroups` | `{}` | The groups the actions may use, with their names (section 5) |

The adapters:

| Option | Adapter | Imported from | To install | Guide |
|---|---|---|---|---|
| `http` | `expressHTTPEntrypoint()` | `lakutata/adapter/express` | `express` | [HTTP](HTTP.md) |
| `http` | `fastifyHTTPEntrypoint()` | `lakutata/adapter/fastify` | `fastify` | [HTTP](HTTP.md) |
| `cli` | `commanderCLIEntrypoint()` | `lakutata/adapter/commander` | `commander` | [CLI](CLI.md) |
| `service` | `httpServiceEntrypoint()` | `lakutata/com/entrypoint` | | [ServiceCalls](ServiceCalls.md) |
| `service` | `socketIOServiceEntrypoint()` | `lakutata/adapter/socket.io` | `socket.io` | [ServiceCalls](ServiceCalls.md) |
| `service` | `jsonRPCServiceEntrypoint()` | `lakutata/adapter/jsonrpc` | `ws`, for WebSocket | [ServiceCalls](ServiceCalls.md) |
| `service` | `electronIPCServiceEntrypoint()` | `lakutata/adapter/electron` | (Electron) | [ServiceCalls](ServiceCalls.md) |
| `service` | `grpcServiceEntrypoint()` | `@lakutata/grpc/service` | `@lakutata/grpc` | [GRPC](GRPC.md) |
| `service` | `natsServiceEntrypoint()` | `@lakutata/nats` | `@lakutata/nats` | [NATS](NATS.md) |
| `schedule` | `scheduleEntrypoint()` | `lakutata/com/entrypoint` | | [Schedules](Schedules.md) |
| `queue` | `queueEntrypoint()` | `lakutata/com/queue` | The client of the queue server | [Queue](Queue.md) |
| `mcp` | `httpMCPEntrypoint()`, `stdioMCPEntrypoint()` | `@lakutata/mcp` | `@lakutata/mcp` | [MCP](MCP.md) |
| `dbus` | `dbusEntrypoint()` | `@lakutata/dbus` | `@lakutata/dbus` | [DBus](DBus.md) |

## 3. Several adapters

Each option accepts an array, to serve one transport in several ways. For example, the service actions over Socket.IO
for the browsers and over JSON-RPC for the scripts, or the HTTP actions on two ports:

```typescript
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {jsonRPCServiceEntrypoint} from 'lakutata/adapter/jsonrpc'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'

export const entrypoint = buildEntrypoints({
    controllers: [],
    http: [
        expressHTTPEntrypoint({name: 'public', port: 8080}),
        expressHTTPEntrypoint({name: 'internal', host: '127.0.0.1', port: 9090})
    ],
    service: [
        socketIOServiceEntrypoint({port: 3000}),
        jsonRPCServiceEntrypoint({port: 4000, path: '/rpc'})
    ]
})
```

Every adapter of a transport serves all the actions of that transport. The `name` option tells the adapters apart.

## 4. Starting and stopping

**When the application launches**, the entrypoint first checks the controllers. Each of these mistakes stops the
launch with its exception:

- two actions of the same transport with the same name (`DuplicateActionNameException`);
- an action in a group that its `*ActionGroups` option does not declare (`InvalidActionGroupException`);
- a prefix that conflicts with the pattern of an action (`InvalidPrefixException`);
- a middleware that is neither a function nor a `Middleware` class (`InvalidMiddlewareException`);
- an adapter given under the key of another transport, or an option that is neither an option of the entrypoint nor a
  transport (`InvalidEntrypointAdapterException`).

Then the adapters start one after another, in the order of the options. One that fails, such as a server whose port is
already in use, stops the launch. The command line and the scheduled jobs begin once the whole application has
launched.

**When the application stops** (on `SIGTERM` or `SIGINT`, or after `app.exit()`), the adapters stop in the reverse
order:

1. they stop accepting new requests. Depending on the transport, a request that still arrives is refused with an
   `EntrypointStoppedException` (status 503 over HTTP);
2. the requests in progress are given `shutdownTimeout` (30 seconds by default) to finish;
3. the requests still running are aborted: their `this.signal` fires, and they are answered with an
   `EntrypointStoppedException`;
4. the adapters close their servers and connections.

## 5. Groups and the list of the actions

The `groups` option of an action puts it in groups. The access rules can use them (see [Middlewares](Middlewares.md)),
and the entrypoint can list the actions by group, to build an index of an API or a list of permissions. The groups of
the HTTP, command line and service actions must be declared, with their names:

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller, type Entrypoint} from 'lakutata/com/entrypoint'
import {DELETE, GET} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'

class UserController extends Controller {
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    @GET('/users', {description: 'List the users'})
    public async list(): Promise<string[]> {
        return []
    }

    @DELETE('/users/:id', {description: 'Delete a user', groups: ['admin']})
    public async remove(): Promise<void> {
    }

    //The actions of each group: [{"group":"Administration","actions":["Delete a user"]}]
    @GET('/permissions')
    public async permissions(): Promise<{ group: string, actions: string[] }[]> {
        return this.entrypoint.getHttpActions().groups.map((group) => ({
            group: group.name,
            actions: group.actions.map((action): string => action.description)
        }))
    }
}

Application.run(() => ({
    id: 'users.app',
    name: 'Users',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [UserController],
            httpActionGroups: {admin: 'Administration'}
        })
    },
    bootstrap: ['entrypoint']
}))
```

`getHttpActions()`, `getCliActions()` and `getServiceActions()` return `{groups, actions}`: `groups` holds the declared
groups (`id`, `name` and their `actions`), `actions` every action of the transport. `getActions(channel)` lists the
actions of any other transport (`getActions('schedule')`). Each action is described by:

| Property | Meaning |
|---|---|
| `id` | A stable id, computed from its controller, its method and its address |
| `name`, `description`, `groups`, `acl` | Its options |
| `controller`, `method` | The name of its controller class, and of its method |
| `route` / `command` / `pattern` | Its address, prefix included |
| `jsonSchema` | The JSON schema of its DTO |

## 6. Pushing events to the clients

The service transports that keep their clients connected (Socket.IO, Electron, the event stream of the HTTP service,
JSON-RPC over WebSocket or stdio, gRPC) can receive events from the application.
`entrypoint.notify(clientId, event, ...args)` sends an event to the client whose id an action found in
`this.context.clientId`, and returns whether that client received it. `entrypoint.broadcast(event, ...args)` sends it to
every connected client, and returns their number. See [GRPC](GRPC.md) and [ServiceCalls](ServiceCalls.md).

## 7. Customizing the entrypoint

A subclass of `Entrypoint` can replace the class of the component: declare it with `class`, and give the same options
next to it.

```typescript
import {AccessControl, Entrypoint} from 'lakutata/com/entrypoint'

//Logs every decision of the access control
class AuditedAccessControl extends AccessControl {
    protected async match(): Promise<boolean> {
        const allowed: boolean = await super.match()
        console.log(`${this.target.name}: ${allowed ? 'allowed' : 'denied'}`)
        return allowed
    }
}

export class AuditedEntrypoint extends Entrypoint {
    protected readonly accessControl: typeof AccessControl = AuditedAccessControl
}

//components: {entrypoint: {class: AuditedEntrypoint, controllers: [...], http: ...}}, bootstrap: ['entrypoint']
```

An adapter for another transport implements the `EntrypointAdapter` interface of `@lakutata/entrypoint/channel`. The
entrypoint functions of lakutata 2.x (`buildHTTPEntrypoint`, `buildCLIEntrypoint`, `buildServiceEntrypoint`) are still
accepted by the `http`, `cli` and `service` options.
