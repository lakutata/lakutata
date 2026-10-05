# Lakutata Core

This guide covers the core of the framework (the package `@lakutata/core`, re-exported by `lakutata`,
`lakutata/decorator/di`, `lakutata/decorator/dto` and `lakutata/decorator/asst`): the objects and their container, their
lifetimes and scopes, their asynchronous construction, dependency injection, modules and the application lifecycle. The
README of `@lakutata/core` and the typings of each export give the details.

## 1. Objects and the container

Every object of an application is created by an IoC container, never with `new`. The class hierarchy:

| Class | Role | Default lifetime |
|---|---|---|
| `BaseObject` | The root class: asynchronous construction, `init()`/`destroy()`, `getObject()` | `@Transient` |
| `Provider` | A functional unit living in a scope, such as a request (a repository, a hasher) | `@Scoped` |
| `Component` | A long-lived service shared by the application (a logger, a database, an entrypoint); an event emitter | `@Singleton` (locked) |
| `Module` | A component owning its own components, providers and objects | `@Singleton` (locked) |
| `Application` | The root module, created by `Application.run()` | |
| `Controller` (`lakutata/com/entrypoint`) | A provider serving the requests of an entrypoint | `@Scoped` (locked) |

### Lifetimes

| Decorator (`lakutata/decorator/di`) | One instance… |
|---|---|
| `@Singleton()` | per container registering the class, shared by its users and its scopes |
| `@Scoped()` | per scope (`container.createScope()`; each request of an entrypoint is a scope, the root container is one too) |
| `@Transient()` | per resolution, never cached |

Subclasses inherit the lifetime. `Component` and `Module` lock theirs: a subclass declaring another one throws a
`LifetimeLockedException`. A `Provider` is `@Scoped` by default and may be declared `@Transient` or `@Singleton` (as in
2.x: one instance shared by the scopes, such as the `ServiceProxy` of `@lakutata/nats`); a long-lived object owning
resources (connections, subscriptions, servers) is rather a `Component`. A singleton injecting a scoped object keeps the
instance of the scope which created it.
`@Lifetime('SINGLETON' | 'SCOPED' | 'TRANSIENT', lock)` is the long form of the three decorators.

### Scopes

A scope is a child container holding its own instances of the scoped objects, the singletons and registrations of its
parent being shared. The entrypoint creates one per request: the controller of the request and the providers it injects
are created in it and destroyed when the request ends. A component creates its own with its protected `createScope()`.

## 2. Asynchronous construction

The container creates an object asynchronously, and the promise of `getObject()` (or `@Inject`) settles once the
object is ready:

1. its `@Inject` properties are resolved;
2. its `@Configurable` properties get their configured values, validated (and converted) by their schemas; a property
   not configured keeps its initializer, else the default of its schema;
3. its `init()` runs (an error thrown here fails the creation);
4. its `startup()` runs, once it can be got by the other objects: the requesters wait for it (and fail with its error),
   except the objects got from within it, directly or through the objects they create, which get the object at once —
   so an object it gets may inject it (an entrypoint starts its adapters there, their hooks getting an authenticator
   which injects the entrypoint). It is named `startup` so that the classes with a `start()` method of their own (the
   containers of `@lakutata/docker`) are not started by the framework;
5. once the application has launched (and the object started), its `launched()` runs (not awaited; its errors are
   logged).

At its teardown (`dispose()`, or the teardown of the object, scope or application that created it), once its
`startup()` ended, its `beforeDestroy()` runs, then the objects it created are destroyed, then its `destroy()` runs. Each object owns a
container: the objects it creates with `this.getObject()` are destroyed with it.

```typescript
import {Application, Component, DTO, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

class Mailer extends Component {
    //Its option, given by its declaration in the application options
    @Configurable(DTO.String().required())
    protected readonly host: string

    //25 unless configured: the initializer is the default, validated like a configured value
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

A class marked `@Autoload()` is registered on its first request instead of failing: a singleton in the root container,
a scoped class in the nearest scope, a transient class in the requesting container. A registration that cannot be
resolved fails the creation with a `DependencyInjectionException`.

`@Configurable(schema, fn?)` makes a property an option of the object: its value comes from the object's declaration
(`{class: Mailer, host: 'smtp.example.com'}`) or from the second argument of `getObject()`, validated by the schema, then
passed to `fn` when given. A module checks the options of the objects it declares when it initializes: an invalid value
fails it with an `InvalidObjectOptionsException`, an option that is not a configurable property is warned of.

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

A `Module` declares its own components, providers and objects with the same options as the application, in the
initializer of its `options` property. Its objects resolve their dependencies from the module first, then from the
application; the application's objects do not see the module's. Declare a module in the `objects.named` of the
application (or of a parent module), its options under `options` (merged over its initializer), and list it in
`bootstrap` to start it at launch.

When a module is created, its options are checked, its objects registered, then its `bootstrap` runs in order. An
object outside the module getting it (`getObject()`, `@Inject`) receives it once these steps are complete, or receives
the error of the step that failed; the module's own objects, created by these steps, receive it at once.

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

`module.reload()` destroys the module with its objects and initializes it again.

## 5. The application

### Options

`Application.run(options)` (or `run(() => options)`, the getter called at launch, possibly async) takes:

| Option | Meaning |
|---|---|
| `id`, `name` | Required. The ID (also the `process.title`) and the name of the application (`app.appId`, `app.appName`) |
| `timezone` | An IANA time zone, or `'auto'` (default) for the system's; written to `TZ` |
| `mode` | `'development'` or `'production'`, when the environment gives none (see below) |
| `shutdownSignals` | The signals ending the application gracefully (default `['SIGTERM', 'SIGINT']`), or `false` |
| `components`, `providers` | The components and providers by name: `{class, ...options}` |
| `objects` | Other objects (modules, plain objects): `{named: {...}, anonymous: [...]}` |
| `bootstrap` | The steps run in order at launch: a name, a symbol or a class (the object is created), or an async function called with the application |
| `checkOptions` | Check the options of the declared objects at launch (default `true`) |

A declaration without `class` completes the options of the object of the same name preset by the framework: the
`lakutata` package presets `log` (the `Logger`) and `entrypoint` (the `Entrypoint`), so `log: {level: 'debug'}` sets the
level of the preset logger. `Application.preset(options)` presets objects for every application of the process.

### The fluent API

```typescript
import {Application, type ApplicationExitReason, type ILogger} from 'lakutata'

Application
    //Environment variables, set at launch before the options getter runs
    .env({TZ_NAME: 'Asia/Shanghai'})
    //Path aliases: '@data' in a path given to path.resolve() or app.alias.resolve(); created when missing
    .alias({'@data': './data'}, true)
    .run(() => ({
        id: 'com.example.app',
        name: 'Example',
        components: {}
    }))
    //Called once the bootstrap completed (not awaited)
    .onLaunched((app: Application, log: ILogger): void => log.info('%s launched in %s mode', app.appName, app.mode()))
    //Called, awaited, when the application exits, before its objects are destroyed
    .onDone(async (app: Application, log: ILogger, reason: ApplicationExitReason): Promise<void> => {
        log.info('%s done (exit code %d%s)', app.appName, reason.code, reason.signal ? `, ${reason.signal}` : '')
    })
    //An uncaught exception of the process, the application keeps running
    .onUncaughtException((error: Error, log: ILogger): void => log.warn(error.message))
    //The launch failed: the returned number is the exit code (1 when none)
    .onFatalException((error: Error, log: ILogger): number => {
        log.error('Launch failed: %s', error.message)
        return 100
    })
```

`app.exit(code)` ends the application gracefully with the exit code; `app.exit(true)` ends the process at once with the
code 2, without the done handlers nor the teardown.

### Lifecycle

1. The environment variables are set and the aliases registered (`@runtime` is the working directory).
2. The options are read and validated; the ID, the time zone and the mode are applied.
3. The application is created in a new root container: its objects are registered and its `bootstrap` runs in order.
4. The `onLaunched` handlers and the `launched()` hooks of the objects run.

- **Launch failure**: when the application cannot launch (invalid options, an object failing to initialize, a bootstrap
  step failing), the `onFatalException` handler gives the exit code (1 when it returns none). Without handler, the error
  is logged and the process exits with the code 1, as Node.js does on an uncaught exception, so the tools running it
  (Docker restart policies, Kubernetes, systemd, CI) know it failed; the objects already created (a listening server, a
  connection) do not keep it running.
- **Shutdown signals**: on `SIGTERM` (`docker stop`, the rolling updates of Kubernetes, systemd) and `SIGINT` (Ctrl+C),
  the application ends gracefully: the `onDone` handlers run first, the application still working (their third
  argument tells why: `{code: 0, signal: 'SIGTERM'}`, or `{code}` for `app.exit(code)`), then the entrypoints stop
  accepting requests and let the running ones complete, the objects are destroyed, and the process exits with the code
  0. A second signal (a shutdown hanging), or a signal received while the application launches, ends the process at
  once with the code 128 + the number of the signal (143 for `SIGTERM`, 130 for `SIGINT`). The option
  `shutdownSignals` gives other signals (`['SIGTERM', 'SIGINT', 'SIGHUP']`), or `false` to leave them to Node.js.
- **The mode**: `app.mode()` gives `'development'` or `'production'`. The environment overrides the code, so the same
  build runs in each mode: the `MODE` environment variable, then `NODE_ENV`, then the `mode` option, `'development'`
  otherwise. A `MODE` that is not a mode is warned of and ignored; a `NODE_ENV` that is not a mode (`test`) is skipped.
  The mode is written back to `MODE` and `NODE_ENV`, so the libraries read the same mode. The variables come from the
  system, from `Application.env({MODE: 'production'})`, or from the `.env` file Bun reads (`bun App.js`; the
  executables built by Bun do not read it).
- **The packed application**: `isPackaged()` (from `lakutata`) tells whether the application runs bundled
  (`lakutata package bundle`) or as an executable (`lakutata package exe`). The files it reads at run time (the built
  pages of a web application, templates, data) are declared by `lakutata.resources` in its `package.json`, as the
  `extraResources` of electron-builder: `[{"from": "../ui/dist", "to": "ui"}]`. Packed, `resourcesPath()` gives their
  directory; not packed, it gives `undefined` and the application finds them where they are built:
  `const ui = resourcesPath() ? path.join(resourcesPath()!, 'ui') : uiBuildDirectory`.

## 6. Entrypoints

The `entrypoint` component (`lakutata/com/entrypoint`) serves the controllers over HTTP, CLI, service transports and
schedules. Give its options with `buildEntrypoints({controllers, http, cli, service, schedule})` and list it in
`bootstrap`; see [ActionPattern](ActionPattern.md).

## 7. A container without an application

Tests, scripts and libraries can use the objects in a bare container:

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
//Created with its options, its init() awaited
const mailer: Mailer = await container.set(Mailer, {host: 'localhost'})
await mailer.send('someone@example.com', 'Hello')
//Destroys the objects it created
await container.destroy()
```

`container.register()`/`registerNamed()` register a class without creating it, `get()` resolves an object,
`build()` creates a new one whatever its lifetime, `createScope()` creates a scope.
