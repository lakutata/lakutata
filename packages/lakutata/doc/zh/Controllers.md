# Lakutata 控制器与动作

控制器是一个类，它的方法用来响应请求。这些方法叫做**动作**：装饰器给动作一个地址（HTTP 路由、命令、服务模式、定时计划、消息队列），请求到达这个地址时，`entrypoint` 组件就调用它。同一个方法可以有多个地址：同一段代码可以同时通过 HTTP、命令行和服务传输方式响应请求，校验、中间件和访问控制都相同。

## 1. 一个控制器

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {CLIAction, GET, POST, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'

class OrderIdDTO extends DTO {
    //路由参数和命令行参数都是文本：strict(false) 会转换它们
    @Expect(DTO.Number().integer().strict(false).required())
    public id: number
}

class CreateOrderDTO extends DTO {
    @Expect(DTO.String().required())
    public product: string

    @Expect(DTO.Number().integer().min(1).default(1))
    public quantity: number
}

class OrderController extends Controller {
    //GET /orders/42、命令 "order 42"、服务消息 {cmd: 'order.get', id: 42}
    @GET('/orders/:id', OrderIdDTO)
    @CLIAction('order <id>', OrderIdDTO, {description: 'Show an order'})
    @ServiceAction({cmd: 'order.get'}, OrderIdDTO)
    public async get(input: OrderIdDTO): Promise<{ id: number, status: string }> {
        return {id: input.id, status: 'paid'}
    }

    //带 JSON 请求体的 POST /orders
    @POST('/orders', CreateOrderDTO)
    public async create(input: CreateOrderDTO): Promise<CreateOrderDTO> {
        return input
    }
}

Application.run(() => ({
    id: 'orders.app',
    name: 'Orders',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [OrderController],
            http: expressHTTPEntrypoint({port: 8080}),
            service: httpServiceEntrypoint({port: 8081}),
            cli: commanderCLIEntrypoint({bin: 'orders', noCommand: 'ignore'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ curl localhost:8080/orders/42
{"id":42,"status":"paid"}
$ curl -X POST localhost:8080/orders -H 'Content-Type: application/json' -d '{"product":"tea","extra":1}'
{"product":"tea","quantity":1}
$ curl -X POST localhost:8081 -H 'Content-Type: application/json' -d '{"cmd":"order.get","id":42}'
{"success":true,"error":null,"payload":{"id":42,"status":"paid"}}
$ node dist/index.js order 42
{
  "id": 42,
  "status": "paid"
}
```

- 控制器继承 `lakutata/com/entrypoint` 中的 `Controller`。
- 控制器列在 `buildEntrypoints` 的 `controllers` 选项里，和各传输方式的适配器放在一起（见 [Entrypoint](Entrypoint.md)）。入口必须列在 `bootstrap` 里，否则它不会被启动。
- 没有对应的适配器时，传输方式的装饰器不起作用：上面如果没有 `cli`，`@CLIAction` 就会被忽略。

## 2. 请求的处理过程

1. 适配器收到请求，按地址查找动作。找不到时，传输方式会回复“找不到”（HTTP 是 404）。
2. 为这个请求创建一个新的作用域。
3. 执行中间件（见 [Middlewares](Middlewares.md)）。
4. 在这个作用域里创建控制器的一个新实例。
5. 动作的 DTO 校验输入（第 4 节）。
6. 访问控制检查请求（见 [Middlewares](Middlewares.md)）。
7. 用输入调用方法，方法的返回值就是响应（第 5 节）。
8. 销毁作用域，以及在其中创建的对象。

所以，一个控制器只存活一个请求的时间。它注入的 `@Scoped` 提供者（提供者默认就是这种）在一个请求里只创建一次，由参与这个请求的所有对象共享；组件则由整个应用共享。

在方法里，有两个属性描述当前请求：

- `this.context` 是请求的上下文。它的 `type` 表示传输方式，它的类提供该传输方式的细节：

  | 类 | `type` | 特有的属性 |
  |---|---|---|
  | `HTTPContext` | `'HTTP'` | `request`、`response`、`route`（声明时的路由）、`method` |
  | `CLIContext` | `'CLI'` | `command`（声明时的命令） |
  | `ServiceContext` | `'SERVICE'` | `clientId`、`input`（完整的消息） |
  | `ScheduleContext` | `'SCHEDULE'` | `schedule`、`scheduledAt`、`run` |
  | `QueueContext`（`lakutata/com/queue`） | `'QUEUE'` | 见 [Queue](Queue.md) |

  所有上下文都有 `data`（输入到达时的样子，尚未校验）和 `locale`（使用 I18n 中间件时，请求的语言）。
- `this.signal` 是一个 `AbortSignal`。请求被中止时它会触发：客户端离开、gRPC 调用的截止时间已过，或者应用正在停止而 `shutdownTimeout` 已用完。触发之后，动作的结果会被丢弃；耗时长的动作应该检查它并提前结束。

## 3. 动作装饰器

| 装饰器 | 地址 | 指南 |
|---|---|---|
| `@GET(route)`、`@POST`、`@PUT`、`@PATCH`、`@DELETE`、`@HEAD`、`@OPTIONS`、`@HTTPAction(route, methods)` | HTTP 路由 | [HTTP](HTTP.md) |
| `@CLIAction(command)` | 命令 | [CLI](CLI.md) |
| `@ServiceAction(pattern)` | 服务模式 | [ServiceCalls](ServiceCalls.md)、[GRPC](GRPC.md)、[NATS](NATS.md) |
| `@Schedule(schedule)` | 间隔或 cron 表达式 | [Schedules](Schedules.md) |
| `@QueueAction(queue)`（`lakutata/com/queue`） | 消息队列 | [Queue](Queue.md) |
| `@MCPTool(name)`（`@lakutata/mcp`）、`@DBusMethod(...)`（`@lakutata/dbus`） | MCP 工具、D-Bus 方法 | [MCP](MCP.md)、[DBus](DBus.md) |

除非表中注明了其他子路径，前五行的装饰器都来自 `lakutata/decorator/ctrl`。它们依次接受地址、输入的 DTO 类和动作选项，DTO 和选项都可以省略。`@Schedule` 是例外：它不接受 DTO，因为定时任务没有输入。

动作选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `name` | `'控制器类名:方法名'` | 动作名，在同一传输方式中必须唯一 |
| `description` | | 说明：命令的帮助、动作列表中的描述 |
| `middlewares` | | 这个动作的中间件（见 [Middlewares](Middlewares.md)） |
| `acl` | `false` | 用入口的访问规则检查请求 |
| `rule` | | 这个动作自己的访问规则：`(context, input) => Promise<boolean>` |
| `groups` | | 动作所属的分组，访问规则和动作列表会用到（见 [Entrypoint](Entrypoint.md)） |

## 4. 输入

各传输方式从请求中组装输入：

| 传输方式 | 输入 |
|---|---|
| HTTP | 查询参数和请求体，路由参数覆盖在上面 |
| 命令行 | 参数和选项 |
| 服务 | 消息，去掉模式中的键 |
| 定时任务 | 无 |
| 消息队列 | 消息 |

然后由动作的 DTO 校验：

- 能转换时，值会被转换成校验规则要求的类型。查询参数、路由参数和命令行参数都是文本：要求数字的规则需要 `.strict(false)` 才能接受 `'42'`；
- 补上默认值，去掉 DTO 没有声明的键（上例中的 `extra`）；
- 输入不合法时，请求以 `InvalidValueException` 结束，HTTP 返回状态码 400。消息指出第一个不合法的值：`"product" is required`。使用 I18n 中间件时，消息是请求的语言。

方法收到的是校验后的输入，一个普通对象的副本：它不是 DTO 类的实例，DTO 类只为它提供类型。没有 DTO 的动作收到的是原样的输入，所有键都保留。

## 5. 结果

方法的返回值由传输方式发送回去：

| 传输方式 | 返回值 | `undefined` | 抛出的错误 |
|---|---|---|---|
| HTTP | JSON | 状态码 204 | 它的 `statusCode`（默认 500）和 `{errno, errMsg}` |
| 命令行 | 写到 stdout：文本原样输出，其他值输出为 JSON | 不输出 | stderr 上的 `error: <消息>`，退出码 1 |
| 服务 | `{success: true, error: null, payload}` | 没有 `payload` | `{success: false, error, payload: null}`，错误带着它的全部属性 |
| 定时任务 | 忽略 | | 交给 `onError`，或者写入日志 |

`lakutata/com/entrypoint` 中的 `Result` 可以更细地控制响应：

- `Result.status(status, data, headers)`：带着数据指定 HTTP 状态码和响应头；
- `Result.file(path)`（也可以是 `Buffer` 或流，选项有 `{filename, contentType, etag, headers}`）：一个文件，给出 `filename` 时作为下载；
- `Result.events(producer)`：在 HTTP 上是 Server-Sent Events，在命令行上输出每个事件的数据。生产函数 `(send, signal) => …` 在请求的作用域销毁之后才运行，所以它应该使用组件，而不是请求作用域内的提供者。

服务传输方式不能发送文件或事件：这样的结果会让请求失败。

## 6. 前缀

在控制器上加 `@Prefix`，可以给它所有动作的地址加上前缀：

```typescript
import {DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction, GET, Prefix, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'

class UserIdDTO extends DTO {
    @Expect(DTO.String().required())
    public id: string
}

@Prefix({route: '/users', command: 'user', pattern: {resource: 'user'}})
class UserController extends Controller {
    //GET /users/:id、命令 "user:get <id>"、消息 {resource: 'user', act: 'get', id}
    @GET('/:id', UserIdDTO)
    @CLIAction('get <id>', UserIdDTO)
    @ServiceAction({act: 'get'}, UserIdDTO)
    public async get(input: UserIdDTO): Promise<{ id: string }> {
        return {id: input.id}
    }
}
```

- `route` 加在 HTTP 路由前面，`command` 加在命令前面（用冒号连接），`pattern` 合并进服务模式。同一个键在前缀和动作里取值不同会报错（`InvalidPrefixException`）。
- 定时任务没有前缀。
- 控制器使用离它最近的、声明了前缀的类的前缀：先看自己，没有再看父类。

## 7. 继承

控制器会继承父类的动作，所以通用的动作可以在基类里只写一次。注册的子类会在自己的前缀下提供这些动作：

```typescript
import {Controller} from 'lakutata/com/entrypoint'
import {GET, Prefix} from 'lakutata/decorator/ctrl'

abstract class HealthController extends Controller {
    @GET('/health')
    public async health(): Promise<string> {
        return 'ok'
    }
}

//GET /v1/health
@Prefix({route: '/v1'})
class V1Controller extends HealthController {
}

//GET /v2/health
@Prefix({route: '/v2'})
class V2Controller extends HealthController {
}
```

- 只注册子类（`controllers: [V1Controller, V2Controller]`）。如果父类和子类一起注册，而某个动作的地址相同，它们会冲突：后注册的生效。
- 子类可以重写继承来的方法：动作保持原来的地址，执行新的代码。在重写的方法上再加装饰器，会增加一个地址，继承来的地址仍然保留。
- 基类可以是抽象类。
