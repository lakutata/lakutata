# Lakutata 控制器与动作

控制器是一个类，其方法用于响应请求，这些方法称为**动作**。装饰器为动作指定地址（HTTP 路由、命令、服务模式、定时计划、消息队列），请求到达该地址时，由 `entrypoint` 组件调用动作。同一个方法可以拥有多个地址，因此同一段代码可以同时通过 HTTP、命令行和服务传输方式响应请求，并使用相同的校验、中间件和访问控制。

## 1. 一个控制器

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {CLIAction, GET, POST, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'

class OrderIdDTO extends DTO {
    //路由参数是文本：strict(false) 会转换它（命令行会自行转换它的参数）
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
- 控制器列在 `buildEntrypoints` 的 `controllers` 选项中，与各传输方式的适配器并列（见[入口](Entrypoint.md)）。入口必须列在 `bootstrap` 中，否则入口不会被创建。
- 没有对应的适配器时，传输方式的装饰器不起作用。例如在上例中，若没有 `cli`，`@CLIAction` 将被忽略。

## 2. 请求的处理过程

1. 适配器收到请求后，按地址查找动作。未找到时，传输方式返回“未找到”（HTTP 为 404）。
2. 为该请求创建新的作用域。
3. 执行中间件（见[中间件与访问控制](Middlewares.md)）。
4. 在该作用域中创建控制器的新实例。
5. 动作的 DTO 校验输入（第 4 节）。
6. 访问控制检查请求（见[中间件与访问控制](Middlewares.md)）。
7. 以输入调用方法，方法的返回值即为响应（第 5 节）。
8. 销毁作用域及其中创建的对象。

因此，一个控制器仅在一个请求期间存活。其注入的 `@Scoped` 提供者（提供者默认即为此生命周期类型）在一个请求中只创建一次，由参与该请求的所有对象共享；组件则由整个应用共享。

在方法中，以下两个属性描述当前请求：

- `this.context` 是请求的上下文。其 `type` 表示传输方式，上下文的类则提供该传输方式的细节：

  | 类 | `type` | 特有的属性 |
  |---|---|---|
  | `HTTPContext` | `'HTTP'` | `request`、`response`、`route`（声明时的路由）、`method` |
  | `CLIContext` | `'CLI'` | `command`（声明时的命令） |
  | `ServiceContext` | `'SERVICE'` | `clientId`、`input`（完整的消息） |
  | `ScheduleContext` | `'SCHEDULE'` | `schedule`、`scheduledAt`、`run` |
  | `QueueContext`（`lakutata/com/queue`） | `'QUEUE'` | 见[消息队列](Queue.md) |

  所有上下文都具有 `data`（到达时的原始输入，尚未校验）和 `locale`（使用 I18n 中间件时，为请求的语言）。
- `this.signal` 是一个 `AbortSignal`（其类型允许 `undefined`，因此需写作 `this.signal?.`）。请求被中止时，该信号随之触发：客户端关闭了连接或取消了调用、gRPC 调用的截止时间已过，或者应用正在停止且 `shutdownTimeout` 已耗尽。信号触发之后，动作的结果将被丢弃；耗时较长的动作应检查该信号并提前结束。

## 3. 动作装饰器

| 装饰器 | 地址 | 指南 |
|---|---|---|
| `@GET(route)`、`@POST`、`@PUT`、`@PATCH`、`@DELETE`、`@HEAD`、`@OPTIONS`、`@HTTPAction(route, methods)` | HTTP 路由 | [HTTP](HTTP.md) |
| `@CLIAction(command)` | 命令 | [命令行](CLI.md) |
| `@ServiceAction(pattern)` | 服务模式 | [服务调用](ServiceCalls.md)、[gRPC](GRPC.md)、[NATS](NATS.md) |
| `@Schedule(schedule)` | 间隔或 cron 表达式 | [定时任务](Schedules.md) |
| `@QueueAction(queue)`（`lakutata/com/queue`） | 消息队列 | [消息队列](Queue.md) |
| `@MCPTool(name)`（`@lakutata/mcp`）、`@DBusMethod(...)`（`@lakutata/dbus`） | MCP 工具、D-Bus 方法 | [MCP](MCP.md)、[D-Bus](DBus.md) |

除非表中注明了其他子路径，前五行的装饰器均来自 `lakutata/decorator/ctrl`。这些装饰器依次接受地址、输入的 DTO 类和动作选项，其中 DTO 和选项都可以省略。`@Schedule` 是例外，它不接受 DTO，因为定时任务没有输入。

动作选项：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `name` | `'控制器类名:方法名'` | 动作的名称，在同一传输方式中必须唯一 |
| `description` | | 说明文字，用于命令的帮助和动作列表中的描述 |
| `middlewares` | | 该动作的中间件（见[中间件与访问控制](Middlewares.md)） |
| `acl` | `false` | 使用入口的访问规则检查请求 |
| `rule` | | 该动作自身的访问规则：`(context, input) => Promise<boolean>` |
| `groups` | | 动作所属的分组，供访问规则和动作列表使用（见[入口](Entrypoint.md)） |

## 4. 输入

各传输方式从请求中组装输入：

| 传输方式 | 输入 |
|---|---|
| HTTP | 查询参数和请求体，路由参数覆盖其上 |
| 命令行 | 参数和选项 |
| 服务 | 消息（去除模式中的键） |
| 定时任务 | 无 |
| 消息队列 | 消息 |

随后由动作的 DTO 校验输入：

- 查询参数和路由参数的值均为文本，因此要求数字或布尔值的规则需要 `.strict(false)` 才能转换 `'42'` 或 `'true'`。命令行则会自行将参数和选项转换为对应属性的类型（见[命令行](CLI.md)）；
- 补全默认值，并去除 DTO 未声明的键（如上例中的 `extra`）；
- 输入不合法时，请求以 `InvalidValueException` 结束，HTTP 返回状态码 400。消息指出第一个不合法的值，例如 `"product" is required`。使用 I18n 中间件时，消息使用请求的语言。

方法收到的是校验后的输入，即一个普通对象的副本，而非 DTO 类的实例；DTO 类仅为该输入提供类型。未声明 DTO 的动作收到原样的输入，所有键均保留。

## 5. 结果

方法的返回值由传输方式发回：

| 传输方式 | 返回值 | `undefined` | 抛出的错误 |
|---|---|---|---|
| HTTP | JSON | 状态码 204 | 错误的 `statusCode`（默认 500）和 `{errno, errMsg}` |
| 命令行 | 写入 stdout，文本原样输出，其他值输出为 JSON | 不输出 | stderr 上的 `error: <消息>`，退出码 1 |
| 服务 | `{success: true, error: null, payload}` | 不含 `payload` | `{success: false, error, payload: null}`，错误包含其全部属性 |
| 定时任务 | 忽略 | | 交由 `onError` 处理，或写入日志 |

`lakutata/com/entrypoint` 中的 `Result` 可以更精细地控制响应：

- `Result.status(status, data, headers)`：在返回数据的同时指定 HTTP 状态码和响应头；
- `Result.file(path)`（参数也可以是 `Buffer` 或流，选项为 `{filename, contentType, etag, headers}`）：返回一个文件，指定 `filename` 时作为下载文件；
- `Result.events(producer)`：在 HTTP 上为 Server-Sent Events，在命令行上则输出每个事件的数据。生产函数 `(send, signal) => …` 在请求的作用域销毁之后才运行，因此应使用组件，而不是请求作用域内的提供者。

服务传输方式无法发送文件或事件，此类结果会导致请求失败。

## 6. 前缀

在控制器上添加 `@Prefix`，可以为该控制器所有动作的地址加上前缀：

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

- `route` 加在 HTTP 路由之前，`command` 加在命令之前（以冒号连接），`pattern` 合并到服务模式中。同一个键在前缀和动作中取值不同时会报错（`InvalidPrefixException`）。
- 定时任务没有前缀。
- 控制器的前缀取自最近一个声明了前缀的类，即先查找控制器自身，若未声明，再查找父类。

## 7. 继承

控制器会继承父类的动作，因此通用的动作只需在基类中编写一次。注册的子类会在自身的前缀下提供这些动作：

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

- 只注册子类（`controllers: [V1Controller, V2Controller]`）。如果父类和子类一同注册，且某个动作的地址相同，二者会发生冲突，后注册的生效。
- 子类可以重写继承的方法，此时动作保持原来的地址，执行新的代码。在重写的方法上再添加装饰器会增加一个地址，继承的地址仍然保留。
- 基类可以是抽象类。
