<div align="center">

![lakutata](https://socialify.git.ci/lakutata/lakutata/image?description=1&descriptionEditable=An%20IoC-based%20universal%20application%20framework&font=Source%20Code%20Pro&forks=1&language=1&logo=https%3A%2F%2Fraw.githubusercontent.com%2Flakutata%2Flakutata%2Fmain%2Fassets%2Flogo.svg&name=1&pattern=Circuit%20Board&stargazers=1&theme=Auto)

</div>

<div align="center">

![node-lts](https://img.shields.io/node/v-lts/lakutata?style=for-the-badge&logo=nodedotjs&color=rgb(128%2C189%2C65))
![npm](https://img.shields.io/npm/v/lakutata?style=for-the-badge&logo=npm&color=rgb(128%2C189%2C65))
![npm](https://img.shields.io/npm/dm/lakutata?style=for-the-badge&logo=npm&color=rgb(128%2C189%2C65))
![NPM](https://img.shields.io/npm/l/lakutata?style=for-the-badge&logo=github&color=rgb(128%2C189%2C65))
![Codacy grade](https://img.shields.io/codacy/grade/0f16d1c355494415ad7733f8f22f7d36?style=for-the-badge&logo=codacy)

</div>


# lakutata

An IoC-based application framework for Node.js and TypeScript: one programming model for web services, CLI tools,
desktop (Electron) applications and embedded devices. An application is a tree of objects created by a container
(components, providers, controllers), validated by DTOs, and served by transports: HTTP (Express, Fastify), CLI
(Commander), service RPC (HTTP, Socket.IO, JSON-RPC 2.0, gRPC, NATS, Electron IPC) and schedules — one controller method
can be all of them at once.

This package is the framework: it re-exports the `@lakutata/*` packages under the subpaths listed below, and presets
the `log` (pino) and `entrypoint` components of the applications. Each subpath's typings document every declaration
with examples; each `@lakutata/*` package has its own README.

## Installation

```shell
npx @lakutata/cli create --name my-app   # a new project from a template (web, service, CLI, Electron…)
npm install lakutata                      # or the framework in an existing project
```

Node.js 22.13 or later (24.11 or later on Node.js 24), ESM (`"type": "module"`). The TypeScript options the framework needs are published as
`lakutata/tsconfig.json`:

```json
{
  "extends": "lakutata/tsconfig.json",
  "compilerOptions": {"rootDir": "src", "outDir": "dist"}
}
```

The transports and the integrations use optional peer dependencies, installed when used: `express` or `fastify`,
`commander`, `socket.io`, `ws`, the database drivers (`pg`, `mysql2`, `better-sqlite3`…), the cache stores (`redis`…), see each
package's README.

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
| `lakutata` | `@lakutata/core` | `Application`, `Module`, `Component`, `Provider`, `BaseObject`, `Container`, `DTO`, `Exception`, `Time`, the validation schemas and messages |
| `lakutata/decorator/di` | `@lakutata/core` | `@Inject`, `@Configurable`, `@Autoload`, `@Singleton`, `@Scoped`, `@Transient` |
| `lakutata/decorator/dto` | `@lakutata/core` | `@Expect`, `@Accept`, `@Return`, `@IndexSignature` |
| `lakutata/decorator/asst` | `@lakutata/core` | `@Before`, `@After` |
| `lakutata/dtos` | `@lakutata/core` | `PaginationSearchDTO`, `PaginationResultDTO`, `paginator`, `FlexibleDTO`, the JSON Schema conversion |
| `lakutata/com/entrypoint` | `@lakutata/entrypoint` | `Entrypoint`, `buildEntrypoints`, `Controller`, the contexts, the results, the access control, the middlewares, `httpServiceEntrypoint`, `scheduleEntrypoint` |
| `lakutata/decorator/ctrl` | `@lakutata/entrypoint` | `@HTTPAction`, `@GET`…`@OPTIONS`, `@CLIAction`, `@ServiceAction`, `@Schedule`, `@Prefix`, `@UseMiddlewares` |
| `lakutata/adapter/express`, `lakutata/adapter/fastify` | `@lakutata/entrypoint` | The HTTP transports, `staticUI` |
| `lakutata/adapter/commander` | `@lakutata/entrypoint` | The CLI transport |
| `lakutata/adapter/socket.io`, `lakutata/adapter/jsonrpc`, `lakutata/adapter/electron` | `@lakutata/entrypoint` | The service transports |
| `lakutata/com/logger` | `@lakutata/logger` | The `Logger` component (pino) preset as `log` |
| `lakutata/orm`, `lakutata/decorator/orm` | `@lakutata/orm` | TypeORM, its decorators |
| `lakutata/com/database`, `lakutata/provider/database` | `@lakutata/orm` | The `Database` component and provider, the migration commands |
| `lakutata/com/cacher` | `@lakutata/cache` | The `Cacher` component: memory, file, Redis, Memcached, MongoDB, SQLite, PostgreSQL, MySQL stores |
| `lakutata/com/mutex` | `@lakutata/mutex` | The `Mutex` component, `@Synchronized` |
| `lakutata/com/i18n` | `@lakutata/i18n` | The `I18n` component, the `Translator`, the language middleware |
| `lakutata/com/docker` | `@lakutata/docker` | The `Docker` component |
| `lakutata/com/containerd` | `@lakutata/containerd` | The `Containerd` component (containerd without Docker, BuildKit builds) |
| `lakutata/com/monitor` | `@lakutata/monitor` | The CPU, memory, event loop and HTTP monitors |
| `lakutata/security`, `lakutata/provider/passwordHash` | `@lakutata/security` | Hashing, ciphers, signatures, the `PasswordHash` provider |
| `lakutata/utils` | `@lakutata/utils` | The helpers (strings, objects, arrays, time, files, globs, encodings, guards) |
| `lakutata/tsconfig.json` | | The compiler options of the applications |

Outside this package: `@lakutata/cli` (the `lakutata` command: projects, bundles, executables, installers, migrations),
`@lakutata/grpc` (gRPC client, server and service transport), `@lakutata/nats` (NATS component and service transport),
`@lakutata/dbus` (D-Bus), `@lakutata/mcp` (the Model Context Protocol).

## Errors

The framework's exceptions extend `Exception` (from `lakutata`): an `errno` (`E_…`), a `message`, the application's id
and name, and a `statusCode` the HTTP transports answer with (500 by default; 400 for an invalid input, 403 for a denied
access, 404 for a missing route or action, 409 for a lock not acquired…). Each package's README lists its exceptions.

## See also

- The guides, in this package: `doc/en` (English) and `doc/zh` (Chinese): `Overview.md`, `Core.md`, `DTOValidation.md`,
  `Decorator.md`, `ActionPattern.md`, `ORMIntegration.md`, `I18n.md`, `Mutex.md`, `DockerIntegration.md`,
  `ContainerdIntegration.md`, `Security.md`, `Time.md`, `HelperFunctions.md`.
- `@lakutata/cli`: creating, building and packaging the applications.

## License

Lakutata is [MIT licensed](LICENSE).
