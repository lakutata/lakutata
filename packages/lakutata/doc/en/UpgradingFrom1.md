# Upgrading from Lakutata 1.x

Lakutata 1.x was a family of packages: `@lakutata/core` 1.x, the modules `@lakutata-module/*` (`service`, `api`), the
components `@lakutata-component/*` (`typeorm`, `cacher`…) and `@lakutata/cli` 1.0. Lakutata 3 is a different framework
with a different API, so a 1.x project is ported to it rather than upgraded in place. This page gives the way to port
it and what each part of 1.x becomes.

It is for the projects that depend on `@lakutata/core` at version 1. A project that depends on the package `lakutata` at
version 2 follows [UpgradingFrom2](UpgradingFrom2.md), not this page. The 1.x packages covered are those published on
npm (`@lakutata/core` 1.0.60, `@lakutata-module/service` 1.2.7, `@lakutata-module/api` 1.0.29,
`@lakutata-component/typeorm` 1.1.19, `@lakutata-component/cacher` 1.0.15, `@lakutata/cli` 1.0.37); builds of these
packages obtained elsewhere may have APIs that this page does not cover.

## 1. Telling 1.x apart

| Sign | 1.x | 3.x |
|---|---|---|
| Dependencies | `@lakutata/core` `^1…`, `@lakutata-module/service`, `@lakutata-component/*` | `lakutata` `^3…` |
| `src/App.ts` | `createApp(Config(true)).then(…)` | `Application.run(config)` |
| Modules | CommonJS: imports without extensions, `__dirname` | ES modules: relative imports ending in `.js` |
| Service actions | `@Controller({_ctrl: …})` and `@PATTERN({_act: …})` from `@lakutata-module/service` | `@ServiceAction({…})` from `lakutata/decorator/ctrl` |
| Validation | `Validator` schemas (yup) given to `@Accept` | DTO classes with `@Expect` |
| Node.js | `>=14.15.1` (`@lakutata/core` 1.0.60) | `^22.13.0 \|\| >=24.11.0` |

**`@lakutata/core` 3 is not a new version of the 1.x library.** It is the core of Lakutata 3, a different API under the
same name. `npm install @lakutata/core@latest`, or a range such as `*`, in a 1.x project puts it in place of the 1.x
core and breaks the build. Never upgrade the 1.x packages one by one: the ported application depends on `lakutata` 3,
which brings its own `@lakutata/core`.

## 2. The way to port

1. **Create a 3.x project** next to the 1.x one, from the template of its kind: `service` for a service or a gateway
   (an HTTP API, a health check, a `Dockerfile`), `cli` for a command line tool
   ([GettingStarted](GettingStarted.md)):

   ```bash
   npx @lakutata/cli create --name orders --template service
   ```

2. **Port it area by area**, building and testing after each: the database and its entities (section 8), the inputs as
   DTOs (section 7), the components (section 3), the service actions and their callers (section 5), the HTTP API
   (section 6), the configuration (section 9), the tests (section 10).
3. **Keep the contracts of the clients**: the patterns of the service actions and their keys, the `errno` codes, the
   HTTP routes and the shape of their responses, the names of the events. Then the callers, the user interfaces and the
   devices do not change with the port.
4. **Plan the order of the services.** The service module of 1.x and the service transports of 3.x do not talk to each
   other: a 3.x service cannot answer the `invoke()` of a 1.x service, nor call one. Move the services that call each
   other together, or keep a 1.x service as a bridge until its callers are ported.

Editing the 1.x project in place does not work: the module system, the container, the validation and the transports
all change at once.

## 3. The application and its objects

See [Application](Application.md), [Objects](Objects.md) and [Injection](Injection.md).

| 1.x | 3.x |
|---|---|
| `createApp(Config(isProd))`, a promise of the application | `Application.run(config).onLaunched(…)` |
| The options `id`, `name`, `timezone`, `components: {name: {class, …}}` | The same options |
| `modules: {name: {class, …}}` | `components`: a long-lived object is a `Component` |
| `plugins: [{class, scope, …}]`, reached as `app.<ClassName>` | `providers` (`@Singleton()` for a shared client) or `components`, injected by name |
| `processes`, `threads`, `workflows`, `onModulesLoaded`, `onComponentsLoaded` | None: `bootstrap` steps, and `child_process` or `worker_threads` of Node.js in a component |
| `initialize()` | `init()`; 3.x adds `destroy()`, run at the teardown |
| `app.on('ready', …)` in a component | The `launched()` hook of the component, or `onLaunched` of the application |
| `@Inject('name')`, `@Inject(Application)` | The same, from `lakutata/decorator/di` |
| `app.Components.get<T>('name')`, `app.Modules.service`, and the `declare module` that types them | `@Inject('name')` on a typed property; `await app.getObject<T>('name')` outside the objects; no augmentation |
| `@Configurable()` | `@Configurable(schema)`: the schema validates the option at launch (without one, any value is accepted) |
| The global `getApp()` | `@Inject(Application)` |
| `new SomeComponent()` in a test | Never: `await new Container().set(SomeComponent, options)` |
| `app.Logger.info`, `.warning`, `.error`, `.debug`… (winston) | `@Inject('log')` an `ILogger`: `info`, `warn`, `error`, `debug`, `trace` (`emerg`, `alert`, `crit` become `error`, `notice` becomes `info`) |
| `app.Security.MD5()`, `SHA1()`, `SHA256()` | `md5()`, `sha1()`, `sha256()` from `lakutata/utils`, which return a `Buffer` (`.toString('hex')`); with a key, `hmac()` from `lakutata/security` |
| `app.Security.generateRandomString()` | `randomString()` from `lakutata/utils` |
| `app.Security.encryptByPassword()`, `encryptByKey()` and their `decrypt…` | The same functions, from `lakutata/security` ([Security](Security.md)) |
| `app.Security.generatePasswordHash()`, `validatePassword()` | The `PasswordHash` provider, from `lakutata/provider/passwordHash` |
| `app.Formatter.asTimestamp()`, `asDateText()` | `Time`, from `lakutata` ([Time](Time.md)) |
| `app.JSON`, `app.MessagePack`, `app.HttpRequest`, `app.Shell` | `JSON`, `MessagePack` from `lakutata/utils`, `fetch()`, `child_process` of Node.js |
| `delay()` | `delay()` from `lakutata/utils` |
| `app.emit()`, `app.on()` as an event bus | A component is an event emitter: inject it and use its `emit()` and `on()` |
| `throw this.generateException(OrderNotFoundException, 'Order', 'not found')` | `throw new OrderNotFoundException('Order {id} not found', {id})`; the exceptions have no `district` |

A 1.x component:

```text
//1.x
export class OrderComponent extends Component {
    @Inject(Application) protected readonly app: Application
    @Inject('db') protected readonly db: TypeOrmComponent
    @Configurable() protected readonly keepDays: number = 30

    protected async initialize(): Promise<void> {
        this.app.on('ready', () => this.startCleanup())
    }
}
```

The same component in 3.x:

```typescript
import {Component, DTO, Exception, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'
import type {Database} from 'lakutata/com/database'

export class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'

    public readonly statusCode: number = 404
}

export class Orders extends Component {
    @Inject('db')
    protected readonly db: Database

    @Inject('log')
    protected readonly log: ILogger

    @Configurable(DTO.Number().integer().min(1))
    protected readonly keepDays: number = 30

    protected timer: NodeJS.Timeout

    //Once the application has launched (1.x: app.on('ready'))
    protected async launched(): Promise<void> {
        this.timer = setInterval((): void => this.log.info('Keeping %d days of orders', this.keepDays), 3600000)
    }

    protected async destroy(): Promise<void> {
        clearInterval(this.timer)
    }

    public async get(id: string): Promise<Record<string, unknown>> {
        const rows: Record<string, unknown>[] = await this.db.query('SELECT * FROM orders WHERE id = ?', [id])
        if (!rows.length) throw new OrderNotFoundException('Order {id} not found', {id: id})
        return rows[0]
    }
}
```

- The `errno` of the exceptions stays, so the clients that test it keep working. 3.x adds `statusCode`, the HTTP status
  of the error, and builds the message from a template ([Exceptions](Exceptions.md)).
- One class may still be declared several times under different names with different options (several caches, two
  HTTP servers): each declaration is its own instance, injected by its name.

## 4. The packages

| 1.x | 3.x |
|---|---|
| `@lakutata/core` 1.x | `lakutata`: `lakutata`, `lakutata/decorator/di`, `lakutata/decorator/dto`, `lakutata/utils` |
| `@lakutata-module/service` | `lakutata/com/entrypoint` (`@ServiceAction` and the service transports), `@lakutata/nats` (section 5) |
| `@lakutata-module/api` | `lakutata/adapter/express` or `lakutata/adapter/fastify`, with `@GET`, `@POST`… (section 6) |
| `@lakutata-component/typeorm` | `lakutata/com/database`, `lakutata/orm`, `lakutata/decorator/orm` (section 8) |
| `@lakutata-component/cacher` | `lakutata/com/cacher` (section 8) |
| `@lakutata/cli` 1.0 (`lakutata`, `lakutata-deploy`) | `@lakutata/cli` 3: `lakutata create`, `run`, `migration`, `package`… ([Command](Command.md)); no deploy command |
| The other `@lakutata-component/*` packages | No counterpart: keep what they did in the application, or use another library |

Import only from these subpaths: 3.x does not support imports from the files inside a package (1.x projects sometimes
imported from `/distro/…`, `/src/…` or `/build/…` of a package).

## 5. Service calls

In 1.x, each application had a `service` module: it registered its controllers with a registry application (backed by
Redis), and called the actions of the others with `invoke({serviceId, data, timeout})`; its channels carried events
between the services. In 3.x there is no registry application: the `entrypoint` component serves the service actions
over a transport, and a proxy calls them ([ServiceCalls](ServiceCalls.md)):

- **NATS** ([NATS](NATS.md)) is the closest to the 1.x model: the services share one NATS server, address each other
  by their application id (as the `serviceId` of 1.x), balance the calls between the instances of a service, and
  publish events. Its `ServiceProxy` calls another service; the NATS server replaces the registry application.
- **The HTTP service** with `HTTPServiceProxy`, or **gRPC** ([GRPC](GRPC.md)), call a service at a known address.

A 1.x controller of the service module:

```text
//1.x
@Controller({_ctrl: 'order'})
export class OrderController extends BaseController {
    @Inject('order') protected readonly order: OrderComponent

    @PATTERN({_act: 'get'})
    @Accept(TGetOrderOptionsSchema)
    public async get(inp: TPattern & TGetOrderOptions): Promise<IOrder> {
        return await this.order.get(inp.id)
    }
}
```

The same actions in 3.x, served over NATS, and a proxy that calls another service:

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {Prefix, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {buildNatsClientOptions, buildServiceProxy, natsServiceEntrypoint} from '@lakutata/nats'

class GetOrderDTO extends DTO {
    @Expect(DTO.String().required())
    public id: string
}

//The keys of the patterns are free: the callers keep sending {_ctrl: 'order', _act: 'get', id}
@Prefix({pattern: {_ctrl: 'order'}})
class OrderController extends Controller {
    @ServiceAction({_act: 'get'}, GetOrderDTO)
    public async get(input: GetOrderDTO): Promise<{ id: string }> {
        return {id: input.id}
    }
}

Application.run(() => ({
    //The id the other services call: the serviceId of 1.x
    id: 'orders.app',
    name: 'orders',
    components: {
        nats: buildNatsClientOptions({servers: process.env.NATS_URL ?? 'nats://127.0.0.1:4222'}),
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            service: natsServiceEntrypoint('nats')
        })
    },
    providers: {
        //Another service: await this.users.invoke({_ctrl: 'user', _act: 'get', id}, 30000)
        users: buildServiceProxy({natsComponentName: 'nats', serviceId: 'users.app'})
    },
    bootstrap: ['nats', 'entrypoint']
}))
```

- **The patterns.** `@Prefix({pattern})` plus `@ServiceAction` replace `@Controller` plus `@PATTERN`, with the same
  keys, so the messages of the callers do not change (`_action` instead of `_act` works the same way). Extra keys of a
  pattern still select another action: `{_act: 'query', batch: true}` and `{_act: 'query', batch: false}` are two
  actions. A key that the prefix and an action give different values is an error in 3.x (in 1.x, the controller's
  value won).
- **The input.** The action receives the message without the keys of its pattern: a method that read `inp.batch` or
  `inp._act` reads them from `this.context.input`, the whole message. Fields that a gateway added to every message (the
  id of the user, of the organization) stay ordinary fields of the DTOs, or move to a middleware
  ([Middlewares](Middlewares.md)).
- **Calls.** `this.app.Modules.service.invoke({serviceId, data, timeout})` becomes `this.users.invoke(message, timeout)`
  on an injected proxy. A failed action throws a `ServiceInvokeException` that carries the `errno` and the other
  properties of the remote error. The `transform` option and the chains of several invoke objects have no counterpart:
  write them as code; `service.parallel(…)` becomes `Promise.all()` of the calls. A 1.x call waited 60 seconds by
  default, a 3.x proxy 10 minutes: give the calls their timeout.
- **Events.** A channel's `triggerAll(event, …args)` becomes `nats.emitServiceEvent(event, …args)` of the NATS
  component, received by `proxy.on(event, listener)` or `nats.onServiceEvent(serviceId, event, listener)` in every
  instance. For `triggerOne`, where one instance of each service receives the event, publish on a subject of your own
  (`nats.publish(subject, payload)`) and subscribe with the id of the service as the queue group
  (`nats.subscribe(subject, handler, {queue: app.appId})`): the instances of a service share the group.
- **Work shared by the instances.** A job that one instance of a service must take, such as the processing of a
  stream of data, fits a message queue ([Queue](Queue.md)): the instances of a group share its messages, with retries.
- **A clock service.** An application that published timer ticks to the others is replaced by `@Schedule` in each
  service, with `exclusive` for the jobs that must run in one instance only ([Schedules](Schedules.md)).

## 6. The HTTP API

The `api` module of 1.x becomes the HTTP adapter of the entrypoint, `expressHTTPEntrypoint()` or
`fastifyHTTPEntrypoint()` ([HTTP](HTTP.md)). A route is a controller method with `@GET`, `@POST`…; its input is one
object, the query and the body with the route parameters over them, validated by its DTO. The parameter decorators of
1.x (the body, the query, a header, the request and the response) are replaced by the DTO and by `this.context`, an
`HTTPContext` with `request` and `response`.

The clients keep working when the responses keep their shape. A responder of your own writes them as the 1.x
clients expect, for example `{code, payload}` with `code` 0 for a result:

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller, HTTPContext} from 'lakutata/com/entrypoint'
import {POST} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {describeError, expressHTTPEntrypoint, statusOfError, type ExpressResponder} from 'lakutata/adapter/express'
import type {Request, Response} from 'express'

//The responses as the clients of 1.x read them: {code: 0, payload} for a result, a code that is not 0 for an error
const legacyEnvelope: ExpressResponder = {
    success(response: Response, data: unknown): void {
        response.status(200).json({code: 0, payload: data ?? null})
    },
    error(response: Response, error: unknown): void {
        response.status(statusOfError(error)).json({code: 1, payload: describeError(error)})
    }
}

class QueryDTO extends DTO {
    @Expect(DTO.String().required())
    public method: string
}

class RpcController extends Controller {
    //POST /rpc?method=order.get with a JSON body
    @POST('/rpc', QueryDTO)
    public async call(input: QueryDTO): Promise<{ method: string, token?: string }> {
        //A header, read from the request of the context
        const request: Request = (this.context as HTTPContext).request as Request
        return {method: input.method, token: request.header('x-token')}
    }
}

Application.run(() => ({
    id: 'gateway.app',
    name: 'gateway',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [RpcController],
            http: expressHTTPEntrypoint({port: 8080, respond: legacyEnvelope})
        })
    },
    bootstrap: ['entrypoint']
}))
```

- `statusOfError()` and `describeError()` give the status and the `{errno, errMsg}` that the adapter would send; the
  responder chooses the shape. The `api` module of 1.x answered `{statusCode, code, error, payload, timestamp, server}`
  (or what its `responseFormatter` made of it): write the fields that the clients read. `jsonEnvelope()` gives the
  envelope of 3.x, `{errno, errMsg, data}`, instead.
- The `api` module allowed any origin (CORS) and signed its responses (the `x-signature` headers). The 3.x adapters
  send no CORS headers unless a middleware adds them ([HTTP](HTTP.md), section 7); a client that checks the signatures
  needs a middleware that adds them.
- A server that a 1.x component started itself (an HTTP server for Socket.IO, another web framework) can stay in a
  component, started in `startup()` and closed in `destroy()`. A `socketIOServiceEntrypoint()` can also share the
  server of the HTTP adapter and serve the service actions over Socket.IO ([ServiceCalls](ServiceCalls.md), section 4).

## 7. Validation

The `Validator` of 1.x builds yup schemas; 3.x validates with DTO classes, whose schemas have the API of joi
([DTOValidation](DTOValidation.md)). A 1.x pair of a schema and a type becomes one DTO class:

| 1.x (`Validator`, yup) | 3.x (`DTO`) |
|---|---|
| `Validator.Object({…})` and a type `T…Options` | A class extending `DTO`, one `@Expect` per property |
| `Validator.String`, `.Number`, `.Boolean`, `.Date`, `.Array(of)`, `.Any` | `DTO.String()`, `DTO.Number()`, `DTO.Boolean()`, `DTO.Date()`, `DTO.Array(of)`, `DTO.Any()` |
| `Validator.Integer`, `Validator.Email` | `DTO.Number().integer()`, `DTO.String().email()` |
| `.required()` | `.required()` |
| `.notRequired()`, `.optional()` | `.optional()` |
| `.nullable()` | `.allow(null)` |
| `.oneOf([…])` | `.valid(…)` |
| `.matches(regex)` | `.pattern(regex)` |
| `.test(fn)` | `.custom(fn)` |
| `.when(…)` | `.when(…)` (the options of joi) |
| `schema.concat(other)` | A DTO that extends another, or `.concat()` |
| `@Accept(schema, {stripUnknown})` on a method | `@Accept(DTO)` on a method, or the DTO of an action |

- **Conversion.** The `@Accept` of 1.x converted the values by default (yup's `strict: false`): `'5'` became 5 on every
  validated method. The 3.x schemas are strict: a value of the wrong type is refused, not converted. An input that
  relied on the conversion (numbers, booleans or dates arriving as text, from a query string, a route parameter or any
  other source) declares it with `.strict(false)` on its schema.
- The unknown keys are removed by default; a DTO that keeps them extends `FlexibleDTO` (`lakutata/dtos`).
- An invalid input fails with an `InvalidValueException` (`E_INVALID_VALUE`, HTTP status 400).

## 8. Databases and caches

**The database.** The `TypeOrmComponent` of 1.x becomes the `Database` component, declared with
`buildDatabaseOptions()` ([Database](Database.md), [Entities](Entities.md)). The ORM is TypeORM 1.1 (1.x used 0.3):

| 1.x | 3.x |
|---|---|
| `db: {class: TypeOrmComponent, options: {type: 'mysql', …, entities: [glob]}}` | `db: buildDatabaseOptions({type: 'mysql', …, entities: [Order, …]})` |
| `this.db.getRepository(Order)`, `this.db.manager`, `this.db.transaction(…)`, `this.db.query(sql)` | The same methods of `Database` |
| The decorators, operators and types imported from `@lakutata-component/typeorm` or `typeorm` | `lakutata/decorator/orm` (decorators) and `lakutata/orm` (operators such as `In`, `Like`, and the types); no `typeorm` package |
| `relations: ['customer']`, `select: ['id']` | `relations: {customer: true}`, `select: {id: true}` |
| `ConnectionOptions` | `MysqlDataSourceOptions`… (the `ConnectionOptions` names are deprecated aliases) |
| `this.db.queryData(options, Entity)` and its query language | No counterpart: keep the query language as a component of the application, on top of the find options of TypeORM, and `paginator` (`lakutata/dtos`) for the pages |

- **`synchronize: true` in production** changed the tables at every start. Turn it off and use migrations
  ([Migrations](Migrations.md)): generate a first migration against a copy of the production database (it should be
  empty when the entities match the tables), then let `migrationsRun` apply the next ones at startup.
- **Globs with `__dirname`** do not exist in ES modules: list the entity classes, and build the migration paths with
  `import.meta.dirname`.

**The caches.** The `CacherComponent` of 1.x becomes the `Cacher` component, declared with `buildCacherOptions()`
([Cache](Cache.md)). `get(key)`, `set(key, value, ttl)` and `del(key)` keep their names (the time to live, given only
by the options in 1.x, may be given to each `set`), and `wrap(key, fn)` reads through the cache. A missing key gives
`undefined`, where 1.x gave `null` (on a failing store too), and `null` and `false` can be cached as values. The keys
are built differently, so the entries that 1.x wrote are not found: start with an empty cache.

## 9. Configuration, mode and entries

- **One configuration.** 1.x chose production or development by the entry file (`App.ts` called `Config(true)`, the
  development entry `Config(false)`). In 3.x, `config()` is one function, and the mode comes from the environment:
  `MODE`, else `NODE_ENV`, else the `mode` option; `app.mode()` gives it ([Application](Application.md)).
- **The values** come from the environment variables, read in `config()` or given as defaults to the `@Configurable`
  properties. A declaration that is invalid stops the launch with an `InvalidObjectOptionsException` listing every
  invalid option, so a missing variable fails at once rather than at the first use.
- **Functions in the options** that received the application to reach other components become injections: the
  component injects what it needs.
- **Credentials** in the code of the configuration move to environment variables or secrets of the deployment.

## 10. Tests, build and deployment

- **Tests.** A 1.x `npm test` that booted the application against shared development servers becomes `node --test` on
  the compiled tests: each test file starts the application with `Application.run(config(port))` on a port of its
  own, calls it, and disposes of it; a component is tested alone in a `Container`; another service is replaced by a
  stand-in ([examples](examples/README.md)).
- **The `lakutata` field of `package.json`** told the 1.x tool the kind of the project (`type`), its directories and
  its configuration file. In 3.x the field has another meaning (the `resources` and the `installer` of a packed
  application, [Packaging](Packaging.md)): remove the 1.x one.
- **Node.js, TypeScript and modules.** Node.js `^22.13.0 || >=24.11.0`, TypeScript 6 as in the templates, ES modules
  (`"type": "module"`, relative imports ending in `.js`), `tsconfig.json` extending `lakutata/tsconfig.json`.
- **Ports.** The service module listened on a port of its own (6912 by default) and the registry on another (6911).
  The 3.x adapters listen on the ports of their options, and a service on NATS only connects out to the NATS server:
  the `Dockerfile` exposes those ports instead.
- **Scripts.** The template's scripts replace `shx rm -rf ./build` (`lakutata clean`), `prepare` compiling on install,
  and the development entry; `lakutata-deploy` has no counterpart: the `service` template has a `Dockerfile` and a
  `docker:build` script, and the image is pushed by the deployment's own tools.

## 11. User interfaces

The web interfaces of a 1.x system, built apart and calling a gateway over HTTP, do not use Lakutata and do not change,
as long as the gateway keeps its routes and the shape of its responses (section 6), the patterns that they name, and
the `errno` codes that they test. Their WebSocket clients keep working when the server keeps its path and its events.

## 12. Checking the port

```bash
npm ls @lakutata/core            # one version: the 3.x one that lakutata brings, no 1.x left
npm run build                    # no import from @lakutata-module/*, @lakutata-component/* or @lakutata/core 1.x
grep -rnE "createApp|generateException|initialize\(|app\.(Components|Modules|Logger)|Validator\.|__dirname" src
npm test
MODE=production npm start        # the launch log, then Ctrl+C: the application stops gracefully
```

- The `grep` lists the 1.x code left. Check each line it finds.
- The callers and the interfaces get the same answers as from the 1.x service: the same patterns, `errno` codes and
  shapes of response.
- The database: `lakutata migration generate` against a copy of production generates no change.

## 13. Common mistakes

- Upgrading `@lakutata/core` in the 1.x project: version 3 is another library (section 1).
- Reading the keys of the pattern from the input of an action: they are removed from it (section 5).
- Inputs that relied on the conversion of 1.x (`'5'` for 5): the 3.x schemas refuse them without `.strict(false)`
  (section 7).
- Testing `=== null` for a missing cache entry: a miss is `undefined` (section 8).
- `app.Logger.warning(…)`: the method is `warn`.
- Leaving `synchronize: true` on for production after the port: changes of entities then alter the tables at startup.
- Mixing the two frameworks in one process, or a 1.x service calling a 3.x one: their service transports do not
  understand each other (section 2).
