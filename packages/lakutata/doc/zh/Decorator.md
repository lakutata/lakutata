# Lakutata 装饰器

框架用装饰器声明依赖、选项、动作和校验（TypeScript 的 `experimentalDecorators` 与 `emitDecoratorMetadata`，两者都已在 `lakutata/tsconfig.json` 中开启）。装饰器由以下子路径导出：

| 子路径 | 装饰器 |
|---|---|
| `lakutata/decorator/di` | `@Inject`、`@Configurable`、`@Autoload`、`@Singleton`、`@Scoped`、`@Transient`、`@Lifetime` |
| `lakutata/decorator/ctrl` | `@HTTPAction`、`@GET`、`@POST`、`@PUT`、`@PATCH`、`@DELETE`、`@HEAD`、`@OPTIONS`、`@CLIAction`、`@ServiceAction`、`@Schedule`、`@Prefix`、`@UseMiddlewares` |
| `lakutata/decorator/dto` | `@Expect`、`@IndexSignature`、`@Accept`、`@Return` |
| `lakutata/decorator/asst` | `@Before`、`@After` |
| `lakutata/decorator/orm` | TypeORM 的装饰器（`@Entity`、`@Column` 等） |
| `lakutata/com/mutex` | `@Synchronized` |

## 1. 依赖注入（`lakutata/decorator/di`）

### 1.1 `@Inject`

在对象创建时、`init()` 之前，把容器中的某个对象赋给属性：

```typescript
import {Application, Component, type ILogger} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'

class Mailer extends Component {
    public async send(to: string, text: string): Promise<void> {
        console.log(to, text)
    }
}

class Signup extends Component {
    //以属性名注册的对象：组件 "mailer"
    @Inject()
    protected readonly mailer: Mailer

    //以指定名称注册的对象：预置为 "log" 的日志组件
    @Inject('log')
    protected readonly logger: ILogger

    //为某个类注册的对象（标记了 @Autoload() 的类会在第一次使用时自动注册）
    @Inject(Application)
    protected readonly app: Application

    //由注册对象派生的值
    @Inject('mailer', (mailer: Mailer) => mailer.send.bind(mailer))
    protected readonly send: (to: string, text: string) => Promise<void>

    public async register(email: string): Promise<void> {
        this.logger.info('Signup of %s', email)
        await this.send(email, `Welcome to ${this.app.appName}`)
    }
}
```

无法解析的注册项会使对象创建失败，并抛出 `DependencyInjectionException`。

### 1.2 `@Configurable`

`@Configurable(schema?, fn?)` 把属性声明为对象的选项，选项值来自对象的声明（`{class: Server, port: 8080}`）或 `getObject()` 的第二个参数。值先由校验规则（默认 `DTO.Any()`）校验（及转换），如果提供了 `fn`，再交给 `fn` 处理（调用时 `this` 为该实例）。

```typescript
import {Application, Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'

class Server extends Component {
    //声明中没有给出 port 时为 80
    @Configurable(DTO.Number().integer().min(1).max(65535).optional().default(80))
    protected readonly port: number

    //初始值就是默认值，和配置值一样会被校验
    @Configurable(DTO.String().required())
    protected readonly host: string = '127.0.0.1'

    //去掉基础 URL 末尾的斜杠
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

- **取值**：优先使用配置里给的值，其次是属性的初始值（`protected readonly host: string = '127.0.0.1'`），最后是校验规则的默认值（`DTO.Number().default(80)`）。初始值会和配置值一样经过校验和转换；子类可以用自己的初始值给出自己的默认值。
- **`maxListeners`**：所有组件都有这个可配置属性（默认 11），表示同一个事件的监听器超过多少个时给出可能内存泄漏的警告（0 表示不警告；监听器数量从不受限制）。组件可以用 `protected readonly maxListeners: number = 0` 设置自己的默认值，也可以在声明里设置：`{class: MyComponent, maxListeners: 0}`。
- **启动检查**：模块（或应用）初始化时，会在创建任何对象之前检查它声明的所有对象（组件、提供者和对象）的选项，所以即使某个对象从未被使用，配置错误也会在启动时暴露：
  - 不符合 `@Configurable` 属性校验规则的值会导致启动失败，抛出 `InvalidObjectOptionsException`，并列出所有不合法的选项；
  - 不是该类 `@Configurable` 属性的选项会被忽略并给出警告，警告中列出该类的可配置属性（用于发现拼错的选项名）。

  通过 `getConfigurableRecords()` 读取非可配置属性选项的类，可以覆盖静态方法 `acceptsOption(name, value)` 来接受这些选项，不产生警告。由外部（异步）规则校验的值在对象创建时校验。在应用或模块的选项中设置 `checkOptions: false` 可以关闭这项检查。

### 1.3 `@Autoload`

标记了 `@Autoload()` 的类在第一次被请求时（`@Inject(TheClass)`、`getObject(TheClass)`）自动注册，而不是报错：单例注册到根容器，作用域类注册到最近的作用域，瞬态类注册到发起请求的容器。该标记不会被子类继承。

### 1.4 生命周期：`@Singleton`、`@Scoped`、`@Transient`、`@Lifetime`

| 装饰器 | 实例数量 | 默认用于 |
|---|---|---|
| `@Singleton(lock?)` | 每个注册该类的容器一个 | `Component`、`Module`（锁定） |
| `@Scoped(lock?)` | 每个作用域一个（入口的一次请求） | `Provider`、`Controller`（锁定） |
| `@Transient(lock?)` | 每次解析一个 | `BaseObject` |

`@Lifetime('SINGLETON' | 'SCOPED' | 'TRANSIENT', lock?)` 是它们的完整写法。`lock` 为 `true` 时，子类不能声明其他生命周期类型（子类定义时抛出 `LifetimeLockedException`）；`Provider` 可以是单例（与 2.x 相同）。

```typescript
import {Provider} from 'lakutata'
import {Transient} from 'lakutata/decorator/di'

//每个使用者都得到自己的构建器，各自保存状态
@Transient()
export class QueryBuilder extends Provider {
    protected readonly clauses: string[] = []

    public where(clause: string): this {
        this.clauses.push(clause)
        return this
    }
}
```

### 1.5 子类的属性

- **继承**：子类继承父类的 `@Inject` 和 `@Configurable` 属性。子类重新声明某个属性时，会取代父类对它的声明，不论使用的是哪种装饰器，以最近一层的声明为准（父类注入的属性，在子类里用 `@Configurable` 重新声明后，只按配置处理，不再注入；反之亦然）。
- **属性的类型**：TypeScript 允许子类在重新声明属性时把类型改窄（例如把 `Store` 改成 `MemoryStore`），但不允许换成其他类型：把 `number` 换成 `string` 会报 `TS2416`（`Property 'port' in type 'BrokenServer' is not assignable to the same property in base type 'PlainServer'`），而且没有任何编译选项可以关闭这个检查。如果父类允许子类替换某个属性的类型，就用泛型参数来声明这个属性：
  - 父类在类上声明泛型参数，按属性命名并以 `Type` 结尾（属性 `store` 对应 `StoreType`）。加上约束（`extends Store`）：父类可以按约束的类型使用这个属性，子类也只能换成兼容的类型。再加上默认类型（`= Store`）：不需要替换类型的子类，继承时不用填写类型参数；
  - 子类在 `extends` 处填入具体类型。只有需要更换装饰器时，才在子类里重新声明这个属性。

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

//沿用父类的类型：store 是 Store
export class RemoteRepository extends Repository {
}

//换成其他类型：store 是 MemoryStore，按父类的声明注入
export class MemoryRepository extends Repository<MemoryStore> {
    public reset(): void {
        this.store.clear()
    }
}

export class Server<PortType extends number | string = number> extends Component {
    @Configurable(DTO.Number().integer().min(1).optional().default(80))
    protected readonly port: PortType
}

//换成其他类型和其他校验规则：port 是一个名称
export class NamedPortServer extends Server<string> {
    @Configurable(DTO.String().valid('auto', 'http', 'https').optional().default('auto'))
    protected readonly port: string
}
```

在 `MemoryRepository` 里，IDE 会把 `this.store` 当作 `MemoryStore` 来补全；在 `Repository` 里则当作 `Store`。如果父类没有声明泛型参数，子类只能在属性上用 `// @ts-expect-error` 压制这个错误，而父类的方法仍会按原来的类型使用这个属性。

## 2. 控制器动作（`lakutata/decorator/ctrl`）

这些装饰器用于 `Controller` 子类的方法（`@Prefix` 和 `@UseMiddlewares` 也可用于类）；详见 [ActionPattern](ActionPattern.md)。

| 装饰器 | 地址 |
|---|---|
| `@HTTPAction(route, method \| methods, DTO?, options?)` | 一个或多个 HTTP 方法（`'get'`、`['get', 'post']`）的路由 |
| `@GET(route, DTO?, options?)`、`@POST`、`@PUT`、`@PATCH`、`@DELETE`、`@HEAD`、`@OPTIONS` | 单个 HTTP 方法的路由 |
| `@CLIAction(command, DTO?, options?)` | CLI 命令（`'copy <source> [target]'`；名称前面的词是命令分组） |
| `@ServiceAction(pattern, DTO?, options?)` | 服务模式（`{cmd: 'order.get'}`） |
| `@Schedule(schedule, options?)` | 间隔（`'30s'`）或 cron 表达式（`'0 3 * * *'`） |
| `@Prefix({route, command, pattern})` | 为控制器类中动作的地址添加前缀 |
| `@UseMiddlewares(...middlewares)` | 控制器类或动作的中间件 |

`options` 是动作选项：`acl`、`name`、`description`、`groups`、`rule`、`middlewares`。

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

CLI 命令名称前面的词是命令分组：`@CLIAction('package exe <name>', ExeDTO)` 是命令组 `package` 下的命令 `exe`（`tool package exe app`），`tool package --help` 会列出这个组的所有命令。命令组的说明由适配器的 `groups` 选项给出（`CommanderCLIEntrypoint({groups: {package: '打包应用'}})`，翻译键为 `commands.package.description`）。

## 3. 校验（`lakutata/decorator/dto`）

| 装饰器 | 效果 |
|---|---|
| `@Expect(schema)` | DTO 属性的校验规则（`DTO.String().required()`） |
| `@IndexSignature(schema)` | DTO 类保留没有规则的字段，并按该规则校验 |
| `@Accept(...schemas)` | 每次调用方法时按位置校验参数 |
| `@Return(schema)` | 每次调用方法时校验返回值 |

见 [DTOValidation](DTOValidation.md)。

## 4. 辅助装饰器（`lakutata/decorator/asst`）

`@Before(fn)` 在方法每次调用之前以其参数执行一个函数：函数返回的数组会替换传给方法的参数。`@After(fn)` 在每次调用之后以其结果执行一个函数：函数返回的非 `undefined` 值会替换结果。这些函数调用时 `this` 为该实例；只有方法是异步的，函数才可以是异步的。

```typescript
import {Component} from 'lakutata'
import {After, Before} from 'lakutata/decorator/asst'

class Users extends Component {
    //按去除首尾空格并转为小写后的名称查找
    @Before(function (this: Users, name: string): [string] {
        return [name.trim().toLowerCase()]
    })
    public async find(name: string): Promise<string | undefined> {
        return name === 'ada' ? 'Ada Lovelace' : undefined
    }
}

class Prices extends Component {
    //价格四舍五入到分
    @After(async function (this: Prices, price: number): Promise<number> {
        return Math.round(price * 100) / 100
    })
    public async withTax(price: number): Promise<number> {
        return price * 1.196
    }
}
```

## 5. 锁（`lakutata/com/mutex`）

`@Synchronized` 让控制器动作在持有 `Mutex` 组件的锁时执行，锁在输入校验和访问控制通过之后获取。见 [Mutex](Mutex.md)。

## 6. 数据库实体（`lakutata/decorator/orm`）

`lakutata/decorator/orm` 重新导出 TypeORM 的装饰器：

- 实体：`@Entity`、`@ViewEntity`、`@ChildEntity`、`@TableInheritance`、`@Unique`、`@Index`、`@Check`、`@Exclusion`。
- 列：`@Column`、`@PrimaryColumn`、`@PrimaryGeneratedColumn`、`@Generated`、`@ObjectIdColumn`、`@CreateDateColumn`、`@UpdateDateColumn`、`@DeleteDateColumn`、`@VersionColumn`、`@ViewColumn`、`@VirtualColumn`。
- 关系：`@OneToOne`、`@OneToMany`、`@ManyToOne`、`@ManyToMany`、`@JoinColumn`、`@JoinTable`、`@RelationId`。
- 树：`@Tree`、`@TreeChildren`、`@TreeParent`、`@TreeLevelColumn`。
- 监听器：`@BeforeInsert`、`@AfterInsert`、`@BeforeUpdate`、`@AfterUpdate`、`@BeforeRemove`、`@AfterRemove`、`@BeforeSoftRemove`、`@AfterSoftRemove`、`@BeforeRecover`、`@AfterRecover`、`@AfterLoad`、`@EventSubscriber`。

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

见 [ORMIntegration](ORMIntegration.md)。
