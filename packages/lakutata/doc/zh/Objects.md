# Lakutata 对象与生命周期

应用中的每个对象（组件、提供者、控制器）都由 IoC 容器创建，从不使用 `new`。本页介绍这些对象的类、生命周期类型与作用域、对象如何创建和销毁，以及如何不建应用直接使用它们。它们来自 `@lakutata/core` 包，由 `lakutata`、`lakutata/decorator/di`、`lakutata/decorator/dto` 和 `lakutata/decorator/asst` 重新导出；更多细节见 `@lakutata/core` 的 README 和各导出的类型声明。

## 1. 类

| 类 | 作用 | 默认生命周期 |
|---|---|---|
| `BaseObject` | 根类：异步构造、`init()`/`destroy()`、`getObject()` | `@Transient` |
| `Provider` | 存在于某个作用域（如一次请求）中的功能单元（仓储、哈希器等） | `@Scoped` |
| `Component` | 整个应用共享的长期服务（日志、数据库、入口等），同时是事件发射器 | `@Singleton`（锁定） |
| `Application` | 应用本身：声明组件、提供者和对象，由 `Application.run()` 创建 | |
| `Controller`（`lakutata/com/entrypoint`） | 处理入口请求的提供者 | `@Scoped`（锁定） |

## 2. 生命周期类型

| 装饰器（`lakutata/decorator/di`） | 实例数量 |
|---|---|
| `@Singleton()` | 每个注册该类的容器一个，由它的使用者和它的作用域共享 |
| `@Scoped()` | 每个作用域一个（`container.createScope()`；入口的每次请求是一个作用域，根容器本身也是一个作用域） |
| `@Transient()` | 每次解析都新建，从不缓存 |

子类继承父类的生命周期类型。`Component` 锁定了自己的类型：子类声明其他类型会抛出 `LifetimeLockedException`。`Provider` 默认是 `@Scoped`，也可以声明为 `@Transient` 或 `@Singleton`（与 2.x 相同：一个实例由各作用域共享，例如 `@lakutata/nats` 的 `ServiceProxy`）；长期持有资源（连接、订阅、服务器）的对象更适合用 `Component`。单例注入作用域对象时，拿到的是创建它的那个作用域的实例。`@Lifetime('SINGLETON' | 'SCOPED' | 'TRANSIENT', lock)` 是这三个装饰器的完整写法。

## 3. 作用域

作用域是一个子容器，持有自己的作用域对象实例，父容器的单例和注册项则是共享的。入口为每次请求创建一个作用域：该请求的控制器以及它注入的提供者都在其中创建，请求结束时一并销毁。组件可以通过受保护的 `createScope()` 创建自己的作用域。

## 4. 创建与销毁

容器以异步方式创建对象，`getObject()`（或 `@Inject`）返回的 Promise 在对象就绪后才完成。创建依次经过以下步骤：

1. 解析它的 `@Inject` 属性；
2. 为它的 `@Configurable` 属性赋予配置值，并由各自的校验规则校验（及转换）；未配置的属性保留其初始值，没有初始值时取校验规则的默认值；
3. 执行它的 `init()`（在此抛出的错误会导致创建失败）；
4. 执行它的 `startup()`。此时其他对象已经可以获取它，但要等 `startup()` 完成才拿到（失败时得到同样的错误）；例外是在 `startup()` 内部直接或经由它创建的对象去获取的一方，会立即拿到它，所以在那里获取的对象可以反过来注入它（入口就在 `startup()` 里启动各个适配器，适配器的钩子会获取一个注入了入口的 Authenticator）。方法叫 `startup` 而不是 `start`，是为了避免框架去启动那些自带 `start()` 方法的类（比如 `@lakutata/docker` 的容器）；
5. 应用启动完成（且对象已启动）后，执行它的 `launched()`（不会被等待，其错误会被记录到日志）。

销毁时（调用 `dispose()`，或创建它的对象、作用域、应用被销毁时），先等待 `startup()` 结束，再执行它的 `beforeDestroy()`，再销毁它创建的对象，最后执行它的 `destroy()`。每个对象都拥有自己的容器：通过 `this.getObject()` 创建的对象会随它一起销毁。

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

它依次记录 `init`、`startup`、`launched` 和 `onLaunched`。按下 Ctrl+C 后，依次记录 `onDone`、`beforeDestroy` 和 `destroy`，然后进程退出。

## 5. 不使用应用的容器

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
