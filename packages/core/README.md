# @lakutata/core

English | [中文](README.zh-CN.md)

The core of the lakutata framework: the IoC container and dependency injection, the object model (`BaseObject`,
`Component`, `Provider`, `Application`) with its asynchronous construction and destruction, and schema validation
(`DTO`, a validation engine with the API of joi), which the `@Configurable`, `@Expect`, `@Accept` and `@Return`
decorators use.

Most applications install the umbrella package `lakutata`, which re-exports this package (`lakutata`,
`lakutata/decorator/di`, `lakutata/decorator/dto`, `lakutata/decorator/asst`, `lakutata/dtos`) and presets the `log`
and `entrypoint` components. `@lakutata/core` alone is enough for a library, or for an application that needs neither
(it then logs to the console).

## Installation

```shell
npm install lakutata          # the framework
npm install @lakutata/core    # or the core only
```

The package needs Node.js 18.10 or later (`>=18.10.0`). Projects use ES modules (`"type": "module"`); the package also
ships CommonJS builds. The decorators need these TypeScript options:

```json
{
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Usage

### An application

An application is a tree of objects that its container creates. `Application.run()` validates the application's
options, registers its components and providers, creates the objects listed in `bootstrap`, then calls `onLaunched`.

```typescript
import {Application, Component, DTO, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

//A component: a singleton of the application, created when it is first needed (or by bootstrap)
class Mailer extends Component {
    //An option, validated when the component is created; its value comes from the application options below
    @Configurable(DTO.String().required())
    protected readonly host: string

    @Inject('log')
    protected readonly log: ILogger

    //Called once its injected objects and options are set
    protected async init(): Promise<void> {
        this.log.info('Mailer connected to %s', this.host)
    }

    public async send(to: string, text: string): Promise<void> {
        this.log.info('Mail to %s: %s', to, text)
    }

    //Called when the application stops
    protected async destroy(): Promise<void> {
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
    .onLaunched(async (app: Application, log: ILogger): Promise<void> => {
        const mailer: Mailer = await app.getObject('mailer')
        await mailer.send('someone@example.com', 'Hello')
        log.info('%s started', app.appName)
    })
    .onFatalException((error: Error, log: ILogger): void => log.error(error.message))
```

### Lifetimes

| Decorator | One instance… | Default of |
|---|---|---|
| `@Singleton()` | per container | `Component` |
| `@Scoped()` | per scope (`container.createScope()`, e.g. a request) | `Provider` (the controllers) |
| `@Transient()` | per resolution | `BaseObject` |

### Dependency injection

`@Inject()` injects the object registered under the property's name, `@Inject('name')` the one registered under
another name, and `@Inject(SomeClass)` an instance of a class (registered automatically when the class is marked
`@Autoload()`). Injected objects are set before `init()` runs.

### Validation

A `DTO` subclass declares its fields with `@Expect(schema)`. Schemas are built with the static methods of `DTO`
(`DTO.String()`, `DTO.Number()`, `DTO.Object()`, `DTO.Array()`, `DTO.Alternatives()`…), which follow the joi API:

```typescript
import {DTO} from 'lakutata'
import {Accept, Expect} from 'lakutata/decorator/dto'

class CreateUserDTO extends DTO {
    @Expect(DTO.String().email().required())
    public email: string

    @Expect(DTO.Number().integer().min(0).default(0))
    public credit: number
}

class Users {
    //The argument is validated (and its defaults applied) before the method runs
    @Accept(CreateUserDTO.required())
    public async create(input: CreateUserDTO): Promise<void> {
    }
}

//Validated directly: resolves to the value with its defaults ({email: 'a@example.com', credit: 0}), or rejects with
//InvalidValueException when the value is invalid
const input = await CreateUserDTO.validateAsync({email: 'a@example.com'})
```

### Tests and libraries: a container without an application

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

//Created with its options; set() resolves once its init() has completed
const container: Container = new Container()
const mailer: Mailer = await container.set(Mailer, {host: 'localhost'})
await mailer.send('someone@example.com', 'Hello')
//Destroys the objects it created
await container.destroy()
```

## API

| Export | Subpath | What it is |
|---|---|---|
| `Application` | `lakutata` | The application: `run()`, `env()`, `alias()`, `onLaunched()`, `onDone()`, `onFatalException()`, `getObject()`, `exit()` |
| `Module` | `lakutata` | The base class of `Application`: the container and the declared objects live here |
| `Component` | `lakutata` | A singleton service with events (`emit`, `on`…) |
| `Provider` | `lakutata` | A scoped object (one per scope) |
| `BaseObject` | `lakutata` | The root class: asynchronous construction (`init`), destruction (`destroy`), `getObject` |
| `Container` | `lakutata` | The IoC container: `set`, `get`, `getShared`, `register`, `createScope`, `destroy` |
| `DTO` | `lakutata` | Validated data classes and the schema builders |
| `Exception` | `lakutata` | The base of the exceptions of the framework (`errno`, `statusCode`) |
| `isPackaged`, `resourcesPath` | `lakutata` | Whether the application runs packed, and its resources directory |
| `registerValidationMessages`, `runInValidationLanguage`… | `lakutata` | The languages of the validation messages |
| `Inject`, `Configurable`, `Autoload`, `Singleton`, `Scoped`, `Transient`, `Lifetime` | `lakutata/decorator/di` | Dependency injection and lifetimes |
| `Expect`, `Accept`, `Return`, `IndexSignature` | `lakutata/decorator/dto` | DTO fields, method argument and return validation |
| `Before`, `After` | `lakutata/decorator/asst` | Functions run before and after a method |
| `PaginationSearchDTO`, `PaginationResultDTO`, `paginator`, `FlexibleDTO`, `toJsonSchema`, `fromJsonSchema` | `lakutata/dtos` | Pagination, open DTOs and JSON Schema conversion |
| `ConsoleLogger`, `ILogger` | `@lakutata/core/com/logger` | The logger interface and its console implementation |
| `IInterfaceListening`, `IInterfaceListener`, `IInterfaceListenOptions`, `IListeningAddress`, `NetworkInterfaceSelector` | `lakutata` | The contract of the listening on network interfaces, which the entrypoints use for their `interface` option and `@lakutata/netif` implements (types only) |

The typings document each declaration with examples.

## Errors

| Exception | Thrown when |
|---|---|
| `InvalidValueException` | A value does not match its schema (`DTO.validate`, `@Configurable`, `@Expect`) |
| `InvalidMethodAcceptException`, `InvalidMethodReturnException` | The arguments (`@Accept`) or the result (`@Return`) of a method are invalid |
| `DependencyInjectionException` | An injected object cannot be resolved |
| `InvalidObjectOptionsException`, `InvalidObjectTypeException` | The options or the class of a declared object are invalid |
| `LifetimeLockedException` | The lifetime of a class is changed after it was locked |
| `ObjectDestroyedException` | A destroyed object is used |
| `AliasExistsException`, `AliasNotFoundException`, `InvalidAliasNameException` | A path alias is declared twice, missing, or invalid |
| `MethodNotFoundException` | A method called by name does not exist |

## See also

- The guides on the website: [Objects and Lifetimes](https://lakutata.com/guide/Objects),
  [Dependency Injection](https://lakutata.com/guide/Injection) and
  [DTO and Validation](https://lakutata.com/guide/DTOValidation).
- The guides `doc/en/Application.md`, `doc/en/Objects.md`, `doc/en/Injection.md`, `doc/en/DTOValidation.md` and
  `doc/en/Decorator.md` in the `lakutata` package (Chinese in `doc/zh`).
- `@lakutata/entrypoint`: the controllers and their HTTP, CLI and service transports.
- `@lakutata/logger`: the logger that `lakutata` presets as `log` (pino-compatible JSON lines).
