# Lakutata 应用设计

本指南介绍如何组织 Lakutata 应用的结构：应用的各个部分应继承哪个类、逻辑和状态应放在哪里、配置如何传递到各个对象、对象的创建顺序，以及如何测试应用。这些建议与项目模板和[示例](examples/README.md)的做法一致；其所依据的模型见[核心概念](Concepts.md)。

## 1. 应用的组成部分

| 部分 | 类 | 目录 | 职责 |
|---|---|---|---|
| 动作 | `Controller` | `controllers/` | 接收请求中已校验的输入，调用完成工作的对象，返回结果 |
| 服务与资源 | `Component` | `components/` | 跨请求共享的状态、多个动作共用的逻辑、连接、文件、定时器 |
| 请求内的功能单元 | `Provider` | | 一次请求的状态，例如已登录的用户（[中间件与访问控制](Middlewares.md)第 3 节） |
| 拥有自身对象的功能 | `Module` | | 通过一个对象访问的一组对象（[模块](Modules.md)） |
| 契约 | `DTO` | `dtos/` | 动作的输入、队列的消息、结果的结构 |
| 错误 | `Exception` | `exceptions/` | 应用的错误，每个错误带有 `errno`，面向 HTTP 客户端时还带有 `statusCode` |
| 数据 | 实体、迁移 | `entities/`、`migrations/` | 数据库中的表及其变更（[实体、查询与事务](Entities.md)） |
| 横切规则 | 中间件 | `middlewares/` | 适用于多个动作的身份认证、语言、访问控制 |
| 普通函数 | 无 | `lib/` | 不需要容器参与的计算 |
| 选项 | `config()` | `config/` | 从环境中读取的应用选项 |

`default` 模板会创建 `controllers/`、`dtos/`、`config/` 和 `tests/`；`service` 和 `web-*` 模板另有 `middlewares/`，桌面应用模板另有 `components/`，示例则按需增加其他目录。

## 2. 逻辑与状态的归属

控制器只在一次请求中存在，因此无法在请求之间保存任何内容。动作通过其 DTO 校验输入，调用完成工作的对象，并返回其结果：

- **跨请求保存的状态**（条目列表、缓存、文件中的数据）应放在组件中，即所有请求共享的唯一实例。
- **多个动作或多种传输方式共用的逻辑**应放在组件中，使每个动作无论通过哪种传输方式调用，都只是对组件的一次调用。
- **资源**（连接、服务器、定时器、设备）应放在组件中：组件在 `init()` 或 `startup()` 中打开资源，在 `destroy()` 中释放资源。
- **需要在测试中替换的代码**应放在组件中，测试可以获取该组件并替换其方法，或改用另一个类。
- **一次请求的状态**应放在提供者中，提供者为该请求创建，并随请求一起销毁。

如果某项工作只属于一个动作，例如[带数据库的 REST API](examples/RestAPI.md) 示例中的查询，或[手机应用](examples/MobileApp.md)示例中的月度汇总，动作可以直接在保存状态的数据库仓储上完成这项工作。一旦这项工作需要被共用、需要在请求之间保存状态或需要在测试中替换，就应将其移入组件。

依赖平台功能（窗口、剪贴板、原生模块）的组件，应通过选项或一个单独的小组件获得这些功能，使应用的其余部分可以脱离该平台运行和测试（[用 NW.js 开发托盘应用](examples/TrayApp.md)）。

## 3. 为对象选择类

1. 为请求提供服务：使用 `Controller`。
2. 在应用的整个生命周期内保存状态或资源，或其他对象需要监听其事件：使用 `Component`。
3. 状态属于一次请求或另一个作用域：使用 `Provider`。
4. 每个使用者都需要各自的实例：使用继承 `BaseObject` 的类，该类为瞬态。
5. 将多个对象组织在一起，使应用的其他部分只通过一个对象访问它们：使用 `Module`。
6. 不需要容器参与：在 `lib/` 中编写普通的函数或类。

## 4. 示例：订单服务

下文示例中的服务通过 HTTP 创建和查询订单。它以 `default` 模板为基础，增加了一个管理订单的组件；为保持简短，订单保存在内存中，[带数据库的 REST API](examples/RestAPI.md) 示例则将数据保存在数据库中。

```
src/
  App.ts                              启动应用（与模板相同）
  config/Config.ts                    应用的选项
  components/Orders.ts                订单，由所有请求共享
  controllers/OrderController.ts      动作
  dtos/OrderDTO.ts                    动作的输入
  exceptions/OrderNotFoundException.ts
  tests/App.spec.ts                   通过 HTTP 测试整个应用
  tests/Orders.spec.ts                单独测试组件
```

`src/dtos/OrderDTO.ts`：

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class CreateOrderDTO extends DTO {
    @Expect(DTO.String().trim().min(1).max(100).required())
    public product: string

    @Expect(DTO.Number().integer().min(1).max(1000).default(1))
    public quantity: number
}

export class OrderIdDTO extends DTO {
    //来自路由（/orders/:id）的字符串，转换为数字
    @Expect(DTO.Number().integer().min(1).required().strict(false))
    public id: number
}
```

`src/exceptions/OrderNotFoundException.ts`：

```typescript
import {Exception} from 'lakutata'

export class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'

    public readonly statusCode: number = 404
}
```

`src/components/Orders.ts` 保存订单。它是唯一修改订单的对象，并在每次创建订单时发出事件，供其他组件监听：

```typescript
import {Component} from 'lakutata'
import {OrderNotFoundException} from '../exceptions/OrderNotFoundException.js'

export interface Order {
    id: number
    product: string
    quantity: number
}

//应用的订单：只有一个实例，由所有请求共享
export class Orders extends Component {
    readonly #orders: Map<number, Order> = new Map()

    #lastId: number = 0

    public create(product: string, quantity: number): Order {
        const order: Order = {id: ++this.#lastId, product: product, quantity: quantity}
        this.#orders.set(order.id, order)
        this.emit('order.created', order)
        return order
    }

    public find(id: number): Order {
        const order: Order | undefined = this.#orders.get(id)
        if (!order) throw new OrderNotFoundException('Order {id} not found', {id: id})
        return order
    }
}
```

`src/controllers/OrderController.ts` 将请求转换为对组件的调用：

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {GET, POST} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {type Order, Orders} from '../components/Orders.js'
import {CreateOrderDTO, OrderIdDTO} from '../dtos/OrderDTO.js'

export class OrderController extends Controller {
    @Inject('orders')
    protected readonly orders: Orders

    @POST('/orders', CreateOrderDTO)
    public async create(input: CreateOrderDTO): Promise<Order> {
        return this.orders.create(input.product, input.quantity)
    }

    @GET('/orders/:id', OrderIdDTO)
    public async find(input: OrderIdDTO): Promise<Order> {
        return this.orders.find(input.id)
    }
}
```

`src/config/Config.ts` 声明各个对象：

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {Orders} from '../components/Orders.js'
import {OrderController} from '../controllers/OrderController.js'

/**
 * 应用的选项
 * @param port HTTP 服务器的端口：PORT 环境变量，默认为 8080。
 */
export function config(port: number = Number(process.env.PORT ?? 8080)): ApplicationOptions {
    return {
        id: 'com.example.orders',
        name: 'Orders',
        components: {
            orders: {class: Orders},
            entrypoint: buildEntrypoints({
                controllers: [OrderController],
                http: expressHTTPEntrypoint({port: port})
            })
        },
        bootstrap: ['entrypoint']
    }
}
```

```text
$ curl -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{"product":"tea","quantity":2}'
{"id":1,"product":"tea","quantity":2}
$ curl localhost:8080/orders/1
{"id":1,"product":"tea","quantity":2}
$ curl -i localhost:8080/orders/7
HTTP/1.1 404 Not Found
{"errno":"E_ORDER_NOT_FOUND","errMsg":"Order 7 not found"}
$ curl -i -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{"quantity":0}'
HTTP/1.1 400 Bad Request
{"errno":"E_INVALID_VALUE","errMsg":"\"product\" is required"}
```

为这些动作加上其他传输方式的装饰器和适配器，即可通过其他传输方式提供同样的服务，而无需修改组件（[控制器与动作](Controllers.md)）。

## 5. 配置

应用的配置按一个方向传递：

1. **环境**提供在不同部署之间变化的值：`PORT`、数据库地址、令牌。
2. **`config()`** 以带默认值的参数读取这些值（`port = Number(process.env.PORT ?? 8080)`），并返回应用的选项。由于它是一个函数，测试可以用其所需的取值调用它：端口、内存数据库、临时目录。
3. **这些选项中的声明**为每个对象提供其选项：`{class: Orders}`，或 `{class: Mailer, host: 'smtp.example.com'}`。
4. **每个对象的 `@Configurable` 属性**接收这些选项，并在应用启动时由各自的校验规则校验（[依赖注入](Injection.md)第 2 节）。

在 `config()` 中读取环境变量，测试即可通过参数传入所需的取值，模板对端口的处理正是如此（[项目结构](ProjectStructure.md)第 1 节）。运行模式（`development` 或 `production`）来自 `MODE` 或 `NODE_ENV` 环境变量（[应用](Application.md)第 4 节）。

## 6. 创建顺序与 bootstrap

对象在首次被其他对象请求时创建。`bootstrap` 按顺序列出启动时必须存在的对象，应用在这些步骤全部完成后才算启动完成：

- 动作在第一个请求到来之前就需要的对象，应排在入口之前；入口负责启动服务器和其他适配器。REST API 示例使用 `bootstrap: ['database', 'entrypoint']`，先连接并迁移数据库；
- 依赖动作的对象应排在入口之后：在桌面应用示例中，窗口加载用户界面之前，动作已经可以调用（`['entrypoint', 'notes', 'window']`）；
- 只为请求提供服务的组件（例如上文的 `orders`）不需要列入：第一个请求会创建它；
- 独立工作的组件（轮询器、窗口、托盘图标）应列入，因为没有其他对象会创建它。

无论是否列入 `bootstrap`，应用都会在启动时检查所有已声明对象的选项。

## 7. 测试

模板的测试在编译后的文件上用 `node --test` 运行（`npm test`）。

**整个应用。** 测试用 `config()` 和专用的端口启动应用，等待启动完成后发送请求，最后销毁应用：

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import {config} from '../config/Config.js'

const PORT: number = 18090

describe('Orders', (): void => {
    let app: Application

    before(async (): Promise<void> => {
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config(PORT)).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
    })

    it('creates an order and finds it', async (): Promise<void> => {
        const created: Response = await fetch(`http://127.0.0.1:${PORT}/orders`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({product: 'tea', quantity: 2})
        })
        assert.deepStrictEqual(await created.json(), {id: 1, product: 'tea', quantity: 2})
        const found: Response = await fetch(`http://127.0.0.1:${PORT}/orders/1`)
        assert.deepStrictEqual(await found.json(), {id: 1, product: 'tea', quantity: 2})
    })

    it('responds with 404 for an unknown order', async (): Promise<void> => {
        const response: Response = await fetch(`http://127.0.0.1:${PORT}/orders/99`)
        assert.strictEqual(response.status, 404)
    })
})
```

**单个对象。** 不依赖其他对象的组件可以在容器中单独测试，无需应用：

```typescript
import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from 'lakutata'
import {Orders} from '../components/Orders.js'
import {OrderNotFoundException} from '../exceptions/OrderNotFoundException.js'

describe('Orders component', (): void => {
    it('throws OrderNotFoundException for an unknown order', async (): Promise<void> => {
        const container: Container = new Container()
        const orders: Orders = await container.set(Orders)
        orders.create('tea', 1)
        assert.strictEqual(orders.find(1).product, 'tea')
        assert.throws((): unknown => orders.find(2), OrderNotFoundException)
        await container.destroy()
    })
})
```

**替换依赖。** 测试可以从已启动的应用中获取组件（`app.getObject('orders')`），并用 `t.mock.method()` 替换其某个方法，[后台任务](examples/BackgroundJobs.md)示例即采用这种做法。应用所调用的服务可以替换为替身，替身在测试进程中的一个 `Container` 内启动，参见[服务之间的调用](examples/ServiceCalls.md)示例。模块内部的对象可以通过模块声明中的选项替换（[模块](Modules.md)第 4 节）。

## 8. 应用的扩展

- **由多个对象组成的功能**可以作为模块，应用的其他部分通过一个对象访问它（[模块](Modules.md)）。
- **在多个应用之间共享的功能**可以作为包，导出一个组件以及生成其声明的函数（[依赖注入](Injection.md)第 3 节）。
- **带有用户界面的应用**采用工作区结构：应用位于 `packages/app`，界面位于 `packages/ui`；对于移动端模板，两者之间的通道位于 `packages/ipc`（[项目结构](ProjectStructure.md)第 2 节）。
- **相互调用的服务**不共享代码：动作的模式和消息的结构构成它们之间的契约（[服务之间的调用](examples/ServiceCalls.md)）。
