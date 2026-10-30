# Upgrading from Lakutata 2.x

This page brings a project from Lakutata 2.x (the last release is 2.0.126) to 3.x: how to tell the versions apart, the
steps, the renamed and moved APIs, the behavior that changes without a compile error, and how to check the result.

It is for the projects that depend on the package `lakutata` at version 2. A project on Lakutata 1.x depends instead on
`@lakutata/core` at version 1 and on `@lakutata-component/*` or `@lakutata-module/*` packages: it follows
[UpgradingFrom1](UpgradingFrom1.md), not this page.

## 1. Telling 2.x from 3.x

| Sign | 2.x | 3.x |
|---|---|---|
| `lakutata` in `package.json` | `^2.…` | `^3.…` |
| `node_modules/lakutata/package.json` | No `dependencies` (everything bundled) | Depends on `@lakutata/core`, `@lakutata/entrypoint`… at its own version |
| Helpers | `import {Delay} from 'lakutata/helper'` | `import {delay} from 'lakutata/utils'` |
| Exported functions | PascalCase: `BuildEntrypoints`, `BuildDatabaseOptions`, `MD5` | camelCase: `buildEntrypoints`, `buildDatabaseOptions`, `md5` |
| Transports | Written by hand: `BuildHTTPEntrypoint((module, routeMap, handler, registerDestroy) => …)` | Adapters: `expressHTTPEntrypoint()` from `lakutata/adapter/express`… |
| Subpaths of 3.x only | | `lakutata/utils`, `lakutata/security`, `lakutata/adapter/*`, `lakutata/com/{containerd,mutex,queue,i18n}` |
| Node.js | `>=20` | `>=18.10.0` |

`npx @lakutata/cli info` prints the versions of the tool, of the framework and of Node.js, and the `lakutata` version
that the project declares and the one installed. There is no upgrade command: the steps below are done by hand.

## 2. The steps

- **Node.js** `>=18.10.0` (3.0 to 3.1 needed `^22.13.0 || >=24.11.0`). The versions 2.x needs (`>=20`) are among them:
  `engines`, the CI matrix and the Dockerfiles can stay.
- **A TypeScript that knows `"module": "Node20"`** (the templates use TypeScript 6): `lakutata/tsconfig.json` now sets
  it (2.x: `Node16`), and older compilers reject it.
- **`package.json`**: `"type": "module"`, `lakutata` `^3.0.0`, the `@lakutata/*` packages at `^3.0.0` too, and
  `@lakutata/cli` in `devDependencies`. Do not give the other packages the version of `lakutata`: a patch release
  publishes only the packages it changes, so their latest versions can differ (`lakutata` 3.1.4 with
  `@lakutata/ffi` 3.1.2).
- **A clean install**: remove `node_modules` and the lock file, then install. Upgrading in place can leave several
  copies of `@lakutata/core`, whose classes and decorator metadata do not match (`instanceof` and injection fail across
  them). `npm ls @lakutata/core` must print one version.
- **`tsconfig.json`** extends `lakutata/tsconfig.json` and sets its own `rootDir`, `outDir` and `include`. Keep
  `include`: the published options set `allowJs`, so without it a configuration file at the root of the project
  (`eslint.config.js`) is compiled too. A project that keeps its own options needs `experimentalDecorators`,
  `emitDecoratorMetadata` and `useDefineForClassFields: false`.

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

- **Relative imports** end in `.js` (`import {config} from './config/Config.js'`), as in the ES module projects of 2.x.
- **The libraries of the features used** are optional peer dependencies of `lakutata`, which the project installs (a
  2.x project already has those that its own transports import); see [GettingStarted](GettingStarted.md), section 3:

| Used | Install |
|---|---|
| `lakutata/adapter/express` | `express` (4.21+ or 5), `@types/express` |
| `lakutata/adapter/fastify` | `fastify` 5 |
| `lakutata/adapter/commander` | `commander` (12 to 15); `@inquirer/prompts` (7 or 8) for the prompts |
| `lakutata/adapter/socket.io` | `socket.io` 4 |
| `lakutata/adapter/jsonrpc` over WebSocket | `ws` 8 |
| A database `type` | `pg`, `mysql2` (3.15.3+), `better-sqlite3` 12 (instead of `sqlite3`), `mongodb` 7, `mssql` 12, `oracledb`, `sql.js`… |
| A cache store | `redis` (4 or 5) or `@redis/client`, `memjs`, `mongodb`, `mysql2`, `pg`, `better-sqlite3` (the SQLite store used `sqlite3` in 2.x) |
| NATS, D-Bus | `@lakutata/nats`, `@lakutata/dbus`, at the version of `lakutata` |

- **Rename** with the tables of section 3, then build: none of the renamed functions has an alias, so the compiler
  reports every import left. Then go through section 4, which the compiler does not report.

## 3. Renamed and moved

| 2.x | 3.x |
|---|---|
| `lakutata/helper` | `lakutata/utils` (the same helpers, renamed below, plus `Time`, `cloneDeep`, `isSubclassOf`) |
| `Paginator`, `PaginatorHandlerResult` from `lakutata/helper` | `paginator`, `PaginatorHandlerResult` from `lakutata/dtos` |
| `IPatRun` from `lakutata` | Removed: the pattern matching is internal |

The other subpaths of 2.x keep their names: `lakutata`, `lakutata/orm`, `lakutata/dtos`,
`lakutata/com/{entrypoint,database,cacher,docker,monitor,logger}`, `lakutata/provider/{database,passwordHash}`,
`lakutata/decorator/{di,dto,ctrl,asst,orm}` and `lakutata/tsconfig.json`.

Every exported function is in camelCase, and the 2.x names have no alias. Most of them only lower their first letter
(`ArrayToSet` becomes `arrayToSet`):

- `lakutata/utils`: `arrayToSet`, `convertArrayLikeToIterable`, `convertArrayLikeToStream`, `delay`,
  `getObjectNestingDepth`, `getObjectPropertyPaths`, `hexToIEEE754`, `hexToSigned`, `hexToUnsigned`, `isAbortError`,
  `isEmptyObject`, `isGlobString`, `isNativeFunction`, `isPath`, `isPromise`, `isPromiseLike`, `isSymbol`, `isXML`,
  `mergeArray`, `mergeMap`, `mergeSet`, `noCase`, `objectConstructor`, `objectHash`, `objectParentConstructor`,
  `objectParentConstructors`, `objectPrototype`, `objectToMap`, `randomString`, `setToArray`, `signedToHex`,
  `sortArray`, `sortKeys`, `sortObject`, `templating`, `uniqueArray`, `unsignedToHex`;
- `lakutata/com/entrypoint`: `buildEntrypoints`, `buildHTTPEntrypoint`, `buildCLIEntrypoint`, `buildServiceEntrypoint`;
- `lakutata/com/cacher`: `buildCacherOptions`; `lakutata/com/database` and `lakutata/provider/database`:
  `buildDatabaseOptions`;
- `lakutata/com/docker`: `buildDockerConnectionOptions`, `buildDockerSocketConnectionOptions`,
  `buildDockerHttpConnectionOptions`, `buildDockerHttpsConnectionOptions`, `buildDockerSSHConnectionOptions`,
  `parseEnvToRecord`, `parseRepositoryTag`.

`As`, `DevNull` and `Glob` (with the new `GlobSync`) stay in PascalCase, as do the classes (`Time`, `URLBuilder`,
`UUID`, `ObjectPath`, `MessagePack`, `Statistics`, `IP`, `IPv4`, `IPv6`) and the decorators. The other renames:

| 2.x | 3.x |
|---|---|
| `GraceExit` | `gracefulExit` |
| `IsExists` | `pathExists` |
| `IsHtml` | `isHTML` |
| `NonceStr` | `nonceString` |
| `MD5`, `SHA1`, `SHA256` | `md5`, `sha1`, `sha256` |
| `IEEE754ToHex` | `ieee754ToHex` |
| `Split`, `ToLower`, `ToUpper` | Removed: `noCase(input).split(' ')` gives the words in lower case (`['']` for an input without words) |
| Type `SortOptions` | `SortArrayOptions` |
| Types `IPv4SubNet`, `IPv6SubNet` | `IPv4Subnet`, `IPv6Subnet` |
| Field `comperssed` of `IPv6Result` | `compressed` |
| `AccessDenyException` | `AccessDeniedException`: its `errno` is still `E_ACCESS_DENY`, its `err` (the class name) changes |
| Type `OnDelEventData` (`lakutata/com/cacher`) | `OnDeleteEventData`; the event is still `'del'` |
| `@Lifetime('APPLICATION_SINGLETON')`, `'MODULE_SINGLETON'` | `@Singleton()`: the lifetimes are `SINGLETON`, `SCOPED` and `TRANSIENT` |
| Static `databaseSymbol` of `Database` | Removed |

The ORM moves from TypeORM 0.3.24 to TypeORM 1.1.2, whose source is part of `@lakutata/orm` (there is no `typeorm`
package):

| 2.x | 3.x |
|---|---|
| `type: 'sqlite'` (driver `sqlite3`) | `type: 'better-sqlite3'` (driver `better-sqlite3`) |
| `PostgresConnectionOptions`, `MysqlConnectionOptions`… | `PostgresDataSourceOptions`, `MysqlDataSourceOptions`… (the old names are deprecated aliases) |
| `SqliteConnectionOptions` | `BetterSqlite3DataSourceOptions` |
| `AbstractRepository` | Removed: a `Repository`, or `repository.extend({...})` |
| `relations: ['author']`, `select: ['id']` | `relations: {author: true}`, `select: {id: true}` |
| `import {In} from 'typeorm'` | `import {In} from 'lakutata/orm'`: a `typeorm` package would be another copy |

The packages published apart from `lakutata` in 2.x are renamed the same way:

| 2.x | 3.x |
|---|---|
| `SetupNatsServiceEntrypoint` (`@lakutata/nats`) | `natsServiceEntrypoint` |
| `BuildServiceProxy`, `JSONCodec`, `MessagePackCodec` | `buildServiceProxy`, `jsonCodec`, `messagePackCodec` |
| `CreateDBusError` (`@lakutata/dbus`) | `createDBusError` |
| D-Bus client events `online`, `offline`, `replaced`, `NameOwnerChanged`, `NameAcquired`, `NameLost` | `serviceOnline`, `serviceOffline`, `serviceReplaced`, `nameOwnerChanged`, `nameAcquired`, `nameLost` (a listener of an old name is never called) |
| D-Bus client options `advancedResponse`, `convertBigIntToNumber` | `decode`: `{types: 'all'}` keeps the D-Bus types, `{int64: 'bigint'}` the bigints |

## 4. Behavior that changes without a compile error

### The application and its objects

See [Application](Application.md) and [Objects](Objects.md).

- **The mode** (`app.mode()`) is the `MODE` environment variable, else `NODE_ENV`, else the `mode` option, else
  `development`, written back to both variables. 2.x took the option (`development` by default) and overwrote
  `NODE_ENV` with it: a deployment that sets `NODE_ENV=production` now runs in production, whatever the option says.
- **SIGTERM and SIGINT** end the application gracefully (`onDone` runs, the entrypoints stop, the objects are destroyed,
  the exit code is 0); 2.x left them to Node.js. Remove the application's own `process.on('SIGTERM', …)`, or set
  `shutdownSignals: false`. The `onDone` handlers receive a third argument, `{code, signal?}`.
- **A process with nothing left to do** (no server, connection or timer) ends the application gracefully: the `onDone`
  handlers and the `destroy()` hooks run then too. In 2.x the process just ended.
- **A failed launch** exits with code 1 when there is no `onFatalException` handler. 2.x logged the error, and the
  process kept running or ended with code 0.
- **The options are checked at launch** (`checkOptions`, on by default): an invalid value of a `@Configurable` property
  fails the launch with an `InvalidObjectOptionsException` (`E_INVALID_OBJECT_OPTIONS`) that lists every invalid
  option, even for an object never created; an option that is not a `@Configurable` property produces a warning. `''`
  fails a required string: write `process.env.X || undefined`, not `|| ''`. A class that accepts other options declares
  a static `acceptsOption(name, value)`.
- **The initializer of a `@Configurable` property is its default** (`protected readonly port: number = 8080`), and it
  is validated like a configured value. 2.x replaced it with the default of the schema, or `undefined`.
- **New lifecycle hooks**: `startup()` (after `init()`, before the object is handed out), `launched()` (once the
  application has launched), `beforeDestroy()` (when the teardown starts), and the static `acceptsOption()`. A 2.x class
  with a member of one of these names is now called by the framework: rename the member.
- **A `Component` is locked to the singleton lifetime**: `@Transient()` or `@Scoped()` on a subclass throws a
  `LifetimeLockedException` when the class is defined (2.x accepted it). Make it a `Provider`, which is scoped by
  default and may be `@Singleton()` or `@Transient()`.
- **A built-in component declared with `class`** (`components: {log: {class: MyLogger}}`) replaces the preset one; 2.x
  silently kept the preset. A declaration without `class` still configures the preset `log` or `entrypoint`.
- **A glob of objects** (`objects.anonymous`, `container.load()`) registers every exported `BaseObject` subclass of each
  file (2.x: only the first export), and a file that fails to import fails the launch (2.x skipped it).

### Errors and values

- **Statuses**: `AccessDeniedException` has the `statusCode` 403, `ControllerActionNotFoundException` 404 and
  `InvalidValueException` 400. All three had 500 in 2.x, so clients and tests that check for 500 change.
- **Messages**: an exception created without arguments takes the words of its class name (`Order not found exception`;
  2.x gave `Ordernotfoundexception`); a single parameter fills `{0}` (`new OrderException('Order {0}', 7)`); the `%`
  placeholders follow `util.format()` (`%s %d %i %f %j %o %O %c %%`), and a `%` before another character is kept.
- **DTOs are strict, as in 2.x**: the HTTP adapters give the query and the route parameters as strings, so a number or
  a boolean read from them needs `.strict(false)`. `PaginationSearchDTO` now converts its `limit` and `offset`.
- **`Time`**: a date without a time (`new Time('2024-03-01')`) is midnight in the default time zone (2.x: UTC).
- **`PasswordHash`**: `hash()` throws a `PasswordTooLongException` above 72 bytes of UTF-8, and `validate()` returns
  `false` for such a password. 2.x hashed its first 72 bytes, so those users can no longer log in. `saltRounds` is
  between 4 and 31.
- **`Glob`** takes only `cwd`, `absolute`, `dot`, `nodir`, `follow`, `ignore` and `nocase`, and returns a sorted
  `string[]` without duplicates: `withFileTypes` and the extended patterns (`+(a|b)`) are gone.

### The entrypoint

See [HTTP](HTTP.md), section 8, and [ServiceCalls](ServiceCalls.md).

- **The transport functions of 2.x still work** under `http`, `cli` and `service` (renamed `buildHTTPEntrypoint`…).
  They are called when the entrypoint starts and their promise is awaited: the launch waits for the server, a rejection
  (a port in use) fails it, and a function that awaits a long-running command (`await program.parseAsync()`) holds the
  launch until the command ends. Call it without `await`, or move to `commanderCLIEntrypoint()`.
- **Moving to an adapter**: the middlewares and routes of an Express server written by hand go into the `before` hook of
  `expressHTTPEntrypoint()`, its body limit into `body`, the input it built into `input`. The responses change: the HTTP
  adapters answer an error with its status and `{errno, errMsg}`, and `jsonEnvelope({actionErrorStatus: 200, extra})`
  gives the `{errno, errMsg, data}` envelope that 2.x applications often wrote themselves (example below). The service
  adapters (HTTP service, Socket.IO, JSON-RPC, Electron) answer `{success, error, payload}`.
- **Nested service patterns are compared key by key**: `@ServiceAction({res: {name: 'user'}, act: 'get'})` matches that
  nested value only. 2.x compared any object as `[object Object]`, so two actions that differed by a nested value
  replaced each other.
- **`Controller.context`** is `CLIContext | HTTPContext | ServiceContext | BaseContext`: a function whose parameter is
  the 2.x union no longer accepts `this.context`. Add `BaseContext`, or narrow it with `instanceof`.
- **Electron**: Lakutata 2.x had no Electron transport. 3.x serves the actions in the main process with
  `electronIPCServiceEntrypoint()` from `lakutata/adapter/electron`: the preload script calls
  `ipcRenderer.invoke('lakutata:service', message, clientId)`, answered with `{success, error, payload}`, and the events
  come from `entrypoint.notify(clientId, event, ...args)` and `entrypoint.broadcast(event, ...args)`, with the id in
  `this.context.clientId`. The Electron templates have a preload script and a `window.ipc` whose `invoke()` returns the
  payload or throws; code that reads the raw responses of an IPC layer of its own changes.

### The components

See [Database](Database.md), [DockerIntegration](DockerIntegration.md) and [Logger](Logger.md).

- **Database**: a `null` or `undefined` value in a where condition is still left out (`invalidWhereValuesBehavior`),
  so `findOneBy({id: undefined})` returns the first row: check the values taken from requests. With table or column
  names outside ASCII, TypeORM 1 names indices and constraints differently: `namingStrategy: new NamingStrategyV03()`
  (from `lakutata/orm`) keeps the names of TypeORM 0.3.
- **Docker**: `exec()` resolves `{exitCode, stdout, stderr}` (2.x: the output as a string); a string `cmd` of `exec()`
  and `createTTY()` runs through `/bin/sh -c`, and `createTTY()` runs `/bin/sh` by default (2.x: `bash`).
- **Logger**: colors only when the standard output is a terminal and `NO_COLOR` is not set (2.x: always); the
  `Authorization`, `Cookie`, `Set-Cookie` and `Proxy-Authorization` headers of a logged request are redacted
  (`redactedHeaders: []` keeps them); a `level` that is not a level fails the launch.

```typescript
import {Application, type ApplicationExitReason, type ApplicationOptions, type ILogger} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import {delay, md5} from 'lakutata/utils'

class HashController extends Controller {
    //2.x: Delay() and MD5() from 'lakutata/helper'
    @GET('/hash')
    public async hash(): Promise<{ hash: string }> {
        await delay(10)
        return {hash: md5('text').toString('hex')}
    }
}

Application
    .run((): ApplicationOptions => ({
        id: 'com.example.app',
        name: 'Example',
        //Used only when the environment sets neither MODE nor NODE_ENV
        mode: 'production',
        components: {
            entrypoint: buildEntrypoints({
                controllers: [HashController],
                http: expressHTTPEntrypoint({
                    port: 8080,
                    //The errors of the actions answered with 200 in {errno, errMsg, data, timestamp}
                    respond: jsonEnvelope({
                        actionErrorStatus: 200,
                        extra: (): Record<string, unknown> => ({timestamp: Date.now()})
                    })
                })
            })
        },
        bootstrap: ['entrypoint']
    }))
    .onDone((app: Application, log: ILogger, reason: ApplicationExitReason): void => {
        log.info('%s stopped with code %d', app.appName, reason.code)
    })
```

## 5. Tools that help

- `lakutata create --name probe --template <template> --path <a scratch directory>` makes a fresh 3.x project of the
  same kind, to compare its `package.json`, `tsconfig.json` and scripts, and for Electron its preload script. `--init`
  creates it in an existing directory, keeps the files already there and lists the ones it did not copy.
- `lakutata migration generate|create|run|revert|show` runs the migrations (the `MIGRATION_*` environment variables of
  2.x still work); `lakutata package bundle|exe|installer` packs the application. See [Command](Command.md).

## 6. Checking the upgrade

```bash
node --version                      # >=18.10.0
npm ls lakutata @lakutata/core      # one version of each
npm run build                       # tsc without errors: no 2.x import left
grep -rnE "process\.on\('SIG|\|\| ''|(startup|launched|beforeDestroy|acceptsOption)\(|AccessDenyException|=== 500" src
npm test
MODE=production npm start           # the launch log, then Ctrl+C: onDone runs, exit code 0
```

- The `grep` lists what compiles but behaves differently: signal handlers, empty strings given to options, members
  named like the new hooks, comparisons with the error name or the status of 2.x. Check each line it finds.
- The launch shows the expected mode, no `InvalidObjectOptionsException`, and no warning that ends with
  `is not a configurable property, it is ignored`.
- An invalid input is answered with 400 `E_INVALID_VALUE`, a denied access with 403 `E_ACCESS_DENY`, an unknown route
  with 404, in the envelope that the clients expect.
- A broken configuration makes the process exit with code 1.
- `lakutata migration generate` against a copy of the production database generates no change: a change there means a
  difference of naming or of entities (see `NamingStrategyV03` in section 4), not a migration to run.

## 7. Common mistakes

- A search-and-replace of a renamed function also changes string literals, log messages, object keys and longer names
  that contain it (`Delay` in `RequestDelay`): match whole words and read the diff. The new camelCase name can also
  collide with a local variable or a parameter (`delay`, `paginator`, `md5`).
- One process must load one copy of the framework. `lakutata` ships ES module and CommonJS builds as separate files: an
  ES module application that loads a CommonJS-only library requiring `lakutata` gets two copies, whose classes and
  metadata differ. Keep the libraries built for both module systems, or the whole process on one of them.
- `process.env.X || ''` for a required option fails the launch; `|| undefined` lets the default apply.
- A member named `startup`, `launched`, `beforeDestroy` or `acceptsOption` is now called by the framework.
- The `NODE_ENV` of the deployment, not the `mode` option, decides the mode.
- The SQLite files of 2.x open with `type: 'better-sqlite3'`. `better-sqlite3` is a native addon built for one version
  of Node.js: an Electron application needs the build made for its Electron.
- The hashes that 2.x made of passwords longer than 72 bytes no longer validate: plan a password reset for those users.
- Code that checks `statusCode === 500` for a denied access, or compares `err === 'AccessDenyException'`, no longer
  matches: compare the `errno`.
