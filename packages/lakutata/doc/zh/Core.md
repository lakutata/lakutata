# Lakutata 核心

本指南介绍框架的核心（`@lakutata/core` 包，由 `lakutata`、`lakutata/decorator/di`、`lakutata/decorator/dto` 和 `lakutata/decorator/asst` 重新导出）：对象及其容器、生命周期类型与作用域、异步构造、依赖注入、在多个应用之间共享功能，以及应用的生命周期。更多细节见 `@lakutata/core` 的 README 和各导出的类型声明。

## 1. 对象与容器

应用中的每个对象都由 IoC 容器创建，从不使用 `new`。类的继承关系如下：

| 类 | 作用 | 默认生命周期 |
|---|---|---|
| `BaseObject` | 根类：异步构造、`init()`/`destroy()`、`getObject()` | `@Transient` |
| `Provider` | 存在于某个作用域（如一次请求）中的功能单元（仓储、哈希器等） | `@Scoped` |
| `Component` | 整个应用共享的长期服务（日志、数据库、入口等），同时是事件发射器 | `@Singleton`（锁定） |
| `Application` | 应用本身：声明组件、提供者和对象，由 `Application.run()` 创建 | |
| `Controller`（`lakutata/com/entrypoint`） | 处理入口请求的提供者 | `@Scoped`（锁定） |

### 生命周期类型

| 装饰器（`lakutata/decorator/di`） | 实例数量 |
|---|---|
| `@Singleton()` | 每个注册该类的容器一个，由它的使用者和它的作用域共享 |
| `@Scoped()` | 每个作用域一个（`container.createScope()`；入口的每次请求是一个作用域，根容器本身也是一个作用域） |
| `@Transient()` | 每次解析都新建，从不缓存 |

子类继承父类的生命周期类型。`Component` 锁定了自己的类型：子类声明其他类型会抛出 `LifetimeLockedException`；`Provider` 默认是 `@Scoped`，也可以声明为 `@Transient` 或 `@Singleton`（与 2.x 相同：一个实例由各作用域共享，例如 `@lakutata/nats` 的 `ServiceProxy`）；长期持有资源（连接、订阅、服务器）的对象更适合用 `Component`。单例注入作用域对象时，拿到的是创建它的那个作用域的实例。`@Lifetime('SINGLETON' | 'SCOPED' | 'TRANSIENT', lock)` 是这三个装饰器的完整写法。

### 作用域

作用域是一个子容器，持有自己的作用域对象实例，父容器的单例和注册项则是共享的。入口为每次请求创建一个作用域：该请求的控制器以及它注入的提供者都在其中创建，请求结束时一并销毁。组件可以通过受保护的 `createScope()` 创建自己的作用域。

## 2. 异步构造

容器以异步方式创建对象，`getObject()`（或 `@Inject`）返回的 Promise 在对象就绪后才完成：

1. 解析它的 `@Inject` 属性；
2. 为它的 `@Configurable` 属性赋予配置值，并由各自的校验规则校验（及转换）；未配置的属性保留其初始值，没有初始值时取校验规则的默认值；
3. 执行它的 `init()`（在此抛出的错误会导致创建失败）；
4. 执行它的 `startup()`。此时其他对象已经可以获取它，但要等 `startup()` 完成才拿到（失败时得到同样的错误）；例外是在 `startup()` 内部直接或经由它创建的对象去获取的一方，会立即拿到它，所以在那里获取的对象可以反过来注入它（入口就在 `startup()` 里启动各个适配器，适配器的钩子会获取一个注入了入口的 Authenticator）。方法叫 `startup` 而不是 `start`，是为了避免框架去启动那些自带 `start()` 方法的类（比如 `@lakutata/docker` 的容器）；
5. 应用启动完成（且对象已启动）后，执行它的 `launched()`（不会被等待，其错误会被记录到日志）。

销毁时（调用 `dispose()`，或创建它的对象、作用域、应用被销毁时），先等待 `startup()` 结束，再执行它的 `beforeDestroy()`，再销毁它创建的对象，最后执行它的 `destroy()`。每个对象都拥有自己的容器：通过 `this.getObject()` 创建的对象会随它一起销毁。

```typescript
import {Application, Component, DTO, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

class Mailer extends Component {
    //它的选项，由应用选项中的声明给出
    @Configurable(DTO.String().required())
    protected readonly host: string

    //未配置时为 25：初始值就是默认值，和配置值一样会被校验
    @Configurable(DTO.Number().integer().min(1).max(65535))
    protected readonly port: number = 25

    //lakutata 包预置的日志组件 "log"
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

## 3. 依赖注入

`@Inject`（来自 `lakutata/decorator/di`）在对象创建时、`init()` 之前为属性赋值：

- `@Inject()`：注入以属性名注册的对象；
- `@Inject('name')` 或 `@Inject(symbol)`：注入以该名称注册的对象；
- `@Inject(SomeClass)`：注入为该类注册的对象（`@Inject(Application)` 注入应用本身）；
- `@Inject('name', transform)`：注入 `transform(object)` 的返回值（可以是异步函数）。

标记了 `@Autoload()` 的类在第一次被请求时自动注册，而不是报错：单例注册到根容器，作用域类注册到最近的作用域，瞬态类注册到发起请求的容器。无法解析的注册项会使创建失败并抛出 `DependencyInjectionException`。

`@Configurable(schema, fn?)` 把属性声明为对象的选项：它的值来自对象的声明（`{class: Mailer, host: 'smtp.example.com'}`）或 `getObject()` 的第二个参数，经校验规则校验后，如果提供了 `fn` 再交给 `fn` 处理。应用在启动时会检查它声明的对象的选项：不合法的值会抛出 `InvalidObjectOptionsException` 并终止启动，不是可配置属性的选项会给出警告。

```typescript
import {Application, Component, Provider} from 'lakutata'
import {Autoload, Inject, Scoped} from 'lakutata/decorator/di'

//未在应用中声明：第一次被注入时自动注册
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

## 4. 在多个应用之间共享功能

多个应用都要用到的功能，做成一个包来共享。包导出一个 `Component`（或 `Provider`），再导出一个生成其声明的函数，框架自带的包都是这样做的（`lakutata/com/database` 的 `buildDatabaseOptions`、`lakutata/com/queue` 的 `buildQueueOptions`）。应用自己给组件起名，把选项传给这个函数；应用启动时，组件的 `@Configurable` 校验规则会检查这些选项，其他对象按这个名字注入该组件。

```typescript
import {Application, Component, type ComponentOptions, DTO} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'

//包里：组件，以及生成其声明的函数
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

//应用里
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

## 5. 应用

### 选项

`Application.run(options)`（或 `run(() => options)`，在启动时调用该函数，可以是异步的）接受以下选项：

| 选项 | 含义 |
|---|---|
| `id`、`name` | 必填。应用的 ID（同时作为 `process.title`）和名称（`app.appId`、`app.appName`） |
| `timezone` | IANA 时区名，或 `'auto'`（默认）表示使用系统时区；写入 `TZ` |
| `mode` | `'development'` 或 `'production'`，在环境变量未指定时生效（见下文） |
| `shutdownSignals` | 使应用优雅退出的信号（默认 `['SIGTERM', 'SIGINT']`），或 `false` |
| `components`、`providers` | 按名称声明的组件和提供者：`{class, ...options}` |
| `objects` | 其他对象：`{named: {...}, anonymous: [...]}` |
| `bootstrap` | 启动时依次执行的步骤：名称、symbol 或类（创建该对象），或以应用为参数调用的异步函数 |
| `checkOptions` | 启动时检查所声明对象的选项（默认 `true`） |

不带 `class` 的声明会补充框架预置的同名对象的选项：`lakutata` 包预置了 `log`（`Logger`）和 `entrypoint`（`Entrypoint`），因此 `log: {level: 'debug'}` 会设置预置日志组件的级别。`Application.preset(options)` 为进程中的所有应用预置对象。

### 链式 API

```typescript
import {Application, type ApplicationExitReason, type ILogger} from 'lakutata'

Application
    //环境变量，在启动时、调用选项函数之前设置
    .env({TZ_NAME: 'Asia/Shanghai'})
    //路径别名：传给 path.resolve() 或 app.alias.resolve() 的路径中的 '@data'；目录不存在时创建
    .alias({'@data': './data'}, true)
    .run(() => ({
        id: 'com.example.app',
        name: 'Example',
        components: {}
    }))
    //bootstrap 完成后调用（不会被等待）
    .onLaunched((app: Application, log: ILogger): void => log.info('%s launched in %s mode', app.appName, app.mode()))
    //应用退出时、对象销毁之前调用，会被等待
    .onDone(async (app: Application, log: ILogger, reason: ApplicationExitReason): Promise<void> => {
        log.info('%s done (exit code %d%s)', app.appName, reason.code, reason.signal ? `, ${reason.signal}` : '')
    })
    //进程中未捕获的异常，应用继续运行
    .onUncaughtException((error: Error, log: ILogger): void => log.warn(error.message))
    //启动失败：返回的数字作为退出码（未返回时为 1）
    .onFatalException((error: Error, log: ILogger): number => {
        log.error('Launch failed: %s', error.message)
        return 100
    })
```

`app.exit(code)` 以指定退出码优雅地结束应用；`app.exit(true)` 立即以退出码 2 结束进程，不执行 `onDone` 处理函数，也不销毁对象。

### 生命周期

1. 设置环境变量，注册路径别名（`@runtime` 为当前工作目录）。
2. 读取并校验选项；应用 ID、时区和运行模式。
3. 在新的根容器中创建应用：注册它的对象，并依次执行 `bootstrap`。
4. 执行 `onLaunched` 处理函数和各对象的 `launched()` 钩子。

- **启动失败**：应用无法启动时（选项不合法、对象初始化失败、bootstrap 步骤失败），由 `onFatalException` 的处理函数决定退出码（没有返回时为 1）。没有注册处理函数时，框架记录错误后以退出码 1 退出，和 Node.js 处理未捕获异常的方式一致，这样运行它的工具（Docker 的重启策略、Kubernetes、systemd、CI）都能知道启动失败了；已经创建的对象（正在监听的服务、数据库连接等）也不会让进程继续挂着。
- **退出信号**：收到 `SIGTERM`（`docker stop`、Kubernetes 滚动更新、systemd 停止服务）或 `SIGINT`（Ctrl+C）时，应用会优雅退出：先执行 `onDone` 处理函数，此时应用仍然完全可用（第三个参数说明退出原因：收到信号时是 `{code: 0, signal: 'SIGTERM'}`，调用 `app.exit(code)` 时是 `{code}`）；然后各入口停止接收新请求并等待正在处理的请求完成，各对象被销毁，最后以退出码 0 退出。如果再次收到信号（比如退出过程卡住了），或者信号是在应用启动期间收到的，进程会立即以 128 + 信号编号退出（`SIGTERM` 为 143，`SIGINT` 为 130）。选项 `shutdownSignals` 可以指定其他信号（如 `['SIGTERM', 'SIGINT', 'SIGHUP']`），设为 `false` 则交由 Node.js 处理。
- **运行模式**：`app.mode()` 返回 `'development'` 或 `'production'`。环境变量会覆盖代码里的配置，同一份构建产物可以在不同模式下运行：依次看环境变量 `MODE`、`NODE_ENV`，然后是选项 `mode`，都没有时为 `'development'`。不是这两个值的 `MODE` 会发出警告并被忽略，不是这两个值的 `NODE_ENV`（如 `test`）会被跳过。确定的模式会写回 `MODE` 和 `NODE_ENV`，第三方库读到的也是同一个模式。环境变量可以来自系统、`Application.env({MODE: 'production'})`，或者 Bun 读取的 `.env` 文件（指 `bun App.js` 这种运行方式；Bun 构建的可执行文件不会读取它）。
- **打包后的应用**：`isPackaged()`（来自 `lakutata`）表示应用是否以打包形式运行（`lakutata package bundle` 的打包产物或 `lakutata package exe` 的可执行文件）。应用运行时要读取的文件（Web 应用构建好的页面、模板、数据等）在 `package.json` 的 `lakutata.resources` 中声明，写法和 electron-builder 的 `extraResources` 一样：`[{"from": "../ui/dist", "to": "ui"}]`。打包后，`resourcesPath()` 返回这些文件所在的目录；未打包时返回 `undefined`，由应用到构建目录中查找：`const ui = resourcesPath() ? path.join(resourcesPath()!, 'ui') : uiBuildDirectory`。

## 6. 入口

`entrypoint` 组件（`lakutata/com/entrypoint`）通过 HTTP、CLI、服务传输、定时任务和消息队列对外提供控制器。用 `buildEntrypoints({controllers, http, cli, service, schedule, queue})` 配置它，并把它列入 `bootstrap`；详见 [ActionPattern](ActionPattern.md)。

## 7. 不使用应用的容器

测试、脚本和库可以不建应用，直接在一个容器里使用这些对象：

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
//按选项创建，并等待它的 init() 完成
const mailer: Mailer = await container.set(Mailer, {host: 'localhost'})
await mailer.send('someone@example.com', 'Hello')
//销毁它创建的所有对象
await container.destroy()
```

`container.register()`/`registerNamed()` 只注册类而不创建对象，`get()` 解析对象，`build()` 无论生命周期类型都新建一个对象，`createScope()` 创建作用域。
