# Calls between services

This example builds two services, one calling the other. The `inventory` service keeps the stock of the products and
serves it to other services through service actions; the `orders` service has an HTTP API that places orders, and
reserves their stock in the inventory through a proxy. Both start from the `service` template. The example shows
service actions and their patterns, the HTTP service transport and a proxy that calls it, a token shared by the two
services, how the inventory's error reaches the client when it refuses an order, and the tests of each service.

| Service | Call | What it does |
|---|---|---|
| `inventory` | `{"resource": "stock", "act": "get", "product": "lamp"}` | Gives the quantity of a product in stock |
| `inventory` | `{"resource": "stock", "act": "reserve", "order": "<id>", "items": [{"product": "lamp", "quantity": 2}]}` | Reserves the items of an order, all of them or none |
| `orders` | `POST /orders` | Places an order: `{"items": [{"product": "lamp", "quantity": 2}]}` |

## 1. Create the projects

```bash
npx @lakutata/cli create --name inventory --template service --yes
npx @lakutata/cli create --name orders --template service --yes
rm inventory/packages/app/src/controllers/ExampleController.ts inventory/packages/app/src/dtos/GreetDTO.ts
rm orders/packages/app/src/controllers/ExampleController.ts orders/packages/app/src/dtos/GreetDTO.ts
```

The two projects sit side by side, each a workspace whose service is `packages/app`
([ProjectStructure](../ProjectStructure.md)); the paths below start with the name of their project. They share no code:
the action patterns and the shape of the messages are the contract between them. Nothing is installed: the HTTP
service transport is part of lakutata, and the orders service calls it with `fetch()`.

## 2. The stock

**`inventory/packages/app/src/exceptions/StockExceptions.ts`**

```typescript
import {Exception} from 'lakutata'

/**
 * The product of the call does not exist
 */
export class ProductNotFoundException extends Exception {
    public errno: string = 'E_PRODUCT_NOT_FOUND'

    public readonly statusCode: number = 404
}

/**
 * The stock of a product is short of the quantity asked
 */
export class OutOfStockException extends Exception {
    public errno: string = 'E_OUT_OF_STOCK'

    public readonly statusCode: number = 409
}
```

Each exception has its `errno` and its status ([Exceptions](../Exceptions.md)). Its message is given when it is thrown.

**`inventory/packages/app/src/components/Stock.ts`**

```typescript
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {OutOfStockException, ProductNotFoundException} from '../exceptions/StockExceptions.js'

export type StockItem = { product: string, quantity: number }

export type StockLevel = { product: string, available: number }

/**
 * The stock of the products, kept in memory, and the orders it is reserved for
 */
export class Stock extends Component {

    /**
     * The quantity of each product at the start
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.Number().integer().min(0)).default({}))
    protected readonly products: Record<string, number>

    /**
     * The available quantity of each product
     */
    protected readonly levels: Map<string, number> = new Map()

    /**
     * The reserved orders, with the stock levels left after each reservation
     */
    protected readonly reserved: Map<string, StockLevel[]> = new Map()

    protected async init(): Promise<void> {
        Object.entries(this.products).forEach(([product, quantity]: [string, number]): unknown => this.levels.set(product, quantity))
    }

    /**
     * The available quantity of a product
     * @param product
     */
    public level(product: string): StockLevel {
        const available: number | undefined = this.levels.get(product)
        if (available === undefined) throw new ProductNotFoundException('The product {product} does not exist', {product: product})
        return {product: product, available: available}
    }

    /**
     * Reserve the items of an order: all of them or none
     * @param order
     * @param items
     */
    public reserve(order: string, items: StockItem[]): StockLevel[] {
        //An order already reserved (a call sent again) is not reserved twice
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

- The stock is a component ([Objects](../Objects.md)): one instance for the whole service, while a controller lives for
  one request. It is kept in memory, starting from the quantities of its `products` option (a `@Configurable`
  property), which `init()` copies.
- `reserve()` checks every item before it changes the stock: an order is reserved whole, or not at all.
- The order id makes the reservation happen only once: a call sent again, after a timeout for example, gets the same
  result and reserves nothing more.
- The message of `OutOfStockException` is built from the values given with it: `desk: 5 asked, 2 in stock`.

## 3. The service actions

**`inventory/packages/app/src/dtos/StockDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * A product
 */
export class ProductDTO extends DTO {
    @Expect(DTO.String().required())
    public product: string
}

/**
 * A quantity of a product
 */
export class StockItemDTO extends ProductDTO {
    @Expect(DTO.Number().integer().min(1).required())
    public quantity: number
}

/**
 * The items of an order, each product once
 */
export class ReserveDTO extends DTO {
    @Expect(DTO.String().required())
    public order: string

    @Expect(DTO.Array(StockItemDTO.Schema()).min(1).unique('product').required())
    public items: StockItemDTO[]
}
```

The DTOs validate the input of the actions as they do over HTTP ([DTOValidation](../DTOValidation.md)). A message is
JSON, so its values keep their types: no `.strict(false)` is needed. `.unique('product')` refuses an order that lists a
product twice.

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
     * The stock (the component "stock" of the options)
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

- `@ServiceAction(pattern, DTO)` gives an action its pattern ([ServiceCalls](../ServiceCalls.md)). A message matches it
  when it holds the keys of the pattern with the same values; its other keys are the input of the action.
- `@Prefix({pattern: {resource: 'stock'}})` merges `resource: 'stock'` into the patterns of all the controller's
  actions ([Controllers](../Controllers.md)): the `get` action answers the message
  `{"resource": "stock", "act": "get", "product": "lamp"}`, and its input is `{"product": "lamp"}`.
- What the action returns is the `payload` of the response, and the exception it throws is its `error`.

## 4. The token of the callers

**`inventory/packages/app/src/middlewares/Authenticate.ts`**

```typescript
import {Exception} from 'lakutata'
import {type ActionInvocation, httpRequestOfContext, type Next, type ServiceContext} from 'lakutata/com/entrypoint'

export class UnauthorizedException extends Exception {
    public errno: string = 'E_UNAUTHORIZED'

    public readonly statusCode: number = 401
}

/**
 * When the environment has an API_TOKEN, the service calls must carry "Authorization: Bearer <API_TOKEN>": the services
 * that call the inventory are given this token
 * @param invocation
 * @param next
 */
export async function authenticate(invocation: ActionInvocation, next: Next): Promise<unknown> {
    const token: string | undefined = process.env.API_TOKEN
    if (!token) return next()
    //The HTTP request that carries the call
    const authorization: string | undefined = httpRequestOfContext(invocation.context as ServiceContext)?.headers.authorization
    if (authorization !== `Bearer ${token}`) throw new UnauthorizedException('The caller is not authenticated')
    return next()
}
```

The template's middleware checked the HTTP requests; here it checks the service calls. `httpRequestOfContext()` gives
the HTTP request that carries a call, with its headers. When the environment has an `API_TOKEN`, a call without
`Authorization: Bearer <API_TOKEN>` is refused with `E_UNAUTHORIZED` before its input is validated
([Middlewares](../Middlewares.md)). The services that call the inventory are given this token. To let each caller reach
only some of the actions, give each caller its own token and add an access rule that checks the action groups
([Middlewares](../Middlewares.md), section 4).

## 5. The options of the inventory

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
 * The options of the service
 * @param port the port of the HTTP server (the health check), the PORT environment variable or 8080 by default
 * @param servicePort the port of the service calls, the SERVICE_PORT environment variable or 3000 by default
 */
export function config(port: number = Number(process.env.PORT ?? 8080), servicePort: number = Number(process.env.SERVICE_PORT ?? 3000)): ApplicationOptions {
    return {
        id: 'inventory',
        name: 'inventory',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //The stock at the start, in memory
            stock: {class: Stock, products: {lamp: 10, desk: 3}},
            entrypoint: buildEntrypoints({
                controllers: [HealthController, StockController],
                //GET /health
                http: expressHTTPEntrypoint({port: port, respond: jsonEnvelope()}),
                //POST / with the message as its JSON body, from the services that hold the token
                service: httpServiceEntrypoint({port: servicePort, middlewares: [authenticate]})
            })
        },
        bootstrap: ['entrypoint']
    }
}
```

The entrypoint has two adapters ([Entrypoint](../Entrypoint.md)):

- `http`: an Express server on `PORT`, kept for the template's health check (`GET /health`, used by the `HEALTHCHECK`
  of the `Dockerfile`);
- `service`: `httpServiceEntrypoint()`, the HTTP service transport, on `SERVICE_PORT` (3000 by default). It runs its own
  server. A call is a `POST` of the message as JSON, always answered with 200 and `{success, error, payload}`. Its
  `middlewares` run for the calls only, so the health check needs no token.

The `stock` component starts with 10 lamps and 3 desks.

## 6. The proxy of the inventory

**`orders/packages/app/src/components/InventoryProxy.ts`**

```typescript
import {Component, DTO, Exception} from 'lakutata'
import {ServiceInvokeException} from 'lakutata/com/entrypoint'
import {Configurable} from 'lakutata/decorator/di'

export type OrderItem = { product: string, quantity: number }

/**
 * The response of a service action: its result, or its error with all its properties
 */
type Envelope<T> = { success: boolean, error: { message: string, errno?: string } | null, payload: T }

/**
 * The inventory's errors that refuse an order: they are passed on to the clients of the orders service
 */
const REFUSALS: string[] = ['E_OUT_OF_STOCK', 'E_PRODUCT_NOT_FOUND']

/**
 * The inventory does not answer, or fails
 */
export class InventoryUnavailableException extends Exception {
    public errno: string = 'E_INVENTORY_UNAVAILABLE'

    public readonly statusCode: number = 503
}

/**
 * The client of the inventory: it calls its service actions over HTTP
 */
export class InventoryProxy extends Component {

    /**
     * The address where the inventory takes its service calls
     */
    @Configurable(DTO.String().uri().required())
    protected readonly url: string

    /**
     * The token sent with the calls (the inventory's API_TOKEN)
     */
    @Configurable(DTO.String().optional())
    protected readonly token?: string

    /**
     * The longest wait for a response, in milliseconds
     */
    @Configurable(DTO.Number().integer().positive().default(5000))
    protected readonly timeout: number

    /**
     * Call an action of the inventory: return its result, or throw its error
     * @param message the pattern of the action and its input
     */
    public async invoke<T>(message: Record<string, unknown>): Promise<T> {
        let envelope: Envelope<T>
        try {
            const response: Response = await fetch(this.url, {
                method: 'POST',
                headers: {'Authorization': `Bearer ${this.token ?? ''}`, 'Content-Type': 'application/json'},
                body: JSON.stringify(message),
                signal: AbortSignal.timeout(this.timeout)
            })
            envelope = await response.json() as Envelope<T>
        } catch (error) {
            throw new InventoryUnavailableException('The inventory does not answer: {0}', (error as Error).message)
        }
        if (envelope.success) return envelope.payload
        const error: { message: string, errno?: string } = envelope.error ?? {message: 'The call failed'}
        //A refusal is thrown with all its properties (errno, errMsg, statusCode…), as the NATS and gRPC proxies do
        if (REFUSALS.includes(error.errno ?? '')) throw Object.assign(new ServiceInvokeException(error.message), error, {service: 'inventory'})
        //Any other error (a refused token, a message the inventory does not understand) is a failure of the orders service, not of its clients
        throw new InventoryUnavailableException('The inventory fails: {0}', error.message)
    }

    /**
     * Reserve the stock of an order; reserving the same order again changes nothing
     * @param order
     * @param items
     */
    public async reserve(order: string, items: OrderItem[]): Promise<void> {
        await this.invoke({resource: 'stock', act: 'reserve', order: order, items: items})
    }
}
```

The HTTP service transport comes with no client library ([ServiceCalls](../ServiceCalls.md), section 3): the proxy is a
component of the orders service that posts the messages and reads the responses.

- Its options are `@Configurable` properties, validated when it is created: the inventory's address, the token, and the
  longest wait for a response. The HTTP service transport sets no time limit on the calls, so the proxy sets its own
  with `AbortSignal.timeout()`.
- A refusal of an order crosses the call: the proxy throws a `ServiceInvokeException` (from `lakutata/com/entrypoint`)
  that carries the properties of the inventory's error, including its `errno`, `errMsg` and `statusCode`, as the NATS
  and gRPC proxies do. The HTTP adapter of the orders service answers with that status and that `errno`, so the client
  receives the inventory's 409 `E_OUT_OF_STOCK`.
- The inventory's other errors are not the client's fault. A refused token, or a message that the inventory does not
  understand, is a failure of the orders service: it answers 503 `E_INVENTORY_UNAVAILABLE`, as when the inventory does
  not answer.
- The proxy recognizes the refusals by their `errno`: the class of an exception does not cross the call
  ([Exceptions](../Exceptions.md), section 5).
- `reserve()` wraps the call in a typed method, so the controllers never build messages themselves.

## 7. The orders

**`orders/packages/app/src/dtos/OrderDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * A quantity of a product
 */
export class OrderItemDTO extends DTO {
    @Expect(DTO.String().required())
    public product: string

    @Expect(DTO.Number().integer().min(1).required())
    public quantity: number
}

/**
 * A new order: its items, each product once
 */
export class PlaceOrderDTO extends DTO {
    @Expect(DTO.Array(OrderItemDTO.Schema()).min(1).unique('product').required())
    public items: OrderItemDTO[]
}
```

The items have the shape that the inventory expects. The orders service validates them before the call, so an invalid
order never reaches the inventory.

**`orders/packages/app/src/controllers/OrderController.ts`**

```typescript
import {randomUUID} from 'node:crypto'
import {Controller} from 'lakutata/com/entrypoint'
import {POST, Prefix} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {type InventoryProxy, type OrderItem} from '../components/InventoryProxy.js'
import {PlaceOrderDTO} from '../dtos/OrderDTO.js'

export type Order = { id: string, items: OrderItem[] }

@Prefix({route: '/orders'})
export class OrderController extends Controller {

    /**
     * The client of the inventory (the component "inventory" of the options)
     */
    @Inject('inventory')
    protected readonly inventory: InventoryProxy

    /**
     * POST /orders {"items": [{"product": "lamp", "quantity": 2}]}
     * @param input
     */
    @POST('/', PlaceOrderDTO)
    public async place(input: PlaceOrderDTO): Promise<Order> {
        const order: Order = {id: randomUUID(), items: input.items}
        //A refusal of the inventory (E_OUT_OF_STOCK…) is the error of the request
        await this.inventory.reserve(order.id, order.items)
        return order
    }
}
```

- The controller injects the proxy (`@Inject('inventory')`) and calls it like any other component.
- The order gets its id before the call: if the call is sent again, the inventory still reserves the order only once.
- An error of the call becomes the error of the request, so the controller needs no `try`.

## 8. The options of the orders

**`orders/packages/app/src/config/Config.ts`**

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import compression from 'compression'
import {authenticate} from '../middlewares/Authenticate.js'
import {HealthController} from '../controllers/HealthController.js'
import {OrderController} from '../controllers/OrderController.js'
import {InventoryProxy} from '../components/InventoryProxy.js'

/**
 * The options of the service
 * @param port the port of the HTTP server, the PORT environment variable or 8080 by default
 * @param inventory the address where the inventory takes its service calls, the INVENTORY_URL environment variable or
 * http://localhost:3000 by default
 */
export function config(port: number = Number(process.env.PORT ?? 8080), inventory: string = process.env.INVENTORY_URL ?? 'http://localhost:3000'): ApplicationOptions {
    return {
        id: 'orders',
        name: 'orders',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //The client of the inventory, with the token for its calls
            inventory: {class: InventoryProxy, url: inventory, token: process.env.INVENTORY_TOKEN},
            entrypoint: buildEntrypoints({
                controllers: [HealthController, OrderController],
                http: expressHTTPEntrypoint({
                    port: port,
                    //The results and the errors are {errno, errMsg, data}; the errors keep their status (400, 409…)
                    respond: jsonEnvelope(),
                    body: {limit: '1mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    middlewares: [authenticate],
                    before: (app): void => void app.use(compression())
                })
            })
        },
        //The client of the inventory is created at the start: an invalid INVENTORY_URL stops the service
        bootstrap: ['inventory', 'entrypoint']
    }
}
```

This is the `Config.ts` of the template, with:

- the `inventory` component: the proxy, with the inventory's address (`INVENTORY_URL`, `http://localhost:3000` by
  default) and the token for its calls (`INVENTORY_TOKEN`, the inventory's `API_TOKEN`);
- the `OrderController` instead of the example controller;
- `jsonEnvelope()` without `errorStatus`: the errors keep their status (400, 409, 503);
- a body of 1 MB at most (the template allows 100 MB), more than an order needs;
- `bootstrap: ['inventory', 'entrypoint']`: the proxy is created at the start, so an invalid `INVENTORY_URL` stops the
  service at once, with `The option "url" of "inventory" (InventoryProxy) is invalid`.

The template's middleware `Authenticate.ts` stays: when the orders service has an `API_TOKEN` of its own, its clients
must carry that token.

## 9. Run it

Start the inventory with its HTTP server on 8081, so that the orders service keeps 8080:

```bash
cd inventory
PORT=8081 API_TOKEN=inventory-secret npm run dev
```

Then start the orders service in another terminal, with the inventory's token:

```bash
cd orders
INVENTORY_TOKEN=inventory-secret npm run dev
```

In a third terminal:

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

The inventory answers the calls that carry its token, and refuses the others:

```bash
curl localhost:3000 -H 'Authorization: Bearer inventory-secret' -H 'Content-Type: application/json' -d '{"resource": "stock", "act": "get", "product": "desk"}'
# {"success":true,"error":null,"payload":{"product":"desk","available":1}}

curl localhost:3000 -H 'Content-Type: application/json' -d '{"resource": "stock", "act": "get", "product": "desk"}'
# {"success":false,"error":{…,"statusCode":401,"message":"The caller is not authenticated","errMsg":"The caller is not authenticated","err":"UnauthorizedException","errno":"E_UNAUTHORIZED"},"payload":null}
```

The error carries all the properties of the exception; its `stack`, `appId` and `appName` are left out here. Stop the
inventory (Ctrl+C) and place an order:

```bash
curl -i -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{"items": [{"product": "lamp", "quantity": 1}]}'
# HTTP/1.1 503 Service Unavailable
# {"errno":"E_INVENTORY_UNAVAILABLE","errMsg":"The inventory does not answer: fetch failed","data":null}
```

## 10. Test it

Each service has its own tests, which replace the template's test. The inventory's tests start it and call its actions
as the orders service does:

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
 * Call a service action and return the envelope of the response
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
        //Sent again, the call reserves nothing more
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

The tests of the orders service do not need the inventory. They start a stand-in for it in the same process: an
entrypoint in a container of its own ([Objects](../Objects.md), section 5), with an action of the same pattern as the
inventory's. A process runs one application, here the orders service, so the stand-in is not an application. It checks
the token as the inventory does, and the last two tests change its token, then stop it:

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
 * A stand-in for the inventory: an action with the same pattern, the token it expects, 3 lamps in stock, and the orders
 * it has reserved
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
 * Place an order: the status of the response and its {errno, errMsg, data}
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
    //The stand-in runs in a container of its own, in the test process
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

## 11. In production

- `npm run docker:build` in each project makes its image (the template's `Dockerfile`). In its image, the inventory
  serves its health check on `PORT` (8080) and the calls on `SERVICE_PORT` (3000). On the container network, the
  orders service reaches it with `INVENTORY_URL=http://inventory:3000`; publish only the port of the orders service.
- Give both services the token from the same secret: the inventory's `API_TOKEN` and the `INVENTORY_TOKEN` of the
  orders service. While only one of them has a new token, the orders service answers 503.
- The stock is kept in memory, and the orders are not kept at all: store them in a database
  ([A REST API with a database](RestAPI.md)). There, the order id, as a unique key of the reservations, keeps an order
  from being reserved twice.
- Other transports serve the same actions: Socket.IO, JSON-RPC ([ServiceCalls](../ServiceCalls.md)), NATS
  ([NATS](../NATS.md)) or gRPC ([GRPC](../GRPC.md)), each an adapter of the `service` option. NATS and gRPC come with
  their own proxies, which throw the same `ServiceInvokeException`.

<!--
check:
  create: inventory service
  remove: inventory/packages/app/src/controllers/ExampleController.ts inventory/packages/app/src/dtos/GreetDTO.ts
  create: orders service
  remove: orders/packages/app/src/controllers/ExampleController.ts orders/packages/app/src/dtos/GreetDTO.ts
  run: inventory: npm test
  run: orders: npm test
-->
