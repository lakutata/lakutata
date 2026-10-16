# Lakutata Decorators

The framework declares its dependencies, options, actions and validations with decorators (TypeScript
`experimentalDecorators` with `emitDecoratorMetadata`, both set by `lakutata/tsconfig.json`). They are exported by
these subpaths:

| Subpath | Decorators |
|---|---|
| `lakutata/decorator/di` | `@Inject`, `@Configurable`, `@Autoload`, `@Singleton`, `@Scoped`, `@Transient`, `@Lifetime` |
| `lakutata/decorator/ctrl` | `@HTTPAction`, `@GET`, `@POST`, `@PUT`, `@PATCH`, `@DELETE`, `@HEAD`, `@OPTIONS`, `@CLIAction`, `@ServiceAction`, `@Schedule`, `@Prefix`, `@UseMiddlewares` |
| `lakutata/decorator/dto` | `@Expect`, `@IndexSignature`, `@Accept`, `@Return` |
| `lakutata/decorator/asst` | `@Before`, `@After` |
| `lakutata/decorator/orm` | The TypeORM decorators (`@Entity`, `@Column`…) |
| `lakutata/com/mutex` | `@Synchronized` |
| `lakutata/com/queue` | `@QueueAction` |

## 1. Dependency injection (`lakutata/decorator/di`)

### 1.1 `@Inject`

Sets a property, when the object is created and before its `init()`, to an object of the container:

```typescript
import {Application, Component, type ILogger} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'

class Mailer extends Component {
    public async send(to: string, text: string): Promise<void> {
        console.log(to, text)
    }
}

class Signup extends Component {
    //The object registered under the property name: the component "mailer"
    @Inject()
    protected readonly mailer: Mailer

    //The object registered under a name: the logger preset as "log"
    @Inject('log')
    protected readonly logger: ILogger

    //The object registered for a class (a class marked @Autoload() is registered on first use)
    @Inject(Application)
    protected readonly app: Application

    //A value derived from the registered object
    @Inject('mailer', (mailer: Mailer) => mailer.send.bind(mailer))
    protected readonly send: (to: string, text: string) => Promise<void>

    public async register(email: string): Promise<void> {
        this.logger.info('Signup of %s', email)
        await this.send(email, `Welcome to ${this.app.appName}`)
    }
}
```

A registration that cannot be resolved fails the creation of the object with a `DependencyInjectionException`.

### 1.2 `@Configurable`

`@Configurable(schema?, fn?)` makes a property an option of the object, given by its declaration
(`{class: Server, port: 8080}`) or by the second argument of `getObject()`. The value is validated (and converted) by
the schema (`DTO.Any()` by default), then passed to `fn` (called with the instance as `this`) when given.

```typescript
import {Application, Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'

class Server extends Component {
    //80 unless the declaration gives a port
    @Configurable(DTO.Number().integer().min(1).max(65535).optional().default(80))
    protected readonly port: number

    //The initializer is the default, validated like a configured value
    @Configurable(DTO.String().required())
    protected readonly host: string = '127.0.0.1'

    //The base URL is kept without its trailing slash
    @Configurable(DTO.String().uri().optional().default('http://localhost'), (value: string): string => value.replace(/\/+$/, ''))
    protected readonly baseURL: string

    protected async init(): Promise<void> {
        console.log(`Listening on ${this.host}:${this.port} for ${this.baseURL}`)
    }
}

Application.run(() => ({
    id: 'server.app',
    name: 'Server',
    components: {
        server: {class: Server, port: 8080, baseURL: 'https://example.com/'}
    },
    bootstrap: ['server']
}))
```

- **Value**: the value configured for the property, else its initializer (`protected readonly host: string =
  '127.0.0.1'`), else the default of its schema (`DTO.Number().default(80)`). The initializer is validated and
  transformed like a configured value, and a subclass gives its own default with its own initializer.
- **`maxListeners`**: every component has this configurable property (11 by default): the number of listeners of one
  event above which a possible memory leak is warned of (0 for no warning; the listeners are never limited). A component
  sets its own default with `protected readonly maxListeners: number = 0`, or its declaration sets it:
  `{class: MyComponent, maxListeners: 0}`.
- **Startup check**: when a module (or the application) initializes, it checks the options of every object it declares
  (components, providers and objects) before any of them is created, so a mistake shows up at startup even for an
  object that is never used:
  - a value that does not match the schema of its `@Configurable` property fails the startup with an
    `InvalidObjectOptionsException` listing every invalid option;
  - an option that is not a `@Configurable` property of the class is ignored and warned of, with the configurable
    properties of the class (a misspelled option name).

  A class that reads options without configurable properties (through `getConfigurableRecords()`) overrides the static
  `acceptsOption(name, value)` to accept them without a warning. The values validated by external (asynchronous) rules
  are validated when the object is created. The check is disabled with `checkOptions: false` in the options of the
  application or of the module.

### 1.3 `@Autoload`

A class marked `@Autoload()` is registered the first time it is requested (`@Inject(TheClass)`,
`getObject(TheClass)`) instead of failing: a singleton in the root container, a scoped class in the nearest scope, a
transient class in the requesting container. The mark is not inherited.

### 1.4 Lifetimes: `@Singleton`, `@Scoped`, `@Transient`, `@Lifetime`

| Decorator | One instance… | Default of |
|---|---|---|
| `@Singleton(lock?)` | per container registering the class | `Component`, `Module` (locked) |
| `@Scoped(lock?)` | per scope (a request of an entrypoint) | `Provider`, `Controller` (locked) |
| `@Transient(lock?)` | per resolution | `BaseObject` |

`@Lifetime('SINGLETON' | 'SCOPED' | 'TRANSIENT', lock?)` is their long form. With `lock` set to `true`, the subclasses
cannot declare another lifetime (a `LifetimeLockedException` is thrown when they are defined). A `Provider` may be a
singleton, as in 2.x.

```typescript
import {Provider} from 'lakutata'
import {Transient} from 'lakutata/decorator/di'

//Each user of the builder gets its own, with its own state
@Transient()
export class QueryBuilder extends Provider {
    protected readonly clauses: string[] = []

    public where(clause: string): this {
        this.clauses.push(clause)
        return this
    }
}
```

### 1.5 The properties of subclasses

- **Inheritance**: a subclass inherits the `@Inject` and `@Configurable` properties of its parents. A subclass
  declaring a property again replaces the declaration of its parents, whatever its decorator: the closest declaration
  wins (a property injected by the parent and declared again with `@Configurable` is configured only, and the opposite).
- **The type of a property**: TypeScript lets a subclass narrow the type of a property it declares again (a
  `MemoryStore` for a `Store`), never replace it by another type: `string` for `number` fails with `TS2416` (`Property
  'port' in type 'BrokenServer' is not assignable to the same property in base type 'PlainServer'`), and no compiler
  option disables it. A parent whose subclasses may replace the type of a property declares it with a type parameter:
  - the parent declares the type parameter on the class, named after the property and ending in `Type` (`StoreType` for
    `store`), with a constraint (`extends Store`): the parent uses the property as its constraint, and its subclasses
    replace it by compatible types only; and with a default (`= Store`): a subclass that does not replace it extends
    the parent without type argument;
  - a subclass gives the type in its `extends` clause, and declares the property again only to change its decorator.

```typescript
import {Component, DTO} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

export interface Store {
    get(key: string): Promise<unknown>
}

export interface MemoryStore extends Store {
    clear(): void
}

export class Repository<StoreType extends Store = Store> extends Component {
    @Inject('store')
    protected readonly store: StoreType

    public async find(key: string): Promise<unknown> {
        return await this.store.get(key)
    }
}

//The type of the parent: the store is a Store
export class RemoteRepository extends Repository {
}

//Another type: the store is a MemoryStore, injected as the parent declares it
export class MemoryRepository extends Repository<MemoryStore> {
    public reset(): void {
        this.store.clear()
    }
}

export class Server<PortType extends number | string = number> extends Component {
    @Configurable(DTO.Number().integer().min(1).optional().default(80))
    protected readonly port: PortType
}

//Another type and another schema: the port is a name
export class NamedPortServer extends Server<string> {
    @Configurable(DTO.String().valid('auto', 'http', 'https').optional().default('auto'))
    protected readonly port: string
}
```

In `MemoryRepository`, the IDE completes `this.store` as a `MemoryStore`, and in `Repository` as a `Store`. Without the
type parameter in its parent, a subclass can only silence the error with `// @ts-expect-error` on the property, while
the methods of the parent still use the property with its former type.

## 2. Controller actions (`lakutata/decorator/ctrl`)

These decorators apply to the methods (and, for `@Prefix` and `@UseMiddlewares`, to the classes) of the subclasses of
`Controller`; [ActionPattern](ActionPattern.md) describes them in detail.

| Decorator | Address |
|---|---|
| `@HTTPAction(route, method \| methods, DTO?, options?)` | An HTTP route for one or several methods (`'get'`, `['get', 'post']`) |
| `@GET(route, DTO?, options?)`, `@POST`, `@PUT`, `@PATCH`, `@DELETE`, `@HEAD`, `@OPTIONS` | An HTTP route for one method |
| `@CLIAction(command, DTO?, options?)` | A CLI command (`'copy <source> [target]'`; the words before the name are groups) |
| `@ServiceAction(pattern, DTO?, options?)` | A service pattern (`{cmd: 'order.get'}`) |
| `@Schedule(schedule, options?)` | An interval (`'30s'`) or a cron expression (`'0 3 * * *'`) |
| `@Prefix({route, command, pattern})` | Prefixes the addresses of the actions of a controller class |
| `@UseMiddlewares(...middlewares)` | Middlewares of a controller class or of an action |

The `options` are the action options: `acl`, `name`, `description`, `groups`, `rule`, `middlewares`.

```typescript
import {DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction, HTTPAction, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'

class ItemDTO extends DTO {
    @Expect(DTO.Number().integer().strict(false).required().description('The item id'))
    public id: number
}

class ItemController extends Controller {
    @HTTPAction('/items/:id', ['get', 'post'], ItemDTO)
    @CLIAction('item <id>', ItemDTO, {description: 'Show an item'})
    @ServiceAction({act: 'item.get'}, ItemDTO)
    public async get(input: ItemDTO): Promise<{ id: number }> {
        return {id: input.id}
    }
}
```

The words of a CLI command before its name are its groups: `@CLIAction('package exe <name>', ExeDTO)` is the command
`exe` of the group `package` (`tool package exe app`), and `tool package --help` lists the commands of the group,
described by the `groups` option of the adapter (`commanderCLIEntrypoint({groups: {package: 'Package the
application'}})`, translated by the key `commands.package.description`).

## 3. Validation (`lakutata/decorator/dto`)

| Decorator | Effect |
|---|---|
| `@Expect(schema)` | The schema of a property of a DTO (`DTO.String().required()`) |
| `@IndexSignature(schema)` | A DTO class keeps the keys without schema, validated against the schema |
| `@Accept(...schemas)` | Validates the arguments of each call of a method, by position |
| `@Return(schema)` | Validates the result of each call of a method |

See [DTOValidation](DTOValidation.md).

## 4. Assistants (`lakutata/decorator/asst`)

`@Before(fn)` runs a function before each call of a method, with its arguments: an array it returns replaces the
arguments. `@After(fn)` runs a function after each call, with its result: a value it returns other than `undefined`
replaces the result. The functions are called with the instance as `this`; they may be async only when the method is.

```typescript
import {Component} from 'lakutata'
import {After, Before} from 'lakutata/decorator/asst'

class Users extends Component {
    //The names are looked up trimmed and in lower case
    @Before(function (this: Users, name: string): [string] {
        return [name.trim().toLowerCase()]
    })
    public async find(name: string): Promise<string | undefined> {
        return name === 'ada' ? 'Ada Lovelace' : undefined
    }
}

class Prices extends Component {
    //The prices are rounded to cents
    @After(async function (this: Prices, price: number): Promise<number> {
        return Math.round(price * 100) / 100
    })
    public async withTax(price: number): Promise<number> {
        return price * 1.196
    }
}
```

## 5. Locks (`lakutata/com/mutex`)

`@Synchronized` runs a controller action holding a lock of the `Mutex` component, acquired once the input is validated
and the access is allowed. See [Mutex](Mutex.md).

## 6. Queues (`lakutata/com/queue`)

`@QueueAction(queue, dto?, options?)` makes a controller action the consumer of a queue: the `queueEntrypoint` adapter
delivers it the messages of the queue, acknowledged when it returns, retried after a failure, then sent to the dead letter
queue. See [Queue](Queue.md).

## 7. Database entities (`lakutata/decorator/orm`)

`lakutata/decorator/orm` re-exports the decorators of TypeORM:

- Entities: `@Entity`, `@ViewEntity`, `@ChildEntity`, `@TableInheritance`, `@Unique`, `@Index`, `@Check`, `@Exclusion`.
- Columns: `@Column`, `@PrimaryColumn`, `@PrimaryGeneratedColumn`, `@Generated`, `@ObjectIdColumn`,
  `@CreateDateColumn`, `@UpdateDateColumn`, `@DeleteDateColumn`, `@VersionColumn`, `@ViewColumn`, `@VirtualColumn`.
- Relations: `@OneToOne`, `@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@JoinColumn`, `@JoinTable`, `@RelationId`.
- Trees: `@Tree`, `@TreeChildren`, `@TreeParent`, `@TreeLevelColumn`.
- Listeners: `@BeforeInsert`, `@AfterInsert`, `@BeforeUpdate`, `@AfterUpdate`, `@BeforeRemove`, `@AfterRemove`,
  `@BeforeSoftRemove`, `@AfterSoftRemove`, `@BeforeRecover`, `@AfterRecover`, `@AfterLoad`, `@EventSubscriber`.

```typescript
import {Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn} from 'lakutata/decorator/orm'

@Entity()
export class User {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public name: string

    @Column({unique: true})
    public email: string

    @CreateDateColumn()
    public createdAt: Date

    @UpdateDateColumn()
    public updatedAt: Date
}
```

See [ORMIntegration](ORMIntegration.md).
