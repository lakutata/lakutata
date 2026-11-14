# 服务之间的调用

本示例构建两个服务，其中一个服务调用另一个服务。`inventory`（库存服务）保存产品的库存，并通过服务动作将库存提供给其他服务；`orders`（订单服务）有一个用于下单的 HTTP API，并通过代理在库存服务中为订单预留库存。两个服务都从 `service` 模板开始。示例展示了服务动作及其模式、HTTP 服务传输方式和调用该传输方式的代理、两个服务共用的令牌、库存服务拒绝订单时错误如何传到客户端，以及每个服务各自的测试。

| 服务 | 调用 | 作用 |
|---|---|---|
| `inventory` | `{"resource": "stock", "act": "get", "product": "lamp"}` | 查询一种产品的库存数量 |
| `inventory` | `{"resource": "stock", "act": "reserve", "order": "<id>", "items": [{"product": "lamp", "quantity": 2}]}` | 为订单的各项预留库存，要么全部预留，要么一项都不预留 |
| `orders` | `POST /orders` | 下单：`{"items": [{"product": "lamp", "quantity": 2}]}` |

## 1. 创建项目

```bash
npx @lakutata/cli create --name inventory --template service --yes
npx @lakutata/cli create --name orders --template service --yes
rm inventory/packages/app/src/controllers/ExampleController.ts inventory/packages/app/src/dtos/GreetDTO.ts
rm orders/packages/app/src/controllers/ExampleController.ts orders/packages/app/src/dtos/GreetDTO.ts
```

两个项目并排放置，每个项目都是一个工作区，服务位于 `packages/app` 中（见[项目结构](../ProjectStructure.md)）；下面的路径均以所属项目的名称开头。两个项目不共享代码，动作的模式和消息的结构即为两者之间的约定。本例无需安装任何包，因为 HTTP 服务传输方式及其代理都是 `lakutata` 自带的。

## 2. 库存

**`inventory/packages/app/src/exceptions/StockExceptions.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * 调用中指定的产品不存在
 */
export class ProductNotFoundException extends Exception {
    public errno: string = 'E_PRODUCT_NOT_FOUND'

    public readonly statusCode: number = 404
}

/**
 * 产品的库存少于要求的数量
 */
export class OutOfStockException extends Exception {
    public errno: string = 'E_OUT_OF_STOCK'

    public readonly statusCode: number = 409
}
```

每个异常都有各自的 `errno` 和状态码（见[异常](../Exceptions.md)）。异常的消息在抛出时给出。

**`inventory/packages/app/src/components/Stock.ts`**

```typescript
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {OutOfStockException, ProductNotFoundException} from '../exceptions/StockExceptions.js'

export type StockItem = { product: string, quantity: number }

export type StockLevel = { product: string, available: number }

/**
 * 产品的库存（保存在内存中），以及已经预留了库存的订单
 */
export class Stock extends Component {

    /**
     * 启动时每种产品的数量
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.Number().integer().min(0)).default({}))
    protected readonly products: Record<string, number>

    /**
     * 每种产品的可用数量
     */
    protected readonly levels: Map<string, number> = new Map()

    /**
     * 已经预留的订单，以及预留后剩下的库存
     */
    protected readonly reserved: Map<string, StockLevel[]> = new Map()

    protected async init(): Promise<void> {
        Object.entries(this.products).forEach(([product, quantity]: [string, number]): unknown => this.levels.set(product, quantity))
    }

    /**
     * 一种产品的可用数量
     * @param product
     */
    public level(product: string): StockLevel {
        const available: number | undefined = this.levels.get(product)
        if (available === undefined) throw new ProductNotFoundException('The product {product} does not exist', {product: product})
        return {product: product, available: available}
    }

    /**
     * 为订单的各项预留库存：要么全部预留，要么一项都不预留
     * @param order
     * @param items
     */
    public reserve(order: string, items: StockItem[]): StockLevel[] {
        //已经预留过的订单（重发的调用）不会再预留一次
        const done: StockLevel[] | undefined = this.reserved.get(order)
        if (done) return done
        for (const item of items) {
            const available: number = this.level(item.product).available
            if (available < item.quantity) throw new OutOfStockException('{product}: {quantity} asked, {available} in stock', {...item, available: available})
        }
        const levels: StockLevel[] = items.map((item: StockItem): StockLevel => {
            this.levels.set(item.product, this.level(item.product).available - item.quantity)
            return this.level(item.product)
        })
        this.reserved.set(order, levels)
        return levels
    }
}
```

- 库存是一个组件（见[对象与生命周期](../Objects.md)）：整个服务只有一个实例，而控制器只存在于一个请求之内。库存保存在内存中，初始数量来自组件的 `products` 选项（一个 `@Configurable` 属性），由 `init()` 复制。
- `reserve()` 在修改库存之前先检查每一项，因此订单要么整体预留成功，要么完全不预留。
- 订单的 ID 保证同一个订单只预留一次：同一个调用再次发送时（例如在超时之后），得到的结果相同，也不会多预留库存。
- `OutOfStockException` 的消息由随该异常传入的值生成：`desk: 5 asked, 2 in stock`。

## 3. 服务动作

**`inventory/packages/app/src/dtos/StockDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * 一种产品
 */
export class ProductDTO extends DTO {
    @Expect(DTO.String().required())
    public product: string
}

/**
 * 一种产品的数量
 */
export class StockItemDTO extends ProductDTO {
    @Expect(DTO.Number().integer().min(1).required())
    public quantity: number
}

/**
 * 订单的各项，每种产品只出现一次
 */
export class ReserveDTO extends DTO {
    @Expect(DTO.String().required())
    public order: string

    @Expect(DTO.Array(StockItemDTO.Schema()).min(1).unique('product').required())
    public items: StockItemDTO[]
}
```

DTO 校验动作输入的方式与 HTTP 中相同（见 [DTO 与数据校验](../DTOValidation.md)）。消息是 JSON，其中的值保留各自的类型，因此无需 `.strict(false)`。`.unique('product')` 会拒绝同一种产品出现两次的订单。

**`inventory/packages/app/src/controllers/StockController.ts`**

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {Prefix, ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {type Stock, type StockLevel} from '../components/Stock.js'
import {ProductDTO, ReserveDTO} from '../dtos/StockDTO.js'

@Prefix({pattern: {resource: 'stock'}})
export class StockController extends Controller {

    /**
     * 库存（选项中的 "stock" 组件）
     */
    @Inject('stock')
    protected readonly stock: Stock

    /**
     * {"resource": "stock", "act": "get", "product": "lamp"}
     * @param input
     */
    @ServiceAction({act: 'get'}, ProductDTO)
    public async get(input: ProductDTO): Promise<StockLevel> {
        return this.stock.level(input.product)
    }

    /**
     * {"resource": "stock", "act": "reserve", "order": "…", "items": [{"product": "lamp", "quantity": 2}]}
     * @param input
     */
    @ServiceAction({act: 'reserve'}, ReserveDTO)
    public async reserve(input: ReserveDTO): Promise<StockLevel[]> {
        return this.stock.reserve(input.order, input.items)
    }
}
```

- `@ServiceAction(pattern, DTO)` 为动作指定模式（见[服务调用](../ServiceCalls.md)）。当消息包含模式中的全部键、各键的值也都相同时，消息即与该模式匹配；消息中其余的键即为动作的输入。
- `@Prefix({pattern: {resource: 'stock'}})` 将 `resource: 'stock'` 合并到控制器所有动作的模式中（见[控制器与动作](../Controllers.md)）：动作 `get` 处理消息 `{"resource": "stock", "act": "get", "product": "lamp"}`，其输入为 `{"product": "lamp"}`。
- 动作的返回值即为响应的 `payload`，抛出的异常即为响应的 `error`。

## 4. 调用方的令牌

**`inventory/packages/app/src/middlewares/Authenticate.ts`**

```typescript
import {Exception} from 'lakutata'
import {type ActionInvocation, httpRequestOfContext, type Next, type ServiceContext} from 'lakutata/com/entrypoint'

export class UnauthorizedException extends Exception {
    public errno: string = 'E_UNAUTHORIZED'

    public readonly statusCode: number = 401
}

/**
 * 环境中有 API_TOKEN 时，服务调用必须带上 "Authorization: Bearer <API_TOKEN>"：调用库存服务的服务会拿到这个令牌
 * @param invocation
 * @param next
 */
export async function authenticate(invocation: ActionInvocation, next: Next): Promise<unknown> {
    const token: string | undefined = process.env.API_TOKEN
    if (!token) return next()
    //承载这次调用的 HTTP 请求
    const authorization: string | undefined = httpRequestOfContext(invocation.context as ServiceContext)?.headers.authorization
    if (authorization !== `Bearer ${token}`) throw new UnauthorizedException('The caller is not authenticated')
    return next()
}
```

模板中的中间件检查的是 HTTP 请求，本例改为检查服务调用。`httpRequestOfContext()` 返回承载调用的 HTTP 请求及其请求头。环境中有 `API_TOKEN` 时，未携带 `Authorization: Bearer <API_TOKEN>` 的调用在校验输入之前就会被拒绝，错误为 `E_UNAUTHORIZED`（见[中间件与访问控制](../Middlewares.md)）。调用库存服务的服务会获得该令牌。如果要让每个调用方只能调用部分动作，可以为每个调用方分配各自的令牌，再添加一条检查动作分组的访问规则（见[中间件与访问控制](../Middlewares.md)第 4 节）。

## 5. 库存服务的选项

**`inventory/packages/app/src/config/Config.ts`**

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import {authenticate} from '../middlewares/Authenticate.js'
import {HealthController} from '../controllers/HealthController.js'
import {StockController} from '../controllers/StockController.js'
import {Stock} from '../components/Stock.js'

/**
 * 服务的选项
 * @param port HTTP 服务器（健康检查）的端口，默认取环境变量 PORT，没有时为 8080
 * @param servicePort 服务调用的端口，默认取环境变量 SERVICE_PORT，没有时为 3000
 */
export function config(port: number = Number(process.env.PORT ?? 8080), servicePort: number = Number(process.env.SERVICE_PORT ?? 3000)): ApplicationOptions {
    return {
        id: 'inventory',
        name: 'inventory',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //启动时的库存，保存在内存中
            stock: {class: Stock, products: {lamp: 10, desk: 3}},
            entrypoint: buildEntrypoints({
                controllers: [HealthController, StockController],
                //GET /health
                http: expressHTTPEntrypoint({port: port, respond: jsonEnvelope()}),
                //POST /，请求体是 JSON 格式的消息，只接受持有令牌的服务
                service: httpServiceEntrypoint({port: servicePort, middlewares: [authenticate]})
            })
        },
        bootstrap: ['entrypoint']
    }
}
```

入口有两个适配器（见[入口](../Entrypoint.md)）：

- `http`：一个 Express 服务器，监听 `PORT`，保留该服务器是为了模板中的健康检查（`GET /health`，`Dockerfile` 中的 `HEALTHCHECK` 会用到该检查）；
- `service`：`httpServiceEntrypoint()`，即 HTTP 服务适配器，监听 `SERVICE_PORT`（默认 3000）。该适配器使用单独的服务器。一次调用即以 JSON 格式 `POST` 一条消息，响应的状态码始终为 200，内容为 `{success, error, payload}`。该适配器的 `middlewares` 只对服务调用执行，因此健康检查无需令牌。

`stock` 组件启动时有 10 盏台灯和 3 张书桌。

## 6. 库存服务的客户端

**`orders/packages/app/src/components/Inventory.ts`**

```typescript
import {Component, Exception} from 'lakutata'
import {type HTTPServiceProxy, ServiceInvokeException} from 'lakutata/com/entrypoint'
import {Inject} from 'lakutata/decorator/di'

export type OrderItem = { product: string, quantity: number }

/**
 * 库存服务中表示拒绝订单的错误：它们会原样传给订单服务的客户端
 */
const REFUSALS: unknown[] = ['E_OUT_OF_STOCK', 'E_PRODUCT_NOT_FOUND']

/**
 * 库存服务没有应答，或者出了故障
 */
export class InventoryUnavailableException extends Exception {
    public errno: string = 'E_INVENTORY_UNAVAILABLE'

    public readonly statusCode: number = 503
}

/**
 * 订单服务眼中的库存服务：对它的调用，以及调用出错对订单意味着什么
 */
export class Inventory extends Component {

    /**
     * 库存服务的服务动作的代理（选项中的 "inventoryService" 组件）
     */
    @Inject('inventoryService')
    protected readonly service: HTTPServiceProxy

    /**
     * 为订单预留库存；同一个订单再预留一次不会改变任何东西
     * @param order
     * @param items
     */
    public async reserve(order: string, items: OrderItem[]): Promise<void> {
        try {
            //最多等待 5 秒
            await this.service.invoke({resource: 'stock', act: 'reserve', order: order, items: items}, 5000)
        } catch (error) {
            //拒绝订单的错误原样抛出，带着库存服务错误的全部属性（errno、errMsg、statusCode 等）
            if (error instanceof ServiceInvokeException && REFUSALS.includes(error.errno)) throw error
            //其他错误（没有响应、令牌被拒绝、库存服务看不懂消息）都是订单服务自己的故障，不是客户端的问题
            throw new InventoryUnavailableException('The inventory fails: {0}', (error as Error).message)
        }
    }
}
```

订单服务通过 `HTTPServiceProxy`（见[服务调用](../ServiceCalls.md)第 4 节）调用库存服务，该代理在选项中注册为 `inventoryService` 组件（第 8 节）。代理负责发送消息和读取响应。`Inventory` 是订单服务中位于代理之上的一个组件，负责决定库存服务的各种错误对订单意味着什么。

- `invoke()` 接收消息和等待响应的最长时间，此处为 5 秒。代理默认等待 10 分钟，而订单不应等待如此之久，因此本例为调用单独设定了时限。
- 订单被拒绝时，错误会逐层传回客户端：代理抛出一个 `ServiceInvokeException`，该异常带有库存服务错误的各项属性，包括 `errno`、`errMsg` 和 `statusCode`。`Inventory` 将这一异常原样抛出，订单服务的 HTTP 适配器即以相同的状态码和 `errno` 响应，因此客户端收到的就是库存服务的 409 `E_OUT_OF_STOCK`。
- 库存服务的其他错误并非客户端的问题。令牌被拒绝、库存服务无法理解收到的消息，或者根本没有响应（代理抛出的 `ServiceUnavailableException`），都属于订单服务自身的故障，订单服务以 503 `E_INVENTORY_UNAVAILABLE` 响应。
- `Inventory` 通过 `errno` 识别拒绝，因为异常的类不会随调用传回（见[异常](../Exceptions.md)第 5 节）。
- `reserve()` 将调用封装为带类型的具名方法，因此控制器无需自行拼装消息。

## 7. 订单

**`orders/packages/app/src/dtos/OrderDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * 一种产品的数量
 */
export class OrderItemDTO extends DTO {
    @Expect(DTO.String().required())
    public product: string

    @Expect(DTO.Number().integer().min(1).required())
    public quantity: number
}

/**
 * 新订单：它的各项，每种产品只出现一次
 */
export class PlaceOrderDTO extends DTO {
    @Expect(DTO.Array(OrderItemDTO.Schema()).min(1).unique('product').required())
    public items: OrderItemDTO[]
}
```

订单各项的结构与库存服务所要求的相同。订单服务在调用之前先校验这些条目，因此不合法的订单不会到达库存服务。

**`orders/packages/app/src/controllers/OrderController.ts`**

```typescript
import {randomUUID} from 'node:crypto'
import {Controller} from 'lakutata/com/entrypoint'
import {POST, Prefix} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {type Inventory, type OrderItem} from '../components/Inventory.js'
import {PlaceOrderDTO} from '../dtos/OrderDTO.js'

export type Order = { id: string, items: OrderItem[] }

@Prefix({route: '/orders'})
export class OrderController extends Controller {

    /**
     * 库存服务（选项中的 "inventory" 组件）
     */
    @Inject('inventory')
    protected readonly inventory: Inventory

    /**
     * POST /orders {"items": [{"product": "lamp", "quantity": 2}]}
     * @param input
     */
    @POST('/', PlaceOrderDTO)
    public async place(input: PlaceOrderDTO): Promise<Order> {
        const order: Order = {id: randomUUID(), items: input.items}
        //库存服务的拒绝（E_OUT_OF_STOCK 等）就是这个请求的错误
        await this.inventory.reserve(order.id, order.items)
        return order
    }
}
```

- 控制器注入 `inventory` 组件（`@Inject('inventory')`），并像调用其他组件一样调用该组件。
- 订单在调用之前就已获得 ID，因此即使该调用再次发送，库存服务也只会为订单预留一次。
- 调用的错误即为请求的错误，因此控制器无需 `try`。

## 8. 订单服务的选项

**`orders/packages/app/src/config/Config.ts`**

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints, buildHTTPServiceProxy} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import compression from 'compression'
import {authenticate} from '../middlewares/Authenticate.js'
import {HealthController} from '../controllers/HealthController.js'
import {OrderController} from '../controllers/OrderController.js'
import {Inventory} from '../components/Inventory.js'

/**
 * 服务的选项
 * @param port HTTP 服务器的端口，默认取环境变量 PORT，没有时为 8080
 * @param inventory 库存服务接收服务调用的地址，默认取环境变量 INVENTORY_URL，没有时为 http://localhost:3000
 */
export function config(port: number = Number(process.env.PORT ?? 8080), inventory: string = process.env.INVENTORY_URL ?? 'http://localhost:3000'): ApplicationOptions {
    return {
        id: 'orders',
        name: 'orders',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //库存服务的服务动作的代理，以及调用时使用的令牌
            inventoryService: buildHTTPServiceProxy({url: inventory, headers: {Authorization: `Bearer ${process.env.INVENTORY_TOKEN ?? ''}`}}),
            inventory: {class: Inventory},
            entrypoint: buildEntrypoints({
                controllers: [HealthController, OrderController],
                http: expressHTTPEntrypoint({
                    port: port,
                    //结果和错误都是 {errno, errMsg, data}，错误保留各自的状态码（400、409 等）
                    respond: jsonEnvelope(),
                    body: {limit: '1mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    middlewares: [authenticate],
                    before: (app): void => void app.use(compression())
                })
            })
        },
        //代理在启动时创建：INVENTORY_URL 无效时，服务无法启动
        bootstrap: ['inventoryService', 'entrypoint']
    }
}
```

这是模板中的 `Config.ts`，改动如下：

- 新增 `inventoryService` 组件，即代理，其中包含库存服务的地址（`INVENTORY_URL`，默认为 `http://localhost:3000`），并在调用时在 `Authorization` 请求头中携带令牌（`INVENTORY_TOKEN`，即库存服务的 `API_TOKEN`）；
- 新增 `inventory` 组件，由控制器注入；
- 用 `OrderController` 替换示例控制器；
- `jsonEnvelope()` 不再设置 `errorStatus`：错误保留各自的状态码（400、409、503）；
- 请求体上限为 1 MB（模板允许 100 MB），对订单而言已经足够；
- `bootstrap: ['inventoryService', 'entrypoint']`：代理在启动时、HTTP 服务器开始监听之前创建。应用在启动时会检查每个已声明对象的选项，因此 `INVENTORY_URL` 无效时，启动会立即失败，并给出 `The option "url" of "inventoryService" (HTTPServiceProxy) is invalid`。

模板中的中间件 `Authenticate.ts` 保持不变：订单服务设置了自身的 `API_TOKEN` 时，其客户端必须携带该令牌。

## 9. 运行

启动库存服务，并将其 HTTP 服务器置于 8081 端口，以便订单服务继续使用 8080 端口：

```bash
cd inventory
PORT=8081 API_TOKEN=inventory-secret npm run dev
```

然后在另一个终端中启动订单服务，并传入库存服务的令牌：

```bash
cd orders
INVENTORY_TOKEN=inventory-secret npm run dev
```

在第三个终端中：

```bash
curl -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{"items": [{"product": "desk", "quantity": 2}, {"product": "lamp", "quantity": 1}]}'
# {"errno":null,"errMsg":null,"data":{"id":"91de56de-9ca0-45d8-8197-cd2b2526dde5","items":[{"product":"desk","quantity":2},{"product":"lamp","quantity":1}]}}

curl -i -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{"items": [{"product": "desk", "quantity": 2}]}'
# HTTP/1.1 409 Conflict
# {"errno":"E_OUT_OF_STOCK","errMsg":"desk: 2 asked, 1 in stock","data":null}

curl -i -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{"items": [{"product": "chair", "quantity": 1}]}'
# HTTP/1.1 404 Not Found
# {"errno":"E_PRODUCT_NOT_FOUND","errMsg":"The product chair does not exist","data":null}
```

库存服务响应带有令牌的调用，拒绝其他调用：

```bash
curl localhost:3000 -H 'Authorization: Bearer inventory-secret' -H 'Content-Type: application/json' -d '{"resource": "stock", "act": "get", "product": "desk"}'
# {"success":true,"error":null,"payload":{"product":"desk","available":1}}

curl localhost:3000 -H 'Content-Type: application/json' -d '{"resource": "stock", "act": "get", "product": "desk"}'
# {"success":false,"error":{…,"statusCode":401,"message":"The caller is not authenticated","errMsg":"The caller is not authenticated","err":"UnauthorizedException","errno":"E_UNAUTHORIZED"},"payload":null}
```

错误带有异常的全部属性，此处省略了其中的 `stack`、`appId` 和 `appName`。停止库存服务（Ctrl+C），然后再下一个订单：

```bash
curl -i -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{"items": [{"product": "lamp", "quantity": 1}]}'
# HTTP/1.1 503 Service Unavailable
# {"errno":"E_INVENTORY_UNAVAILABLE","errMsg":"The inventory fails: The service http://localhost:3000 cannot be reached: connect ECONNREFUSED ::1:3000, connect ECONNREFUSED 127.0.0.1:3000","data":null}
```

## 10. 测试

每个服务都有各自的测试，这些测试替换了模板中的测试。库存服务的测试启动该服务，向其动作发送消息，并读取响应的封套：

**`inventory/packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import {config} from '../config/Config.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18085)
const SERVICE_PORT: number = PORT + 1

type Envelope = { success: boolean, error: { errno: string, errMsg: string } | null, payload?: any }

/**
 * 调用一个服务动作，返回响应的封套
 * @param message
 * @param token
 */
async function call(message: Record<string, unknown>, token: string = 'test-token'): Promise<Envelope> {
    const response: Response = await fetch(`http://127.0.0.1:${SERVICE_PORT}`, {
        method: 'POST',
        headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(message)
    })
    return await response.json() as Envelope
}

describe('inventory', (): void => {

    let app: Application

    before(async (): Promise<void> => {
        process.env.API_TOKEN = 'test-token'
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config(PORT, SERVICE_PORT)).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
    })

    it('answers the health check without authentication', async (): Promise<void> => {
        assert.deepStrictEqual(await (await fetch(`http://127.0.0.1:${PORT}/health`)).json(), {errno: null, errMsg: null, data: {status: 'ok'}})
    })

    it('refuses the calls without the token', async (): Promise<void> => {
        const refused: Envelope = await call({resource: 'stock', act: 'get', product: 'lamp'}, 'wrong-token')
        assert.strictEqual(refused.success, false)
        assert.strictEqual(refused.error?.errno, 'E_UNAUTHORIZED')
    })

    it('gives the stock of a product', async (): Promise<void> => {
        assert.deepStrictEqual((await call({resource: 'stock', act: 'get', product: 'lamp'})).payload, {product: 'lamp', available: 10})
        assert.strictEqual((await call({resource: 'stock', act: 'get', product: 'chair'})).error?.errno, 'E_PRODUCT_NOT_FOUND')
    })

    it('reserves all the items of an order, once', async (): Promise<void> => {
        const message: Record<string, unknown> = {resource: 'stock', act: 'reserve', order: 'order-1', items: [{product: 'lamp', quantity: 2}, {product: 'desk', quantity: 1}]}
        const levels: unknown = [{product: 'lamp', available: 8}, {product: 'desk', available: 2}]
        assert.deepStrictEqual((await call(message)).payload, levels)
        //重发这个调用，不会再预留任何库存
        assert.deepStrictEqual((await call(message)).payload, levels)
        assert.deepStrictEqual((await call({resource: 'stock', act: 'get', product: 'lamp'})).payload, {product: 'lamp', available: 8})
    })

    it('reserves nothing when an item is short', async (): Promise<void> => {
        const refused: Envelope = await call({resource: 'stock', act: 'reserve', order: 'order-2', items: [{product: 'lamp', quantity: 1}, {product: 'desk', quantity: 5}]})
        assert.strictEqual(refused.error?.errno, 'E_OUT_OF_STOCK')
        assert.strictEqual(refused.error?.errMsg, 'desk: 5 asked, 2 in stock')
        assert.deepStrictEqual((await call({resource: 'stock', act: 'get', product: 'lamp'})).payload, {product: 'lamp', available: 8})
    })

    it('refuses an invalid message', async (): Promise<void> => {
        assert.strictEqual((await call({resource: 'stock', act: 'reserve', order: 'order-3', items: []})).error?.errno, 'E_INVALID_VALUE')
        assert.strictEqual((await call({resource: 'stock', act: 'count'})).error?.errno, 'E_CONTROLLER_ACTION_NOT_FOUND')
    })
})
```

订单服务的测试无需库存服务，而是在同一个进程中启动一个库存服务的替身，即一个运行在独立容器中的入口（见[对象与生命周期](../Objects.md)第 5 节），其动作与库存服务的动作模式相同。一个进程只运行一个应用，此处为订单服务，因此替身不是应用。替身像库存服务一样检查令牌，最后两个测试先更换替身的令牌，再停止替身：

**`orders/packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application, Container, Exception} from 'lakutata'
import {buildEntrypoints, Controller, Entrypoint, httpRequestOfContext, httpServiceEntrypoint, type ServiceContext} from 'lakutata/com/entrypoint'
import {Prefix, ServiceAction} from 'lakutata/decorator/ctrl'
import {config} from '../config/Config.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18085)
const INVENTORY_PORT: number = PORT + 1

class UnauthorizedException extends Exception {
    public errno: string = 'E_UNAUTHORIZED'

    public readonly statusCode: number = 401
}

class OutOfStockException extends Exception {
    public errno: string = 'E_OUT_OF_STOCK'

    public readonly statusCode: number = 409
}

/**
 * 库存服务的替身：模式相同的动作、它要求的令牌、库存中的 3 盏台灯，以及它预留过的订单
 */
@Prefix({pattern: {resource: 'stock'}})
class InventoryStandIn extends Controller {
    public static token: string = 'inventory-token'

    public static lamps: number = 3

    public static readonly orders: string[] = []

    @ServiceAction({act: 'reserve'})
    public async reserve(input: { order: string, items: { product: string, quantity: number }[] }): Promise<unknown> {
        const authorization: string | undefined = httpRequestOfContext(this.context as ServiceContext)?.headers.authorization
        if (authorization !== `Bearer ${InventoryStandIn.token}`) throw new UnauthorizedException('The caller is not authenticated')
        const quantity: number = input.items[0].quantity
        if (quantity > InventoryStandIn.lamps) throw new OutOfStockException('lamp: {0} asked, {1} in stock', quantity, InventoryStandIn.lamps)
        InventoryStandIn.lamps -= quantity
        InventoryStandIn.orders.push(input.order)
        return [{product: 'lamp', available: InventoryStandIn.lamps}]
    }
}

/**
 * 下一个订单，返回响应的状态码和 {errno, errMsg, data}
 * @param body
 */
async function placeOrder(body: unknown): Promise<{ status: number, errno: string | null, errMsg: string | null, data: any }> {
    const response: Response = await fetch(`http://127.0.0.1:${PORT}/orders`, {
        method: 'POST',
        headers: {'Authorization': 'Bearer test-token', 'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    })
    return {status: response.status, ...await response.json() as { errno: string | null, errMsg: string | null, data: any }}
}

describe('orders', (): void => {

    let app: Application
    //替身运行在自己的容器中，和测试在同一个进程里
    const inventory: Container = new Container()

    before(async (): Promise<void> => {
        await inventory.set(Entrypoint, buildEntrypoints({
            controllers: [InventoryStandIn],
            service: httpServiceEntrypoint({port: INVENTORY_PORT, host: '127.0.0.1'})
        }))
        process.env.API_TOKEN = 'test-token'
        process.env.INVENTORY_TOKEN = 'inventory-token'
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config(PORT, `http://127.0.0.1:${INVENTORY_PORT}`)).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
        await inventory.destroy()
    })

    it('places an order, its stock reserved by the inventory', async (): Promise<void> => {
        const placed = await placeOrder({items: [{product: 'lamp', quantity: 2}]})
        assert.strictEqual(placed.status, 200)
        assert.deepStrictEqual(placed.data.items, [{product: 'lamp', quantity: 2}])
        assert.deepStrictEqual(InventoryStandIn.orders, [placed.data.id])
        assert.strictEqual(InventoryStandIn.lamps, 1)
    })

    it('answers the refusal of the inventory', async (): Promise<void> => {
        const refused = await placeOrder({items: [{product: 'lamp', quantity: 5}]})
        assert.strictEqual(refused.status, 409)
        assert.strictEqual(refused.errno, 'E_OUT_OF_STOCK')
        assert.strictEqual(refused.errMsg, 'lamp: 5 asked, 1 in stock')
    })

    it('refuses an invalid order without calling the inventory', async (): Promise<void> => {
        const invalid = await placeOrder({items: []})
        assert.strictEqual(invalid.status, 400)
        assert.strictEqual(invalid.errno, 'E_INVALID_VALUE')
        assert.strictEqual(InventoryStandIn.orders.length, 1)
    })

    it('answers 503 when the inventory refuses its token', async (): Promise<void> => {
        InventoryStandIn.token = 'another-token'
        const failed = await placeOrder({items: [{product: 'lamp', quantity: 1}]})
        assert.strictEqual(failed.status, 503)
        assert.strictEqual(failed.errno, 'E_INVENTORY_UNAVAILABLE')
        assert.strictEqual(failed.errMsg, 'The inventory fails: The caller is not authenticated')
    })

    it('answers 503 when the inventory does not answer', async (): Promise<void> => {
        await inventory.destroy()
        const unavailable = await placeOrder({items: [{product: 'lamp', quantity: 1}]})
        assert.strictEqual(unavailable.status, 503)
        assert.strictEqual(unavailable.errno, 'E_INVENTORY_UNAVAILABLE')
    })
})
```

```bash
cd inventory
npm test
```

```
app │   ✔ answers the health check without authentication
app │   ✔ refuses the calls without the token
app │   ✔ gives the stock of a product
app │   ✔ reserves all the items of an order, once
app │   ✔ reserves nothing when an item is short
app │   ✔ refuses an invalid message
app │ ℹ pass 6
✔ test ran in app
```

```bash
cd ../orders
npm test
```

```
app │   ✔ places an order, its stock reserved by the inventory
app │   ✔ answers the refusal of the inventory
app │   ✔ refuses an invalid order without calling the inventory
app │   ✔ answers 503 when the inventory refuses its token
app │   ✔ answers 503 when the inventory does not answer
app │ ℹ pass 5
✔ test ran in app
```

## 11. 在生产环境中

- 在每个项目中运行 `npm run docker:build`，使用模板中的 `Dockerfile` 构建镜像。在镜像中，库存服务在 `PORT`（8080）上提供健康检查，在 `SERVICE_PORT`（3000）上接收调用。在容器网络中，订单服务通过 `INVENTORY_URL=http://inventory:3000` 访问库存服务；请只对外公开订单服务的端口。
- 两个服务的令牌应来自同一份机密配置：库存服务的 `API_TOKEN`，以及订单服务的 `INVENTORY_TOKEN`。仅有一方更换了令牌时，订单服务会以 503 响应。
- 库存保存在内存中，订单则完全没有保存，请将它们存储到数据库中（见[带数据库的 REST API](RestAPI.md)）。届时将订单的 ID 作为预留记录的唯一键，即可保证一个订单不会被预留两次。
- 其他传输方式也能提供同样的动作：Socket.IO、JSON-RPC（见[服务调用](../ServiceCalls.md)）、NATS（见 [NATS](../NATS.md)）或 gRPC（见 [gRPC](../GRPC.md)），每种传输方式都通过 `service` 选项中的一个适配器提供。NATS 和 gRPC 的代理具有同样的 `invoke()`，也抛出同样的 `ServiceInvokeException`，因此只需改用这些代理的构建函数注册 `inventoryService`，并修改 `Inventory.ts` 中代理的类型，`Inventory.ts` 的其余部分保持不变。
