# Lakutata Overview

**Lakutata** is an IoC-based application framework for Node.js and TypeScript: one programming model for web
services, CLI tools, desktop (Electron) applications and embedded devices. An application is a tree of objects created
by a container (components, providers, modules, controllers), whose options and inputs are validated by DTOs, and whose
controllers are served by transports: HTTP (Express, Fastify), CLI (Commander), service RPC (HTTP, Socket.IO,
JSON-RPC 2.0, gRPC, NATS, Electron IPC) and schedules. One controller method can be all of them at once.

The package `lakutata` re-exports the `@lakutata/*` packages under its subpaths (see the table below) and presets two
components in every application: `log` (the pino `Logger`) and `entrypoint` (the `Entrypoint` that serves the
controllers).

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

The transports and the integrations use optional peer dependencies, installed when used: `express` or `fastify`,
`commander`, `socket.io`, `ws`, the database drivers (`pg`, `mysql2`, `better-sqlite3`…), the cache stores (`redis`…).

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
| `lakutata` | `Application`, `Module`, `Component`, `Provider`, `BaseObject`, `Container`, `DTO`, `Exception`, `Time`, `isPackaged`, `resourcesPath`, the validation messages |
| `lakutata/decorator/di` | `@Inject`, `@Configurable`, `@Autoload`, `@Singleton`, `@Scoped`, `@Transient`, `@Lifetime` |
| `lakutata/decorator/dto` | `@Expect`, `@Accept`, `@Return`, `@IndexSignature` |
| `lakutata/decorator/asst` | `@Before`, `@After` |
| `lakutata/dtos` | `PaginationSearchDTO`, `PaginationResultDTO`, `paginator`, `FlexibleDTO`, the JSON Schema conversion |
| `lakutata/com/entrypoint` | `Entrypoint`, `buildEntrypoints`, `Controller`, the contexts, `Result`, the access control, the middlewares, `httpServiceEntrypoint`, `scheduleEntrypoint` |
| `lakutata/decorator/ctrl` | `@HTTPAction`, `@GET`…`@OPTIONS`, `@CLIAction`, `@ServiceAction`, `@Schedule`, `@Prefix`, `@UseMiddlewares` |
| `lakutata/adapter/express`, `lakutata/adapter/fastify` | The HTTP transports |
| `lakutata/adapter/commander` | The CLI transport |
| `lakutata/adapter/socket.io`, `lakutata/adapter/jsonrpc`, `lakutata/adapter/electron` | The service transports |
| `lakutata/com/logger` | The `Logger` component (pino), preset as `log` |
| `lakutata/orm`, `lakutata/decorator/orm` | TypeORM and its decorators |
| `lakutata/com/database`, `lakutata/provider/database` | The `Database` component and provider |
| `lakutata/com/cacher` | The `Cacher` component |
| `lakutata/com/mutex` | The `Mutex` component, `@Synchronized` |
| `lakutata/com/queue` | The `Queue` component, `@QueueAction`, `queueEntrypoint` |
| `lakutata/com/i18n` | The `I18n` component, the `Translator`, the language middleware |
| `lakutata/com/docker` | The `Docker` component |
| `lakutata/com/containerd` | The `Containerd` component |
| `lakutata/com/monitor` | The CPU, memory, event loop and HTTP monitors |
| `lakutata/security`, `lakutata/provider/passwordHash` | Hashing, ciphers, signatures, the `PasswordHash` provider |
| `lakutata/utils` | The helper functions |

Outside this package: `@lakutata/cli` (the `lakutata` command: projects, bundles, executables, migrations),
`@lakutata/grpc` (gRPC client, server and service transport), `@lakutata/nats` (NATS component and service transport),
`@lakutata/dbus` (D-Bus) and `@lakutata/mcp` (the Model Context Protocol).

## The guides

| Guide | Topic |
|---|---|
| [Core](Core.md) | The application, the container, the lifetimes, dependency injection, modules, the lifecycle |
| [DTOValidation](DTOValidation.md) | DTOs, the schemas, the validation of the options, inputs and results |
| [Decorator](Decorator.md) | The decorators of each subpath |
| [ActionPattern](ActionPattern.md) | The controllers, their actions and their transports (HTTP, CLI, services, schedules, queues) |
| [ORMIntegration](ORMIntegration.md) | The `Database` component and TypeORM |
| [I18n](I18n.md) | The messages of each language |
| [Mutex](Mutex.md) | The locks between the instances and the processes |
| [Queue](Queue.md) | The message queues: producers, `@QueueAction` consumers, retries, dead letters, results |
| [DockerIntegration](DockerIntegration.md) | The `Docker` component |
| [ContainerdIntegration](ContainerdIntegration.md) | The `Containerd` component |
| [Security](Security.md) | Hashing, ciphers, signatures, passwords |
| [Time](Time.md) | The `Time` class |
| [HelperFunctions](HelperFunctions.md) | The helper functions of `lakutata/utils` |

Each `@lakutata/*` package has its own README, and the typings of each subpath document every declaration with
examples.
