# Lakutata 模块

**模块**是声明自身组件、提供者和对象的组件，声明方式与应用相同。模块中的对象先在模块内、再到应用中解析依赖；应用中的其他对象无法注入这些对象，只能通过模块本身使用该功能。本指南介绍如何声明模块、模块中对象的解析方式、模块的创建、如何从应用中配置模块，以及何时使用模块。`Module` 和 `ModuleOptions` 由 `lakutata` 导出。

## 1. 声明模块

模块继承 `Module`，并在其 `options` 属性的初始值中给出自身的声明。这些选项的形式与应用选项相同：`components`、`providers`、`objects`、`bootstrap` 和 `checkOptions`。

```typescript
import {Application, Component, type ILogger, Module, type ModuleOptions} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'

//模块中的对象
class Gateway extends Component {
    public async charge(amount: number): Promise<string> {
        return `${amount} charged`
    }
}

class Payments extends Component {
    //由模块声明
    @Inject('gateway')
    protected readonly gateway: Gateway

    //模块未声明：在应用中查找
    @Inject('log')
    protected readonly log: ILogger

    public async pay(amount: number): Promise<string> {
        const receipt: string = await this.gateway.charge(amount)
        this.log.info('Payment: %s', receipt)
        return receipt
    }
}

//模块在其选项的初始值中声明自身的对象，方式与应用相同
export class PaymentModule extends Module {
    protected options: ModuleOptions = {
        components: {
            gateway: {class: Gateway},
            payments: {class: Payments}
        },
        bootstrap: ['gateway']
    }

    //供应用的其他部分调用的方法
    public async pay(amount: number): Promise<string> {
        const payments: Payments = await this.getObject<Payments>('payments')
        return await payments.pay(amount)
    }
}

//应用中的对象：注入模块本身，而不是模块内部的对象
class Checkout extends Component {
    @Inject('payment')
    protected readonly payment: PaymentModule

    public async checkout(amount: number): Promise<string> {
        return await this.payment.pay(amount)
    }
}

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            checkout: {class: Checkout}
        },
        objects: {
            named: {
                payment: {class: PaymentModule}
            }
        },
        bootstrap: ['payment']
    }))
    .onLaunched(async (app: Application, log: ILogger): Promise<void> => {
        const checkout: Checkout = await app.getObject<Checkout>('checkout')
        log.info('Checkout: %s', await checkout.checkout(42))
    })
```

```text
INFO (Shop/…): Payment: 42 charged
INFO (Shop/…): Checkout: 42 charged
```

- 应用在 `objects.named` 中声明模块。如果在 `components` 中声明，启动会失败并抛出 `InvalidObjectTypeException`，其消息会提示改用 `objects.named`。
- `bootstrap: ['payment']` 在启动时创建模块；否则模块在首次被其他对象请求时创建。随后，模块自身的 `bootstrap` 依次创建其对象，与应用的 `bootstrap` 相同。
- 模块是单例，其生命周期类型已锁定。模块也是组件，因此具有组件的事件和方法；其 `getObject()` 是公开的，模块之外的代码可以通过该方法获取模块中的对象。

## 2. 模块中对象的解析方式

- **在模块内部**，名称先在模块中查找，再到应用中查找：`Payments` 在模块中找到 `gateway`，在应用中找到 `log`。对于模块中的对象，模块声明的名称会遮蔽应用中的同名对象。
- **在模块外部**，应用中的对象只能看到模块本身：`app.getObject('gateway')` 会失败，注入 `gateway` 的应用对象在创建时会抛出 `DependencyInjectionException`。
- **模块本身**对其内部对象可见：它们可以按名称注入模块（`@Inject('payment')`），`this.getModule()` 也会返回该模块。
- **应用中的单例**仍属于应用：模块中的对象获取这样的单例时，得到的是应用中的实例，其依赖也在应用中解析。

## 3. 创建与销毁

创建模块时，先注册其声明并检查其选项（与应用检查自身选项的方式相同），再依次执行其 `bootstrap` 步骤。模块自身的 `init()` 和 `startup()` 在其 bootstrap 之后执行，因此 bootstrap 中的步骤不应依赖模块在 `init()` 中完成的工作。

模块之外的对象请求模块时，会等待模块的 bootstrap 完成；如果某个步骤失败，请求方会收到该错误。对于应用而言，这样的错误会导致启动失败。由模块的 bootstrap 创建的模块内部对象会立即得到模块，因此它们可以注入模块本身。模块随创建它的容器一起销毁，模块中的对象也随之销毁。

## 4. 从应用中配置模块

模块的声明接受一个 `options` 选项，该选项会合并到模块的初始值之上：

```typescript
objects: {
    named: {
        payment: {
            class: PaymentModule,
            //同名组件替换初始值中的组件
            options: {components: {gateway: {class: TestGateway}}}
        }
    }
}
```

- 以初始值中某个组件或提供者的名称声明的组件或提供者会替换它；不带 `class` 的声明则补充初始值中同名对象的选项。
- `bootstrap` 步骤追加在初始值的步骤之后。
- 在此处设置的 `checkOptions` 优先于初始值中的设置。

因此，应用或测试可以在不修改模块的情况下替换模块内部的对象。

## 5. 何时使用模块

模块适用于由多个对象组成、而应用的其他部分只应通过一个对象访问的功能：模块使该功能的对象不进入应用的命名空间，并为该功能的声明提供一个集中的位置。只由一个对象构成的功能应作为组件；若要在多个应用之间共享这样的组件，可以由一个包导出该组件以及生成其声明的函数（[依赖注入](Injection.md)第 3 节）。
