<div align="center">

![lakutata](https://socialify.git.ci/lakutata/lakutata/image?description=1&descriptionEditable=An%20IoC-based%20universal%20application%20framework&font=Source%20Code%20Pro&forks=1&language=1&logo=https%3A%2F%2Fraw.githubusercontent.com%2Flakutata%2Flakutata%2Fmain%2Fpackages%2Flakutata%2Fassets%2Flogo.svg&name=1&pattern=Circuit%20Board&stargazers=1&theme=Auto)

</div>

<div align="center">

![node-lts](https://img.shields.io/node/v-lts/lakutata?style=for-the-badge&logo=nodedotjs&color=rgb(128%2C189%2C65))
![npm](https://img.shields.io/npm/v/lakutata?style=for-the-badge&logo=npm&color=rgb(128%2C189%2C65))
![npm](https://img.shields.io/npm/dm/lakutata?style=for-the-badge&logo=npm&color=rgb(128%2C189%2C65))
![NPM](https://img.shields.io/npm/l/lakutata?style=for-the-badge&logo=github&color=rgb(128%2C189%2C65))
![Codacy grade](https://img.shields.io/codacy/grade/0f16d1c355494415ad7733f8f22f7d36?style=for-the-badge&logo=codacy)

</div>

English | [中文](README.zh-CN.md)

# lakutata

An IoC-based application framework for Node.js and TypeScript, with one programming model for web services, CLI tools,
desktop (Electron) applications and embedded devices. An application is a tree of objects (components, providers,
controllers) that a container creates. DTOs validate their options and inputs, and transports expose the controllers:
HTTP (Express, Fastify), CLI (Commander), service RPC (HTTP, Socket.IO, JSON-RPC 2.0, gRPC, NATS, Electron IPC),
schedules and message queues. One controller method can serve all of them at once.

This package is the framework itself: it re-exports the `@lakutata/*` packages under the subpaths listed below and
presets two components in every application, `log` and `entrypoint`. The typings of each subpath document every
declaration with examples, and each `@lakutata/*` package has its own README.

## Installation

```shell
npx @lakutata/cli create --name my-app   # a new project from a template (web, service, CLI, Electron…)
npm install lakutata                      # or the framework in an existing project
```

The framework needs Node.js `^22.13.0 || >=24.11.0`: 22.13 or a later 22.x, or 24.11 and later (not 23). Projects
use ES modules (`"type": "module"`), as the templates do; the package also ships CommonJS builds. The TypeScript
options that the framework needs are published as `lakutata/tsconfig.json`:

```json
{
  "extends": "lakutata/tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "build"
  },
  "include": ["src"]
}
```

Keep `include`: the published options compile JavaScript files too (`allowJs`), so without it a configuration file at
the root of the project (`eslint.config.js`, `vite.config.ts`) breaks the build.

The transports and integrations rely on optional peer dependencies, which you install only when you use them: `express`
or `fastify`, `commander`, `socket.io`, `ws`, the database drivers (`pg`, `mysql2`, `better-sqlite3`…) and the cache
stores (`redis`…). Each package's README lists its own.

## Usage

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

## API

| Subpath | Package | What it provides |
|---|---|---|
| `lakutata` | `@lakutata/core` | `Application`, `Component`, `Provider`, `BaseObject`, `Container`, `DTO`, `Exception`, `Time`, `isPackaged`, `resourcesPath`, the validation schemas and messages |
| `lakutata/decorator/di` | `@lakutata/core` | `@Inject`, `@Configurable`, `@Autoload`, `@Lifetime`, `@Singleton`, `@Scoped`, `@Transient` |
| `lakutata/decorator/dto` | `@lakutata/core` | `@Expect`, `@Accept`, `@Return`, `@IndexSignature` |
| `lakutata/decorator/asst` | `@lakutata/core` | `@Before`, `@After` |
| `lakutata/dtos` | `@lakutata/core` | `PaginationSearchDTO`, `PaginationResultDTO`, `paginator`, `FlexibleDTO`, the JSON Schema conversion |
| `lakutata/com/entrypoint` | `@lakutata/entrypoint` | `Entrypoint`, `buildEntrypoints`, `Controller`, the contexts, the results, the access control, the middlewares, `httpServiceEntrypoint`, `scheduleEntrypoint` |
| `lakutata/decorator/ctrl` | `@lakutata/entrypoint` | `@HTTPAction`, `@GET`…`@OPTIONS`, `@CLIAction`, `@ServiceAction`, `@Schedule`, `@Prefix`, `@UseMiddlewares` |
| `lakutata/adapter/express`, `lakutata/adapter/fastify` | `@lakutata/entrypoint` | The HTTP transports, `staticUI` (Express only) |
| `lakutata/adapter/commander` | `@lakutata/entrypoint` | The CLI transport |
| `lakutata/adapter/socket.io`, `lakutata/adapter/jsonrpc`, `lakutata/adapter/electron` | `@lakutata/entrypoint` | The service transports |
| `lakutata/com/logger` | `@lakutata/logger` | The `Logger` component preset as `log` (pino-compatible JSON lines) |
| `lakutata/orm`, `lakutata/decorator/orm` | `@lakutata/orm` | TypeORM, its decorators |
| `lakutata/com/database`, `lakutata/provider/database` | `@lakutata/orm` | The `Database` component and provider, the migration commands |
| `lakutata/com/cacher` | `@lakutata/cache` | The `Cacher` component: memory, file, Redis, Memcached, MongoDB, SQLite, PostgreSQL, MySQL stores |
| `lakutata/com/mutex` | `@lakutata/mutex` | The `Mutex` component, `@Synchronized` |
| `lakutata/com/queue` | `@lakutata/queue` | The `Queue` component, `@QueueAction`, `queueEntrypoint`: message queues in memory, Redis (BullMQ), NATS JetStream, RabbitMQ or Kafka |
| `lakutata/com/i18n` | `@lakutata/i18n` | The `I18n` component, the `Translator`, the language middleware |
| `lakutata/com/docker` | `@lakutata/docker` | The `Docker` component |
| `lakutata/com/containerd` | `@lakutata/containerd` | The `Containerd` component (containerd without Docker, BuildKit builds) |
| `lakutata/com/monitor` | `@lakutata/monitor` | The CPU, memory, event loop and HTTP monitors |
| `lakutata/security`, `lakutata/provider/passwordHash` | `@lakutata/security` | Hashing, ciphers, signatures, the `PasswordHash` provider |
| `lakutata/utils` | `@lakutata/utils` | The helpers (strings, objects, arrays, time, files, globs, encodings, guards) |
| `lakutata/tsconfig.json` | | The compiler options for applications |

Not part of this package: `@lakutata/cli` (the `lakutata` command for projects, bundles, executables, installers and
migrations), `@lakutata/grpc` (a gRPC client, server and service transport), `@lakutata/nats` (a NATS component and
service transport), `@lakutata/dbus` (D-Bus) and `@lakutata/mcp` (the Model Context Protocol).

## Errors

The framework's exceptions extend `Exception` (from `lakutata`). Each one has an `errno` (`E_…`), a `message`, the
application's id and name, and a `statusCode` that the HTTP transports use as the response status: 500 by default, 400
for invalid input, 403 when access is denied, 404 for a missing route or action, 409 when a lock is not acquired, and so
on. Each package's README lists its exceptions.

## See also

- The website, [lakutata.com](https://lakutata.com): the guides, the examples and the API reference, in English and in
  Chinese.
- The guides, in this package: `doc/en` (English) and `doc/zh` (Chinese): `Overview.md`, `GettingStarted.md`,
  `ProjectStructure.md`, `UpgradingFrom2.md`, `UpgradingFrom1.md`, `Application.md`, `Objects.md`, `Injection.md`,
  `DTOValidation.md`, `Exceptions.md`, `Logger.md`, `Decorator.md`, `Time.md`, `HelperFunctions.md`, `Controllers.md`,
  `Entrypoint.md`, `Middlewares.md`, `HTTP.md`, `CLI.md`, `ServiceCalls.md`, `GRPC.md`, `NATS.md`, `Schedules.md`,
  `Queue.md`, `Database.md`, `DatabaseDrivers.md`, `MongoEmbedded.md`, `Entities.md`, `Migrations.md`, `Cache.md`,
  `Mutex.md`, `I18n.md`, `DockerIntegration.md`, `ContainerdIntegration.md`, `Monitor.md`, `Security.md`, `DBus.md`,
  `MCP.md`, `Command.md`, `Workspaces.md`, `NativeAddons.md`, `Packaging.md`, `Installers.md`; and the examples, in
  `doc/en/examples` and `doc/zh/examples`: whole applications built from the templates.
- `@lakutata/cli`: creating, building and packaging applications.
- The official Agent Skill for AI coding assistants that work on lakutata projects:
  [lakutata.com/skill](https://lakutata.com/skill/).

## License

Lakutata is [MIT licensed](LICENSE).
