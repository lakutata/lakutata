# Lakutata 对象与生命周期

应用中的每个对象（组件、提供者、控制器）都由 IoC 容器创建，从不使用 `new`。本指南介绍这些对象的类、生命周期类型与作用域、对象的创建与销毁，以及如何在不创建应用的情况下使用这些对象。这些类来自 `@lakutata/core` 包，由 `lakutata`、`lakutata/decorator/di`、`lakutata/decorator/dto` 和 `lakutata/decorator/asst` 重新导出；更多细节见 `@lakutata/core` 的 README 和各导出的类型声明。

## 1. 类

| 类 | 作用 | 默认生命周期类型 |
|---|---|---|
| `BaseObject` | 根类：异步构造、`init()`/`destroy()`、`getObject()` | `@Transient` |
| `Provider` | 存在于某个作用域（如一次请求）中的功能单元（仓储、哈希器等） | `@Scoped` |
| `Component` | 整个应用共享的长期服务（日志、数据库、入口等），同时是事件发射器 | `@Singleton`（锁定） |
| `Module` | 声明自身组件、提供者和对象的组件（[模块](Modules.md)） | `@Singleton`（锁定） |
| `Application` | 根模块：声明组件、提供者和对象，由 `Application.run()` 创建 | |
| `Controller`（`lakutata/com/entrypoint`） | 处理入口请求的提供者 | `@Scoped`（锁定） |

这些类之间的继承关系以及各自的设计用意见[核心概念](Concepts.md)。

## 2. 生命周期类型

| 装饰器（`lakutata/decorator/di`） | 实例数量 |
|---|---|
| `@Singleton()` | 每个注册该类的容器一个，由其所有使用者（包括该容器的作用域）共享 |
| `@Scoped()` | 每个作用域一个（`container.createScope()`；入口的每次请求是一个作用域）；在作用域之外，注册该类的容器共享一个实例 |
| `@Transient()` | 每次解析都新建，从不缓存 |

子类继承父类的生命周期类型。`Component` 锁定了其生命周期类型：子类若声明其他类型，会抛出 `LifetimeLockedException`。`Provider` 默认是 `@Scoped`，也可以声明为 `@Transient` 或 `@Singleton`（与 2.x 相同：一个实例由各作用域共享，例如 `@lakutata/nats` 的 `ServiceProxy`）；长期持有资源（连接、订阅、服务器）的对象更适合写成 `Component`。单例注入作用域对象时，会得到注册该作用域类的容器所持有的实例（对于应用声明的提供者，即应用容器中的实例），而非某次请求的实例；即使该单例是在请求过程中首次被获取，也是如此。`@Lifetime('SINGLETON' | 'SCOPED' | 'TRANSIENT', lock)` 是这三个装饰器的完整写法。

## 3. 作用域

作用域是一个子容器，持有自身的作用域对象实例，并共享父容器的单例和注册项。入口为每次请求创建一个作用域：该请求的控制器及其注入的提供者都在其中创建，请求结束时一并销毁。组件可以通过受保护的 `createScope()` 创建自身的作用域。不再需要这样的作用域时应将其销毁；否则它会随组件一起销毁。

## 4. 创建与销毁

容器以异步方式创建对象，`getObject()`（或 `@Inject`）返回的 Promise 在对象就绪后才完成。创建依次经过以下步骤：

1. 解析其 `@Inject` 属性；
2. 为其 `@Configurable` 属性赋予配置值，并由各自的校验规则校验（及转换）；未配置的属性保留其初始值，没有初始值时取校验规则的默认值；
3. 执行其 `init()`（在此抛出的错误会导致创建失败）；
4. 执行其 `startup()`。此时其他对象已经可以获取该对象，但需等待 `startup()` 完成（失败时，获取方收到同一错误）。例外是在 `startup()` 内部直接或经由其创建的对象发起的请求：请求方会立即得到该对象，因此在其中获取的对象可以反过来注入它。例如，入口在 `startup()` 中启动各个适配器，适配器的钩子会获取一个注入了入口的 Authenticator。该方法命名为 `startup` 而非 `start`，是为了避免框架启动那些自带 `start()` 方法的类（例如 `@lakutata/docker` 的容器）；
5. 应用启动完成（且对象已启动）后，执行其 `launched()`（不会被等待，其错误会被记录到日志）。

对象在调用 `dispose()` 时销毁，或随拥有它的对象、作用域或应用一起销毁。销毁过程先等待 `startup()` 结束，然后执行 `beforeDestroy()`，接着销毁该对象所拥有的对象，最后执行 `destroy()`。

每个对象都拥有自身的容器。对象所拥有的对象包括：通过 `this.getObject()` 获取的瞬态对象、通过 `getObject()` 的第二个参数带选项请求的作用域对象，以及通过 `buildObject()` 创建的对象。单例以及作用域内共享的作用域实例属于注册它们的容器，不会随请求它们的对象一起销毁。

销毁一个容器时（例如请求结束、应用停止），先并发执行其中所有对象的 `beforeDestroy()`，然后销毁这些对象；销毁的先后顺序不固定，即使对象之间存在依赖关系也是如此。因此，对象应在 `beforeDestroy()` 中停止使用其依赖，在 `destroy()` 中只释放自身的资源。

```typescript
import {Application, Component, type ILogger} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'

class Poller extends Component {
    @Inject('log')
    protected readonly log: ILogger

    protected timer: NodeJS.Timeout

    //依赖已注入，选项已设置
    protected async init(): Promise<void> {
        this.log.info('init')
    }

    //其他对象此时已经可以获取它，但要等这里结束
    protected async startup(): Promise<void> {
        this.timer = setInterval((): void => this.log.info('polling'), 10000)
        this.log.info('startup')
    }

    //应用已启动（不会被等待）
    protected async launched(): Promise<void> {
        this.log.info('launched')
    }

    //开始销毁：它创建的对象还在
    protected async beforeDestroy(): Promise<void> {
        this.log.info('beforeDestroy')
    }

    //销毁的最后一步：它创建的对象已被销毁
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

该示例先记录 `init` 和 `startup`，再记录 `launched` 和 `onLaunched`，后两者之间的先后顺序不固定。按下 Ctrl+C 后，依次记录 `onDone`、`beforeDestroy` 和 `destroy`，然后进程退出。

## 5. 不使用应用的容器

测试、脚本和库可以不创建应用，直接在容器中使用这些对象：

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

`container.register()`/`registerNamed()` 只注册类而不创建对象，`get()` 解析对象，`build()` 无论生命周期类型如何，都会新建一个对象，`createScope()` 创建作用域。
