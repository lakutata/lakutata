# Lakutata Objects and Lifetimes

Every object of an application (components, providers, controllers) is created by an IoC container; you never call
`new`. This page covers the classes of these objects, their lifetimes and scopes, how they are created and destroyed,
and how to use them without an application. They come from the package `@lakutata/core`, which `lakutata`,
`lakutata/decorator/di`, `lakutata/decorator/dto` and `lakutata/decorator/asst` re-export; its README and the type
declarations of each export give the details.

## 1. The classes

| Class | Role | Default lifetime |
|---|---|---|
| `BaseObject` | The root class: asynchronous construction, `init()`/`destroy()`, `getObject()` | `@Transient` |
| `Provider` | A unit of work that lives in a scope such as a request (a repository, a password hasher) | `@Scoped` |
| `Component` | A long-lived service shared by the whole application (a logger, a database, an entrypoint); also an event emitter | `@Singleton` (locked) |
| `Application` | The application: it declares the components, providers and objects, and is created by `Application.run()` | |
| `Controller` (`lakutata/com/entrypoint`) | A provider that handles the requests of an entrypoint | `@Scoped` (locked) |

## 2. Lifetimes

| Decorator (`lakutata/decorator/di`) | One instance… |
|---|---|
| `@Singleton()` | per container that registers the class, shared by everything that uses it, including its scopes |
| `@Scoped()` | per scope (`container.createScope()`; each request of an entrypoint is a scope, the root container is one too) |
| `@Transient()` | per resolution, never cached |

Subclasses inherit the lifetime. `Component` locks its lifetime: a subclass that declares a different one throws a
`LifetimeLockedException`. A `Provider` is `@Scoped` by default but may be declared `@Transient` or `@Singleton` (as in
2.x, one instance shared by all scopes, like the `ServiceProxy` of `@lakutata/nats`). A long-lived object that owns
resources (connections, subscriptions, servers) is better written as a `Component`. When a singleton injects a scoped
object, it keeps the instance from the scope that created it. `@Lifetime('SINGLETON' | 'SCOPED' | 'TRANSIENT', lock)` is
the long form of the three decorators.

## 3. Scopes

A scope is a child container that holds its own instances of the scoped objects and shares the singletons and
registrations of its parent. The entrypoint creates a scope for each request: the request's controller and the providers
it injects are created in it and destroyed when the request ends. A component can create its own scope with its
protected `createScope()`.

## 4. Creation and teardown

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
import {Application, Component, type ILogger} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'

class Poller extends Component {
    @Inject('log')
    protected readonly log: ILogger

    protected timer: NodeJS.Timeout

    //Its dependencies are injected and its options set
    protected async init(): Promise<void> {
        this.log.info('init')
    }

    //Other objects can already get it, but they wait until this ends
    protected async startup(): Promise<void> {
        this.timer = setInterval((): void => this.log.info('polling'), 10000)
        this.log.info('startup')
    }

    //The application has launched (not awaited)
    protected async launched(): Promise<void> {
        this.log.info('launched')
    }

    //Teardown begins: the objects it created still exist
    protected async beforeDestroy(): Promise<void> {
        this.log.info('beforeDestroy')
    }

    //Teardown ends: the objects it created are destroyed
    protected async destroy(): Promise<void> {
        clearInterval(this.timer)
        this.log.info('destroy')
    }
}

Application
    .run(() => ({
        id: 'poller.app',
        name: 'Poller',
        components: {
            poller: {class: Poller}
        },
        bootstrap: ['poller']
    }))
    .onLaunched((app: Application, log: ILogger): void => log.info('onLaunched'))
    .onDone((app: Application, log: ILogger): void => log.info('onDone'))
```

It logs `init`, `startup`, `launched` and `onLaunched`. On Ctrl+C, it logs `onDone`, `beforeDestroy` and `destroy`,
then the process exits.

## 5. A container without an application

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
