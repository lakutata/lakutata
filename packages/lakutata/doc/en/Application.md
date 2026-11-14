# Lakutata Application

The **application** is the root object of a Lakutata program. `Application.run()` creates it in a new root container,
registers the objects it declares, runs its bootstrap steps, and stops it gracefully on a shutdown signal. This guide
describes its options, the fluent API, the lifecycle, the mode and packed applications. [Objects and
Lifetimes](Objects.md) describes the objects it creates, and [Dependency Injection](Injection.md) how they obtain one
another.

## 1. Options

`Application.run(options)` — or `run(() => options)`, a function called at launch that may be async — takes these
options:

| Option | Meaning |
|---|---|
| `id`, `name` | Required. The application's ID (also the `process.title`, except in NW.js) and name (`app.appId`, `app.appName`) |
| `timezone` | An IANA time zone, or `'auto'` (default) for the system time zone; written to `TZ` |
| `mode` | `'development'` or `'production'`, when the environment specifies none (see section 4) |
| `shutdownSignals` | The signals that stop the application gracefully (default `['SIGTERM', 'SIGINT']`), or `false` |
| `components`, `providers` | Components and providers by name: `{class, ...options}` |
| `objects` | Other objects: `{named: {...}, anonymous: [...]}` |
| `bootstrap` | Steps run in order at launch: a name or a class (the object is created), or a function declared `async` that receives the application |
| `checkOptions` | Check the declared objects' options at launch (default `true`) |

A declaration without `class` adds options to an object of the same name preset by the framework. The `lakutata`
package presets `log` (the `Logger`) and `entrypoint` (the `Entrypoint`), so `log: {level: 'debug'}` sets the preset
logger's level. `Application.preset(options)` presets objects for every application in the process.

## 2. The fluent API

```typescript
import {Application, type ApplicationExitReason, type ILogger} from 'lakutata'

Application
    //Environment variables, set at launch before the options function runs
    .env({TZ_NAME: 'Asia/Shanghai'})
    //Path aliases: '@data' in a path passed to path.resolve() or app.alias.resolve(); the directory is created when missing
    .alias({'@data': './data'}, true)
    .run(() => ({
        id: 'com.example.app',
        name: 'Example',
        components: {}
    }))
    //Called once the bootstrap has completed (not awaited)
    .onLaunched((app: Application, log: ILogger): void => log.info('%s launched in %s mode', app.appName, app.mode()))
    //Called and awaited when the application exits, before its objects are destroyed
    .onDone(async (app: Application, log: ILogger, reason: ApplicationExitReason): Promise<void> => {
        log.info('%s done (exit code %d%s)', app.appName, reason.code, reason.signal ? `, ${reason.signal}` : '')
    })
    //An uncaught exception in the process; the application keeps running
    .onUncaughtException((error: Error, log: ILogger): void => log.warn(error.message))
    //The launch failed: the returned number is the exit code (1 when none)
    .onFatalException((error: Error, log: ILogger): number => {
        log.error('Launch failed: %s', error.message)
        return 100
    })
```

The environment variables and aliases are set when the application launches, before its options are read. An option
that uses an alias, such as `path.resolve('@data/app.sqlite')`, therefore belongs in an options function passed to
`run()`, as above. An object passed to `run()` is built before the launch, when `@data` is not yet declared, and
`path.resolve()` then returns `app.sqlite` in a directory named `@data` inside the working directory.

`app.exit(code)` stops the application gracefully with that exit code; `app.exit(true)` ends the process immediately
with exit code 2, skipping the done handlers and teardown.

## 3. The lifecycle

1. The environment variables are set and the aliases registered (`@runtime` is the working directory).
2. The options are read and validated; the ID, the time zone and the mode are applied.
3. The application is created in a new root container: its objects are registered and its `bootstrap` runs in order.
4. The objects' `launched()` hooks and the `onLaunched` handlers run.

- **Launch failure**: when the application cannot launch (invalid options, an object that fails to initialize, a
  bootstrap step that fails), the `onFatalException` handler decides the exit code (1 when it returns none). Without a
  handler, the error is logged and the process exits with code 1, as Node.js does on an uncaught exception, so that
  whatever runs the process (Docker restart policies, Kubernetes, systemd, CI) knows it failed. Objects already created
  (a listening server, a connection) do not keep the process alive.
- **Shutdown signals**: on `SIGTERM` (`docker stop`, Kubernetes rolling updates, systemd) and `SIGINT` (Ctrl+C), the
  application stops gracefully. The `onDone` handlers run first, while the application is still fully operational
  (their third argument holds the exit reason, `{code: 0, signal: 'SIGTERM'}`, or `{code}` after `app.exit(code)`).
  Then the entrypoints stop accepting requests and let running requests finish, the objects are destroyed, and the
  process exits with code 0. A second signal (if the shutdown hangs), or a signal received while the application is
  still launching, ends the process immediately with code 128 + the signal number (143 for `SIGTERM`, 130 for
  `SIGINT`). The `shutdownSignals` option accepts other signals (`['SIGTERM', 'SIGINT', 'SIGHUP']`), or `false` to
  leave them to Node.js.
- **Nothing left to do**: when nothing keeps the process busy any more (no server, connection or timer), the
  application stops gracefully, as with `app.exit(0)`. The `onDone` handlers run, the objects are destroyed, and the
  process exits with its current exit code (`process.exitCode`, 0 by default). A script can therefore simply finish its
  work. An application that has been disposed (`app.dispose()`, as in tests) leaves the process exit to whatever runs
  it.

## 4. The mode

`app.mode()` returns `'development'` or `'production'`. The environment overrides the code, so the same build can run in
either mode. The `MODE` environment variable takes precedence, then `NODE_ENV`, then the `mode` option, and
`'development'` applies otherwise. An unknown `MODE` value is ignored with a warning; an unknown `NODE_ENV` value (such
as `test`) is skipped. The resolved mode is written back to `MODE` and `NODE_ENV`, so libraries see the same mode. These
variables can come from the system, from `Application.env({MODE: 'production'})`, or from the `.env` file that Bun
reads (when running `bun App.js`; executables built by Bun do not read it).

## 5. The packed application

`lakutata package bundle`, `package exe` and `package installer` pack the compiled application into a bundle, an
executable or installers. `isPackaged()` (from `lakutata`) returns `true` when the application runs packed.
`resourcesPath()` then returns the directory that holds the application's resources, the files declared in the
`lakutata.resources` field of its `package.json`; it returns `undefined` when the application is not packed, and the
application then reads those files from where they are built. See [Packaging](Packaging.md).

## 6. Entrypoints

The `entrypoint` component (`lakutata/com/entrypoint`) serves controllers over HTTP, the CLI, service transports,
schedules and message queues. Configure it with `buildEntrypoints({controllers, http, cli, service, schedule, queue})`
and list it in `bootstrap`; see [Entrypoint](Entrypoint.md).
