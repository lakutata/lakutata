# Lakutata Application

The **application** is the root object of a Lakutata program. `Application.run()` creates it in a new root container,
registers the objects it declares, runs its bootstrap steps, and ends it gracefully on a shutdown signal. This page
covers its options, the fluent API, the lifecycle, the mode and packed applications. The objects it creates are
described in [Objects](Objects.md), and how they obtain one another in [Injection](Injection.md).

## 1. Options

`Application.run(options)` — or `run(() => options)`, a function called at launch that may be async — takes these
options:

| Option | Meaning |
|---|---|
| `id`, `name` | Required. The ID (also the `process.title`) and the name of the application (`app.appId`, `app.appName`) |
| `timezone` | An IANA time zone, or `'auto'` (default) for the system's; written to `TZ` |
| `mode` | `'development'` or `'production'`, when the environment gives none (see section 4) |
| `shutdownSignals` | The signals that end the application gracefully (default `['SIGTERM', 'SIGINT']`), or `false` |
| `components`, `providers` | The components and providers by name: `{class, ...options}` |
| `objects` | Other objects: `{named: {...}, anonymous: [...]}` |
| `bootstrap` | The steps run in order at launch: a name, a symbol or a class (the object is created), or an async function that receives the application |
| `checkOptions` | Check the options of the declared objects at launch (default `true`) |

A declaration without `class` adds options to an object of the same name that the framework presets: the `lakutata`
package presets `log` (the `Logger`) and `entrypoint` (the `Entrypoint`), so `log: {level: 'debug'}` sets the level of
the preset logger. `Application.preset(options)` presets objects for every application in the process.

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

`app.exit(code)` ends the application gracefully with that exit code; `app.exit(true)` ends the process immediately with
exit code 2, skipping the done handlers and the teardown.

## 3. The lifecycle

1. The environment variables are set and the aliases registered (`@runtime` is the working directory).
2. The options are read and validated; the ID, the time zone and the mode are applied.
3. The application is created in a new root container: its objects are registered and its `bootstrap` runs in order.
4. The `launched()` hooks of the objects and the `onLaunched` handlers run.

- **Launch failure**: when the application cannot launch (invalid options, an object that fails to initialize, a
  bootstrap step that fails), the `onFatalException` handler decides the exit code (1 when it returns none). Without a
  handler, the error is logged and the process exits with code 1, as Node.js does on an uncaught exception, so whatever
  runs it (Docker restart policies, Kubernetes, systemd, CI) knows it failed; objects already created (a listening
  server, a connection) do not keep the process alive.
- **Shutdown signals**: on `SIGTERM` (`docker stop`, Kubernetes rolling updates, systemd) and `SIGINT` (Ctrl+C), the
  application ends gracefully. The `onDone` handlers run first, while the application is still fully working (their
  third argument says why it is exiting: `{code: 0, signal: 'SIGTERM'}`, or `{code}` after `app.exit(code)`). Then the
  entrypoints stop accepting requests and let the running ones finish, the objects are destroyed, and the process exits
  with code 0. A second signal (if the shutdown hangs), or a signal received while the application is still launching,
  ends the process at once with code 128 + the signal number (143 for `SIGTERM`, 130 for `SIGINT`). The
  `shutdownSignals` option accepts other signals (`['SIGTERM', 'SIGINT', 'SIGHUP']`), or `false` to leave them to
  Node.js.
- **Nothing left to do**: like any Node.js program, a process that nothing keeps busy (no server, connection or timer)
  ends once its work is done; the `onDone` handlers and the teardown do not run in that case. An application that runs a
  task and stops, such as a script, calls `app.exit(0)` when the task is done.

## 4. The mode

`app.mode()` returns `'development'` or `'production'`. The environment overrides the code, so the same build can run in
either mode: the `MODE` environment variable wins, then `NODE_ENV`, then the `mode` option, and `'development'`
otherwise. A `MODE` with an unknown value is ignored with a warning; a `NODE_ENV` with an unknown value (such as `test`)
is skipped. The resolved mode is written back to `MODE` and `NODE_ENV`, so libraries see the same mode. The variables
can come from the system, from `Application.env({MODE: 'production'})`, or from the `.env` file that Bun reads (when
running `bun App.js`; executables built by Bun do not read it).

## 5. The packed application

`lakutata package bundle`, `package exe` and `package installer` pack the compiled application into a bundle, an
executable or installers. When it runs packed, `isPackaged()` (from `lakutata`) returns `true`, and `resourcesPath()`
returns the directory of its resources, the files declared in the `lakutata.resources` of its `package.json`; when not
packed, it returns `undefined` and the application reads those files from where they are built. See
[Packaging](Packaging.md).

## 6. Entrypoints

The `entrypoint` component (`lakutata/com/entrypoint`) serves the controllers over HTTP, the CLI, service transports,
schedules and message queues. Configure it with `buildEntrypoints({controllers, http, cli, service, schedule, queue})`
and list it in `bootstrap`; see [Entrypoint](Entrypoint.md).
