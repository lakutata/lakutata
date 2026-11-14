# Lakutata Dependency Injection

An object does not create the objects it uses: it declares them, and the container provides them when it creates the
object. This page covers `@Inject` and `@Autoload`, the options of objects (`@Configurable`), and sharing a feature
between applications as a package. [Decorator](Decorator.md), section 1, gives every rule of these decorators.

## 1. Injecting objects

`@Inject` (from `lakutata/decorator/di`) sets a property when the object is created, before `init()`:

- `@Inject()`: the object registered under the property name;
- `@Inject('name')` or `@Inject(symbol)`: the object registered under that name;
- `@Inject(SomeClass)`: the object registered for the class (`@Inject(Application)` gives the application);
- `@Inject('name', transform)`: the value returned by `transform(object)` (it may be async).

A class marked `@Autoload()` is registered the first time it is requested, instead of failing: a transient class in the
container that requests it, a scoped class in the nearest scope, a singleton in the root container. The root container
holds the application, above the container of the objects the application declares. A singleton registered this way,
like a scoped class requested outside a request, can therefore inject the application but not the objects registered
in the application, such as the preset `log`; a component that needs them is declared in the application options
instead. A dependency that cannot be
resolved fails the creation with a `DependencyInjectionException`.

```typescript
import {Application, BaseObject, Component, type ILogger} from 'lakutata'
import {Autoload, Inject} from 'lakutata/decorator/di'

//Not declared in the application: registered when first injected, one instance per object that injects it
@Autoload()
class Stopwatch extends BaseObject {
    readonly #startedAt: number = Date.now()

    public elapsed(): number {
        return Date.now() - this.#startedAt
    }
}

class Reports extends Component {
    @Inject(Stopwatch)
    protected readonly stopwatch: Stopwatch

    @Inject(Application)
    protected readonly app: Application

    @Inject('log')
    protected readonly log: ILogger

    public uptime(): void {
        this.log.info('%s: reports ready for %d ms', this.app.appName, this.stopwatch.elapsed())
    }
}

Application.run(() => ({
    id: 'reports.app',
    name: 'Reports',
    components: {
        reports: {class: Reports}
    }
}))
```

Code that is not itself an object of the container (an `onLaunched` handler, for example) gets objects with
`app.getObject(name)`; `app.getObject(SomeClass)` works for a class registered on its own, such as an autoloaded class,
not for a component declared under a name.

## 2. Options

`@Configurable(schema, fn?)` turns a property into an option of the object. Its value comes from the object's
declaration (`{class: Mailer, host: 'smtp.example.com'}`) or from the second argument of `getObject()`; the schema
validates it, and `fn`, when given, transforms it. The application checks the options of the objects it declares when
it launches: an invalid value stops the launch with an `InvalidObjectOptionsException`, and an option that matches no
configurable property produces a warning. Only the options that the declarations give are checked at that point: a
required option that a declaration leaves out is reported when the object is created, with an `InvalidValueException`,
because it may still be given by the second argument of `getObject()`. That argument applies when the call creates the
object: a singleton that already exists keeps its options (a warning says so outside production), and a scoped class
requested with options gives a new instance, owned by the requester.

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

[Decorator](Decorator.md), section 1.2, gives the order in which a value is chosen (the configured value, the
initializer, the default of the schema) and the checks made at launch.

## 3. Sharing features between applications

To use a feature in several applications, put it in a package. The package exports a `Component` (or a `Provider`) and
a function that builds its declaration, the way the packages of the framework do (`buildDatabaseOptions` of
`lakutata/com/database`, `buildQueueOptions` of `lakutata/com/queue`). The application declares the component under a
name of its choice and passes the options to the function. The component's `@Configurable` schemas check the options
when the application launches, and the other objects inject the component by its name.

```typescript
import {Application, Component, type ComponentOptions, DTO} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

//In the package: the component, and the function that builds its declaration
export interface BillingOptions {
    currency: string
}

export class Billing extends Component {
    @Configurable(DTO.String().length(3).required())
    public readonly currency: string

    public charge(amount: number): string {
        return `Charged ${amount} ${this.currency}`
    }
}

export function buildBillingOptions(options: BillingOptions): ComponentOptions<BillingOptions> {
    return {class: Billing, ...options}
}

//In the application
class Checkout extends Component {
    @Inject('billing')
    protected readonly billing: Billing
}

Application.run(() => ({
    id: 'shop.app',
    name: 'Shop',
    components: {
        billing: buildBillingOptions({currency: 'EUR'}),
        checkout: {class: Checkout}
    }
}))
```
