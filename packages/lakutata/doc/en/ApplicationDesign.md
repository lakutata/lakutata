# Lakutata Application Design

This guide describes how to structure an application on Lakutata: the class each part of the application extends, where
its logic and its state live, how the configuration reaches its objects, the order in which they are created, and how
the application is tested. The recommendations follow the project templates and the [examples](examples/README.md);
[Concepts](Concepts.md) explains the model they rely on.

## 1. The parts of an application

| Part | Class | Directory | Responsibility |
|---|---|---|---|
| Actions | `Controller` | `controllers/` | Receive the validated input of a request, call the objects that do the work, return the result |
| Services and resources | `Component` | `components/` | The state shared between requests, the logic several actions share, connections, files, timers |
| Units of a request | `Provider` | | The state of one request, such as the signed-in user ([Middlewares and Access Control](Middlewares.md), section 3) |
| Features with their own objects | `Module` | | A group of objects reached through one object ([Modules](Modules.md)) |
| Contracts | `DTO` | `dtos/` | The input of the actions, the messages of the queues, the shape of results |
| Errors | `Exception` | `exceptions/` | The errors of the application, each with its `errno` and, for HTTP clients, its `statusCode` |
| Data | Entities, migrations | `entities/`, `migrations/` | The tables of the databases and their changes ([Entities, Queries and Transactions](Entities.md)) |
| Cross-cutting rules | Middlewares | `middlewares/` | Authentication, languages, access control, applied to many actions |
| Plain functions | None | `lib/` | Computations that need nothing from the container |
| Options | `config()` | `config/` | The options of the application, read from the environment |

The `default` template creates `controllers/`, `dtos/`, `config/` and `tests/`; the `service` and `web-*` templates
add `middlewares/`, the desktop templates `components/`, and the examples add the other directories as the application
needs them.

## 2. Where the logic and the state live

A controller exists for one request only, so it cannot keep anything between requests. An action validates its input
through its DTO, calls the objects that do the work, and returns their result:

- **State kept between requests** (a list of items, a cache, the data of a file) belongs to a component, the one
  instance that every request shares.
- **Logic that several actions or transports share** belongs to a component, so that each action stays a call to it,
  whatever the transport.
- **Resources** (a connection, a server, a timer, a device) belong to a component, which opens them in `init()` or
  `startup()` and releases them in `destroy()`.
- **Code that a test replaces** belongs to a component, which a test can obtain and stub, or replace with another class.
- **The state of one request** belongs to a provider, created for the request and destroyed with it.

When the work of an action belongs to that action alone, such as the queries of the [REST API
example](examples/RestAPI.md) or the monthly totals of the [mobile application example](examples/MobileApp.md), the
action may perform it itself on the repositories of the database, where the state is kept. As soon as the work is
shared, keeps state between requests, or must be replaced in tests, it moves to a component.

Components that depend on platform features (a window, the clipboard, a native module) receive them as options or
through a dedicated component, so that the rest of the application runs, and is tested, without that
platform ([A tray application with NW.js](examples/TrayApp.md)).

## 3. Choosing the class of an object

1. It serves requests: a `Controller`.
2. It keeps state or a resource for the lifetime of the application, or other objects listen to its events: a
   `Component`.
3. Its state belongs to one request, or to another scope: a `Provider`.
4. Each object that uses it needs a separate instance: a class that extends `BaseObject`, which is transient.
5. It groups several objects that the rest of the application should reach through one object: a `Module`.
6. It needs nothing from the container: a plain function or class in `lib/`.

## 4. An example: an orders service

The service below creates orders and finds them over HTTP. It follows the `default` template, with a component for the
orders, and keeps them in memory to stay short; the [REST API example](examples/RestAPI.md) stores them in a database.

```
src/
  App.ts                              starts the application (as in the template)
  config/Config.ts                    the options of the application
  components/Orders.ts                the orders, shared by every request
  controllers/OrderController.ts      the actions
  dtos/OrderDTO.ts                    the input of the actions
  exceptions/OrderNotFoundException.ts
  tests/App.spec.ts                   the application, over HTTP
  tests/Orders.spec.ts                the component alone
```

`src/dtos/OrderDTO.ts`:

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
    //From the route (/orders/:id), a string converted to a number
    @Expect(DTO.Number().integer().min(1).required().strict(false))
    public id: number
}
```

`src/exceptions/OrderNotFoundException.ts`:

```typescript
import {Exception} from 'lakutata'

export class OrderNotFoundException extends Exception {
    public errno: string = 'E_ORDER_NOT_FOUND'

    public readonly statusCode: number = 404
}
```

`src/components/Orders.ts` holds the orders. It is the only object that changes them, and it emits an event for each
new order, which other components can listen to:

```typescript
import {Component} from 'lakutata'
import {OrderNotFoundException} from '../exceptions/OrderNotFoundException.js'

export interface Order {
    id: number
    product: string
    quantity: number
}

//The orders of the application: one instance, shared by every request
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

`src/controllers/OrderController.ts` translates the requests into calls of the component:

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

`src/config/Config.ts` declares the objects:

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {Orders} from '../components/Orders.js'
import {OrderController} from '../controllers/OrderController.js'

/**
 * The options of the application
 * @param port The port of the HTTP server: the PORT environment variable, or 8080.
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

The same actions can serve other transports by adding their decorators and adapters, without changing the component
([Controllers and Actions](Controllers.md)).

## 5. Configuration

The configuration of an application flows in one direction:

1. **The environment** gives the values that change between deployments: `PORT`, the address of a database, a token.
2. **`config()`** reads them, as parameters with defaults (`port = Number(process.env.PORT ?? 8080)`), and returns the
   options of the application. Because it is a function, a test calls it with the values it needs: a port, an in-memory
   database, a temporary directory.
3. **The declarations** in those options give each object its options: `{class: Orders}`, or
   `{class: Mailer, host: 'smtp.example.com'}`.
4. **The `@Configurable` properties** of each object receive them, validated by their schemas when the application
   launches ([Dependency Injection](Injection.md), section 2).

Reading the environment in `config()` lets a test pass its own values as arguments, as the templates do with the port
([Project Structure](ProjectStructure.md), section 1). The mode (`development` or `production`) comes from the `MODE` or
`NODE_ENV` environment variable ([Application](Application.md), section 4).

## 6. Creation order and bootstrap

An object is created when another object first requests it. `bootstrap` lists the objects that must exist at launch,
in order, and the application launches once its steps have completed:

- an object that the actions need ready before the first request comes before the entrypoint, which starts the
  servers and the other adapters: the REST API example connects and migrates its database first, with
  `bootstrap: ['database', 'entrypoint']`;
- an object that relies on the actions comes after the entrypoint: in the desktop example, the actions are served
  before the window loads its user interface (`['entrypoint', 'notes', 'window']`);
- a component that only serves requests, such as `orders` above, needs no step: the first request creates it;
- a component that works on its own (a poller, a window, a tray icon) is listed, since nothing else would create it.

The options of every declared object are checked at launch whether or not `bootstrap` lists it.

## 7. Testing

The tests of the templates run with `node --test` on the compiled files (`npm test`).

**The whole application.** A test starts the application with `config()` and a dedicated port, waits for the launch,
sends requests, and disposes of the application:

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

**One object.** A component that needs no other object is tested in a container, without an application:

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

**Replacing a dependency.** A test obtains the component from the launched application (`app.getObject('orders')`)
and stubs one of its methods with `t.mock.method()`, as the [background jobs example](examples/BackgroundJobs.md)
does. A service that the application calls is replaced by a stand-in started in the test process, in a `Container`,
as in the [example of calls between services](examples/ServiceCalls.md). An object inside a module is replaced through
the options of the module's declaration ([Modules](Modules.md), section 4).

## 8. Growing an application

- **Features of several objects** become modules, which the rest of the application reaches through one object
  ([Modules](Modules.md)).
- **Features shared between applications** become packages that export a component with a function that builds its
  declaration ([Dependency Injection](Injection.md), section 3).
- **Applications with a user interface** are workspaces: the application in `packages/app`, the interface in
  `packages/ui`, and, for the mobile template, the channel between them in `packages/ipc`
  ([Project Structure](ProjectStructure.md), section 2).
- **Services that call each other** share no code: the patterns of the actions and the shape of the messages form the
  contract between them ([Calls between services](examples/ServiceCalls.md)).
