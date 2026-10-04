# Lakutata 控制器与动作

`Entrypoint` 组件（`lakutata/com/entrypoint`，`@lakutata/entrypoint` 包）通过多种传输方式对外提供控制器的方法，即**动作**。动作的地址可以是 HTTP 路由、CLI 命令、服务模式或定时计划，同一个方法可以同时拥有多个地址：无论通过哪种传输方式调用，它的输入都以相同的方式经过 DTO 校验、访问控制和中间件。更多细节见 `@lakutata/entrypoint` 的 README，以及 `lakutata/com/entrypoint` 和 `lakutata/decorator/ctrl` 的类型声明。

## 1. 控制器

控制器继承 `Controller`（`lakutata/com/entrypoint`），它是一个生命周期为 `@Scoped`（锁定）的提供者：每次请求都会在该请求的作用域中创建自己的控制器，请求结束时销毁；控制器注入的提供者也属于该请求的作用域。

- `this.context` 是请求的上下文：`HTTPContext`（含 `request`、`response`、`route`、`method`）、`CLIContext`（含 `command`）、`ServiceContext`（含 `clientId`）或 `ScheduleContext`；可通过类或 `type` 区分。
- `this.signal` 是一个 `AbortSignal`，在请求被中止时触发：客户端断开、超过截止时间或入口正在停止。耗时较长的动作应随之停止，因为它的结果会被丢弃。
- 方法接收的输入（请求的数据，经动作的 DTO 校验，填充默认值并移除未知字段）是一个普通对象，而不是 DTO 实例。没有 DTO 时，输入原样传入。
- 返回值就是响应；抛出的异常以其 `statusCode`（HTTP）以及 `errno` 和消息作为响应，输入不合法时返回状态码 400。

```typescript
import {Application, DTO} from 'lakutata'
import {BuildEntrypoints, Controller, ScheduleEntrypoint} from 'lakutata/com/entrypoint'
import {CLIAction, GET, POST, Schedule, ServiceAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {ExpressHTTPEntrypoint} from 'lakutata/adapter/express'
import {CommanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {SocketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'

class GetOrderDTO extends DTO {
    //路由参数和查询参数都是字符串：strict(false) 会转换它们
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
    //GET /orders/42、命令 "order --id 42"、服务消息 {cmd: 'order.get', id: 42}
    @GET('/orders/:id', GetOrderDTO)
    @CLIAction('order', GetOrderDTO)
    @ServiceAction({cmd: 'order.get'}, GetOrderDTO)
    public async get(input: GetOrderDTO): Promise<{ id: number }> {
        return {id: input.id}
    }

    //POST /orders，请求体为 JSON
    @POST('/orders', CreateOrderDTO)
    public async create(input: CreateOrderDTO): Promise<{ product: string, quantity: number }> {
        return input
    }

    //每 5 分钟执行一次
    @Schedule('5m')
    public async report(): Promise<void> {
    }
}

Application.run(() => ({
    id: 'orders.app',
    name: 'Orders',
    components: {
        entrypoint: BuildEntrypoints({
            controllers: [OrderController],
            http: ExpressHTTPEntrypoint({port: 8080}),
            cli: CommanderCLIEntrypoint(),
            service: SocketIOServiceEntrypoint({port: 8081}),
            schedule: ScheduleEntrypoint()
        })
    },
    bootstrap: ['entrypoint']
}))
```

## 2. 动作装饰器（`lakutata/decorator/ctrl`）

每个装饰器的参数依次为：地址，可选的输入 DTO 类，可选的动作选项（`acl`、`name`、`description`、`groups`、`rule`、`middlewares`）。

### HTTP：`@HTTPAction`、`@GET`、`@POST`、`@PUT`、`@PATCH`、`@DELETE`、`@HEAD`、`@OPTIONS`

```text
@HTTPAction(route, method | methods, DTOClass?, options?)
@GET(route, DTOClass?, options?)
```

- 路由使用 HTTP 适配器的语法（`/users/:id`）；方法不区分大小写（`'get'`、`['get', 'post']`）。
- 输入由查询参数和解析后的请求体（JSON 或 URL 编码）合并而成，路由参数覆盖在其上。查询参数和路由参数都是字符串，而校验规则是严格的：用 `.strict(false)` 进行转换。
- 返回值以 JSON 响应（`undefined` 时为 204）。`lakutata/com/entrypoint` 中的 `Result.status(201, data, headers)`、`Result.file(path)` 和 `Result.events(producer)`（Server-Sent Events）用于控制响应。

### CLI：`@CLIAction`

```text
@CLIAction(command, DTOClass?, options?)
```

- 命令由名称和可选的位置参数组成（`'copy <source> [target]'`、`'<files...>'`）；名称前面的词是命令分组（`'package exe <file>'`）。DTO 的其他属性是选项（`--times 2`），布尔属性是开关（`--shout`）；校验规则的 `.description()` 是选项的帮助文本，动作选项 `description` 是命令的帮助文本。
- 返回值写到 stdout（字符串原样输出，其他值输出为 JSON）；错误写到 stderr，命令以退出码 1 结束。

### 服务：`@ServiceAction`

```text
@ServiceAction(pattern, DTOClass?, options?)
```

- 模式是一个对象（最多嵌套 2 层），消息必须包含这些键且值相同；字符串值可以是通配符（`'user.*'`）。匹配的模式中最具体的一个胜出。输入是去掉模式中各键后的消息。
- 调用方收到 `{success: true, error: null, payload}`，或 `{success: false, error, payload: null}`，其中 `error` 包含错误的各属性（`errno`、`errMsg`、`statusCode`、`message` 等）；JSON-RPC 则以它自己的 `result` 和 `error` 响应。没有模式匹配的消息会以 `ControllerActionNotFoundException` 失败。

### 定时任务：`@Schedule`

```text
@Schedule(schedule, options?)
```

当入口配置了定时适配器（`schedule: ScheduleEntrypoint()`）时，方法按计划执行。计划可以是时长（`'30s'`、`'1h30m'`，表示间隔）、cron 表达式（`'0 */5 * * * *'`，5 或 6 个字段，或 `'@daily'` 这样的宏），或者是 `{every}`、`{cron, timezone}` 形式的选项，并可附带：

- `overlap`（默认 `false`）：上一次执行尚未结束时也开始新的执行；否则跳过本次；
- `immediate`（默认 `false`）：应用启动后立即额外执行一次；
- `exclusive`（默认 `false`）：借助互斥锁组件，同一时间只在应用的一个实例中执行（`true` 使用名为 `mutex` 的组件，`{mutex, key}` 指定组件名和锁名）；见 [Mutex](Mutex.md)。

每次执行都有自己的作用域，并经过中间件和访问控制；方法接收空输入，`this.context` 是 `ScheduleContext`（含 `schedule`、计划时间、执行序号 `run`）。抛出的错误交给 `ScheduleEntrypoint` 的 `onError` 选项，或记录到日志，后续执行照常进行。

```typescript
import {Controller, ScheduleContext} from 'lakutata/com/entrypoint'
import {Schedule} from 'lakutata/decorator/ctrl'

class JobController extends Controller {
    //每 30 秒一次，并在应用启动后立即执行一次
    @Schedule({every: '30s', immediate: true})
    public async heartbeat(): Promise<void> {
        if (this.context instanceof ScheduleContext) console.log(`run ${this.context.run} of ${this.context.schedule}`)
    }

    //上海时间每天 03:00，同一时间只在一个实例中执行（需要名为 "mutex" 的互斥锁组件）
    @Schedule({cron: '0 3 * * *', timezone: 'Asia/Shanghai', exclusive: true}, {name: 'Purge the expired sessions'})
    public async purge(): Promise<void> {
    }
}
```

### 前缀：`@Prefix`

在控制器类上使用 `@Prefix({route, command, pattern})` 为它的动作添加前缀：`route` 加在 HTTP 路由之前，`command` 加在 CLI 命令之前（以 `:` 连接，`user` 和 `get` 得到 `user:get`），`pattern` 合并到服务模式中。

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

## 3. 中间件与访问控制

中间件包裹在动作外围执行，早于输入校验和访问控制：可以是函数 `(invocation, next) => Promise<unknown>`，也可以是 `Middleware` 类。可以把它们交给 `BuildEntrypoints({middlewares})`（作用于所有动作）、适配器的 `middlewares` 选项、控制器类或方法上的 `@UseMiddlewares(...)`，以及动作选项 `middlewares`。

```typescript
import {type ActionInvocation, Controller, type Next} from 'lakutata/com/entrypoint'
import {GET, UseMiddlewares} from 'lakutata/decorator/ctrl'

async function Timing(invocation: ActionInvocation, next: Next): Promise<unknown> {
    const started: number = Date.now()
    try {
        return await next()
    } finally {
        console.log(`${invocation.context.type} took ${Date.now() - started} ms`)
    }
}

@UseMiddlewares(Timing)
class HealthController extends Controller {
    @GET('/health')
    public async health(): Promise<string> {
        return 'ok'
    }
}
```

声明了 `{acl: true}` 的动作由 `BuildEntrypoints({rules})` 中的规则检查：规则是 `AccessControlRule` 的子类，每次请求都会创建，其 `rule()` 返回 `false` 时以 `AccessDeniedException`（HTTP 403）拒绝请求。动作选项 `rule` 是该动作自己的规则。

```typescript
import {AccessControlRule, ContextType, Controller, type HTTPContext} from 'lakutata/com/entrypoint'
import {DELETE} from 'lakutata/decorator/ctrl'

class AdminRule extends AccessControlRule<HTTPContext> {
    public get supportContextTypes(): ContextType[] {
        return [ContextType.HTTP]
    }

    public async rule(): Promise<boolean> {
        if (!this.targetAction.groups.includes('admin')) return true
        return this.context.request.headers['x-role'] === 'admin'
    }
}

class UserController extends Controller {
    @DELETE('/users/:id', {acl: true, groups: ['admin']})
    public async remove(input: { id: string }): Promise<void> {
    }
}

//BuildEntrypoints({controllers: [UserController], rules: [AdminRule], httpActionGroups: {admin: 'Administration'}})
```

动作的分组必须在 `BuildEntrypoints` 的 `httpActionGroups`、`cliActionGroups` 或 `serviceActionGroups` 中声明。`shutdownTimeout`（默认 30000 毫秒）是入口停止时留给正在处理的请求的时间。

## 4. 传输方式

| `BuildEntrypoints` 的选项 | 适配器 | 子路径 | 需安装 |
|---|---|---|---|
| `http` | `ExpressHTTPEntrypoint({port})` | `lakutata/adapter/express` | `express` |
| `http` | `FastifyHTTPEntrypoint({port})` | `lakutata/adapter/fastify` | `fastify` |
| `cli` | `CommanderCLIEntrypoint()` | `lakutata/adapter/commander` | `commander`（交互提示需要 `@inquirer/prompts`） |
| `service` | `SocketIOServiceEntrypoint({port})` | `lakutata/adapter/socket.io` | `socket.io` |
| `service` | `JSONRPCServiceEntrypoint()`（HTTP、WebSocket、stdio） | `lakutata/adapter/jsonrpc` | WebSocket 需要 `ws` |
| `service` | `ElectronIPCServiceEntrypoint()` | `lakutata/adapter/electron` | （Electron） |
| `service` | `HTTPServiceEntrypoint({port})`（`POST /`，事件通过 SSE 推送） | `lakutata/com/entrypoint` | |
| `service` | `GRPCServiceEntrypoint({port})` | `@lakutata/grpc/service` | `@lakutata/grpc` |
| `service` | `NatsServiceEntrypoint('nats')` | `@lakutata/nats` | `@lakutata/nats` |
| `schedule` | `ScheduleEntrypoint()` | `lakutata/com/entrypoint` | |

每个选项可以是一个适配器或适配器数组。`lakutata/com/entrypoint` 中的 `BuildHTTPEntrypoint`、`BuildCLIEntrypoint` 和 `BuildServiceEntrypoint` 用于以 lakutata 2.x 的风格编写入口函数，以接入其他库；`EntrypointAdapter`（来自 `@lakutata/entrypoint/channel`）是适配器的接口。

### 服务动作的客户端与推送事件

带客户端的服务适配器会把请求所属客户端的 id 放入上下文的 `ServiceContext.clientId`：`ElectronIPCServiceEntrypoint`（窗口中的每个页面）、`SocketIOServiceEntrypoint`（每个 socket，连接时通过 `auth.id` 或 `id` 请求头给出 id）、`HTTPServiceEntrypoint`（`POST` 请求的 `id` 请求头，事件流 `GET /events` 的 `id` 请求头或查询参数）、WebSocket 和 stdio 上的 `JSONRPCServiceEntrypoint`，以及 `GRPCServiceEntrypoint`（`id` 元数据）。入口组件用 `notify(clientId, event, ...args)` 向某个客户端推送事件（返回是否有客户端收到），用 `broadcast(event, ...args)` 向所有客户端推送（返回客户端数量）：

```typescript
import {Controller, Entrypoint, ServiceContext} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'

class TaskController extends Controller {
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint

    @ServiceAction({cmd: 'start'})
    public async start(): Promise<void> {
        const clientId: string | undefined = (this.context as ServiceContext).clientId
        if (clientId) setTimeout((): void => void this.entrypoint.notify(clientId, 'done', {task: 1}), 1000)
        this.entrypoint.broadcast('started', {task: 1})
    }
}
```

Electron 的渲染进程用 `window.ipc.on(event, listener)` 监听事件（Electron 模板中提供），socket 用 `socket.on(event, listener)`，HTTP 客户端通过 `GET /events` 的 Server-Sent Events 监听（`EventSource`、curl）。窗口中的页面在重新加载或窗口关闭之前都是同一个客户端。

### JSON-RPC 2.0

`JSONRPCServiceEntrypoint` 通过 JSON-RPC 2.0 提供服务动作：请求的 method 和（按名称给出的）params 就是动作的模式和输入，`{"method": "order.get", "params": {"id": 1}}` 会被分发为 `{method: 'order.get', id: 1}`（`methodField` 指定字段名，`toPattern(method, params)` 把它们映射为其他模式，`positionalParams` 接受按位置给出的 params）。批量请求和通知遵循规范；错误码为 `-32601`（没有匹配的动作）、`-32602`（DTO 拒绝了输入）和 `-32000`（动作抛出的错误，完整的错误对象放在 `data` 中）。传输方式有 HTTP（`POST`）、WebSocket（`ws` 包）和 stdio（按行或按 `Content-Length` 头分帧）；后两者以通知的形式推送客户端事件。在 WebSocket 上，不响应 ping 的连接会被关闭（`heartbeat`，30 秒）；在 stdio 上，输入结束后应用退出（`end: 'application'`）。

```text
service: [
    JSONRPCServiceEntrypoint({port: 4000, path: '/rpc'}),
    JSONRPCServiceEntrypoint({transport: 'websocket', port: 4001}),
    JSONRPCServiceEntrypoint({transport: 'stdio', framing: 'content-length'})
]
```

### gRPC 与 NATS

`GRPCServiceEntrypoint`（`@lakutata/grpc/service`）通过 gRPC 提供服务动作：服务 `lakutata.service.v1.Service`（`SERVICE_PROTO`，供其他语言的客户端使用）以模式和输入的 JSON 调用动作，并以流的形式推送客户端的事件。用 `BuildGRPCServiceProxy` 声明的 `GRPCServiceProxy` 调用远程应用的动作并监听其事件。调用的截止时间到达时会中止对应的动作（`this.signal`）。详见 `@lakutata/grpc` 的 README。

```typescript
import {Application} from 'lakutata'
import {BuildGRPCServiceProxy, type GRPCServiceProxy} from '@lakutata/grpc/service'

Application
    .run(() => ({
        id: 'shop.app',
        name: 'Shop',
        components: {
            orders: BuildGRPCServiceProxy({address: 'orders.internal:50051'})
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const orders: GRPCServiceProxy = await app.getObject<GRPCServiceProxy>('orders')
        orders.on('orderChanged', (order: { id: number }): void => console.log(order))
        console.log(await orders.invoke({cmd: 'order.get', id: 1}))
    })
```

`NatsServiceEntrypoint`（`@lakutata/nats`）通过 NATS 提供服务动作，订阅以应用 id 为名的主题，各实例共享同一个队列组；用 `BuildServiceProxy` 声明的 `ServiceProxy` 调用它们。详见 `@lakutata/nats` 的 README。
