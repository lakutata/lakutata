# Lakutata 依赖注入

对象不自己创建它所依赖的对象，而是声明这些依赖，由容器在创建它时注入。本页介绍 `@Inject` 和 `@Autoload`、对象的选项（`@Configurable`），以及如何把功能做成包、在多个应用之间共享。这些装饰器的全部规则见 [Decorator](Decorator.md) 第 1 节。

## 1. 注入对象

`@Inject`（来自 `lakutata/decorator/di`）在对象创建时、`init()` 之前为属性赋值：

- `@Inject()`：注入以属性名注册的对象；
- `@Inject('name')` 或 `@Inject(symbol)`：注入以该名称注册的对象；
- `@Inject(SomeClass)`：注入为该类注册的对象（`@Inject(Application)` 注入应用本身）；
- `@Inject('name', transform)`：注入 `transform(object)` 的返回值（可以是异步函数）。

标记了 `@Autoload()` 的类在第一次被请求时自动注册，而不是报错：单例注册到根容器，作用域类注册到最近的作用域，瞬态类注册到发起请求的容器。依赖无法解析时，创建失败，抛出 `DependencyInjectionException`。

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

本身不是容器中对象的代码（比如 `onLaunched` 处理函数）用 `app.getObject(name)` 获取对象；`app.getObject(SomeClass)` 只适用于单独注册的类（比如自动注册的类），不适用于按名称声明的组件。

## 2. 选项

`@Configurable(schema, fn?)` 把属性声明为对象的选项：它的值来自对象的声明（`{class: Mailer, host: 'smtp.example.com'}`）或 `getObject()` 的第二个参数，经校验规则校验后，如果提供了 `fn` 再交给 `fn` 处理。应用在启动时会检查它声明的对象的选项：不合法的值会抛出 `InvalidObjectOptionsException` 并终止启动，不是可配置属性的选项会给出警告。

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

取值的先后顺序（配置的值、初始值、校验规则的默认值）以及启动时的检查，见 [Decorator](Decorator.md) 第 1.2 节。

## 3. 在多个应用之间共享功能

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
