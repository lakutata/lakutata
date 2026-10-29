---
name: lakutata
description: >-
  Writes, changes and tests applications built on lakutata 3.x, the IoC application framework for Node.js and
  TypeScript (web services and APIs, command line tools, Electron desktop applications, services on devices, MCP
  servers). Use it when a project depends on "lakutata" or "@lakutata/*", imports from 'lakutata' or 'lakutata/...',
  calls Application.run(), has classes extending Component, Provider, Controller or DTO, uses decorators such as
  @Inject, @Configurable, @Expect, @GET, @POST, @CLIAction, @ServiceAction, @Schedule or @QueueAction, calls
  buildEntrypoints() or an adapter such as expressHTTPEntrypoint(), extends "lakutata/tsconfig.json", or runs the
  lakutata command (@lakutata/cli). Also for creating a project from a lakutata template, and for upgrading to 3.x a
  lakutata 2.x project or a 1.x one (packages @lakutata/core 1.x, @lakutata-component/*, @lakutata-module/*).
license: MIT
metadata:
  framework: lakutata
  framework-version: "3.x"
  documentation: https://lakutata.com
---

# Lakutata 3.x

Lakutata is an IoC application framework for Node.js and TypeScript. An application is a tree of objects (components,
providers, controllers) that a container creates; DTOs validate their options and inputs; one controller method can
answer over HTTP, on the command line, over service transports, on a schedule and from a queue. This file gives the
model and the rules that hold everywhere. The details are in the guides that ship with the package the project has
installed: read them as the section "Where the details are" says.

## Step 0: check the version first

Read the dependencies in the `package.json` of the project (in a workspace, the package of the application, usually
`packages/app/package.json`), and `node_modules/lakutata/package.json` or `node_modules/@lakutata/core/package.json`.

| Signs | Version |
|---|---|
| `lakutata` at `^3…`; `"type": "module"`; relative imports ending in `.js`; `buildEntrypoints()` | 3.x: this skill |
| `lakutata` at `^2…`; imports from `lakutata/helper`; builders in PascalCase (`BuildEntrypoints()`) | 2.x |
| `@lakutata/core` at `^1…`, with packages named `@lakutata-component/*` or `@lakutata-module/*` | 1.x |

This skill documents 3.x. The three versions are not source compatible, and 1.x and 2.x differ from each other too:

- In a 2.x or 1.x project, do not write 3.x code, and never mix the APIs of two versions in one project.
- To upgrade a 2.x project, follow only `https://lakutata.com/doc/en/UpgradingFrom2.md`; to upgrade a 1.x project,
  follow only `https://lakutata.com/doc/en/UpgradingFrom1.md`. Each covers its own version: do not apply the steps of
  one to the other.
- Otherwise follow the code the project already has, and tell the user that this skill describes 3.x.

## Where the details are

The guides and the examples of lakutata ship inside the package, in the version the project runs. Before writing code
in an area this project does not use yet, read its guide, in this order:

1. `node_modules/lakutata/doc/en/` (in a workspace, the `node_modules` of the root or of the application package).
   `Overview.md` lists the guides of the installed version; `examples/`, when present, holds whole applications.
   The separate packages (`@lakutata/nats`, `@lakutata/grpc`, `@lakutata/mcp`, `@lakutata/dbus`, `@lakutata/webrtc`,
   `@lakutata/ffi`, `@lakutata/math`, `@lakutata/netif`, `@lakutata/cli`) have their README in their own directory of
   `node_modules`.
2. The type declarations of `lakutata` and `@lakutata/*` in `node_modules`: every export is documented there with an
   example. They are the reference for a signature or an option.
3. When the package is not installed yet (a new project) or has no `doc/`: the same files on the website, as plain
   Markdown: `https://lakutata.com/doc/en/<file>.md` (the guides) and `https://lakutata.com/doc/en/examples/<file>.md`;
   `https://lakutata.com/llms.txt` lists them. The website follows the latest sources, which may be ahead of a
   project's version: what the installed package says wins.

Some assistants keep `node_modules` away from their file tools (it is ignored by git). When a file there cannot be
opened, read it with a shell command (`cat node_modules/lakutata/doc/en/Overview.md`) if one is allowed, or use the
website.

| Task | Guides (file names of the current version; `Overview.md` lists those of the installed one) |
|---|---|
| A new project, its files and scripts, the `lakutata` command | `GettingStarted.md`, `ProjectStructure.md`, `Command.md` |
| The application: options, lifecycle, mode | `Application.md` |
| Components, providers, lifetimes, injection, options of objects | `Objects.md`, `Injection.md`, `Decorator.md` |
| DTOs and validation; exceptions | `DTOValidation.md`; `Exceptions.md` |
| Controllers, the entrypoint, middlewares and access control | `Controllers.md`, `Entrypoint.md`, `Middlewares.md` |
| HTTP routes and responses; command line tools | `HTTP.md`; `CLI.md` |
| Service actions and their clients; gRPC; NATS | `ServiceCalls.md`; `GRPC.md`; `NATS.md` |
| Scheduled jobs; message queues | `Schedules.md`; `Queue.md` |
| Databases, entities, migrations | `Database.md`, `DatabaseDrivers.md`, `Entities.md`, `Migrations.md`, `MongoEmbedded.md` |
| Caches; locks | `Cache.md`; `Mutex.md` |
| Logs; messages in several languages; monitors | `Logger.md`; `I18n.md`; `Monitor.md` |
| Docker; containerd; D-Bus; MCP servers | `DockerIntegration.md`; `ContainerdIntegration.md`; `DBus.md`; `MCP.md` |
| Security; time; helper functions | `Security.md`; `Time.md`; `HelperFunctions.md` |
| Workspaces of several packages; native addons; C functions of native libraries | `Workspaces.md`; `NativeAddons.md`; `FFI.md` |
| Mathematics: formulas, equations, decimals, matrices, statistics, numeric solutions, units (`@lakutata/math`) | `Math.md` |
| Listening on a network interface whatever its addresses (the `interface` option of the entrypoints, or `@lakutata/netif` alone); the interfaces and their changes | `Netif.md` |
| Bundles, executables, installers | `Packaging.md`, `Installers.md` |
| A whole application of a kind (REST API, CLI tool, web or desktop application, calls between services, background jobs, MCP server, service on a device) | `examples/README.md` and its pages |
| A 2.x project to bring to 3.x | `https://lakutata.com/doc/en/UpgradingFrom2.md` (the installed 2.x package does not have it) |
| A 1.x project to bring to 3.x | `https://lakutata.com/doc/en/UpgradingFrom1.md` (the installed 1.x packages do not have it) |

## A project

- Node.js `^22.13.0 || >=24.11.0`, TypeScript with `experimentalDecorators` and `emitDecoratorMetadata`, ES modules.
  The `tsconfig.json` extends `lakutata/tsconfig.json` (and keeps an `include`), and the relative imports of the
  sources end in `.js`: `import {config} from './config/Config.js'`.
- `npx @lakutata/cli create --name my-app` creates a project from a template: `default` (an HTTP application), `cli`,
  `service`, `web-react`, `web-vue`, `web-next`, `web-nuxt`, `electron-react`, `electron-vue`; `--with i18n,installer`
  adds features. All but `default` are workspaces, the application being the package `packages/app`.
- `src/App.ts` starts the application with the options returned by `config()` in `src/config/Config.ts`; controllers,
  components, DTOs and tests have their own directories (`controllers/`, `components/`, `dtos/`, `tests/`).
- `npm run build` compiles to `build/`, `npm test` builds then runs `node --test` on the compiled tests, `npm run dev`
  builds and starts.

## The subpaths

Import only from these subpaths, never from the files inside a package.

| Subpath | What it gives |
|---|---|
| `lakutata` | `Application`, `Component`, `Provider`, `Container`, `DTO`, `Exception`, `Time`, `isPackaged`, `resourcesPath` |
| `lakutata/decorator/di` | `@Inject`, `@Configurable`, `@Autoload`, `@Singleton`, `@Scoped`, `@Transient` |
| `lakutata/decorator/dto` | `@Expect`, `@Accept`, `@Return`, `@IndexSignature` |
| `lakutata/dtos` | `PaginationSearchDTO`, `PaginationResultDTO`, `paginator`, `FlexibleDTO` |
| `lakutata/com/entrypoint` | `buildEntrypoints`, `Controller`, the contexts, `Result`, middlewares, access control, `httpServiceEntrypoint`, `HTTPServiceProxy`, `scheduleEntrypoint` |
| `lakutata/decorator/ctrl` | `@GET`…`@OPTIONS`, `@HTTPAction`, `@CLIAction`, `@ServiceAction`, `@Schedule`, `@Prefix`, `@UseMiddlewares` |
| `lakutata/adapter/express`, `lakutata/adapter/fastify` | The HTTP adapters (`expressHTTPEntrypoint`, `jsonEnvelope`…) |
| `lakutata/adapter/commander` | The command line adapter (`commanderCLIEntrypoint`) |
| `lakutata/adapter/socket.io`, `lakutata/adapter/jsonrpc`, `lakutata/adapter/electron` | Service transports |
| `lakutata/com/logger` | The `Logger`, preset as the component `log` |
| `lakutata/orm`, `lakutata/decorator/orm` | TypeORM and its decorators |
| `lakutata/com/database`, `lakutata/provider/database` | `buildDatabaseOptions`, the `Database` component and provider |
| `lakutata/com/queue`, `lakutata/com/mutex`, `lakutata/com/cacher` | Queues, locks, caches |
| `lakutata/com/i18n`, `lakutata/com/monitor`, `lakutata/com/docker`, `lakutata/com/containerd` | Other components |
| `lakutata/security`, `lakutata/provider/passwordHash`, `lakutata/utils` | Security, password hashes, helpers |

Separate packages: `@lakutata/cli` (the `lakutata` command), `@lakutata/nats`, `@lakutata/grpc`, `@lakutata/mcp`,
`@lakutata/dbus`, `@lakutata/webrtc` (WebRTC: the signaling, a TURN server, a media server, peer connections, the
service actions of an application called through data channels, a browser client), `@lakutata/ffi` (the C functions of
native libraries, declared with the C declarations of their headers), `@lakutata/math` (symbolic and numeric
mathematics: equations, derivatives, integrals, limits, matrices, statistics, decimals of any precision; plain
functions, no component), `@lakutata/netif` (servers and UDP sockets listening on a network interface whatever its
addresses, the interfaces of the machine and their changes; plain classes, no component; the entrypoints that listen on
a port use it through their `interface` option). The adapters and drivers need their library installed (`express`,
`fastify`, `commander`, `socket.io`, `ws`, `pg`, `mysql2`, `better-sqlite3`, `ioredis`…): they are optional peer
dependencies.

## An application

```typescript
import {Application, Component, DTO, Exception, type ILogger} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET, POST} from 'lakutata/decorator/ctrl'
import {Configurable, Inject} from 'lakutata/decorator/di'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'

class NoteNotFoundException extends Exception {
    public errno: string = 'E_NOTE_NOT_FOUND'

    public readonly statusCode: number = 404
}

class NoteLimitException extends Exception {
    public errno: string = 'E_NOTE_LIMIT'

    public readonly statusCode: number = 409
}

//A component: one instance for the whole application, its options validated at launch
class Notes extends Component {
    @Configurable(DTO.Number().integer().min(1))
    protected readonly limit: number = 100

    @Inject('log')
    protected readonly log: ILogger

    protected readonly notes: Map<number, string> = new Map()

    public add(text: string): number {
        if (this.notes.size >= this.limit) throw new NoteLimitException('{0} notes at most', this.limit)
        const id: number = this.notes.size + 1
        this.notes.set(id, text)
        this.log.info('Note %d added', id)
        return id
    }

    public get(id: number): string {
        const text: string | undefined = this.notes.get(id)
        if (text === undefined) throw new NoteNotFoundException('Note {id} not found', {id: id})
        return text
    }
}

class NoteIdDTO extends DTO {
    //A route parameter is text: strict(false) converts it to a number
    @Expect(DTO.Number().integer().min(1).strict(false).required())
    public id: number
}

class NewNoteDTO extends DTO {
    @Expect(DTO.String().min(1).max(500).required())
    public text: string
}

//A controller: one instance per request
class NoteController extends Controller {
    @Inject('notes')
    protected readonly notes: Notes

    @POST('/notes', NewNoteDTO)
    public async create(input: NewNoteDTO): Promise<{ id: number }> {
        return {id: this.notes.add(input.text)}
    }

    @GET('/notes/:id', NoteIdDTO)
    public async get(input: NoteIdDTO): Promise<{ id: number, text: string }> {
        return {id: input.id, text: this.notes.get(input.id)}
    }
}

Application
    .run(() => ({
        id: 'notes.app',
        name: 'Notes',
        components: {
            notes: {class: Notes, limit: 1000},
            entrypoint: buildEntrypoints({
                controllers: [NoteController],
                http: expressHTTPEntrypoint({port: 8080, respond: jsonEnvelope()})
            })
        },
        //Created at launch, in this order: nothing listens until the entrypoint is created
        bootstrap: ['notes', 'entrypoint']
    }))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => log.error('Cannot start: %s', error.message))
```

- The options: `id` and `name` (required), `components` and `providers` by name (`{class, ...options}`), `objects`,
  `bootstrap` (names, classes or async functions, run in order at launch), `mode`, `timezone`. `log` (the `Logger`) and
  `entrypoint` are preset: `log: {level: 'debug'}` without `class` configures the preset logger.
- With `jsonEnvelope()`, a result is answered as `{errno: null, errMsg: null, data}` and an exception as
  `{errno, errMsg, data: null}` with its `statusCode`; without it, the result is the body.
- Outside the objects (an `onLaunched` handler, a script), `await app.getObject<Notes>('notes')` gets an object.

## Objects, lifetimes and injection

| Class | Lifetime | Use it for |
|---|---|---|
| `Component` | `@Singleton`, locked | Long-lived services that own resources: connections, servers, timers, state |
| `Provider` | `@Scoped` (may be `@Singleton` or `@Transient`) | Work bound to a request or a scope |
| `Controller` | `@Scoped`, locked | The actions; a new instance for each request |

- Never call `new` on these classes: declare them and let the container create them. In tests and scripts,
  `await new Container().set(Notes, {limit: 10})` creates one with its options.
- Creation: `@Inject` properties are resolved, then `@Configurable` options are validated and set, then `init()` runs,
  then `startup()`; once the application has launched, `launched()` runs (not awaited). Teardown runs
  `beforeDestroy()`, destroys what the object created, then `destroy()`. These hooks are `protected async` methods.
- `@Inject()` takes the object named like the property, `@Inject('name')` a named one, `@Inject(Class)` the object
  registered for a class (`@Inject(Application)`), `@Inject('db', (db) => …)` a value derived from it.
- `@Configurable(schema)` makes a property an option: its value comes from the declaration, the initializer is the
  default, and an invalid value stops the launch with `InvalidObjectOptionsException`. Libraries export a function that
  builds the declaration (`buildDatabaseOptions()`, `buildQueueOptions()`); use them.

## Controllers, DTOs and errors

- An action is a controller method with an address: `@GET('/path', InputDTO)`, `@CLIAction('command <arg>', InputDTO)`,
  `@ServiceAction({cmd: 'name'}, InputDTO)`, `@Schedule('5m')`, `@QueueAction('queue')`. One method may carry several.
  A decorator does nothing without its adapter in `buildEntrypoints()` (`http`, `cli`, `service`, `schedule`, `queue`).
- The input: HTTP merges the query and the body, with the route parameters over them; the command line gives its
  arguments and options; a service call gives its message without the pattern's keys. The DTO validates it, applies
  the defaults and removes the unknown keys; the method receives a plain object.
- DTOs are strict: a value of the wrong type is refused, not converted. Query strings and route parameters are text,
  so their numbers, booleans and dates need `.strict(false)`; JSON bodies and service messages keep their types, and
  the command line converts its own arguments. Under strictness `.trim()` refuses surrounding spaces instead of
  removing them: write `.trim().strict(false)` to trim.
- An invalid input fails with `InvalidValueException` (`E_INVALID_VALUE`, HTTP 400). `@Accept(schema)` and
  `@Return(schema)` validate the arguments and the result of any method at run time.
- Errors: extend `Exception` with an `errno` and a `statusCode`; build messages from templates
  (`'Order {id} not found', {id}`). HTTP answers with the status and `{errno, errMsg}`; the service transports send
  the whole error, and a client recognizes it by `errno` (the class does not cross the call).
- `this.context` describes the request (`HTTPContext`, `CLIContext`, `ServiceContext`…), `this.signal` aborts when the
  client leaves or the application stops: long actions should check it. `Result.status()`, `Result.file()` and
  `Result.events()` control HTTP responses.

## Pitfalls

1. The entrypoint is not in `bootstrap`: the application launches and nothing listens.
2. An action decorator without the matching adapter in `buildEntrypoints()` is ignored silently.
3. A query or route number without `.strict(false)` fails with `"id" must be a number`.
4. A relative import without `.js` compiles and then fails at run time (`ERR_MODULE_NOT_FOUND`).
5. Request state kept in a component is shared by every request: components are singletons.
6. `app.getObject(SomeComponent)` does not find a component declared under a name: use the name.
7. An adapter's or a driver's library that is not installed fails the start with an error naming the package: install
   it in the package of the application (in a workspace, `npm install <package> -w app`).
8. A plain `Error` reaches an HTTP client as status 500 with `errno` `E_UNKNOWN` (or its `code`): throw an `Exception`
   subclass, whose `errno` and `statusCode` the client can rely on.
9. Clients of another service must test `errno`, not `instanceof`: exception classes do not cross the call.
10. An option that no `@Configurable` property declares is only warned about at launch: check the spelling.
11. `launched()` is not awaited and its errors are only logged: work that must succeed before the application serves
    belongs in `init()` or `startup()`.
12. Tests that start the application use a port of their own and `await app.dispose()` at the end, or the next test
    file finds the port in use.
