# Lakutata Overview

**Lakutata** is an IoC application framework for Node.js and TypeScript. It gives web services, CLI tools, desktop
(Electron) applications and embedded devices one programming model: an application is a tree of objects (components,
providers, controllers) that a container creates. DTOs validate their options and inputs, and transports expose
the controllers: HTTP (Express, Fastify), CLI (Commander), service RPC (HTTP, Socket.IO, JSON-RPC 2.0, gRPC, NATS,
Electron IPC), schedules and message queues. One controller method can serve all of them at once.

The package `lakutata` re-exports the `@lakutata/*` packages under its subpaths (see the table below) and presets two
components in every application: `log` (the `Logger`, which writes pino-compatible JSON lines) and `entrypoint` (the
`Entrypoint` that serves the controllers).

## Requirements

- Node.js 22.13 or later (24.11 or later on Node.js 24).
- ESM (`"type": "module"`); the package also ships CommonJS builds.
- TypeScript with `experimentalDecorators` and `emitDecoratorMetadata`. The package publishes the compiler options the
  framework needs as `lakutata/tsconfig.json`.

## Installation

```bash
npx @lakutata/cli create --name my-app   # a new project from a template (web, service, CLI, Electron…)
npm install lakutata                      # or the framework in an existing project
```

```json
{
  "extends": "lakutata/tsconfig.json",
  "compilerOptions": {"rootDir": "src", "outDir": "dist"}
}
```

Transports and integrations rely on optional peer dependencies that you install only when you use them: `express` or
`fastify`, `commander`, `socket.io`, `ws`, database drivers (`pg`, `mysql2`, `better-sqlite3`…), cache stores
(`redis`…).

## A first application

```typescript
import {Application, DTO, type ILogger} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class GreetDTO extends DTO {
    @Expect(DTO.String().optional().default('world'))
    public name: string
}

class GreetController extends Controller {
    //GET /greet?name=you, and the service action {cmd: 'greet', name: 'you'}
    @GET('/greet', GreetDTO)
    @ServiceAction({cmd: 'greet'}, GreetDTO)
    public async greet(input: GreetDTO): Promise<{ message: string }> {
        return {message: `Hello, ${input.name}!`}
    }
}

Application
    .run(() => ({
        id: 'com.example.greeter',
        name: 'Greeter',
        components: {
            entrypoint: buildEntrypoints({
                controllers: [GreetController],
                http: expressHTTPEntrypoint({port: 8080})
            })
        },
        bootstrap: ['entrypoint']
    }))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started', app.appName))
```

## The subpaths

| Subpath | What it provides |
|---|---|
| `lakutata` | `Application`, `Component`, `Provider`, `BaseObject`, `Container`, `DTO`, `Exception`, `Time`, `isPackaged`, `resourcesPath`, the validation messages |
| `lakutata/decorator/di` | `@Inject`, `@Configurable`, `@Autoload`, `@Singleton`, `@Scoped`, `@Transient`, `@Lifetime` |
| `lakutata/decorator/dto` | `@Expect`, `@Accept`, `@Return`, `@IndexSignature` |
| `lakutata/decorator/asst` | `@Before`, `@After` |
| `lakutata/dtos` | `PaginationSearchDTO`, `PaginationResultDTO`, `paginator`, `FlexibleDTO`, the JSON Schema conversion |
| `lakutata/com/entrypoint` | `Entrypoint`, `buildEntrypoints`, `Controller`, the contexts, `Result`, the access control, the middlewares, `httpServiceEntrypoint`, `scheduleEntrypoint` |
| `lakutata/decorator/ctrl` | `@HTTPAction`, `@GET`…`@OPTIONS`, `@CLIAction`, `@ServiceAction`, `@Schedule`, `@Prefix`, `@UseMiddlewares` |
| `lakutata/adapter/express`, `lakutata/adapter/fastify` | The HTTP transports |
| `lakutata/adapter/commander` | The CLI transport |
| `lakutata/adapter/socket.io`, `lakutata/adapter/jsonrpc`, `lakutata/adapter/electron` | The service transports |
| `lakutata/com/logger` | The `Logger` component, preset as `log` (pino-compatible JSON lines) |
| `lakutata/orm`, `lakutata/decorator/orm` | TypeORM and its decorators |
| `lakutata/com/database`, `lakutata/provider/database` | The `Database` component and provider |
| `lakutata/com/cacher` | The `Cacher` component |
| `lakutata/com/mutex` | The `Mutex` component, `@Synchronized` |
| `lakutata/com/queue` | The `Queue` component, `@QueueAction`, `queueEntrypoint` |
| `lakutata/com/i18n` | The `I18n` component, the `Translator`, the language middleware |
| `lakutata/com/docker` | The `Docker` component |
| `lakutata/com/containerd` | The `Containerd` component |
| `lakutata/com/monitor` | CPU, memory, event loop and HTTP monitors |
| `lakutata/security`, `lakutata/provider/passwordHash` | Hashing, ciphers, signatures, the `PasswordHash` provider |
| `lakutata/utils` | The helper functions |

Not part of this package: `@lakutata/cli` (the `lakutata` command for creating projects, bundling, building executables
and running migrations), `@lakutata/grpc` (a gRPC client, server and service transport), `@lakutata/nats` (a NATS
component and service transport), `@lakutata/dbus` (D-Bus) and `@lakutata/mcp` (the Model Context Protocol).

## The guides

| Guide | Topic |
|---|---|
| [Application](Application.md) | The application: its options, the fluent API, the lifecycle, the mode, packed applications |
| [Objects](Objects.md) | Components, providers and their container: lifetimes, scopes, creation and teardown, a container without an application |
| [Injection](Injection.md) | Dependency injection, the options of objects, sharing features between applications |
| [DTOValidation](DTOValidation.md) | DTOs and schemas: validating options, inputs and results |
| [Exceptions](Exceptions.md) | Declaring exceptions, their messages, what the clients receive, the exceptions of the framework |
| [Logger](Logger.md) | The `log` component: writing lines, readable lines or JSON, destinations, another logger |
| [Decorator](Decorator.md) | The decorators, by subpath |
| [Time](Time.md) | The `Time` class |
| [HelperFunctions](HelperFunctions.md) | The helper functions of `lakutata/utils` |
| [Controllers](Controllers.md) | Controllers and actions: their addresses, input and results, prefixes, inheritance |
| [Entrypoint](Entrypoint.md) | The entrypoint component: its options and adapters, starting and stopping, the list of the actions |
| [Middlewares](Middlewares.md) | The middlewares and the access control of the actions |
| [HTTP](HTTP.md) | The HTTP adapters: routes, input, responses, errors, the features of Express and Fastify |
| [CLI](CLI.md) | Command line tools: commands, options, prompts, output and exit codes |
| [ServiceCalls](ServiceCalls.md) | The service actions over HTTP, Socket.IO, JSON-RPC 2.0 and Electron: patterns, responses, clients and their events |
| [GRPC](GRPC.md) | The service actions over gRPC (`@lakutata/grpc`), and calling them from other applications and languages |
| [NATS](NATS.md) | The NATS component, the service actions over NATS (`@lakutata/nats`), the service proxies and their events |
| [Schedules](Schedules.md) | Scheduled jobs: intervals, cron expressions, jobs run by one instance |
| [Queue](Queue.md) | The message queues: producers, `@QueueAction` consumers, retries, dead letters, results |
| [Database](Database.md) | The `Database` component and provider, the connection options, several databases |
| [DatabaseDrivers](DatabaseDrivers.md) | The database drivers, one by one: what to install, their options, their limits |
| [MongoEmbedded](MongoEmbedded.md) | A MongoDB inside the application, its documents in files |
| [Entities](Entities.md) | The entities, the queries, the transactions and the errors |
| [Migrations](Migrations.md) | Writing, generating and running the migrations |
| [Cache](Cache.md) | The `Cacher` component: `wrap()`, the stores and their tiers, what they keep |
| [Mutex](Mutex.md) | Locks shared between processes and instances |
| [I18n](I18n.md) | Messages in several languages |
| [DockerIntegration](DockerIntegration.md) | The `Docker` component |
| [ContainerdIntegration](ContainerdIntegration.md) | The `Containerd` component |
| [Monitor](Monitor.md) | The CPU, memory, event loop and HTTP request monitors |
| [Security](Security.md) | Hashing, ciphers, signatures, passwords |
| [DBus](DBus.md) | A D-Bus service and client (`@lakutata/dbus`): methods, objects, properties, signals |
| [MCP](MCP.md) | The tools, resources and prompts of the Model Context Protocol (`@lakutata/mcp`), over stdio and HTTP |

Each `@lakutata/*` package has its own README, and the type declarations of every subpath document each export with an
example.
