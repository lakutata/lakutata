# Lakutata Core

This guide covers the core of the framework, the `@lakutata/core` package that `lakutata`, `lakutata/decorator/di`,
`lakutata/decorator/dto` and `lakutata/decorator/asst` re-export: objects and their container, lifetimes and scopes,
asynchronous construction, dependency injection, modules, and the application lifecycle. The README of `@lakutata/core`
and the type declarations of each export give the details.

## 1. Objects and the container

An IoC container creates every object of an application; you never call `new`. The class hierarchy:

| Class | Role | Default lifetime |
|---|---|---|
| `BaseObject` | The root class: asynchronous construction, `init()`/`destroy()`, `getObject()` | `@Transient` |
| `Provider` | A unit of work that lives in a scope such as a request (a repository, a password hasher) | `@Scoped` |
| `Component` | A long-lived service shared by the whole application (a logger, a database, an entrypoint); also an event emitter | `@Singleton` (locked) |
| `Module` | A component that owns components, providers and objects of its own | `@Singleton` (locked) |
| `Application` | The root module, created by `Application.run()` | |
| `Controller` (`lakutata/com/entrypoint`) | A provider that handles the requests of an entrypoint | `@Scoped` (locked) |

### Lifetimes

| Decorator (`lakutata/decorator/di`) | One instance… |
|---|---|
| `@Singleton()` | per container that registers the class, shared by everything that uses it, including its scopes |
| `@Scoped()` | per scope (`container.createScope()`; each request of an entrypoint is a scope, the root container is one too) |
| `@Transient()` | per resolution, never cached |

Subclasses inherit the lifetime. `Component` and `Module` lock theirs: a subclass that declares a different one throws a
`LifetimeLockedException`. A `Provider` is `@Scoped` by default but may be declared `@Transient` or `@Singleton` (as in
2.x, one instance shared by all scopes, like the `ServiceProxy` of `@lakutata/nats`). A long-lived object that owns
resources (connections, subscriptions, servers) is better written as a `Component`. When a singleton injects a scoped
object, it keeps the instance from the scope that created it. `@Lifetime('SINGLETON' | 'SCOPED' | 'TRANSIENT', lock)` is
the long form of the three decorators.

### Scopes

A scope is a child container that holds its own instances of the scoped objects and shares the singletons and
registrations of its parent. The entrypoint creates a scope for each request: the request's controller and the providers
it injects are created in it and destroyed when the request ends. A component can create its own scope with its
protected `createScope()`.

## 2. Asynchronous construction

The container creates objects asynchronously: the promise returned by `getObject()` (or resolved for `@Inject`) settles
once the object is ready. Creation goes through these steps:

1. its `@Inject` properties are resolved;
2. its `@Configurable` properties receive their configured values, validated (and converted) by their schemas; a
   property that is not configured keeps its initializer, or the default of its schema when it has none;
3. its `init()` runs (an error thrown here fails the creation);
4. its `startup()` runs. By then other objects can already obtain it, but they wait for `startup()` to finish (and fail
   with its error if it throws). The exception is anything requested from inside `startup()`, directly or through the
   objects it creates: those get the object at once, which is how an object requested there can inject it back (an
   entrypoint starts its adapters in `startup()`, and their hooks obtain an authenticator that injects the entrypoint).
   The method is named `startup` rather than `start` so that classes with a `start()` method of their own, such as the
   containers of `@lakutata/docker`, are not started by the framework;
5. once the application has launched (and the object has started), its `launched()` runs; it is not awaited, and its
   errors are logged.

An object is torn down by `dispose()`, or along with the object, scope or application that created it. Teardown waits
for `startup()` to end, then runs `beforeDestroy()`, destroys the objects it created, and finally runs `destroy()`. Each
object owns a container, so whatever it creates with `this.getObject()` is destroyed with it.

```typescript
import {Application, Component, DTO, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

class Mailer extends Component {
    //An option, set by the component's declaration in the application options
    @Configurable(DTO.String().required())
    protected readonly host: string

    //25 unless configured: the initializer is the default and is validated like a configured value
    @Configurable(DTO.Number().integer().min(1).max(65535))
    protected readonly port: number = 25

    //The logger preset by the lakutata package as the "log" component
    @Inject('log')
    protected readonly log: ILogger

    protected async init(): Promise<void> {
        this.log.info('Mailer connected to %s:%d', this.host, this.port)
    }

    public async send(to: string, text: string): Promise<void> {
        this.log.info('Mail to %s: %s', to, text)
    }

    protected async destroy(): Promise<void> {
        this.log.info('Mailer disconnected')
    }
}

Application
    .run(() => ({
        id: 'com.example.app',
        name: 'Example',
        components: {
            mailer: {class: Mailer, host: 'smtp.example.com'}
        },
        bootstrap: ['mailer']
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const mailer: Mailer = await app.getObject<Mailer>('mailer')
        await mailer.send('someone@example.com', 'Hello')
    })
```

## 3. Dependency injection

`@Inject` (from `lakutata/decorator/di`) sets a property when the object is created, before `init()`:

- `@Inject()`: the object registered under the property name;
- `@Inject('name')` or `@Inject(symbol)`: the object registered under that name;
- `@Inject(SomeClass)`: the object registered for the class (`@Inject(Application)` gives the application);
- `@Inject('name', transform)`: the value returned by `transform(object)` (it may be async).

A class marked `@Autoload()` is registered the first time it is requested, instead of failing: a singleton in the root
container, a scoped class in the nearest scope, a transient class in the container that requested it. A dependency that
cannot be resolved fails the creation with a `DependencyInjectionException`.

`@Configurable(schema, fn?)` turns a property into an option of the object. Its value comes from the object's
declaration (`{class: Mailer, host: 'smtp.example.com'}`) or from the second argument of `getObject()`; the schema
validates it, and `fn`, when given, transforms it. A module checks the options of the objects it declares when it
initializes: an invalid value fails the module with an `InvalidObjectOptionsException`, and an option that matches no
configurable property produces a warning.

```typescript
import {Application, Component, Provider} from 'lakutata'
import {Autoload, Inject, Scoped} from 'lakutata/decorator/di'

//Not declared in the application: registered the first time it is injected
@Autoload()
@Scoped()
class RequestClock extends Provider {
    public readonly startedAt: number = Date.now()
}

class Reports extends Component {
    @Inject(RequestClock)
    protected readonly clock: RequestClock

    @Inject(Application)
    protected readonly app: Application

    public elapsed(): number {
        return Date.now() - this.clock.startedAt
    }
}
```

## 4. Modules

A `Module` declares its own components, providers and objects in the initializer of its `options` property, with the
same options as an application. Its objects resolve their dependencies from the module first, then from the application;
the application's objects cannot see the module's. Declare a module under `objects.named` of the application (or of a
parent module), give its options under `options` (merged over the initializer), and list it in `bootstrap` to start it
at launch.

When a module is created, its options are checked, its objects are registered, and its `bootstrap` runs in order. An
object outside the module that requests it (`getObject()`, `@Inject`) receives it once these steps are complete, or
receives the error of the step that failed; the module's own objects, which these steps create, receive it immediately.

```typescript
import {Application, Component, Module, type ModuleOptions} from 'lakutata'

class Billing extends Component {
    public charge(amount: number): void {
        console.log(`Charged ${amount}`)
    }
}

class PaymentModule extends Module {
    protected options: ModuleOptions = {
        components: {
            billing: {class: Billing}
        },
        bootstrap: ['billing']
    }
}

Application.run(() => ({
    id: 'shop.app',
    name: 'Shop',
    objects: {
        named: {
            payment: {class: PaymentModule}
        }
    },
    bootstrap: ['payment']
}))
```

`module.reload()` destroys the module and its objects, then initializes it again.

## 5. The application

### Options

`Application.run(options)` — or `run(() => options)`, a getter called at launch that may be async — takes these options:

| Option | Meaning |
|---|---|
| `id`, `name` | Required. The ID (also the `process.title`) and the name of the application (`app.appId`, `app.appName`) |
| `timezone` | An IANA time zone, or `'auto'` (default) for the system's; written to `TZ` |
| `mode` | `'development'` or `'production'`, when the environment gives none (see below) |
| `shutdownSignals` | The signals that end the application gracefully (default `['SIGTERM', 'SIGINT']`), or `false` |
| `components`, `providers` | The components and providers by name: `{class, ...options}` |
| `objects` | Other objects (modules, plain objects): `{named: {...}, anonymous: [...]}` |
| `bootstrap` | The steps run in order at launch: a name, a symbol or a class (the object is created), or an async function that receives the application |
| `checkOptions` | Check the options of the declared objects at launch (default `true`) |

A declaration without `class` adds options to an object of the same name that the framework presets: the `lakutata`
package presets `log` (the `Logger`) and `entrypoint` (the `Entrypoint`), so `log: {level: 'debug'}` sets the level of
the preset logger. `Application.preset(options)` presets objects for every application in the process.

### The fluent API

```typescript
import {Application, type ApplicationExitReason, type ILogger} from 'lakutata'

Application
    //Environment variables, set at launch before the options getter runs
    .env({TZ_NAME: 'Asia/Shanghai'})
    //Path aliases: '@data' in a path passed to path.resolve() or app.alias.resolve(); the directory is created when missing
    .alias({'@data': './data'}, true)
    .run(() => ({
        id: 'com.example.app',
        name: 'Example',
        components: {}
    }))
    //Called once the bootstrap completed (not awaited)
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

### Lifecycle

1. The environment variables are set and the aliases registered (`@runtime` is the working directory).
2. The options are read and validated; the ID, the time zone and the mode are applied.
3. The application is created in a new root container: its objects are registered and its `bootstrap` runs in order.
4. The `onLaunched` handlers and the `launched()` hooks of the objects run.

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
- **The mode**: `app.mode()` returns `'development'` or `'production'`. The environment overrides the code, so the same
  build can run in either mode: the `MODE` environment variable wins, then `NODE_ENV`, then the `mode` option, and
  `'development'` otherwise. A `MODE` with an unknown value is ignored with a warning; a `NODE_ENV` with an unknown
  value (such as `test`) is skipped. The resolved mode is written back to `MODE` and `NODE_ENV`, so libraries see the
  same mode. The variables can come from the system, from `Application.env({MODE: 'production'})`, or from the `.env`
  file that Bun reads (when running `bun App.js`; executables built by Bun do not read it).
- **The packed application**: `isPackaged()` (from `lakutata`) tells whether the application is running as a bundle
  (`lakutata package bundle`) or as an executable (`lakutata package exe`). The files it reads at run time (the built
  pages of a web application, templates, data) are declared under `lakutata.resources` in its `package.json`, in the
  same form as electron-builder's `extraResources`: `[{"from": "../ui/dist", "to": "ui"}]`. When packed,
  `resourcesPath()` returns the directory holding them; when not, it returns `undefined` and the application reads them
  from the build directory: `const ui = resourcesPath() ? path.join(resourcesPath()!, 'ui') : uiBuildDirectory`.

## 6. Entrypoints

The `entrypoint` component (`lakutata/com/entrypoint`) serves the controllers over HTTP, the CLI, service transports,
schedules and message queues. Configure it with `buildEntrypoints({controllers, http, cli, service, schedule, queue})`
and list it in `bootstrap`; see [ActionPattern](ActionPattern.md).

## 7. A container without an application

Tests, scripts and libraries can use these objects in a bare container, without an application:

```typescript
import {Component, Container, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'

class Mailer extends Component {
    @Configurable(DTO.String().required())
    protected readonly host: string

    public async send(to: string, text: string): Promise<string> {
        return `${this.host} -> ${to}: ${text}`
    }
}

const container: Container = new Container()
//Created with its options; its init() is awaited
const mailer: Mailer = await container.set(Mailer, {host: 'localhost'})
await mailer.send('someone@example.com', 'Hello')
//Destroys the objects it created
await container.destroy()
```

`container.register()` and `registerNamed()` register a class without creating it, `get()` resolves an object, `build()`
always creates a new instance whatever the lifetime, and `createScope()` creates a scope.
